import { GameData } from '../../shared/GameData.js';
import  {OpenAI}  from 'openai';
import { Config } from '../../shared/Config.js';
import { ApiConnection } from '../../shared/apiConnection.js';
import { checkInteractions } from './checkInteractions.js';
import { convertChatToText, buildChatPrompt, buildSummarizeTextPrompt, buildSummarizeChatPrompt } from './promptBuilder.js';
import { cleanMessageContent } from './messageCleaner.js';
import { summarize } from './summarize.js';
import fs from 'fs';
import path from 'path';

import {Message, MessageChunk, ResponseObject, ErrorMessage, Summary, Interaction} from '../ts/conversation_interfaces.js';
import { RunFileManager } from '../RunFileManager.js';

export class Conversation{
    isOpen: boolean;
    gameData: GameData;
    messages: Message[];
    config: Config;
    runFileManager: RunFileManager;
    textGenApiConnection: ApiConnection;
    summarizationApiConnection: ApiConnection;
    interactionApiConnection: ApiConnection;
    description: string;
    interactions: Interaction[];
    exampleMessages: Message[];
    summaries: Summary[];
    textgenParameters: Object;
    
    constructor(gameData: GameData, config: Config){
        this.isOpen = true;
        this.gameData = gameData;
        this.messages = [];

        this.summaries = [];
        if (!fs.existsSync(process.cwd()+`/conversation_summaries`)){
            fs.mkdirSync(process.cwd()+`/conversation_summaries`);
        }

        if (!fs.existsSync(`${process.cwd()}/conversation_summaries/${this.gameData.playerID}`)){
            fs.mkdirSync(`${process.cwd()}/conversation_summaries/${this.gameData.playerID}`);
        }
        
        if(fs.existsSync(`${process.cwd()}/conversation_summaries/${this.gameData.playerID}/${this.gameData.aiID}.json`)){
            this.summaries = JSON.parse(fs.readFileSync(`${process.cwd()}/conversation_summaries/${this.gameData.playerID}/${this.gameData.aiID}.json`, 'utf8'));
        }
        else{
            this.summaries = [];
            fs.writeFileSync(`${process.cwd()}/conversation_summaries/${this.gameData.playerID}/${this.gameData.aiID}.json`, JSON.stringify(this.summaries, null, '\t'));
        }

        this.config = config;

        //TODO: wtf
        this.runFileManager = new RunFileManager(config.userFolderPath);
        this.textGenApiConnection = new ApiConnection({});
        this.summarizationApiConnection = new ApiConnection({});
        this.interactionApiConnection = new ApiConnection({});
        this.description = "";
        this.interactions = [];
        this.exampleMessages = [],
        this.textgenParameters = [];
        
        this.loadConfig();
    }

    pushMessage(message: Message): void{           
        this.messages.push(message);
    }

    async generateNewAIMessage(streamRelay: (arg1: MessageChunk)=> void): Promise<ResponseObject>{
        let responseMessage: Message;

        if(this.textGenApiConnection.isChat()){
            

            responseMessage= {
                role: "assistant",
                name: this.gameData.aiName,
                content: await this.textGenApiConnection.complete(buildChatPrompt(this), this.config.stream, {
                    //stop: [this.gameData.playerName+":", this.gameData.aiName+":", "you:", "user:"],
                    max_tokens: this.config.maxTokens,
                    ...this.textgenParameters,
                },
                streamRelay)
            };  
            
        }
        //instruct
        else{

            responseMessage = {
                role: "assistant",
                name: this.gameData.aiName,
                content: await this.textGenApiConnection.complete(convertChatToText(buildChatPrompt(this), this.config.inputSequence, this.config.outputSequence), this.config.stream, {
                    stop: [this.config.inputSequence, this.config.outputSequence],
                    max_tokens: this.config.maxTokens,
                    ...this.textgenParameters
                },
                streamRelay)
            };
    
        }

        if(this.config.cleanMessages){
            responseMessage.content = cleanMessageContent(responseMessage.content);
        }

        this.pushMessage(responseMessage);

        let responseObject: ResponseObject = {
            message: responseMessage,
            interactions: await checkInteractions(this)
        }

        console.log(responseObject.interactions)

        return responseObject;
    }

    async summarize(){
        this.isOpen = false;
        this.runFileManager.write("trigger_event = talk_event.9002");
        setTimeout(()=>{
            this.runFileManager.clear();
        }, 500);

        if(this.messages.length < 6){
            console.log("Not enough messages for summarization, no summary have been saved from this conversation!");
            return;
        }

        let summary = {
            date: this.gameData.date,
            content: await summarize(this)
        }

        this.summaries.unshift(summary)

        fs.writeFileSync(`${process.cwd()}/conversation_summaries/${this.gameData.playerID}/${this.gameData.aiID}.json`, JSON.stringify(this.summaries, null, '\t'));
    }

    updateConfig(config: Config){
        console.log("config updated!")
        this.loadConfig();
    }

    loadConfig(){
        this.textgenParameters = [];

        console.log(this.config.toSafeConfig());

        this.runFileManager = new RunFileManager(this.config.userFolderPath);
        this.runFileManager.clear();

        this.textgenParameters = {temperature: this.config.temperature, frequency_penalty: this.config.frequency_penalty, presence_penalty: this.config.presence_penalty, top_p: this.config.top_p};

        this.description = "";
        this.exampleMessages = [];
        try{
            delete require.cache[require.resolve(process.cwd()+`/custom/scripts/description/${this.config.selectedDescScript}`)];
            this.description = require(process.cwd()+`/custom/scripts/description/${this.config.selectedDescScript}`)(this.gameData.date, this.gameData.scene, this.gameData.location, this.gameData.characters.get(this.gameData.playerID), this.gameData.characters.get(this.gameData.aiID)); 
        }catch(err){
            throw new Error("description script error, your used description script file is not valid! error message:\n"+err);
        }
        try{
            delete require.cache[require.resolve(process.cwd()+`/custom/scripts/example messages/${this.config.selectedExMsgScript}`)];
            this.exampleMessages= require(process.cwd()+`/custom/scripts/example messages/${this.config.selectedExMsgScript}`)(this.gameData.date, this.gameData.scene, this.gameData.location, this.gameData.characters.get(this.gameData.playerID), this.gameData.characters.get(this.gameData.aiID));
        }catch(err){
            throw new Error("example messages script error, your used example messages file is not valid! error message:\n"+err);
        }
    
        this.loadInteractions();

        this.textGenApiConnection = new ApiConnection(this.config.textGenerationApiConnection);

        if(this.config.summarizationUseTextGenApi){
            this.summarizationApiConnection = this.textGenApiConnection;
        }
        else{
            this.summarizationApiConnection = new ApiConnection(this.config.summarizationApiConnection);
        }
        
        if(this.config.interactionUseTextGenApi){;
            this.interactionApiConnection = this.textGenApiConnection;
        }
        else{
            this.interactionApiConnection = new ApiConnection(this.config.interactionApiConnection);
        }
    }

    async loadInteractions(){
        this.interactions = [];

        let actionFiles = fs.readdirSync(`${process.cwd()}/custom/actions/`).filter(file => path.extname(file) === ".js");

        for(const file of actionFiles) {

            if(this.config.disabledInteractions.includes(path.basename(file).split(".")[0])){
                continue;
            }
    
            this.interactions.push(require(`${process.cwd()}/custom/actions/${file}`));
            console.log(`loaded interaction: `+file)
        }
    }

}