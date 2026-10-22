import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installSkill,skillStatus,checkUpdate,updatePolicy,installUpdate} from '../src/lifecycle.mjs';
import {META,hash} from '../src/core.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ic-life-'));const old=process.env.INFINITE_CANVAS_STATE_DIR;process.env.INFINITE_CANVAS_STATE_DIR=path.join(root,'state');t.after(async()=>{if(old===undefined)delete process.env.INFINITE_CANVAS_STATE_DIR;else process.env.INFINITE_CANVAS_STATE_DIR=old;await fs.rm(root,{recursive:true,force:true});});return root;}
test('managed Skill installs, repairs stale bytes in place for locked-directory update, preserves UI metadata and rolls back failure',async t=>{
  const root=await fixture(t),dest=path.join(root,'skill');const first=await installSkill('codex',dest);assert.equal(first.current,true);assert.equal((await installSkill('codex',dest)).changed,false);
  const marker=path.join(dest,'.infinite-canvas-managed.json'),skill=path.join(dest,'SKILL.md'),ui=path.join(dest,'agents/openai.yaml');let record=JSON.parse(await fs.readFile(marker));
  await fs.writeFile(ui,'display_name: Custom UI\n');await fs.writeFile(skill,'old managed version');record.hashes['SKILL.md']=hash('old managed version');record.version='0.0.1';await fs.writeFile(marker,JSON.stringify(record));
  const inode=(await fs.stat(dest)).ino;const updated=await installSkill('codex',dest);assert.equal(updated.current,true);assert.equal(updated.metadata_preserved,true);assert.equal((await fs.stat(dest)).ino,inode);assert.equal(await fs.readFile(ui,'utf8'),'display_name: Custom UI\n');assert.equal((await fs.stat(updated.backup)).isDirectory(),true);
  record=JSON.parse(await fs.readFile(marker));record.version='0.0.2';await fs.writeFile(marker,JSON.stringify(record));const before=await fs.readFile(skill,'utf8');await assert.rejects(installSkill('codex',dest,{failAfterCopy:true}),{code:'SKILL_SYNC_FAILED'});assert.equal(await fs.readFile(skill,'utf8'),before);
  assert.equal((await installSkill('codex',dest)).metadata_preserved,true);
  await fs.writeFile(skill,'user-owned edit');await assert.rejects(installSkill('codex',dest),{code:'LOCAL_EDITS'});assert.equal(await fs.readFile(skill,'utf8'),'user-owned edit');
});
test('a newly introduced resource cannot overwrite an unowned existing file',async t=>{
  const root=await fixture(t),dest=path.join(root,'skill');await installSkill('codex',dest);const marker=path.join(dest,'.infinite-canvas-managed.json');const record=JSON.parse(await fs.readFile(marker));delete record.hashes['references/runtime.md'];record.version='0.0.1';await fs.writeFile(marker,JSON.stringify(record));const f=path.join(dest,'references/runtime.md');await fs.writeFile(f,'user document');await assert.rejects(installSkill('codex',dest),{code:'UNMANAGED_TARGET'});assert.equal(await fs.readFile(f,'utf8'),'user document');
});
test('unmanaged targets are preserved and failed new installation is recoverable',async t=>{
  const root=await fixture(t),dest=path.join(root,'unmanaged');await fs.mkdir(dest);await fs.writeFile(path.join(dest,'keep'),'original');await assert.rejects(installSkill('codex',dest),{code:'UNMANAGED_TARGET'});assert.equal(await fs.readFile(path.join(dest,'keep'),'utf8'),'original');
  const fresh=path.join(root,'fresh');await assert.rejects(installSkill('codex',fresh,{failAfterCopy:true}),{code:'SKILL_SYNC_FAILED'});assert.equal((await installSkill('codex',fresh)).current,true);
});
test('update detection caches, backs off offline, obeys opt-out and preserves malformed state',async t=>{
  const root=await fixture(t);let calls=0;const fetcher=async()=>{calls++;return {ok:true,json:async()=>({version:META.version})};};
  assert.equal((await checkUpdate({fetcher,now:1000})).latest,META.version);assert.equal((await checkUpdate({fetcher,now:2000})).cached,true);assert.equal(calls,1);
  await updatePolicy('off');assert.equal((await checkUpdate({fetcher})).enabled,false);await updatePolicy('on');
  assert.equal((await checkUpdate({force:true,fetcher:async()=>{throw Error('offline')},now:3000})).reason,'offline-or-timeout');assert.equal((await checkUpdate({fetcher,now:4000})).cached,true);assert.equal(calls,1);
  const cache=path.join(root,'state','update-cache.json');await fs.writeFile(cache,'{"owner":"someone-else","checkedAt":1}');await assert.rejects(checkUpdate({fetcher}),{code:'UNMANAGED_STATE'});assert.equal(await fs.readFile(cache,'utf8'),'{"owner":"someone-else","checkedAt":1}');
});
test('source checkout rejects package replacement',async()=>{await assert.rejects(installUpdate({yes:true}),{code:'SOURCE_CHECKOUT'});});
