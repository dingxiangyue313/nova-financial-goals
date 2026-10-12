import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root=fileURLToPath(new URL("..",import.meta.url));
const runner=path.join(root,"scripts","run-framework.mjs");
let child;
let stopping=false;
let restarts=0;

function start(){
  child=spawn(process.execPath,["--max-old-space-size=4096",runner,"dev"],{cwd:root,stdio:"inherit",windowsHide:true});
  child.on("exit",(code,signal)=>{
    if(stopping)return;
    restarts+=1;
    const delay=Math.min(restarts*1000,5000);
    process.stderr.write(`Local preview exited (${code??signal}); restarting in ${delay}ms.\n`);
    setTimeout(start,delay);
  });
}

function stop(){stopping=true;child?.kill();}
process.on("SIGINT",stop);
process.on("SIGTERM",stop);
start();
