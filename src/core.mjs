import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export {execute} from './process-execution.mjs';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const META=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8'));
export class Fault extends Error {constructor(code,message,details={}){super(message);this.code=code;this.details=details;}}
export function need(value,code,message,details){if(!value)throw new Fault(code,message,details);return value;}
export const canonical=v=>JSON.stringify(sort(v));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const hash=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)?v:typeof v==='string'?v:canonical(v)).digest('hex');
export const stateRoot=()=>path.resolve(process.env.INFINITE_CANVAS_STATE_DIR||path.join(os.homedir(),'.local','share','infinite-canvas'));
export const exists=async p=>!!await fs.lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
export const readJSON=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export async function mkdir(p){await fs.mkdir(p,{recursive:true,mode:0o700});}
export async function newFile(p,data){need(!await exists(p),'OUTPUT_EXISTS','Preserve the existing file.',{path:p});await mkdir(path.dirname(p));await fs.writeFile(p,data,{flag:'wx',mode:0o600});return p;}
export const newJSON=(p,data)=>newFile(p,JSON.stringify(data,null,2)+'\n');
export async function replaceOwned(p,data){
  if(!await exists(p))return newJSON(p,data);
  const stat=await fs.lstat(p);need(stat.isFile()&&!stat.isSymbolicLink(),'UNMANAGED_STATE','State must be a regular file.');
  const old=await readJSON(p);need(old.owner===META.name,'UNMANAGED_STATE','Preserve user-owned state.',{path:p});
  const backup=p+'.'+crypto.randomUUID()+'.backup';await fs.copyFile(p,backup,constants.COPYFILE_EXCL);
  need((await fs.stat(backup)).size===stat.size,'BACKUP_FAILED','State backup could not be verified.');
  const tmp=p+'.'+crypto.randomUUID()+'.tmp';await newJSON(tmp,data);await fs.rename(tmp,p);await fs.chmod(p,0o600);return p;
}
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
export async function lock(key,fn,{root=stateRoot()}={}){
  const p=path.join(root,'locks',hash(key)+'.json');await mkdir(path.dirname(p));
  if(await exists(p)){let old;try{old=await readJSON(p);}catch(e){if(e.code==='ENOENT')return lock(key,fn,{root});if(e instanceof SyntaxError)throw new Fault('BUSY','Another process is committing its lock.');throw e;}need(old.owner===META.name,'UNMANAGED_STATE','Unrecognized lock.');need(!alive(old.pid),'BUSY','Another process owns this operation.',{pid:old.pid});await fs.rename(p,p+'.'+crypto.randomUUID()+'.abandoned');}
  try{await newJSON(p,{owner:META.name,pid:process.pid,key,createdAt:new Date().toISOString()});}catch(e){if(['EEXIST','OUTPUT_EXISTS'].includes(e.code))throw new Fault('BUSY','Operation is already locked.');throw e;}
  try{return await fn();}finally{await fs.unlink(p);}
}
export function safeId(v,label='ID'){need(typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v),'INVALID_INPUT','Invalid '+label+'.');return v;}
export function httpsUrl(v){const u=new URL(v);need(u.protocol==='https:'&&!u.username&&!u.password,'INVALID_INPUT','Use an HTTPS media URL.');return u;}
export function redact(e){return {code:e.code||'OPERATION_FAILED',message:String(e.message||e).replace(/Bearer\s+\S+/g,'Bearer [redacted]').replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[redacted]'),details:e.details||{}};}
export function parse(argv,{values=[],booleans=[],repeat=[]}={}){
  const o={},args=[];for(let i=0;i<argv.length;i++){
    const token=argv[i];if(!token.startsWith('--')){args.push(token);continue;}
    const k=token.slice(2);need([...values,...booleans,...repeat].includes(k),'INVALID_ARGUMENT','Unknown option: '+token);
    need(!(k in o)||repeat.includes(k),'INVALID_ARGUMENT','Duplicate option: '+token);
    if(booleans.includes(k)){o[k]=true;continue;}
    const v=argv[++i];need(v!==undefined&&!v.startsWith('--'),'INVALID_ARGUMENT','Missing value for '+token);
    if(repeat.includes(k))(o[k]??=[]).push(v);else o[k]=v;
  }return {options:o,args};
}
