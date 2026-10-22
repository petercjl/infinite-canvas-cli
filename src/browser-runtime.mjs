import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {execute,Fault,need,lock,sleep} from './core.mjs';

export const CDP='http://127.0.0.1:9223';
export const PROFILE_NAME='.dianshang-chrome-profile';
const escapeRE=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const powershell=env=>path.win32.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const psPrefix='$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); ';
export function windowsListeners(output){
  return String(output).split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(row=>row.length===5&&/^TCP$/i.test(row[0])&&row[1].endsWith(':9223')&&/^\d+$/.test(row[4])&&['0.0.0.0:0','[::]:0'].includes(row[2])).map(row=>({pid:Number(row[4]),address:row[1].slice(0,-5).replace(/^\[|\]$/g,'')}));
}

export function chromeCandidates({platform=process.platform,env=process.env,home=os.homedir()}={}){
  const p=platform==='win32'?path.win32:path.posix;
  if(env.INFINITE_CANVAS_CHROME_BIN)return [env.INFINITE_CANVAS_CHROME_BIN];
  if(platform==='darwin')return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',p.join(home,'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')];
  if(platform==='win32')return [...new Set([env.LOCALAPPDATA||p.join(home,'AppData','Local'),env.ProgramFiles||env.PROGRAMFILES||'C:\\Program Files',env['ProgramFiles(x86)']||env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)'].map(root=>p.join(root,'Google','Chrome','Application','chrome.exe')))];
  return [];
}
export function dedicatedCommand(command,profile,platform=process.platform){
  let c=String(command||''),expected=profile;
  if(platform==='win32'){c=c.replaceAll('\\','/').toLowerCase();expected=expected.replaceAll('\\','/').toLowerCase();}
  const flag=(name,value)=>new RegExp('(?:^|[\\s"])--'+name+'(?:=|\\s+)"?'+escapeRE(value)+'"?(?=$|[\\s"])').test(c);
  return flag('remote-debugging-port','9223')&&flag('user-data-dir',expected)&&!/(?:^|[\s"])--no-sandbox(?:[\s"]|$)/.test(c)&&(!c.includes('--remote-debugging-address')||flag('remote-debugging-address','127.0.0.1'));
}
export function chromeArgs(profile,{headless=false,startupUrl='https://sealseek.cn/board/'}={}){
  return ['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9223','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',...(headless?['--headless=new']:[]),startupUrl];
}
async function listening(){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port:9223});let done=false;const finish=v=>{if(done)return;done=true;socket.destroy();resolve(v);};socket.setTimeout(800,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});}
async function launch(executable,args){
  const child=spawn(executable,args,{detached:true,stdio:'ignore',windowsHide:false});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return child.pid;
}

export class ChromeRuntime {
  constructor({platform=process.platform,env=process.env,home=os.homedir(),access=async file=>{const stat=await fs.stat(file);if(!stat.isFile())return false;await fs.access(file,platform==='win32'?constants.F_OK:constants.X_OK);return true;},exec=execute,probe=listening,fetcher=fetch,launchProcess=launch,mkdir=dir=>fs.mkdir(dir,{recursive:true,mode:0o700}),pause=sleep,headless=false,startupUrl}={}){
    Object.assign(this,{platform,env,home,access,exec,probe,fetcher,launchProcess,mkdir,pause,headless,startupUrl});
    this.paths=platform==='win32'?path.win32:path.posix;this.profile=this.paths.join(home,PROFILE_NAME);
  }
  async discover(){
    for(const file of chromeCandidates(this)){try{if(await this.access(file))return {installed:true,executable:file,source:this.env.INFINITE_CANVAS_CHROME_BIN?'configured':'standard-location'};}catch{}}
    if(this.env.INFINITE_CANVAS_CHROME_BIN)return {installed:false,executable:this.env.INFINITE_CANVAS_CHROME_BIN,source:'configured',error:{code:'CHROME_NOT_FOUND',message:'Configured Chrome executable is unavailable.'}};
    if(this.platform==='win32'){
      for(const key of ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe','HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe']){
        try{const {stdout}=await this.exec('reg.exe',['query',key,'/ve'],{timeout:3000,windowsHide:true});let file=stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]?.trim().replace(/^"|"$/g,'');if(file){file=file.replace(/%([^%]+)%/g,(_,name)=>Object.entries(this.env).find(([k])=>k.toLowerCase()===name.toLowerCase())?.[1]||'%'+name+'%');if(await this.access(file))return {installed:true,executable:file,source:'windows-app-paths'};}}catch{}
      }
    }
    return {installed:false,source:'system-discovery',error:{code:['darwin','win32'].includes(this.platform)?'CHROME_NOT_FOUND':'UNSUPPORTED_PLATFORM',message:'Install Google Chrome, or provide its executable with INFINITE_CANVAS_CHROME_BIN.'}};
  }
  async owners(){
    if(this.platform==='win32'){
      const network=await this.exec(path.win32.join(this.env.SystemRoot||this.env.WINDIR||'C:\\Windows','System32','netstat.exe'),['-ano','-p','tcp'],{timeout:5000,maxBuffer:2*1024*1024,windowsHide:true});
      const connections=windowsListeners(network.stdout),pids=[...new Set(connections.map(p=>p.pid))];if(!pids.length)return [];
      const script=psPrefix+'$result=@(foreach($id in @('+pids.join(',')+')){ $p=Get-CimInstance Win32_Process -Filter ("ProcessId = "+$id); [pscustomobject]@{pid=$p.ProcessId;name=$p.Name;command=$p.CommandLine} }); ConvertTo-Json -InputObject $result -Compress';
      const {stdout}=await this.exec(powershell(this.env),['-NoProfile','-NonInteractive','-Command',script],{timeout:8000,maxBuffer:1024*1024,windowsHide:true});const data=JSON.parse(stdout.replace(/^\uFEFF/,''));return (Array.isArray(data)?data:[data]).map(p=>({...p,addresses:connections.filter(c=>c.pid===p.pid).map(c=>c.address)}));
    }
    if(this.platform==='darwin'){
      const {stdout}=await this.exec('/usr/sbin/lsof',['-b','-nP','-t','-iTCP:9223','-sTCP:LISTEN'],{timeout:5000});const pids=[...new Set(stdout.trim().split(/\s+/).filter(v=>/^\d+$/.test(v)))];
      return Promise.all(pids.map(async pid=>({pid:Number(pid),command:(await this.exec('/bin/ps',['-p',pid,'-o','command='],{timeout:3000})).stdout.trim()})));
    }
    throw new Fault('UNSUPPORTED_PLATFORM','Built-in Chrome startup currently supports macOS and Windows.');
  }
  async inspect(chrome){
    if(!await this.probe())return {state:'stopped',running:false,ready:false};
    let owners;
    try{owners=await this.owners();}catch{return {state:'conflict',running:true,ready:false,error:{code:'BROWSER_OWNERSHIP_UNVERIFIED',message:'Port 9223 is occupied, but its process/profile could not be verified.'}};}
    const matches=owners.length>0&&owners.every(p=>dedicatedCommand(p.command,this.profile,this.platform)&&(this.platform==='win32'?p.name?.toLowerCase()==='chrome.exe'&&p.addresses?.length&&p.addresses.every(a=>['127.0.0.1','::1'].includes(a)):p.command.startsWith(chrome.executable+' ')||p.command.startsWith('"'+chrome.executable+'" ')));
    if(!matches)return {state:'conflict',running:true,ready:false,error:{code:'BROWSER_PORT_CONFLICT',message:'Port 9223 belongs to another process, profile, or non-loopback listener. Preserve it and resolve the conflict.'}};
    try{
      const response=await this.fetcher(CDP+'/json/version',{signal:AbortSignal.timeout(1500),redirect:'error'});const data=await response.json(),ws=new URL(data.webSocketDebuggerUrl);
      need(response.ok&&/^(?:Headless)?Chrome\//.test(data.Browser)&&ws.protocol==='ws:'&&ws.hostname==='127.0.0.1'&&ws.port==='9223','BROWSER_UNAVAILABLE','Chrome CDP response is invalid.');
      return {state:'ready',running:true,ready:true,pids:owners.map(p=>p.pid),browser:data.Browser};
    }catch{return {state:'starting',running:true,ready:false,pids:owners.map(p=>p.pid)};}
  }
  async status(){
    const chrome=await this.discover();const runtime=await this.inspect(chrome);
    return {ok:(chrome.installed||runtime.ready)&&!runtime.error,available:chrome.installed||runtime.ready,chrome,...runtime,cdp:CDP,profile:this.profile,source:'built-in',...(chrome.error&&!runtime.ready?{error:chrome.error}:{}),next_action:runtime.ready?'open-or-reuse-board':chrome.installed&&!runtime.error?'browser open':runtime.error?'resolve-port-conflict':'install-google-chrome'};
  }
  async configuredLauncher(action){
    const file=this.env.INFINITE_CANVAS_BROWSER_BIN;if(!file)return null;
    let value;try{const r=await this.exec(file,[action,'--json'],{timeout:30000});value=JSON.parse(r.stdout);}catch(e){try{value=JSON.parse(e.stdout);}catch{throw new Fault('BROWSER_UNAVAILABLE','Configured browser launcher is unavailable.');}}
    need(value.cdp===CDP&&this.paths.resolve(value.profile||'')===this.profile,'PROFILE_MISMATCH','Configured launcher must use port 9223 and the current-user dedicated profile.');
    const own=await this.status();need(!own.error,own.error?.code||'BROWSER_UNAVAILABLE',own.error?.message||'Browser verification failed.');return {...own,source:'configured-launcher'};
  }
  async open({timeoutMs=25000}={}){
    if(this.env.INFINITE_CANVAS_BROWSER_BIN){await this.configuredLauncher('open');const result=await this.status();need(result.ready,'BROWSER_UNAVAILABLE','Configured launcher did not make Chrome ready.');return result;}
    const end=Date.now()+timeoutMs;
    while(Date.now()<end){
      try{return await lock('browser-start:'+this.profile,async()=>{
        let state=await this.status();if(state.ready)return {...state,reused:true,started:false};
        need(!state.error,state.error?.code||'BROWSER_UNAVAILABLE',state.error?.message||'Browser is unavailable.');
        need(state.chrome.installed,'CHROME_NOT_FOUND','Google Chrome is unavailable.');
        if(!state.running){await this.mkdir(this.profile);await this.launchProcess(state.chrome.executable,chromeArgs(this.profile,{headless:this.headless,startupUrl:this.startupUrl}));}
        const started=!state.running;while(Date.now()<end){await this.pause(300);state=await this.status();need(!state.error,state.error?.code||'BROWSER_UNAVAILABLE',state.error?.message||'Browser start conflict.');if(state.ready)return {...state,started,reused:!started};}
        throw new Fault('BROWSER_START_TIMEOUT','Chrome did not become ready. Check whether this dedicated profile is already open without debugging; preserve its files and existing browser processes.');
      });}catch(e){if(e.code!=='BUSY')throw e;await this.pause(300);}
    }
    throw new Fault('BUSY','Another process is preparing the dedicated Chrome browser.');
  }
}
