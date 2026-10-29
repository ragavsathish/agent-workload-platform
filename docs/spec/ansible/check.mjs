#!/usr/bin/env node
// Keep the language-neutral automation spec complete as playbooks change.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specDir = dirname(fileURLToPath(import.meta.url));
const automationDir = resolve(specDir, '../../../products/voice-agent/automation');
const playbookDir = join(automationDir, 'playbooks');
const playbooks = (await readdir(playbookDir)).filter((name) => name.endsWith('.yml'))
  .map((name) => name.slice(0, -4)).sort();
const specs = (await readdir(specDir)).filter((name) => name.endsWith('.feature'))
  .map((name) => name.slice(0, -8)).sort();
assert.deepEqual(specs, playbooks, 'every playbook needs exactly one language-neutral feature');
const index = await readFile(join(specDir, 'index.md'), 'utf8');
for (const role of await readdir(join(automationDir, 'roles'))) {
  assert.ok(index.includes(`roles/${role}`), `unmapped automation role: ${role}`);
}
for (const taskFile of (await readdir(join(automationDir, 'tasks'))).filter((name) => name.endsWith('.yml'))) {
  assert.ok(index.includes(`tasks/${taskFile}`), `unmapped reusable task file: ${taskFile}`);
}
for (const moduleFile of (await readdir(join(automationDir, 'library'))).filter((name) => name.endsWith('.py'))) {
  assert.ok(index.includes(`\`${moduleFile}\``), `unmapped custom automation module: ${moduleFile}`);
}

const ids = new Set();
let scenarios = 0;
for (const stem of specs) {
  const source = await readFile(join(specDir, `${stem}.feature`), 'utf8');
  assert.match(source, /^Feature: .+$/mu, `${stem}: missing Feature`);
  assert.doesNotMatch(source, /\b(?:ansible|golang|go)\b|@(?:ansible|go)-/iu,
    `${stem}: feature must be implementation-neutral`);
  const lines = source.split(/\r?\n/u);
  let count = 0;
  for (const [index, line] of lines.entries()) {
    if (!/^\s*Scenario(?: Outline)?:\s*\S/u.test(line)) continue;
    const tag = lines[index - 1]?.trim();
    assert.match(tag ?? '', new RegExp(`^@behavior-${stem}-[0-9]{3}$`, 'u'),
      `${stem}:${index + 1}: scenario needs a stable source-specific id`);
    assert.ok(!ids.has(tag), `${stem}: duplicate scenario id ${tag}`);
    ids.add(tag);
    count++;
    scenarios++;
    assert.equal(tag, `@behavior-${stem}-${String(count).padStart(3, '0')}`,
      `${stem}: scenario IDs must remain ordered and append-only`);
    const untilNext = lines.slice(index + 1).findIndex((next) => /^\s*Scenario(?: Outline)?:/u.test(next));
    const body = lines.slice(index + 1, untilNext < 0 ? undefined : index + 1 + untilNext).join('\n');
    assert.match(body, /^\s*Given\b/mu, `${tag}: missing Given`);
    assert.match(body, /^\s*When\b/mu, `${tag}: missing When`);
    assert.match(body, /^\s*Then\b/mu, `${tag}: missing Then`);
    if (/^\s*Scenario Outline:/u.test(line)) assert.match(body, /^\s*Examples:/mu, `${tag}: missing Examples`);
  }
  assert.ok(count > 0, `${stem}: empty feature`);
}
console.log(`automation spec: ${specs.length} playbooks, ${scenarios} scenarios, unique stable ids`);
