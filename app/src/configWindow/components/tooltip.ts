import { ipcMain, ipcRenderer } from 'electron';
import { Config } from '../../shared/Config';
import fs from 'fs';
import path from 'path';

const template = document.createElement("template");

function defineTemplate(side:string){
    return `
    <link rel="stylesheet" href="../../public/configWindow/launcher.css"/>
    <style>
    </style>
    <div class="tooltip tooltip-${side}"> <img src="../../public/assets/tooltip2.png" height="15" wdith="15">
        <span class="tooltiptext tooltiptext-${side}"><slot></slot></span>
    </div>
    `
}

    

class Tooltip extends HTMLElement{
    shadow: any;
    side: string;

    constructor(){
        super();
        this.side = this.getAttribute("side")!;
        this.shadow = this.attachShadow({mode: "open"});
        template.innerHTML = defineTemplate(this.side);
        this.shadow.append(template.content.cloneNode(true));

        

    }


    static get observedAttributes(){
        return ["side"]
    }

    connectedCallback(){
        
    }
}




customElements.define("tooltip-text", Tooltip);