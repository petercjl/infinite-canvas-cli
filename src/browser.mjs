import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
import {execute,need,Fault,sleep,hash,canonical,newJSON,lock} from './core.mjs';
import {sceneSignature,verifyGrouping} from './frame.mjs';

export const LOCATORS={newChat:'button:has(svg.lucide-square-plus)',upload:'input[type=file][accept="image/*,video/mp4,video/webm,video/*"]',editor:'[contenteditable=true][role=textbox]',send:'button[aria-label="发送消息"]'};
export async function handleBrowserDialog(dialog){try{if(dialog.type()==='beforeunload'||dialog.type()==='alert')await dialog.accept();else await dialog.dismiss();return true;}catch{return false;}}
export function composerImageState(expected){let node=document.querySelector('[contenteditable=true][role=textbox]');while(node&&!node.querySelector('input[type=file]'))node=node.parentElement;const imgs=[...(node?.querySelectorAll('[data-horizontal-media-strip] img')||[])];if(typeof expected!=='number')return imgs.length;return imgs.length===expected&&imgs.every(e=>e.src.startsWith('https://')&&e.complete&&e.naturalWidth>0)&&!node.innerText.includes('上传中');}
export function allowedGateway(route,method='GET'){
  if(method==='POST')return route==='/canvas/save';
  return method==='GET'&&(/^\/canvas\/detail\/[A-Za-z0-9_-]+$/.test(route)||route==='/chat/v3/history'||/^\/threads\/[A-Za-z0-9_-]+\/runs(?:\/[A-Za-z0-9_-]+)?$/.test(route));
}
export function nativeSubmission(body,expectedPrompt,files){
  need(body?.config?.configurable?.chat_mode==='agent','AGENT_MODE_REQUIRED','The webpage did not submit in Agent mode.');
  need(body.input?.messages?.length===1,'CONTEXT_NOT_CLEAN','Expected one message in a new conversation.');
  const content=body.input.messages[0].content,text=typeof content==='string'?content:content?.filter(c=>c.type==='text').map(c=>c.text).join('');
  need(text===expectedPrompt,'UI_CHANGED','The webpage submitted a different prompt.');
  const refs=Array.isArray(content)?content.filter(c=>c.type==='image_url'):[];
  need(refs.length===files.length&&refs.every((r,i)=>r.name===path.basename(files[i])),'REFERENCE_ORDER_CHANGED','The submitted reference order differs from the input.');
  return {sessionId:body.metadata?.session_id,referenceUrls:refs.map(r=>r.image_url.url),videoSettings:body.config.configurable.video_params,traceId:body.config.configurable.trace_id};
}

export class BrowserDriver {
  async connect(canvasId,{open=true}={}){
    this.canvasId=canvasId;
    let launcher=process.env.INFINITE_CANVAS_BROWSER_BIN||'ecommerce-browser',r;
    try{r=await execute(launcher,['status','--json'],{timeout:15000});}catch(e){if(e.code==='ENOENT'&&!process.env.INFINITE_CANVAS_BROWSER_BIN){launcher=path.join(os.homedir(),'.local','bin','ecommerce-browser');r=await execute(launcher,['status','--json'],{timeout:15000});}else throw new Fault('BROWSER_UNAVAILABLE','Cannot inspect the ecommerce browser.');}
    let status=JSON.parse(r.stdout);if(status.state!=='ready'&&open){await execute(launcher,['open'],{timeout:30000});status=JSON.parse((await execute(launcher,['status','--json'],{timeout:15000})).stdout);}
    need(status.state==='ready'&&status.cdp==='http://127.0.0.1:9223','BROWSER_UNAVAILABLE','The fixed ecommerce CDP browser is unavailable.');
    const profile=path.join(os.homedir(),'.dianshang-chrome-profile');need(path.resolve(status.profile)===profile,'PROFILE_MISMATCH','Ecommerce browser profile mismatch.');
    if(process.platform!=='win32'){let verified=false;for(const pid of status.pids||[]){try{const ps=await execute('ps',['-p',String(pid),'-o','command=']);verified ||= ps.stdout.includes('--remote-debugging-port=9223')&&ps.stdout.includes('--user-data-dir='+profile);}catch{}}need(verified,'PROFILE_MISMATCH','Chrome process arguments could not be verified.');}
    this.status=status;this.browser=await chromium.connectOverCDP(status.cdp,{timeout:15000});
    for(const context of this.browser.contexts()){for(const page of context.pages())page.on('dialog',handleBrowserDialog);context.on('page',page=>page.on('dialog',handleBrowserDialog));}
    await this.composerLock(()=>this.selectBoardTab({open}));
    const resumeEditor=this.page.getByRole('button',{name:'在此继续编辑',exact:true});if(await resumeEditor.count()===1)await resumeEditor.click();
    try{await this.page.locator('.excalidraw').waitFor({state:'attached',timeout:25000});await this.page.locator(LOCATORS.editor).waitFor({state:'attached',timeout:25000});await this.unique(LOCATORS.editor);}catch{throw new Fault('AUTH_OR_BOARD_REQUIRED','Sign in and open an editable board in the ecommerce browser.');}
    this.baseline=sceneSignature(await this.liveElements());return this;
  }
  async selectBoardTab({open=true}={}){
    const canvasId=this.canvasId,pages=this.browser.contexts().flatMap(c=>c.pages()),matching=pages.filter(p=>this.boardId(p.url())===canvasId);
    need(matching.length<=1,'BOARD_SELECTION_REQUIRED','The same board is open in multiple tabs. Keep one target tab.');this.page=matching[0];
    if(!this.page){need(open,'BOARD_NOT_OPEN','Open the requested board in the ecommerce browser.');const context=this.browser.contexts()[0];need(context,'BROWSER_UNAVAILABLE','Browser context unavailable.');this.page=await context.newPage();await this.page.goto('https://sealseek.cn/board/#/canvas/'+encodeURIComponent(canvasId),{waitUntil:'domcontentloaded'});}
    return this.page;
  }
  boardId(url){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='sealseek.cn'?u.hash.match(/^#\/canvas\/([^?]+)/)?.[1]:null;}catch{return null;}}
  assertBoard(){need(this.boardId(this.page.url())===this.canvasId,'BOARD_CHANGED','The browser navigated to another board.');}
  async unique(selector){const l=this.page.locator(selector);need(await l.count()===1,'UI_LOCATOR_CHANGED','Expected one matching webpage control.',{selector});return l;}
  async idle(){need(await this.page.locator('button[aria-label="停止生成"],button[aria-label="视频生成中，任务提交后暂不可停止"]').count()===0,'UI_BUSY','A conversation is still generating in this page.');}
  async gateway(route,{method='GET',params,data}={}){
    this.assertBoard();need(allowedGateway(route,method),'FORBIDDEN_OPERATION','This driver only permits status, history and canvas operations.');
    const request=this.page.evaluate(async({route,method,params,data})=>{
      const urls=performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script'&&/\/board\/static\/index-[^/]+\.js$/.test(r.name)).map(r=>r.name);
      let client;for(const u of urls.slice(0,8)){const m=await import(u);const candidates=[...new Set(Object.values(m).filter(v=>typeof v==='function'&&v.interceptors?.request&&String(v.defaults?.baseURL||'').includes('/api/sealseek-infinitecanvas')))];if(candidates.length===1){client=candidates[0];break;}}
      if(!client)throw Error('WEB_CLIENT_UNAVAILABLE: webpage client export changed');
      const origin=new URL(client.defaults.baseURL).origin;
      const target=route.startsWith('/threads/')?origin+'/api/canvas/v2'+route:route;
      const r=await client(target,{method,params,data,timeout:20000});
      if(r?.code!==undefined&&r.code!==200)throw Error('PROVIDER_FAILURE: '+String(r.msg||r.code));
      return r?.code===200?r.data:r;
    },{route,method,params,data});
    let timer;try{return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Fault('WEB_REQUEST_TIMEOUT','Browser API request did not complete; inspect saved state before retrying.')),25000);})]);}finally{clearTimeout(timer);}
  }
  getBoard(){return this.gateway('/canvas/detail/'+this.canvasId,{params:{_ic_read:crypto.randomUUID()}});}
  history(sessionId){return this.gateway('/chat/v3/history',{params:{sessionId,limit:100}});}
  run(sessionId,runId){return this.gateway(`/threads/${sessionId}/runs/${runId}`);}
  runs(sessionId){return this.gateway(`/threads/${sessionId}/runs`);}
  async liveElements(){
    await this.page.locator('.excalidraw').waitFor({state:'attached',timeout:25000});
    return this.page.evaluate(()=>{
      const el=document.querySelector('.excalidraw');if(!el)throw Error('EDITOR_UNAVAILABLE');const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k&&el[k];while(f?.return)f=f.return;
      const seen=new Set();let result;function walk(n){if(!n||seen.has(n)||result)return;seen.add(n);if(seen.size>30000)return;const a=n.stateNode;if(a&&typeof a.getSceneElements==='function'){result=JSON.parse(JSON.stringify(a.getSceneElements()));return;}walk(n.child);walk(n.sibling);}walk(f);if(!result)throw Error('EDITOR_ADAPTER_UNSUPPORTED');return result;
    });
  }
  async beforeWrite(){
    this.assertBoard();const end=Date.now()+12000;
    while(Date.now()<end){const before=await this.getBoard(),live=await this.liveElements();if(sceneSignature(live)===sceneSignature(JSON.parse(before.content).elements))return {before,signature:sceneSignature(live)};if(sceneSignature(live)===this.baseline){await this.syncLive(before.content);this.baseline=sceneSignature(await this.liveElements());}await sleep(500);}
    throw new Fault('CANVAS_UNSAVED','Webpage and saved canvas differ. Finish manual edits and save before retrying.');
  }
  async afterWrite(token){
    need(sceneSignature(await this.liveElements())===token.signature,'CANVAS_SYNC_PENDING','Canvas was updated remotely, but the user changed the page. Save/reload must be resolved before continuing.');
    await this.syncLive((await this.getBoard()).content);
    const end=Date.now()+15000;while(Date.now()<end){const saved=await this.getBoard();if(sceneSignature(await this.liveElements())===sceneSignature(JSON.parse(saved.content).elements)){this.baseline=sceneSignature(await this.liveElements());return;}await sleep(500);}
    throw new Fault('CANVAS_SYNC_PENDING','Canvas saved, but webpage synchronization was not verified.');
  }
  async syncLive(content){
    await this.page.evaluate(async content=>{const data=JSON.parse(content||'{}'),el=document.querySelector('.excalidraw');if(!el)throw Error('EDITOR_UNAVAILABLE');const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let root=el[key];while(root?.return)root=root.return;const seen=new Set();let api;function walk(n){if(!n||seen.has(n)||api)return;seen.add(n);if(typeof n.stateNode?.getSceneElements==='function'){api=n.stateNode;return;}walk(n.child);walk(n.sibling);}walk(root);if(typeof api?.updateScene!=='function'||typeof api.addFiles!=='function')throw Error('EDITOR_ADAPTER_UNSUPPORTED');const files=Object.entries(data.imageUrlMap||{}).map(([id,url])=>({id,dataURL:url,mimeType:data.elements?.find(e=>e.fileId===id)?.customData?.fileMimeType||'image/png',created:Date.now(),lastRetrieved:Date.now()}));if(files.length)await api.addFiles(files);await api.updateScene({elements:data.elements||[],captureUpdate:'NEVER'});},content);
  }
  async writeLock(action){for(let i=0;i<120;i++){try{return await lock('board-write:'+this.canvasId,action);}catch(e){if(e.code!=='BUSY')throw e;await sleep(1000);}}throw new Fault('BUSY','Canvas write queue did not become available.');}
  async composerLock(action){for(let i=0;i<300;i++){try{return await lock('board-ui:'+this.canvasId,action);}catch(e){if(e.code!=='BUSY')throw e;await sleep(1000);}}throw new Fault('BUSY','Canvas conversation queue did not become available.');}
  async helperMutation(action){return this.writeLock(async()=>{const token=await this.beforeWrite();const out=await action();await this.afterWrite(token);return out;});}
  async newConversation(){
    this.assertBoard();const editor=await this.unique(LOCATORS.editor);
    need(!(await editor.innerText()).replaceAll('\u200b','').trim(),'CHAT_DRAFT_PRESENT','Preserve the existing unsent chat draft.');
    need(await this.page.evaluate(composerImageState)===0,'CHAT_DRAFT_PRESENT','Preserve the existing unsent attachments.');
    const created=this.page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/chat/createSession'),{timeout:20000});created.catch(()=>{});
    await (await this.unique(LOCATORS.newChat)).click();const response=await created;need(response.ok(),'SESSION_CREATE_FAILED','Native conversation creation failed.');await response.finished();
    await this.page.waitForTimeout(300);
    await this.page.getByText('SealSeek AI 助手',{exact:true}).waitFor({timeout:15000});
    need(await this.page.locator('button:has(svg.lucide-bot)').count()===1,'AGENT_MODE_REQUIRED','Select Agent mode in the webpage composer.');
  }
  async attach(files){
    await (await this.unique(LOCATORS.upload)).setInputFiles(files);
    await this.page.waitForFunction(composerImageState,files.length,{timeout:60000});
  }
  async send(prompt,files,onCaptured){
    this.assertBoard();await (await this.unique(LOCATORS.editor)).fill(prompt);
    const requestWait=this.page.waitForRequest(r=>r.method()==='POST'&&/\/api\/canvas\/v2\/threads\/[^/]+\/runs\/stream$/.test(r.url()),{timeout:25000});
    requestWait.catch(()=>{});
    await (await this.unique(LOCATORS.send)).click();
    const req=await requestWait,body=req.postDataJSON();
    const captured={sessionId:body.metadata?.session_id,requestObserved:true,referenceUrls:(body.input?.messages?.[0]?.content||[]).filter?.(c=>c.type==='image_url').map(c=>c.image_url.url)||[],videoSettings:body.config?.configurable?.video_params};
    await onCaptured(captured);
    const context=nativeSubmission(body,prompt,files);
    need(context.sessionId,'SUBMISSION_UNCERTAIN','Native request has no session ID.');await onCaptured({...context,requestObserved:true});
    const response=await req.response();need(response&&response.ok(),'SUBMISSION_UNCERTAIN','Native submission response was not verified.');
    const headers=response.headers(),runId=headers['x-run-id']||headers['content-location']?.match(/\/runs\/([^/]+)$/)?.[1];
    need(runId,'SUBMISSION_UNCERTAIN','Native submission did not expose a run ID.');await onCaptured({...context,runId});return {...context,runId};
  }
  async saveFrame(change,directory){
    return this.composerLock(()=>this.writeLock(()=>this.saveFrameLocked(change,directory)));
  }
  async saveFrameLocked(change,directory){
    const token=await this.beforeWrite(),next=change(token.before.content);
    if(!next.changed){verifyGrouping(token.before.content,token.before.content,next);return {...next,changed:false};}
    await newJSON(path.join(directory,`canvas-before-frame-${crypto.randomUUID()}.json`),{content:token.before.content,id:this.canvasId,createdAt:new Date().toISOString()});
    const fresh=await this.getBoard();need(fresh.content===token.before.content,'CANVAS_CHANGED','Canvas changed before grouping.');
    await this.gateway('/canvas/save',{method:'POST',data:{id:this.canvasId,content:next.content,thumbnail:token.before.thumbnail,triggerType:'auto'}});
    const after=await this.getBoard();verifyGrouping(token.before.content,after.content,next);await this.afterWrite(token);return next;
  }
  async close(){await this.browser?.close();}
}
