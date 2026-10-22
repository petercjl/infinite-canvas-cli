import fs from 'node:fs/promises';
import {runFFprobe} from './ffprobe.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {ROOT,META,need,hash,lock,sleep,newFile,newJSON,exists,httpsUrl,redact,alive,execute} from './core.mjs';
import {getJob,saveJob,jobDir,jobFile,cacheReferences,summary} from './state.mjs';
import {BrowserDriver} from './browser.mjs';
import {MediaCLI} from './media-cli.mjs';
import {findVideo,groupIntoFrame,comparableUrl} from './frame.mjs';

export function selectResult(history,referenceUrls=[]){
  const bubbles=history?.bubbles;need(Array.isArray(bubbles),'RESULT_UNAVAILABLE','Conversation history is unavailable.');
  need(bubbles.filter(b=>b.role==='user').length===1,'CONTEXT_NOT_CLEAN','Task conversation has more than one user message.');
  const videos=bubbles.filter(b=>b.type==='video').map(b=>({bubble:b,url:b.videoParams?.videoUrl||b.content})).filter(v=>typeof v.url==='string'&&/^https:/.test(v.url));
  const unique=[...new Map(videos.map(v=>[v.url,v])).values()];need(unique.length===1,'RESULT_UNAVAILABLE','Expected exactly one video in this conversation.',{count:unique.length});
  const {bubble,url}=unique[0],p=bubble.videoParams||{},refs=p.referenceImageUrls||p.referenceImages?.map(r=>typeof r==='string'?r:r.url)||bubble.referenceImageUrls||[];
  need(!refs.length||refs.length===referenceUrls.length&&referenceUrls.every(u=>refs.some(r=>comparableUrl(u)===comparableUrl(r))),'REFERENCE_MISMATCH','Returned reference metadata differs from the submitted images.');
  return {url,params:p,referenceCount:refs.length,referenceVerified:refs.length>0,bubbleId:bubble.id,toolCallId:bubble.toolCallId,billing:bubbles.map(b=>b.totalPoints??b.billingXidou).filter(v=>v!=null).at(-1)??null};
}
export async function spawnWorker(id){
  const log=path.join(jobDir(id),'worker-'+crypto.randomUUID()+'.log');const file=await fs.open(log,'wx',0o600);
  try{const child=spawn(process.execPath,[path.join(ROOT,'bin/infinite-canvas.mjs'),'_worker',id],{detached:true,stdio:['ignore',file.fd,file.fd],env:process.env});await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j)});child.unref();return child.pid;}finally{await file.close();}
}
async function importReferences(job,driver,media){
  const api=await media.get(job.input.canvasId);need(api.canvas_id===job.input.canvasId,'BOARD_MISMATCH','API and browser board IDs differ.');
  const web=await driver.getBoard();need(String(web.id)===api.canvas_id,'BOARD_MISMATCH','API and browser board IDs differ.');
  for(let i=0;i<job.references.length;i++){
    const ref=job.references[i],key='ic-ref-'+job.id+'-'+i;
    if(job.referenceElements[i]){const current=await media.get(job.input.canvasId);need(current.elements.some(e=>e.id===job.referenceElements[i]&&!e.isDeleted),'ELEMENT_NOT_FOUND','A previously imported reference was deleted.');continue;}
    if(!ref.uploadedUrl){ref.uploadedUrl=(await media.upload(ref.file)).url;need(ref.uploadedUrl,'UPLOAD_FAILED','Reference upload returned no URL.');await saveJob(job);}
    let existing=(await media.get(job.input.canvasId)).elements.filter(e=>!e.isDeleted&&e.customData?.cliTaskId===key);
    if(!existing.length){const spec={id:key,kind:'image',urls:[ref.uploadedUrl],ratio:ref.width+':'+ref.height};await driver.helperMutation(()=>media.add(job.input.canvasId,spec,jobDir(job.id)));existing=(await media.get(job.input.canvasId)).elements.filter(e=>!e.isDeleted&&e.customData?.cliTaskId===key);}
    need(existing.length===1,'ELEMENT_AMBIGUOUS','Reference import identity is ambiguous.');job.referenceElements[i]=existing[0].id;await saveJob(job);
  }
}
export async function recoverNative(job,driver){
  if(job.runId)return;
  need(job.sessionId,'SUBMISSION_UNCERTAIN','No session ID was captured. Inspect the webpage; this task will not resend.');
  const runs=await driver.runs(job.sessionId);const list=Array.isArray(runs)?runs:runs.runs;
  need(Array.isArray(list)&&list.length===1&&list[0].run_id,'SUBMISSION_UNCERTAIN','Unable to identify one native run.');job.runId=list[0].run_id;job.stage='running';await saveJob(job);
}
async function follow(job,driver,{budgetMs=3600000}={}){
  const end=Date.now()+budgetMs;while(Date.now()<end){
    let run;try{run=await driver.run(job.sessionId,job.runId);}catch(e){job.lastReadError=redact(e);await sleep(1500);continue;}job.remoteStatus=run.status;
    if(run.status==='success'){job.result=selectResult(await driver.history(job.sessionId),job.referenceUrls);job.stage='generated';job.status='running';if(!job.result.referenceVerified)job.warnings.push('The provider did not expose returned reference metadata.');await saveJob(job);return;}
    need(!['error','failed','timeout','interrupted','cancelled'].includes(run.status),'PROVIDER_FAILURE','Native Agent run did not succeed.',{status:run.status,reason:run.error?.message||run.error||null});
    await sleep(5000);
  }
  job.status='waiting';await saveJob(job);throw Object.assign(Error('Native run is still active; resume this task without resending.'),{code:'MONITOR_WINDOW_ENDED'});
}
async function downloadResult(job){
  const directory=job.input.output||path.join(jobDir(job.id),'output');const file=path.join(directory,job.id+'.mp4');
  if(job.artifacts?.[0]){need(await exists(file)&&hash(await fs.readFile(file))===job.artifacts[0].sha256,'OUTPUT_CHANGED','Saved video changed.');return;}
  const response=await fetch(httpsUrl(job.result.url),{signal:AbortSignal.timeout(120000),redirect:'error'});need(response.ok,'DOWNLOAD_FAILED','Video download failed.');
  need(!/text|json/.test(response.headers.get('content-type')||''),'OUTPUT_CONTRACT_FAILED','Video URL returned text.');
  const chunks=[];let size=0;for await(const c of response.body){size+=c.length;need(size<=1024*1024*1024,'OUTPUT_CONTRACT_FAILED','Video exceeds the download limit.');chunks.push(c);}const data=Buffer.concat(chunks);need(data.length>0,'OUTPUT_CONTRACT_FAILED','Video is empty.');
  if(await exists(file))need(hash(await fs.readFile(file))===hash(data),'OUTPUT_EXISTS','Preserve a different existing output file.');else await newFile(file,data);
  const probe=runFFprobe(['-v','error','-show_entries','stream=codec_type,width,height,duration:format=duration,size','-of','json',file]);
  need(!probe.error&&probe.status===0,'INSPECTION_UNAVAILABLE','Saved video could not be inspected. Run doctor --json, repair ffprobe and resume this task without generating again.');
  const inspect=JSON.parse(probe.stdout);need(inspect.streams?.some(s=>s.codec_type==='video'&&s.width>0&&s.height>0),'OUTPUT_CONTRACT_FAILED','Downloaded file has no video stream.');
  job.artifacts=[{path:file,bytes:data.length,sha256:hash(data),inspect:inspect||null}];await saveJob(job);
}
function resolveVideoMatches(job,matches){
  job.duplicateVideoIds=[];
  if(matches.length<=1)return matches;
  const native=matches.filter(e=>e.customData?.sessionId===job.sessionId&&!e.customData?.cliTaskId),owned=matches.filter(e=>e.customData?.cliTaskId==='ic-video-'+job.runId);
  need(native.length===1&&native.length+owned.length===matches.length,'VIDEO_ELEMENT_AMBIGUOUS','Multiple matching video elements exist; preserve unrelated nodes.');
  job.duplicateVideoIds=owned.map(e=>e.id);return native;
}
async function ensureVideo(job,driver,media,{settle=()=>sleep(1500)}={}){
  let board=await media.get(job.input.canvasId),matches=findVideo(board.elements,job.result.url);
  job.duplicateVideoIds=[];
  for(let i=0;i<8&&!matches.length;i++){await settle();board=await media.get(job.input.canvasId);matches=findVideo(board.elements,job.result.url);}
  matches=resolveVideoMatches(job,matches);
  if(!matches.length){
    const spec={id:'ic-video-'+job.runId,kind:'video',urls:[job.result.url],ratio:job.result.params.aspectRatio||'16:9',generationParams:{...job.result.params,referenceImageUrls:job.referenceUrls}};
    await driver.helperMutation(()=>media.add(job.input.canvasId,spec,jobDir(job.id)));board=await media.get(job.input.canvasId);matches=findVideo(board.elements,job.result.url);
    for(let i=0;i<8&&!matches.length;i++){await settle();board=await media.get(job.input.canvasId);matches=findVideo(board.elements,job.result.url);}
    matches=resolveVideoMatches(job,matches);
  }
  need(matches.length===1,'CANVAS_SYNC_PENDING','Video was generated, but its canvas node is unresolved.');job.videoElementId=matches[0].id;await saveJob(job);
}
export async function processJob(id,{driver=new BrowserDriver(),media=new MediaCLI(),budgetMs,download=downloadResult,settleVideo}={}){
  let job=await getJob(id);
  return lock('job:'+id,async()=>{
    job=await getJob(id);if(job.status==='succeeded')return summary(job);
    job.pid=process.pid;job.status='running';delete job.error;await saveJob(job);
    try{
      await driver.connect(job.input.canvasId);
      if(!['sending','running','generated','framing','complete'].includes(job.stage)){
        const compose=async()=>{
        await cacheReferences(job);job.stage='references';await saveJob(job);
        await importReferences(job,driver,media);job.stage='imported';await saveJob(job);
        await driver.newConversation();await driver.attach(job.references.map(r=>r.file));
        job.stage='sending';job.sendIntentAt=new Date().toISOString();await saveJob(job);
        await driver.send(job.input.prompt,job.references.map(r=>r.file),async context=>{Object.assign(job,context);await saveJob(job);});job.stage='running';await saveJob(job);
        };await (driver.composerLock?driver.composerLock(compose):compose());
      }
      if(['sending','running'].includes(job.stage)){await recoverNative(job,driver);await follow(job,driver,{budgetMs});}
      await download(job);job.stage='framing';await saveJob(job);
      await ensureVideo(job,driver,media,{settle:settleVideo});
      job.frameId='ic-frame-'+job.id;await saveJob(job);
      const grouped=await driver.saveFrame(content=>groupIntoFrame(content,{ids:[...job.referenceElements,job.videoElementId],frameId:job.frameId,name:'Video '+job.id.slice(0,8),retireIds:job.duplicateVideoIds||[]}),jobDir(job.id));
      job.frame={id:grouped.frameId,elementIds:grouped.elementIds,bounds:grouped.bounds};job.stage='complete';job.status='succeeded';await saveJob(job);
    }catch(e){job.error=redact(e);job.status=e.code==='PROVIDER_FAILURE'?'failed':e.code==='MONITOR_WINDOW_ENDED'?'waiting':job.stage==='sending'?'uncertain':job.result?'canvas_pending':job.runId?'waiting':'failed';await saveJob(job);}
    finally{delete job.pid;await saveJob(job);await driver.close();}
    return summary(job);
  });
}
export async function resumeJob(id){const job=await getJob(id);if(job.status==='succeeded'||job.pid&&alive(job.pid))return {...summary(job),reused:true};await spawnWorker(id);return {...summary(job),resuming:true};}
export async function syncJob(id,{spawn=spawnWorker}={}){const job=await lock('job:'+id,async()=>{const j=await getJob(id);need(j.result?.url&&j.artifacts?.length,'RESULT_UNAVAILABLE','Canvas synchronization requires an existing generated video.');need(!j.pid||!alive(j.pid),'BUSY','The task already has an active worker.');j.stage='framing';j.status='canvas_pending';delete j.error;await saveJob(j);return j;});await spawn(id);return {...summary(job),syncing:true};}
export async function waitJob(id,seconds=30){need(Number.isInteger(seconds)&&seconds>=1&&seconds<=60,'INVALID_ARGUMENT','Wait timeout must be 1–60 seconds.');const end=Date.now()+seconds*1000;let j;while(Date.now()<end){j=await getJob(id);if(!['queued','running'].includes(j.status))break;await sleep(500);}return summary(j||await getJob(id));}
