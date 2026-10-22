import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ChromeRuntime,chromeCandidates,chromeArgs,dedicatedCommand,CDP,windowsListeners} from '../src/browser-runtime.mjs';
import {chromium} from 'playwright-core';

function fixture(platform='darwin',extra={}){
  const home=platform==='win32'?'C:\\Users\\测试 用户':'/Users/test user',executable=chromeCandidates({platform,home,env:{}})[0];let running=false,launches=0;
  const runtime=new ChromeRuntime({platform,home,env:{},access:async file=>file===executable,probe:async()=>running,fetcher:async()=>({ok:true,json:async()=>({Browser:'Chrome/140',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/browser/test'})}),launchProcess:async(file,args)=>{assert.equal(file,executable);assert.equal(args.includes('--no-sandbox'),false);launches++;running=true;return 123;},mkdir:async()=>{},pause:async()=>new Promise(r=>setTimeout(r,1)),...extra});
  runtime.owners=async()=>[{pid:123,name:'chrome.exe',addresses:['127.0.0.1'],command:'"'+executable+'" '+chromeArgs(runtime.profile).map(a=>a.includes(' ')?'"'+a+'"':a).join(' ')}];
  return {runtime,executable,setRunning:value=>{running=value;},launches:()=>launches};
}
test('macOS and Windows discover Chrome in system and current-user locations',async()=>{
  assert.equal(chromeCandidates({platform:'darwin',home:'/Users/me',env:{}}).length,2);
  assert.equal(chromeCandidates({platform:'win32',home:'C:\\Users\\me',env:{}}).length,3);
  for(const platform of ['darwin','win32']){const f=fixture(platform);const s=await f.runtime.status();assert.equal(s.ok,true);assert.equal(s.chrome.installed,true);assert.equal(s.ready,false);assert.equal(s.state,'stopped');assert.equal(s.next_action,'browser open');assert.equal(f.launches(),0);}
});
test('Windows App Paths discovers nonstandard installations and expands environment paths',async()=>{
  const wanted='D:\\安装 应用\\Chrome\\chrome.exe',calls=[];
  const d=new ChromeRuntime({platform:'win32',home:'C:\\Users\\me',env:{CUSTOMAPPS:'D:\\安装 应用'},access:async file=>file===wanted,exec:async(file,args)=>{calls.push([file,args]);return {stdout:'(Default)    REG_EXPAND_SZ    %CUSTOMAPPS%\\Chrome\\chrome.exe\r\n'};}});
  assert.equal((await d.discover()).executable,wanted);assert.equal(calls[0][0],'reg.exe');
});
test('explicit executable is authoritative and not silently replaced',async()=>{
  const d=new ChromeRuntime({platform:'darwin',env:{INFINITE_CANVAS_CHROME_BIN:'/missing/chrome'},access:async()=>false,probe:async()=>false});
  assert.equal((await d.status()).error.code,'CHROME_NOT_FOUND');await assert.rejects(d.open(),{code:'CHROME_NOT_FOUND'});
});
test('process ownership recognizes quoted spaces, Unicode and Windows slash/case variants',()=>{
  const profile='C:\\Users\\中文 Name\\.dianshang-chrome-profile';
  assert.equal(dedicatedCommand('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9223 "--user-data-dir='+profile+'"',profile,'win32'),true);
  assert.equal(dedicatedCommand('--remote-debugging-port 9223 --user-data-dir="'+profile.toUpperCase().replaceAll('\\','/')+'"',profile,'win32'),true);
  for(const bad of ['--remote-debugging-port=92230 --user-data-dir="'+profile+'"','--remote-debugging-port=9223 --user-data-dir="'+profile+'-other"','--remote-debugging-port=9223 --user-data-dir="'+profile+'" --no-sandbox'])assert.equal(dedicatedCommand(bad,profile,'win32'),false);
});
for(const platform of ['darwin','win32'])test(platform+' launches directly with a persistent dedicated profile and reuses it',async()=>{
  const f=fixture(platform);const first=await f.runtime.open();assert.equal(first.ready,true);assert.equal(first.started,true);assert.equal(first.cdp,CDP);assert.equal((await f.runtime.open()).reused,true);assert.equal(f.launches(),1);
});
test('concurrent startup requests share one browser launch',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ic-start-lock-')),old=process.env.INFINITE_CANVAS_STATE_DIR;process.env.INFINITE_CANVAS_STATE_DIR=dir;t.after(async()=>{if(old===undefined)delete process.env.INFINITE_CANVAS_STATE_DIR;else process.env.INFINITE_CANVAS_STATE_DIR=old;await fs.rm(dir,{recursive:true,force:true});});
  const f=fixture();const result=await Promise.all([f.runtime.open(),f.runtime.open(),f.runtime.open()]);assert.equal(result.every(r=>r.ready),true);assert.equal(f.launches(),1);
});
test('an occupied foreign profile/port never starts another Chrome or kills a process',async()=>{
  const f=fixture('win32');f.setRunning(true);f.runtime.owners=async()=>[{pid:1,name:'chrome.exe',addresses:['127.0.0.1'],command:'chrome.exe --remote-debugging-port=9223 --user-data-dir=C:\\other'}];
  assert.equal((await f.runtime.status()).error.code,'BROWSER_PORT_CONFLICT');await assert.rejects(f.runtime.open(),{code:'BROWSER_PORT_CONFLICT'});assert.equal(f.launches(),0);
});
test('non-loopback listeners and inaccessible ownership produce actionable failures',async()=>{
  const f=fixture('win32');f.setRunning(true);const owners=f.runtime.owners;f.runtime.owners=async()=> (await owners()).map(p=>({...p,addresses:['0.0.0.0']}));assert.equal((await f.runtime.status()).error.code,'BROWSER_PORT_CONFLICT');f.runtime.owners=async()=>{throw Error('access denied');};assert.equal((await f.runtime.status()).error.code,'BROWSER_OWNERSHIP_UNVERIFIED');
});
test('an unready CDP endpoint is not confused with a missing Chrome installation',async()=>{
  const f=fixture('darwin',{fetcher:async()=>{throw Error('starting');}});f.setRunning(true);const s=await f.runtime.status();assert.equal(s.ok,true);assert.equal(s.ready,false);assert.equal(s.state,'starting');
});
test('Windows ownership uses bounded built-in PowerShell commands and normalizes UTF-8 JSON',async()=>{
  let call;const d=new ChromeRuntime({platform:'win32',env:{},exec:async(...args)=>{if(args[0].endsWith('netstat.exe'))return {stdout:'  TCP  127.0.0.1:9223  0.0.0.0:0  LISTENING  123\r\n'};call=args;return {stdout:'\uFEFF[{"pid":123,"name":"chrome.exe","command":"中文"}]'};}});
  const owner=(await d.owners())[0];assert.equal(owner.command,'中文');assert.deepEqual(owner.addresses,['127.0.0.1']);assert.match(call[0],/powershell\.exe$/);assert.match(call[1].at(-1),/Get-CimInstance/);assert.equal(call[2].timeout,30000);
});
test('Windows TCP ownership parsing handles IPv4, IPv6, localized headings and unrelated connections',()=>{
  assert.deepEqual(windowsListeners('活动连接\r\nTCP 127.0.0.1:9223 0.0.0.0:0 LISTENING 123\r\nTCP [::1]:9223 [::]:0 LISTENING 123\r\nTCP 127.0.0.1:92230 0.0.0.0:0 LISTENING 999\r\nTCP 127.0.0.1:9223 127.0.0.1:5500 ESTABLISHED 123'),[{pid:123,address:'127.0.0.1'},{pid:123,address:'::1'}]);
});
test('a configured legacy launcher failure is explicit rather than bypassed',async()=>{
  const d=new ChromeRuntime({env:{INFINITE_CANVAS_BROWSER_BIN:'missing-launcher'},exec:async()=>{throw Error('missing');}});await assert.rejects(d.configuredLauncher('status'),{code:'BROWSER_UNAVAILABLE'});
});
test('native Chrome startup and CDP ownership on the actual hosted operating system',{skip:!process.env.GITHUB_ACTIONS||!['darwin','win32'].includes(process.platform),timeout:90000},async()=>{
  const env={...process.env};delete env.INFINITE_CANVAS_BROWSER_BIN;delete env.INFINITE_CANVAS_CHROME_BIN;
  const d=new ChromeRuntime({env,headless:true,startupUrl:'about:blank'});const before=await d.status();assert.equal(before.chrome.installed,true);assert.equal(before.running,false,'CI must start without another 9223 browser');
  let ready;try{ready=await d.open({timeoutMs:60000});}catch(error){try{await d.owners();}catch(cause){console.error('CI ownership diagnostic:',{code:cause.code,killed:cause.killed,stderr:cause.stderr,message:cause.message});}throw error;}assert.equal(ready.ready,true);assert.equal(ready.started,true);
  const browser=await chromium.connectOverCDP(CDP);try{const session=await browser.newBrowserCDPSession();await session.send('Browser.close');}finally{await browser.close().catch(()=>{});}
});
