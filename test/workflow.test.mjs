import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareInput,createJob,getJob,saveJob} from '../src/state.mjs';
import {processJob,selectResult,syncJob} from '../src/workflow.mjs';
import {hash,newFile} from '../src/core.mjs';
import {BrowserDriver} from '../src/browser.mjs';
import {verifyGrouping} from '../src/frame.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmQoAAAAASUVORK5CYII=','base64');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ic-workflow-'));const old=process.env.INFINITE_CANVAS_STATE_DIR;process.env.INFINITE_CANVAS_STATE_DIR=path.join(root,'state');t.after(async()=>{if(old===undefined)delete process.env.INFINITE_CANVAS_STATE_DIR;else process.env.INFINITE_CANVAS_STATE_DIR=old;await fs.rm(root,{recursive:true,force:true});});
  const file=path.join(root,'ref.png');await fs.writeFile(file,png,{flag:'wx'});const input=await prepareInput({canvas:'board',prompt:'Generate 1 video with reference (图1)',references:[file]});const {job}=await createJob(input);
  let content=JSON.stringify({elements:[{id:'unrelated',type:'text',x:1,y:1,width:20,height:20,text:'preserve'}],files:{}});const calls={send:0,conversation:0,videoAdd:0};
  const addVideo=()=>{const c=JSON.parse(content);if(!c.elements.some(e=>e.id==='video'))c.elements.push({id:'video',type:'image',x:0,y:0,width:1280,height:720,fileId:'vfile',customData:{isVideoThumbnail:true,videoUrl:'https://media.example/result.mp4'}});content=JSON.stringify(c);};
  const media={get:async()=>({canvas_id:'board',elements:JSON.parse(content).elements}),upload:async()=>({url:'https://media.example/ref.png'}),add:async(id,spec)=>{if(spec.kind==='video'){calls.videoAdd++;addVideo();return;}const c=JSON.parse(content);c.elements.push({id:'reference',type:'image',x:0,y:0,width:1,height:1,fileId:'rfile',customData:{cliTaskId:spec.id}});content=JSON.stringify(c);}};
  const driver={connect:async()=>{},close:async()=>{},getBoard:async()=>({id:'board',content}),helperMutation:async f=>f(),newConversation:async()=>{calls.conversation++;},attach:async()=>{},send:async(prompt,refs,capture)=>{calls.send++;await capture({sessionId:'session',referenceUrls:['https://media.example/ref.png'],runId:'run'});addVideo();},runs:async()=>[{run_id:'run'}],run:async()=>({status:'success'}),history:async()=>({bubbles:[{role:'user'},{type:'video',content:'https://media.example/result.mp4',videoParams:{referenceImageUrls:['https://media.example/ref.png']}}]}),saveFrame:async change=>{const next=change(content);verifyGrouping(content,next.content,next);content=next.content;return next;}};
  const download=async j=>{if(j.artifacts?.length)return;const f=path.join(root,'video.mp4');await newFile(f,Buffer.from('fake-video'));j.artifacts=[{path:f,bytes:10,sha256:hash('fake-video')}];await saveJob(j);};
  return {root,input,job,driver,media,calls,download,settleVideo:async()=>{},getContent:()=>JSON.parse(content),setContent:v=>{content=JSON.stringify(v);},addVideo};
}
test('idempotency prevents repeated logical submissions and rejects changed inputs',async t=>{
  const f=await fixture(t);assert.equal((await createJob(f.input)).job.id,f.job.id);
  await assert.rejects(createJob({...f.input,output:'/another-output'}),{code:'IDEMPOTENCY_CONFLICT'});
  await createJob(f.input,{requestId:'business-1'});await assert.rejects(createJob({...f.input,prompt:'different'},{requestId:'business-1'}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('complete pipeline reuses native video and frames original nodes',async t=>{
  const f=await fixture(t);const result=await processJob(f.job.id,f);assert.equal(result.status,'succeeded');assert.equal(f.calls.send,1);assert.equal(f.calls.videoAdd,0);assert.deepEqual(result.reference_element_ids,['reference']);assert.equal(result.video_element_id,'video');assert.deepEqual(f.getContent().elements.filter(e=>e.frameId===result.frame_id).map(e=>e.id),['reference','video']);
  await processJob(f.job.id,f);assert.equal(f.calls.send,1);
  let spawned;await syncJob(f.job.id,{spawn:async id=>{spawned=id;}});assert.equal(spawned,f.job.id);assert.equal((await processJob(f.job.id,f)).status,'succeeded');assert.equal(f.calls.send,1);assert.equal(f.calls.conversation,1);
});
test('missing native canvas video is imported once',async t=>{
  const f=await fixture(t);f.driver.send=async(p,r,capture)=>{f.calls.send++;await capture({sessionId:'session',runId:'run',referenceUrls:['https://media.example/ref.png']});};const result=await processJob(f.job.id,f);assert.equal(result.status,'succeeded');assert.equal(f.calls.videoAdd,1);
});
test('ambiguous send without captured session never sends again',async t=>{
  const f=await fixture(t);f.driver.send=async()=>{f.calls.send++;throw Error('connection lost after click');};const first=await processJob(f.job.id,f);assert.equal(first.status,'uncertain');const second=await processJob(f.job.id,f);assert.equal(second.status,'uncertain');assert.equal(second.error.code,'SUBMISSION_UNCERTAIN');assert.equal(f.calls.send,1);
});
test('frame failure resumes from saved video without another conversation or send',async t=>{
  const f=await fixture(t),original=f.driver.saveFrame;f.driver.saveFrame=async()=>{throw Object.assign(Error('save conflict'),{code:'CANVAS_CHANGED'});};const first=await processJob(f.job.id,f);assert.equal(first.status,'canvas_pending');assert.equal(first.artifacts.length,1);f.driver.saveFrame=original;const second=await processJob(f.job.id,f);assert.equal(second.status,'succeeded');assert.equal(f.calls.send,1);assert.equal(f.calls.conversation,1);
});
test('captured session recovers one native run after uncertain response',async t=>{
  const f=await fixture(t);f.driver.send=async(p,r,capture)=>{f.calls.send++;await capture({sessionId:'session',referenceUrls:['https://media.example/ref.png']});throw Error('response interrupted');};assert.equal((await processJob(f.job.id,f)).status,'uncertain');assert.equal((await processJob(f.job.id,f)).status,'succeeded');assert.equal(f.calls.send,1);
});
test('result requires a clean conversation and matching references',()=>{
  assert.throws(()=>selectResult({bubbles:[{role:'user'},{role:'user'}]}),{code:'CONTEXT_NOT_CLEAN'});
  assert.throws(()=>selectResult({bubbles:[{role:'user'},{type:'video',content:'https://m.example/v',videoParams:{referenceImageUrls:['https://m.example/wrong']}}]},['https://m.example/right']),{code:'REFERENCE_MISMATCH'});
});

test('native video arriving during fallback import is retained and only the owned duplicate retired',async t=>{
  const f=await fixture(t),original=f.media.add;
  f.driver.send=async(p,r,capture)=>{f.calls.send++;await capture({sessionId:'session',runId:'run',referenceUrls:['https://media.example/ref.png']});};
  f.media.add=async(id,spec)=>{if(spec.kind!=='video')return original(id,spec);f.calls.videoAdd++;f.addVideo();const c=f.getContent(),v=c.elements.find(e=>e.id==='video');v.customData.sessionId='session';c.elements.push({...v,id:'owned',customData:{...v.customData,sessionId:undefined,cliTaskId:spec.id}});f.setContent(c);};
  const result=await processJob(f.job.id,f);assert.equal(result.status,'succeeded');assert.equal(result.video_element_id,'video');assert.equal(f.getContent().elements.find(e=>e.id==='owned').isDeleted,true);assert.equal(f.calls.send,1);
});
test('same-board conversations submit independently before either remote run completes',async t=>{
  const f=await fixture(t),second=(await createJob({...f.input,prompt:'Second independent video'},{requestId:'second'})).job;
  const queued=new BrowserDriver();queued.canvasId='board';let sent=0,activeUI=0,maxUI=0,framing=0,maxFraming=0;const sessions=new Set();
  const original=f.media.add;f.media.add=async(id,spec)=>{if(spec.kind!=='image')return original(id,spec);const c=f.getContent();c.elements.push({id:spec.id,type:'image',x:0,y:0,width:1,height:1,fileId:spec.id,customData:{cliTaskId:spec.id}});f.setContent(c);};
  function driver(id){return {...f.driver,composerLock:fn=>queued.composerLock(async()=>{activeUI++;maxUI=Math.max(maxUI,activeUI);try{return await fn();}finally{activeUI--;}}),send:async(p,r,capture)=>{sent++;sessions.add(id);await capture({sessionId:id,runId:id,referenceUrls:['https://media.example/ref.png']});const c=f.getContent();c.elements.push({id:'v-'+id,type:'image',x:0,y:0,width:480,height:854,fileId:id,customData:{isVideoThumbnail:true,videoUrl:'https://media.example/'+id+'.mp4'}});f.setContent(c);},run:async()=>{while(sent<2)await new Promise(r=>setTimeout(r,5));return {status:'success'};},history:async()=>({bubbles:[{role:'user'},{type:'video',content:'https://media.example/'+id+'.mp4'}]}),saveFrame:change=>queued.composerLock(async()=>{framing++;maxFraming=Math.max(maxFraming,framing);try{return await f.driver.saveFrame(change);}finally{framing--;}})};}
  const download=async j=>{j.artifacts=[{path:path.join(f.root,j.id+'.mp4'),bytes:1,sha256:'test'}];await saveJob(j);};
  const result=await Promise.all([f.job,second].map(j=>processJob(j.id,{...f,driver:driver(j.id),download})));
  assert.deepEqual(result.map(r=>r.status),['succeeded','succeeded']);assert.equal(sent,2);assert.equal(sessions.size,2);assert.equal(maxUI,1);assert.equal(maxFraming,1);assert.equal(f.getContent().elements.filter(e=>e.type==='frame').length,2);
});

test('simultaneous identical requests reconcile to one payable job',async t=>{
  const f=await fixture(t);const requests=await Promise.all(Array.from({length:12},()=>createJob(f.input,{requestId:'simultaneous-request'})));assert.equal(new Set(requests.map(r=>r.job.id)).size,1);assert.equal(requests.filter(r=>!r.reused).length,1);
});
