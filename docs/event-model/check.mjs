#!/usr/bin/env node
// Ensure every source behavior feature remains represented on the storming board.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelDir = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(modelDir, '../spec');
const evidenceDir = resolve(modelDir, '../evidence/allure');
const board = await readFile(join(modelDir, 'storming.md'), 'utf8');
let features = 0;
for (const [dir, group, prefix] of [
  [evidenceDir, 'features', '../evidence/allure'],
  [specDir, 'ansible', '../spec'],
  [specDir, 'go', '../spec'],
]) {
  for (const name of (await readdir(join(dir, group))).filter((entry) => entry.endsWith('.feature'))) {
    const link = `${prefix}/${group}/${name}`;
    assert.ok(board.includes(link), `storming board has no source mapping for ${link}`);
    features++;
  }
}
console.log(`event model: ${features} behavior features mapped to storming board`);
