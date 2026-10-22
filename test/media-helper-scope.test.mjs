import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {MediaCLI} from '../src/media-cli.mjs';

test('the canvas helper rejects direct generation before invoking any command',async()=>{
  const helper=new MediaCLI();helper.bin='missing-command-that-must-never-run';
  for(const args of [['video','generate'],['image','generate'],['video','guide']])await assert.rejects(helper.call(args),{code:'MEDIA_HELPER_SCOPE'});
});

test('the bundled Skill preserves native video generation and distinguishes helper authentication',async()=>{
  const text=await fs.readFile(new URL('../skills/infinite-canvas-video/SKILL.md',import.meta.url),'utf8');
  for(const phrase of ['Video generation in this Skill always uses','sealseek-media','canvas and media-management operations only','browser login and CLI authentication are separate','absence of separate CLI flags is not evidence'])assert.ok(text.toLowerCase().includes(phrase.toLowerCase()),phrase);
});
