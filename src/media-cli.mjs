import path from 'node:path';
import {execute,newJSON,readJSON,exists,canonical,need,Fault} from './core.mjs';

export class MediaCLI {
  constructor(){this.bin=process.env.INFINITE_CANVAS_MEDIA_BIN||'sealseek-media';}
  async call(args){
    try{const {stdout}=await execute(this.bin,[...args,'--json'],{timeout:90000,maxBuffer:32*1024*1024,env:{...process.env,SEALSEEK_MEDIA_AUTO_UPDATE:'0'}});const r=JSON.parse(stdout);need(r.ok!==false,r.error?.code||'MEDIA_API_FAILED',r.error?.message||'Canvas operation failed.');return r;}
    catch(e){if(e instanceof Fault)throw e;let r;try{r=JSON.parse(e.stdout);}catch{}throw new Fault(r?.error?.code||'MEDIA_CLI_FAILED',r?.error?.message||'sealseek-media could not complete this operation.',{command:args.slice(0,2),cause:e.code});}
  }
  get(canvas){return this.call(['canvas','get',canvas]);}
  upload(file){return this.call(['image','upload',file,'--submit']);}
  async add(canvas,media,directory){const file=path.join(directory,`import-${media.id}.json`);if(await exists(file))need(canonical(await readJSON(file))===canonical(media),'IDEMPOTENCY_CONFLICT','Import record differs.');else await newJSON(file,media);return this.call(['canvas','add',canvas,'--media',file,'--submit']);}
}
