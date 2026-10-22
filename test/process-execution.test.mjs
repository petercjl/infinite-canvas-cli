import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execute, npmShimEntry} from '../src/process-execution.mjs';
import {MediaCLI} from '../src/media-cli.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'npm entry 中文 & '));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const packageRoot = path.join(root, 'node_modules', '@fixture', 'cli');
  await fs.mkdir(packageRoot, {recursive: true});
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({name: '@fixture/cli', bin: {'test-cli': 'bin.mjs'}}), {flag: 'wx'});
  const entry = path.join(packageRoot, 'bin.mjs');
  await fs.writeFile(entry, `const a=process.argv.slice(2); if(a[0]==='fail'){console.log('output');console.error('diagnostic');process.exit(7)} else if(a[0]==='wait'){setTimeout(()=>{},30000)} else console.log(JSON.stringify({ok:true,args:a,env:process.env.FIXTURE_VALUE}));`, {flag: 'wx'});
  const shim = path.join(root, 'test-cli.cmd');
  await fs.writeFile(shim, '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\@fixture\\cli\\bin.mjs" %*\r\n', {flag: 'wx'});
  return {root, entry, shim};
}

test('npm shim resolves only its declared bin, without interpreting shell text', async t => {
  const f = await fixture(t);
  assert.equal(await npmShimEntry(f.shim), f.entry);
  const unknown = path.join(f.root, 'other.cmd');
  await fs.writeFile(unknown, 'echo arbitrary & del something', {flag: 'wx'});
  await assert.rejects(npmShimEntry(unknown), {code: 'UNSUPPORTED_COMMAND_SHIM'});
});

test('execution preserves literal arguments, stdout, nonzero status and timeout', async t => {
  const f = await fixture(t);
  const args = ['中文 path with spaces', '"quoted"', '& echo injected > marker', '%PATH%', '!name!', '^|<>', 'back\\slash\\', 'line\nbreak'];
  const r = await execute(process.execPath, [f.entry, ...args], {env: {...process.env, FIXTURE_VALUE: 'kept'}});
  assert.deepEqual(JSON.parse(r.stdout), {ok: true, args, env: 'kept'});
  await assert.rejects(execute(process.execPath, [f.entry, 'fail']), e => e.code === 7 && e.stdout === 'output\n' && e.stderr === 'diagnostic\n');
  await assert.rejects(execute(process.execPath, [f.entry, 'wait'], {timeout: 100}), e => e.killed === true);
  await assert.rejects(execute(process.execPath, [], {shell: true}), {code: 'SHELL_NOT_SUPPORTED'});
});

test('Windows bare npm command, explicit cmd and direct JS run through the real MediaCLI path', {skip: process.platform !== 'win32'}, async t => {
  const f = await fixture(t);
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path');
  const oldPath = process.env[pathKey];
  const oldBin = process.env.INFINITE_CANVAS_MEDIA_BIN;
  process.env[pathKey] = f.root + path.delimiter + oldPath;
  t.after(() => {process.env[pathKey] = oldPath; if (oldBin === undefined) delete process.env.INFINITE_CANVAS_MEDIA_BIN; else process.env.INFINITE_CANVAS_MEDIA_BIN = oldBin;});
  for (const bin of ['test-cli', f.shim, f.entry]) {
    process.env.INFINITE_CANVAS_MEDIA_BIN = bin;
    const result = await new MediaCLI().call(['canvas', 'get', '中文 & %PATH% "literal"']);
    assert.deepEqual(result.args, ['canvas', 'get', '中文 & %PATH% "literal"', '--json']);
  }
  await assert.rejects(execute('missing-fixture-command', []), {code: 'ENOENT'});
});
