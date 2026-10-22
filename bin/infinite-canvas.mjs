#!/usr/bin/env node
import fs from 'node:fs/promises';
import {ffprobeStatus,setupFFprobe} from '../src/ffprobe.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {META,ROOT,need,parse,readJSON,execute,stateRoot,newJSON,redact,safeId} from '../src/core.mjs';
import {manifest,HELP} from '../src/contracts.mjs';
import {automaticCheck,checkUpdate,installUpdate,updatePolicy,SKILL,skillStatus,installSkill,completeInstallation,installationContract} from '../src/lifecycle.mjs';

const out=v=>console.log(JSON.stringify(v,null,2));
async function main(argv){
  const [command,action,...rest]=argv;
  if(!command||['help','--help','-h'].includes(command))return console.log(HELP);
  need(Number(process.versions.node.split('.')[0])>=22,'CAPABILITY_UNAVAILABLE','Node.js 22 or newer is required.');
  if(['version','--version','-v'].includes(command)){const {args,options}=parse(argv.slice(1),{booleans:['json']});need(!args.length,'INVALID_ARGUMENT','Unexpected arguments.');return options.json?out({ok:true,name:META.name,version:META.version,entry:path.join(ROOT,'bin/infinite-canvas.mjs')}):console.log('infinite-canvas '+META.version);}
  if(argv.includes('--help')||argv.includes('-h')){need(['install','video','task','frame','browser','board','skill','update','doctor','capabilities'].includes(command),'UNKNOWN_COMMAND','Unknown command.');return console.log(HELP);}
  if(command==='dependencies'&&action==='setup'){const {args}=parse(rest,{booleans:['json']});need(!args.length,'INVALID_ARGUMENT','Unexpected arguments.');const check=setupFFprobe();if(!check.ok)process.exitCode=1;return out({ok:check.ok,ffprobe:check});}
  if(command==='install'){
    const {options:o,args}=parse(argv.slice(1),{values:['agent','path'],booleans:['json']});need(!args.length,'INVALID_ARGUMENT','Unexpected arguments.');const dependency=setupFFprobe();need(dependency.ok,'DEPENDENCY_UNAVAILABLE',dependency.error?.message,{dependency:'ffprobe'});return out(await completeInstallation(o.agent,o.path));
  }
  if(command==='_worker'){need(argv.length===2,'INVALID_ARGUMENT','Invalid worker invocation.');const {processJob}=await import('../src/workflow.mjs');return out(await processJob(action));}
  if(command==='skill'){
    const {options:o,args}=parse(rest,{values:['agent','path'],booleans:['json']});need(!args.length,'INVALID_ARGUMENT','Unexpected arguments.');
    if(action==='source')return out({ok:true,source:SKILL,name:'infinite-canvas-video',version:META.version,installation:{named_agents:['codex'],fallback_agent:'generic',custom_path_required:true,scope:'selected Agent only',...installationContract}});
    if(action==='status')return out(await skillStatus(o.agent||'codex',o.path));
    need(['install','update'].includes(action),'UNKNOWN_COMMAND','Use skill source/status/install/update.');return out(await installSkill(o.agent||'codex',o.path));
  }
  if(command==='update'){
    if(action==='auto'){const [mode,...flags]=rest;const {args}=parse(flags,{booleans:['json']});need(['on','off','status'].includes(mode)&&!args.length,'INVALID_ARGUMENT','Use update auto on/off/status.');return out(await updatePolicy(mode));}
    const {options:o,args}=parse(rest,{values:['agent','path'],booleans:['yes','json']});need(!args.length,'INVALID_ARGUMENT','Unexpected arguments.');
    if(action==='check')return out({ok:true,...await checkUpdate({force:true})});
    need(action==='install','UNKNOWN_COMMAND','Use update check/install.');return out(await installUpdate({yes:o.yes,agent:o.agent,destination:o.path}));
  }
  if(command==='capabilities'){const {args}=parse(argv.slice(1),{booleans:['json']});need(!args.length,'INVALID_ARGUMENT','Unexpected arguments.');await automaticCheck();return out({ok:true,...manifest});}
  if(command==='doctor'){
    const {options:o,args}=parse(argv.slice(1),{values:['canvas'],booleans:['live','json']});need(!args.length,'INVALID_ARGUMENT','Unexpected arguments.');await automaticCheck();const checks={ffprobe:ffprobeStatus(),node:process.version,entry:path.join(ROOT,'bin/infinite-canvas.mjs'),platform:process.platform,skill:SKILL};
    for(const library of ['playwright-core','image-size']){try{await import(library);checks[library]={ok:true};}catch{checks[library]={ok:false};}}
    try{checks.media={ok:true,version:(await execute(process.env.INFINITE_CANVAS_MEDIA_BIN||'sealseek-media',['--version'],{timeout:15000})).stdout.trim()};}catch{checks.media={ok:false};}
    const {ChromeRuntime}=await import('../src/browser-runtime.mjs');const runtime=new ChromeRuntime();
    try{checks.browser=await runtime.configuredLauncher('status')||await runtime.status();}catch(e){checks.browser={ok:false,error:redact(e)};}
    if(o.live){need(o.canvas,'INVALID_ARGUMENT','Live doctor requires --canvas ID.');const {BrowserDriver,LOCATORS}=await import('../src/browser.mjs');const driver=new BrowserDriver();try{await driver.connect(o.canvas,{open:false});const board=await driver.getBoard();checks.live={canvas_id:String(board.id),title:board.title,locators:{}};for(const [k,s]of Object.entries(LOCATORS))checks.live.locators[k]=await driver.page.locator(s).count();}finally{await driver.close();}}
    const ok=checks.ffprobe.ok&&checks.media.ok&&checks['playwright-core'].ok&&checks['image-size'].ok&&checks.browser.ok;if(!ok)process.exitCode=1;return out({ok,checks,browser_ready:!!checks.browser.ready,paid_action:false,end_to_end:'not-tested-by-doctor'});
  }
  if(command==='browser'){
    const {args}=parse(rest,{booleans:['json']});need(!args.length&&['status','open'].includes(action),'INVALID_ARGUMENT','Use browser status/open --json.');
    const {ChromeRuntime}=await import('../src/browser-runtime.mjs');const runtime=new ChromeRuntime();
    const result=action==='open'?await runtime.open():await runtime.configuredLauncher('status')||await runtime.status();if(!result.ok)process.exitCode=1;return out(result);
  }
  if(command==='board'&&action==='inspect'){const {options:o,args}=parse(rest,{values:['canvas'],booleans:['json']});need(!args.length&&o.canvas,'INVALID_ARGUMENT','Provide --canvas ID.');const {MediaCLI}=await import('../src/media-cli.mjs');return out(await new MediaCLI().get(o.canvas));}
  if(command==='video'&&action==='generate'){
    const {options:o,args}=parse(rest,{values:['canvas','prompt','prompt-file','output','request-id'],repeat:['reference'],booleans:['new','submit','dry-run','json']});need(!args.length&&!(o.submit&&o['dry-run']),'INVALID_ARGUMENT','Conflicting options or extra arguments.');need(!!o.prompt!==!!o['prompt-file'],'INVALID_ARGUMENT','Provide exactly one prompt source.');need(!(o.new&&o['request-id']),'INVALID_ARGUMENT','Use new or request-id.');
    const {prepareInput,createJob,summary}=await import('../src/state.mjs');const input=await prepareInput({canvas:o.canvas,prompt:o.prompt??await fs.readFile(o['prompt-file'],'utf8'),references:o.reference,output:o.output});await automaticCheck();
    const probe=ffprobeStatus();need(probe.ok,'DEPENDENCY_UNAVAILABLE',probe.error?.message,{dependency:'ffprobe',paid_action:false});
    if(!o.submit)return out({ok:true,dry_run:true,paid_action:false,canvas_id:input.canvasId,prompt:input.prompt,references:input.references.map((r,i)=>({label:'图'+(i+1),source:r.source,sha256:r.sha256||null})),workflow:['import-references','new-native-conversation','ordered-attachments','send-prompt','follow-run','download','deduplicate-video','group-original-nodes-in-frame'],generation_submission:'webpage Agent Send button',model:'inherit webpage settings'});
    const {job,reused}=await createJob(input,{requestId:o['request-id'],newRequest:!!o.new});if(!reused){const {spawnWorker}=await import('../src/workflow.mjs');await spawnWorker(job.id);}return out({...summary(job),reused});
  }
  if(command==='task'){
    const {options:o,args}=parse(rest,{values:['timeout'],booleans:['json']});need(args.length===1,'INVALID_ARGUMENT','Provide one task ID.');const {getJob,summary}=await import('../src/state.mjs');
    if(action==='get'){need(!o.timeout,'INVALID_ARGUMENT','timeout applies only to wait.');return out(summary(await getJob(args[0])));}
    const {resumeJob,waitJob,syncJob}=await import('../src/workflow.mjs');if(['resume','sync'].includes(action)){need(!o.timeout,'INVALID_ARGUMENT','timeout applies only to wait.');return out(await (action==='sync'?syncJob:resumeJob)(args[0]));}need(action==='wait','UNKNOWN_COMMAND','Use task get/wait/resume/sync.');return out(await waitJob(args[0],Number(o.timeout||30)));
  }
  if(command==='frame'&&action==='group'){
    const {options:o,args}=parse(rest,{values:['canvas','elements','frame-id','name'],booleans:['submit','json']});need(!args.length&&o.canvas&&o.elements&&o['frame-id'],'INVALID_ARGUMENT','Provide canvas, elements JSON file, and frame-id.');safeId(o.canvas,'canvas ID');safeId(o['frame-id'],'Frame ID');const ids=await readJSON(o.elements);need(Array.isArray(ids)&&ids.length>0&&ids.length<=30&&new Set(ids).size===ids.length,'INVALID_INPUT','Provide unique element IDs.');ids.forEach(id=>safeId(id,'element ID'));await automaticCheck();
    const {BrowserDriver}=await import('../src/browser.mjs');const {groupIntoFrame}=await import('../src/frame.mjs');const driver=new BrowserDriver();try{await driver.connect(o.canvas);const group=content=>groupIntoFrame(content,{ids,frameId:o['frame-id'],name:o.name});if(!o.submit){const board=await driver.getBoard();const preview=group(board.content);delete preview.content;return out({ok:true,dry_run:true,...preview});}const directory=path.join(stateRoot(),'frame-operations',crypto.randomUUID());return out({ok:true,...await driver.saveFrame(group,directory),content:undefined});}finally{await driver.close();}
  }
  need(false,'UNKNOWN_COMMAND','Unknown command. Use --help.');
}
main(process.argv.slice(2)).catch(e=>{out({ok:false,error:redact(e)});process.exitCode=1;});
