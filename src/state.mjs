import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {imageSize} from 'image-size';
import {META,stateRoot,newFile,newJSON,readJSON,replaceOwned,exists,need,hash,safeId,httpsUrl,mkdir} from './core.mjs';

export const jobDir=id=>path.join(stateRoot(),'jobs',safeId(id));
export const jobFile=id=>path.join(jobDir(id),'job.json');
export async function getJob(id){const j=await readJSON(jobFile(id));need(j.owner===META.name&&j.id===id,'UNMANAGED_STATE','Unrecognized task.');return j;}
export async function saveJob(j){j.updatedAt=new Date().toISOString();await replaceOwned(jobFile(j.id),j);return j;}
export async function prepareInput({canvas,prompt,references,output}){
  safeId(canvas,'canvas ID');need(typeof prompt==='string'&&prompt.trim()&&prompt.length<=20000,'INVALID_INPUT','Provide a non-empty prompt of at most 20000 characters.');
  need(Array.isArray(references)&&references.length>0&&references.length<=20,'INVALID_INPUT','Provide 1–20 ordered reference images.');
  const refs=[];for(const value of references){
    need(typeof value==='string'&&value,'INVALID_INPUT','Reference must be a path or HTTPS URL.');
    if(/^https:/i.test(value)){httpsUrl(value);refs.push({source:value,url:value});continue;}
    const file=path.resolve(value),stat=await fs.stat(file);need(stat.isFile()&&stat.size>0&&stat.size<=30*1024*1024,'INVALID_REFERENCE','Image is missing, empty or larger than 30 MiB.');
    const b=await fs.readFile(file),dim=imageSize(b);need(['png','jpg','webp'].includes(dim.type),'INVALID_REFERENCE','Use PNG, JPEG or WebP reference images.');
    refs.push({source:file,file,sha256:hash(b),bytes:b.length,width:dim.width,height:dim.height,extension:dim.type==='jpg'?'jpg':dim.type});
  }
  return {canvasId:canvas,prompt,references:refs,output:output?path.resolve(output):null};
}
export async function createJob(input,{requestId,newRequest=false}={}){
  need(!requestId||!newRequest,'INVALID_INPUT','Use either request-id or new, not both.');
  const digest=hash({...input,output:undefined,references:input.references.map(r=>({sha256:r.sha256,url:r.url}))});
  requestId=requestId||(newRequest?crypto.randomUUID():digest);safeId(requestId,'request ID');
  const index=path.join(stateRoot(),'requests',hash(requestId)+'.json');
  if(await exists(index)){const old=await readJSON(index);need(old.owner===META.name,'UNMANAGED_STATE','Unrecognized request record.');need(old.digest===digest,'IDEMPOTENCY_CONFLICT','Request ID is associated with different inputs.');const job=await getJob(old.id);need(job.input.output===input.output,'IDEMPOTENCY_CONFLICT','Existing request uses a different output directory; its original task is preserved.');return {job,reused:true};}
  const id=crypto.randomUUID();await mkdir(jobDir(id));
  const job={owner:META.name,id,requestId,digest,createdAt:new Date().toISOString(),status:'queued',stage:'created',input,referenceElements:[],references:[],warnings:[]};
  await newJSON(jobFile(id),job);
  try{await newJSON(index,{owner:META.name,id,digest});}catch(e){if(['EEXIST','OUTPUT_EXISTS'].includes(e.code)){const old=await readJSON(index);need(old.owner===META.name&&old.digest===digest,'IDEMPOTENCY_CONFLICT','Concurrent request conflict.');const existing=await getJob(old.id);need(existing.input.output===input.output,'IDEMPOTENCY_CONFLICT','Concurrent request uses another output directory.');return {job:existing,reused:true};}throw e;}
  return {job,reused:false};
}
export async function cacheReferences(job){
  for(let i=0;i<job.input.references.length;i++){
    if(job.references[i]?.file)continue;
    const ref=job.input.references[i];let bytes;
    if(ref.file){bytes=await fs.readFile(ref.file);need(hash(bytes)===ref.sha256,'REFERENCE_CHANGED','A reference changed after preparation.');}
    else{const r=await fetch(httpsUrl(ref.url),{signal:AbortSignal.timeout(30000),redirect:'error'});need(r.ok,'REFERENCE_DOWNLOAD_FAILED','Could not download the reference.');const max=30*1024*1024;need(Number(r.headers.get('content-length')||0)<=max,'INVALID_REFERENCE','Reference exceeds 30 MiB.');const chunks=[];let size=0;for await(const c of r.body){size+=c.length;need(size<=max,'INVALID_REFERENCE','Reference exceeds 30 MiB.');chunks.push(c);}bytes=Buffer.concat(chunks);}
    const dim=imageSize(bytes);need(['png','jpg','webp'].includes(dim.type),'INVALID_REFERENCE','Unsupported reference format.');
    const file=path.join(jobDir(job.id),'references',`${String(i+1).padStart(2,'0')}-reference.${dim.type==='jpg'?'jpg':dim.type}`);
    if(await exists(file))need(hash(await fs.readFile(file))===hash(bytes),'REFERENCE_CHANGED','Cached reference differs.');else await newFile(file,bytes);
    job.references[i]={...ref,file,sha256:hash(bytes),width:dim.width,height:dim.height,bytes:bytes.length};await saveJob(job);
  }
}
export function summary(j){return {ok:j.status!=='failed'&&j.status!=='uncertain',task_id:j.id,status:j.status,stage:j.stage,canvas_id:j.input.canvasId,session_id:j.sessionId||null,run_id:j.runId||null,frame_id:j.frameId||null,reference_element_ids:j.referenceElements||[],video_element_id:j.videoElementId||null,artifacts:j.artifacts||[],result:j.result?{reference_count:j.result.referenceCount,billing:j.result.billing}:null,error:j.error||null,warnings:j.warnings||[],created_at:j.createdAt,updated_at:j.updatedAt};}
