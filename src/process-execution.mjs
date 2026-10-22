import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const failure = (code, message) => Object.assign(new Error(message), {code});
async function fileExists(file) {
  try { return (await fs.stat(file)).isFile(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

/** Resolve only a declared Node package bin. Never evaluate a batch script. */
export async function npmShimEntry(shim) {
  const text = await fs.readFile(shim, 'utf8');
  const name = path.basename(shim, path.extname(shim));
  const candidates = [...text.matchAll(/%(?:dp0%|~dp0)[\\/]([^"\r\n%]+\.(?:mjs|cjs|js))/gi)]
    .map(match => path.resolve(path.dirname(shim), ...match[1].split(/[\\/]/)));
  for (const entry of new Set(candidates)) {
    if (!await fileExists(entry)) continue;
    for (let directory = path.dirname(entry);;) {
      const manifest = path.join(directory, 'package.json');
      if (await fileExists(manifest)) {
        let pkg;
        try { pkg = JSON.parse(await fs.readFile(manifest, 'utf8')); }
        catch { break; }
        const bin = typeof pkg.bin === 'string'
          ? (pkg.name?.split('/').at(-1) === name ? pkg.bin : undefined)
          : pkg.bin?.[name];
        if (typeof bin === 'string' && path.resolve(directory, bin) === entry) return entry;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw failure('UNSUPPORTED_COMMAND_SHIM', 'This batch command has no verifiable npm Node entry. Use a native executable or explicit Node script path.');
}

export async function resolveWindowsCommand(command, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  const directories = /[\\/]/.test(command) || path.isAbsolute(command)
    ? [''] : (env[pathKey] ?? '').split(path.delimiter).filter(Boolean).map(value => value.replace(/^"|"$/g, ''));
  const extension = path.extname(command).toLowerCase();
  const suffixes = extension ? [''] : ['.com', '.exe', '.cmd', '.bat'];
  for (const directory of directories) for (const suffix of suffixes) {
    const file = path.resolve(cwd, directory, command + suffix);
    if (!await fileExists(file)) continue;
    const ext = path.extname(file).toLowerCase();
    if (['.cmd', '.bat'].includes(ext)) return {file: process.execPath, prefix: [await npmShimEntry(file)]};
    if (['.js', '.mjs', '.cjs'].includes(ext)) return {file: process.execPath, prefix: [file]};
    return {file, prefix: []};
  }
  throw failure('ENOENT', 'Command was not found in the supplied PATH.');
}

export async function execute(command, args = [], options = {}) {
  // Do not expose a shell execution path: prompts, filenames and URLs are data.
  if (options.shell) throw failure('SHELL_NOT_SUPPORTED', 'Use an executable and an argument array.');
  if (process.platform !== 'win32') return run(command, args, {...options, shell: false});
  const launch = await resolveWindowsCommand(command, options);
  return run(launch.file, [...launch.prefix, ...args], {...options, shell: false, windowsHide: true});
}
