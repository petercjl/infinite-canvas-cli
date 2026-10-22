import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execute,ROOT,META} from '../src/core.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'ic-packed-'));
try{
  const env={...process.env,INFINITE_CANVAS_AUTO_UPDATE:'0',INFINITE_CANVAS_STATE_DIR:path.join(root,'state')};
  delete env.npm_config_json;delete env.npm_config_dry_run;
  const npm=args=>execute(process.execPath,[process.env.npm_execpath,...args],{cwd:ROOT,env,timeout:180000,maxBuffer:2*1024*1024});
  const packed=JSON.parse((await npm(['pack','--json','--ignore-scripts','--pack-destination',root])).stdout)[0];
  assert.ok(packed.files.some(f=>f.path==='src/postinstall.mjs'));
  for(const scriptsEnabled of [true,false]){
    const prefix=path.join(root,scriptsEnabled?'ordinary':'scripts-disabled');
    const result=await npm(['install','--prefix',prefix,'--no-audit','--no-fund',scriptsEnabled?'--foreground-scripts':'--ignore-scripts',path.join(root,packed.filename)]);
    if(scriptsEnabled)assert.ok(result.stdout.includes('SKILL_SETUP_REQUIRED'));
    const cli=path.join(prefix,'node_modules',...META.name.split('/'),'bin/infinite-canvas.mjs');
    const invoke=async args=>JSON.parse((await execute(process.execPath,[cli,...args],{env})).stdout);
    assert.equal((await invoke(['version','--json'])).version,META.version);
    const dest=path.join(root,'当前 Agent',scriptsEnabled?'ordinary':'scripts-disabled','infinite-canvas-video');
    const request=['install','--agent','custom-agent','--path',dest,'--json'];
    const first=await invoke(request);assert.equal(first.complete,true);assert.equal(first.skill.current,true);
    assert.equal((await invoke(request)).changed,false);
    const probe=await import(pathToFileURL(path.join(prefix,'node_modules',...META.name.split('/'),'src/ffprobe.mjs')).href);
    const readiness=probe.ffprobeStatus();assert.equal(readiness.ok,true,JSON.stringify(readiness));assert.equal(readiness.source,'package');
    const status=await invoke(['skill','status','--agent','custom-agent','--path',dest,'--json']);assert.equal(status.current,true);
  }
  console.log(JSON.stringify({ok:true,version:META.version,packedInstall:true,scriptsDisabled:true,currentAgentSkillVerified:true}));
}finally{await fs.rm(root,{recursive:true,force:true});}
