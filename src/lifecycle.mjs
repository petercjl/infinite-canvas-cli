import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {ROOT,META,need,exists,readJSON,newJSON,newFile,replaceOwned,stateRoot,hash,mkdir,lock,execute,Fault} from './core.mjs';

export const SKILL=path.join(ROOT,'skills','infinite-canvas-video');
export async function treeFiles(root,prefix=''){
  const out=[];for(const e of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){need(!e.isSymbolicLink(),'UNMANAGED_STATE','Skill resources must not be symbolic links.');const rel=path.posix.join(prefix,e.name);if(e.isDirectory())out.push(...await treeFiles(root,rel));else out.push(rel);}return out.sort();
}
const marker='.infinite-canvas-managed.json';
const hashes=async root=>Object.fromEntries(await Promise.all((await treeFiles(root)).filter(n=>n!==marker).map(async n=>[n,hash(await fs.readFile(path.join(root,n)))])));
export function skillTarget(agent='codex',destination){
  need(/^[a-z][a-z0-9-]{0,63}$/.test(agent),'INVALID_ARGUMENT','Malformed Agent name.');
  const dest=destination?path.resolve(destination):agent==='codex'?path.join(os.homedir(),'.codex','skills','infinite-canvas-video'):null;
  need(dest,'INVALID_ARGUMENT','This Agent requires an explicit --path for its own Skill directory.');
  return {agent,adapter:agent==='codex'?'codex':'generic',destination:dest};
}
export async function skillStatus(agent,destination){
  const target=skillTarget(agent,destination),current=await hashes(SKILL);if(!await exists(target.destination))return {ok:true,...target,installed:false,current:false,version:META.version};
  const s=await fs.lstat(target.destination);need(s.isDirectory()&&!s.isSymbolicLink(),'UNMANAGED_TARGET','Preserve the existing Skill target.');
  const p=path.join(target.destination,marker);need(await exists(p),'UNMANAGED_TARGET','Existing Skill is not managed by this package.');const old=await readJSON(p);need(old.owner===META.name,'UNMANAGED_TARGET','Skill belongs to a different package.');
  const actual=await hashes(target.destination),edited=Object.entries(old.hashes).filter(([k,v])=>k!=='agents/openai.yaml'&&actual[k]!==v).map(([k])=>k);
  return {ok:true,...target,installed:true,current:old.version===META.version&&Object.entries(current).every(([k,v])=>k==='agents/openai.yaml'||actual[k]===v),edited,version:old.version,source_version:META.version,hashes:actual};
}
export async function installSkill(agent,destination,{failAfterCopy=false}={}){
  const status=await skillStatus(agent,destination);need(!status.edited?.length,'LOCAL_EDITS','Managed Skill was edited; preserve it.',{files:status.edited});
  if(status.installed&&status.current)return {...status,changed:false};
  return lock('skill:'+status.destination,async()=>{
    const fresh=await skillStatus(agent,destination);need(!fresh.edited?.length,'LOCAL_EDITS','Skill changed before synchronization.');
    let backup;if(fresh.installed){backup=path.join(stateRoot(),'skill-backups',crypto.randomUUID());await mkdir(path.dirname(backup));await fs.cp(fresh.destination,backup,{recursive:true,errorOnExist:true,force:false});need(JSON.stringify(await hashes(backup))===JSON.stringify(fresh.hashes),'BACKUP_FAILED','Skill backup verification failed.');}
    const files=await treeFiles(SKILL);const previous=new Set(fresh.installed?await treeFiles(fresh.destination):[]);
    const previousRecord=fresh.installed?await readJSON(path.join(fresh.destination,marker)):null;
    if(previousRecord)for(const rel of files)need(!previous.has(rel)||Object.hasOwn(previousRecord.hashes,rel),'UNMANAGED_TARGET','A new managed resource conflicts with a user-owned file.',{file:rel});
    const customUI=fresh.installed&&fresh.hashes['agents/openai.yaml']!==(previousRecord.canonicalHashes||previousRecord.hashes)['agents/openai.yaml'];
    await mkdir(fresh.destination);
    try{
      for(const rel of files){if(rel==='agents/openai.yaml'&&customUI)continue;const p=path.join(fresh.destination,rel),data=await fs.readFile(path.join(SKILL,rel));await mkdir(path.dirname(p));if(await exists(p)){const stat=await fs.lstat(p);need(stat.isFile()&&!stat.isSymbolicLink(),'UNMANAGED_TARGET','Managed file type changed.');await fs.writeFile(p,data);}else await newFile(p,data);}
      if(failAfterCopy)throw new Fault('TEST_SYNC_FAILURE','Injected synchronization failure.');
      const actual=await hashes(fresh.destination),canonicalHashes=await hashes(SKILL);
      const record={owner:META.name,version:META.version,hashes:Object.fromEntries(files.map(f=>[f,actual[f]])),canonicalHashes,source:SKILL};const p=path.join(fresh.destination,marker);await replaceOwned(p,record);
      const verified=await skillStatus(agent,destination);need(verified.current,'SKILL_SYNC_FAILED','Installed bytes differ from canonical source.');return {...verified,changed:true,backup,metadata_preserved:!!customUI};
    }catch(e){
      if(backup){for(const rel of await treeFiles(backup)){const p=path.join(fresh.destination,rel);await mkdir(path.dirname(p));await fs.copyFile(path.join(backup,rel),p);}for(const rel of files.filter(f=>!previous.has(f)))await fs.unlink(path.join(fresh.destination,rel)).catch(()=>{});}
      else {for(const rel of files)await fs.unlink(path.join(fresh.destination,rel)).catch(()=>{});const dirs=[...new Set(files.map(f=>path.dirname(f)).filter(d=>d!=='.'))].sort((a,b)=>b.length-a.length);for(const rel of dirs)await fs.rmdir(path.join(fresh.destination,rel)).catch(()=>{});await fs.rmdir(fresh.destination).catch(()=>{});}
      throw new Fault('SKILL_SYNC_FAILED','Skill synchronization failed; existing content was restored.',{backup,cause:e.code||e.message});
    }
  });
}
const cacheFile=()=>path.join(stateRoot(),'update-cache.json');
const policyFile=()=>path.join(stateRoot(),'update-policy.json');
export async function updatePolicy(mode){
  let policy={owner:META.name,enabled:true};if(await exists(policyFile())){policy=await readJSON(policyFile());need(policy.owner===META.name&&typeof policy.enabled==='boolean','UNMANAGED_STATE','Preserve malformed update policy.');}
  if(mode&&mode!=='status'){policy.enabled=mode==='on';await replaceOwned(policyFile(),policy);}return {ok:true,enabled:policy.enabled,automatic_installation:false};
}
export async function checkUpdate({force=false,fetcher=fetch,now=Date.now()}={}){
  if(process.env.INFINITE_CANVAS_AUTO_UPDATE==='0'&&!force)return {enabled:false};
  if(!force&&!(await updatePolicy()).enabled)return {enabled:false};
  let old;if(await exists(cacheFile())){old=await readJSON(cacheFile());need(old.owner===META.name&&Number.isFinite(old.checkedAt),'UNMANAGED_STATE','Preserve malformed update cache.');if(!force&&now-old.checkedAt<(old.available===false?3600000:86400000))return {...old,cached:true};}
  return lock('update-check',async()=>{
    let record={owner:META.name,checkedAt:now,current:META.version,available:false};
    try{const r=await fetcher('https://registry.npmjs.org/'+encodeURIComponent(META.name)+'/latest',{signal:AbortSignal.timeout(1500)});if(r.status===404)record={...record,published:false};else{need(r.ok,'REGISTRY_UNAVAILABLE','Registry check failed.');const d=await r.json();need(typeof d.version==='string'&&/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(d.version),'REGISTRY_UNAVAILABLE','Invalid registry version.');record={...record,available:true,published:true,latest:d.version,update_available:d.version!==META.version};}}
    catch{record={...record,reason:'offline-or-timeout'};}
    await replaceOwned(cacheFile(),record);return record;
  });
}
export async function automaticCheck(){try{const r=await checkUpdate();if(r.update_available&&!r.cached)process.stderr.write(JSON.stringify({update_available:true,current:META.version,latest:r.latest,installation:'explicit update install --yes required'})+'\n');}catch(e){process.stderr.write(JSON.stringify({update_check:'unavailable',code:e.code||'UPDATE_BUSY'})+'\n');}}
export async function installUpdate({yes,agent,destination}={}){
  need(yes,'PERMISSION_REQUIRED','Package update requires --yes.');
  need(!await exists(path.join(ROOT,'.git')),'SOURCE_CHECKOUT','This is a Git-owned source checkout; update it through its repository.');
  const version=await checkUpdate({force:true});need(version.published&&version.available,'REGISTRY_UNAVAILABLE','A published version is unavailable.');
  if(version.latest===META.version){const skill=agent?await installSkill(agent,destination):null;return {ok:true,changed:!!skill?.changed,version:META.version,skill};}
  const backup=path.join(stateRoot(),'package-backups',crypto.randomUUID());await mkdir(path.dirname(backup));await fs.cp(ROOT,backup,{recursive:true,errorOnExist:true,force:false});
  try{
    await execute(process.platform==='win32'?'npm.cmd':'npm',['install','--global',META.name+'@'+version.latest],{timeout:180000,maxBuffer:1024*1024});
    const entry=process.platform==='win32'?'infinite-canvas.cmd':'infinite-canvas';const r=JSON.parse((await execute(entry,['version','--json'],{timeout:15000})).stdout);need(r.version===version.latest,'UPDATE_VERIFY_FAILED','Installed CLI version differs.');
    let skill;if(agent){const args=['skill','update','--agent',agent,'--json',...(destination?['--path',destination]:[])];skill=JSON.parse((await execute(entry,args,{timeout:30000})).stdout);need(skill.ok,'SKILL_SYNC_FAILED','Package upgraded but selected Skill did not synchronize.');}
    return {ok:true,version:r.version,changed:true,backup,skill};
  }catch(e){throw new Fault('UPDATE_FAILED','Update did not verify. The complete previous package is backed up.',{backup,cause:e.code||e.message});}
}
