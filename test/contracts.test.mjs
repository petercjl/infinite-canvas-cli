import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {manifest} from '../src/contracts.mjs';
test('packed capability manifest matches the live contract and release version',async()=>{
  assert.deepEqual(JSON.parse(await fs.readFile(new URL('../capabilities.json',import.meta.url),'utf8')),manifest);
});
