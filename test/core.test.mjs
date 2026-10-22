import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parse,ROOT} from '../src/core.mjs';
import {groupIntoFrame,verifyGrouping,findVideo,sceneSignature} from '../src/frame.mjs';
import {allowedGateway,nativeSubmission,BrowserDriver,composerImageState,handleBrowserDialog} from '../src/browser.mjs';
const exec=promisify(execFile);
test('new empty board without an elements field matches the empty editor',()=>{assert.equal(sceneSignature(undefined),sceneSignature([]));});
test('editor image hydration is equivalent while actual edits remain detectable',()=>{const e={id:'x',x:0,version:1,versionNonce:1,customData:{fileUrl:'https://example.com/image.png'}};const hydrated={...e,version:2,versionNonce:99,customData:{...e.customData,originalUrl:e.customData.fileUrl}};assert.equal(sceneSignature([e]),sceneSignature([hydrated]));assert.notEqual(sceneSignature([e]),sceneSignature([{...hydrated,x:10}]));});
test('frame fill hydration ignores generated IDs but detects a color change',()=>{const a={id:'f',type:'frame',customData:{fills:[{id:'first',color:'#fff'}]}},b={...a,customData:{fills:[{id:'second',color:'#fff'}]}};assert.equal(sceneSignature([a]),sceneSignature([b]));assert.notEqual(sceneSignature([a]),sceneSignature([{...b,customData:{fills:[{id:'second',color:'#000'}]}}]));});
test('renderer-owned Frame backgrounds are equivalent to their parent scene',()=>{const frame={id:'f',type:'frame'},bg={id:'f__bg',frameId:'f',type:'rectangle',customData:{type:'frame-background',ownerFrameId:'f'}};assert.equal(sceneSignature([frame]),sceneSignature([frame,bg]));assert.notEqual(sceneSignature([frame]),sceneSignature([frame,{...bg,id:'user-rectangle'}]));});
test('upload readiness counts composer attachments independently of history images',t=>{const prior=globalThis.document;const images=[];const composer={innerText:'',querySelector:()=>true,querySelectorAll:()=>images};const editor={querySelector:()=>null,parentElement:composer};globalThis.document={querySelector:()=>editor,querySelectorAll:()=>Array(5).fill({src:'history'})};t.after(()=>{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;});assert.equal(composerImageState(),0);images.push({src:'blob:pending',complete:true,naturalWidth:100});assert.equal(composerImageState(1),false);images[0].src='https://example.com/image.png';assert.equal(composerImageState(1),true);});
test('shared browser dialog handling tolerates another connection completing the dialog',async()=>{assert.equal(await handleBrowserDialog({type:()=> 'beforeunload',accept:async()=>{throw Error('No dialog is showing');}}),false);let dismissed=false;await handleBrowserDialog({type:()=> 'confirm',dismiss:async()=>{dismissed=true;}});assert.equal(dismissed,true);});
test('strict flags preserve reference order and reject ambiguity',()=>{
  assert.deepEqual(parse(['--reference','b','--reference','a'],{repeat:['reference']}).options.reference,['b','a']);
  for(const args of [['--unknown'],['--canvas'],['--canvas','a','--canvas','b']])assert.throws(()=>parse(args,{values:['canvas']}),{code:'INVALID_ARGUMENT'});
});
test('group existing nodes, preserve identity and unrelated content, repeat safely',()=>{
  const content=JSON.stringify({elements:[{id:'r',type:'image',x:2,y:3,width:301,height:499,fileId:'file1',customData:{cliTaskId:'ref'}},{id:'v',type:'image',x:9,y:9,width:1280,height:720,fileId:'file2',customData:{isVideoThumbnail:true,videoUrl:'https://media.example/video.mp4'}},{id:'u',type:'text',x:1,y:9,width:20,height:20,text:'keep'}],files:{file1:{dataURL:'x'}},appState:{viewBackgroundColor:'#fff'}});
  const first=groupIntoFrame(content,{ids:['r','v'],frameId:'frame'});
  assert.equal(verifyGrouping(content,first.content,first),true);
  assert.equal(JSON.parse(first.content).elements.length,4);
  assert.equal(findVideo(JSON.parse(first.content).elements,'https://media.example/video.mp4?new-signature=x').length,1);
  const second=groupIntoFrame(first.content,{ids:['r','v'],frameId:'frame'});assert.equal(second.changed,false);
  const native=JSON.parse(first.content);native.elements.push({id:'frame__bg',type:'rectangle',frameId:'frame',x:0,y:0,width:10,height:10,customData:{type:'frame-background',ownerFrameId:'frame'}});assert.equal(groupIntoFrame(JSON.stringify(native),{ids:['r','v'],frameId:'frame'}).changed,false);
  assert.throws(()=>groupIntoFrame(content,{ids:['r','r'],frameId:'frame'}),{code:'INVALID_INPUT'});
  assert.throws(()=>groupIntoFrame(first.content,{ids:['r'],frameId:'frame'}),{code:'FRAME_CONFLICT'});
  const changed=JSON.parse(first.content);changed.elements.find(e=>e.id==='u').text='lost';assert.throws(()=>verifyGrouping(content,JSON.stringify(changed),first),{code:'CANVAS_SAVE_UNCERTAIN'});
});
test('gateway permits canvas/status only; submission verifies mode, exact prompt and reference order',()=>{
  assert.equal(allowedGateway('/canvas/save','POST'),true);
  assert.equal(allowedGateway('/threads/session/runs/run'),true);
  for(const route of ['/canvas/tasks/generate','/threads/s/runs/stream','/chat/createSession'])assert.equal(allowedGateway(route,'POST'),false);
  const body={input:{messages:[{content:[{type:'text',text:'prompt'},{type:'image_url',name:'01.png',image_url:{url:'https://m.example/1'}}]}]},config:{configurable:{chat_mode:'agent'}},metadata:{session_id:'session'}};
  assert.equal(nativeSubmission(body,'prompt',['/refs/01.png']).sessionId,'session');
  assert.throws(()=>nativeSubmission(body,'changed',['/refs/01.png']),{code:'UI_CHANGED'});
  assert.throws(()=>nativeSubmission(body,'prompt',['/refs/02.png']),{code:'REFERENCE_ORDER_CHANGED'});
  assert.equal(new BrowserDriver().boardId('https://untrusted.example/board/#/canvas/id'),null);
});
test('new conversation waits for native creation and UI commit without waiting for other conversations streams',async()=>{
  const events=[],d=new BrowserDriver();d.canvasId='board';d.idle=async()=>{};d.unique=async s=>s=== '[contenteditable=true][role=textbox]'?{innerText:async()=>''}:{click:async()=>{events.push('click');}};
  d.page={evaluate:async()=>0,url:()=> 'https://sealseek.cn/board/#/canvas/board',locator:s=>({count:async()=>s.includes('lucide-bot')?1:0}),waitForResponse:async()=>{events.push('observe');return {ok:()=>true,finished:async()=>{events.push('created');}};},waitForTimeout:async()=>{events.push('settled');},getByText:()=>({waitFor:async()=>{events.push('welcome');}})};
  await d.newConversation();assert.deepEqual(events,['observe','click','created','settled','welcome']);
});
test('real CLI dry run validates locally without browser or media access',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ic-cli-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'ref.png');await fs.writeFile(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmQoAAAAASUVORK5CYII=','base64'),{flag:'wx'});
  const env={...process.env,INFINITE_CANVAS_AUTO_UPDATE:'0',INFINITE_CANVAS_STATE_DIR:path.join(dir,'state'),INFINITE_CANVAS_BROWSER_BIN:'missing-browser',INFINITE_CANVAS_MEDIA_BIN:'missing-media'};
  const {stdout}=await exec(process.execPath,[path.join(ROOT,'bin/infinite-canvas.mjs'),'video','generate','--canvas','board','--prompt','prompt','--reference',file,'--dry-run','--json'],{env});
  const output=JSON.parse(stdout);assert.equal(output.dry_run,true);assert.equal(output.paid_action,false);assert.equal(await fs.stat(path.join(dir,'state')).catch(()=>null),null);
  await assert.rejects(exec(process.execPath,[path.join(ROOT,'bin/infinite-canvas.mjs'),'video','generate','--canvas','board','--prompt','prompt','--reference',file,'--bad'],{env}),e=>JSON.parse(e.stdout).error.code==='INVALID_ARGUMENT');
});
test('doctor reports missing providers through the current Node managed-runtime entry',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ic-doctor-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const env={...process.env,INFINITE_CANVAS_AUTO_UPDATE:'0',INFINITE_CANVAS_STATE_DIR:dir,INFINITE_CANVAS_BROWSER_BIN:'nonexistent-browser-provider',INFINITE_CANVAS_MEDIA_BIN:'nonexistent-media-provider'};
  await assert.rejects(exec(process.execPath,[path.join(ROOT,'bin/infinite-canvas.mjs'),'doctor','--json'],{env}),e=>{const r=JSON.parse(e.stdout);assert.equal(r.ok,false);assert.equal(r.checks['playwright-core'].ok,true);assert.equal(r.checks.media.ok,false);assert.equal(r.paid_action,false);return true;});
});

test('simultaneous first use creates one tab; duplicate tabs stop before opening or editing',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ic-tab-lock-')),old=process.env.INFINITE_CANVAS_STATE_DIR;process.env.INFINITE_CANVAS_STATE_DIR=dir;t.after(async()=>{if(old===undefined)delete process.env.INFINITE_CANVAS_STATE_DIR;else process.env.INFINITE_CANVAS_STATE_DIR=old;await fs.rm(dir,{recursive:true,force:true});});
  const pages=[];let created=0;const context={pages:()=>pages,newPage:async()=>{created++;let url='about:blank';const p={url:()=>url,goto:async u=>{await new Promise(r=>setTimeout(r,20));url=u;}};pages.push(p);return p;}},browser={contexts:()=>[context]};
  const drivers=[new BrowserDriver(),new BrowserDriver()];for(const d of drivers){d.canvasId='board';d.browser=browser;}
  await Promise.all(drivers.map(d=>d.composerLock(()=>d.selectBoardTab())));assert.equal(created,1);assert.equal(drivers[0].page,drivers[1].page);
  pages.push({url:()=>pages[0].url()});await assert.rejects(drivers[0].selectBoardTab(),{code:'BOARD_SELECTION_REQUIRED'});assert.equal(created,1);
});
test('canvas writes synchronize the editor in place and preserve semantic edits',async()=>{
  const d=new BrowserDriver(),before=[{id:'old',type:'image',x:0}],after=[...before,{id:'new',type:'frame',x:10}];let live=before,synced=0;d.assertBoard=()=>{};d.liveElements=async()=>live;d.getBoard=async()=>({content:JSON.stringify({elements:after})});d.syncLive=async content=>{synced++;live=JSON.parse(content).elements;};
  await d.afterWrite({signature:sceneSignature(before)});assert.equal(synced,1);assert.equal(d.baseline,sceneSignature(after));
  live=[{...before[0],x:999}];await assert.rejects(d.afterWrite({signature:sceneSignature(before)}),{code:'CANVAS_SYNC_PENDING'});assert.equal(synced,1);
});
