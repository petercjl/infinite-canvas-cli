import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execute,ROOT} from '../src/core.mjs';

test('npm handoff reports incomplete setup; the public CLI installs and verifies only the selected Agent Skill',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ic-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={...process.env,INFINITE_CANVAS_AUTO_UPDATE:'0',INFINITE_CANVAS_STATE_DIR:path.join(root,'state')};
  const invoke=args=>execute(process.execPath,[path.join(ROOT,'bin/infinite-canvas.mjs'),...args],{env});
  const notice=JSON.parse((await execute(process.execPath,[path.join(ROOT,'src/postinstall.mjs')],{env})).stdout);assert.equal(notice.complete,false);assert.deepEqual(notice.required_components,['cli','skill']);
  await assert.rejects(invoke(['install','--json']),e=>JSON.parse(e.stdout).error.code==='SKILL_TARGET_REQUIRED');
  const dest=path.join(root,'另一 Agent','infinite-canvas-video'),args=['install','--agent','custom-agent','--path',dest,'--json'];
  const receipt=JSON.parse((await invoke(args)).stdout);assert.equal(receipt.complete,true);assert.equal(receipt.skill.destination,dest);assert.equal(receipt.skill.current,true);
  const source=JSON.parse((await invoke(['skill','source','--json'])).stdout);assert.equal(source.installation.required_components.includes('skill'),true);
  assert.equal(await fs.readFile(path.join(dest,'SKILL.md'),'utf8'),await fs.readFile(path.join(source.source,'SKILL.md'),'utf8'));
  assert.equal(JSON.parse((await invoke(args)).stdout).changed,false);
});
