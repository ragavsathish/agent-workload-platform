#!/usr/bin/env node
// Verify the context split and cross-context slice references stay coherent.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const contexts = (await readdir(dir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^c[1-9]-/u.test(entry.name))
  .map((entry) => entry.name).sort();
assert.equal(contexts.length, 9, 'all nine bounded contexts need a spec.feature');

const ids = new Set();
for (const [index, context] of contexts.entries()) {
  assert.ok(context.startsWith(`c${index + 1}-`), `unexpected context order: ${context}`);
  const source = await readFile(join(dir, context, 'spec.feature'), 'utf8');
  assert.match(source, /^Feature: \S/mu, `${context}: missing Feature`);
  const scenarios = [...source.matchAll(/^\s+@bc-(c[1-9])-(\d{3}) @(current|agreed|proposed)\n\s+Scenario: ([^\n]+)\n((?:[^\n]*\n)*?)(?=\s+@bc-|$)/gmu)];
  assert.ok(scenarios.length > 0, `${context}: no tagged scenarios`);
  for (const [scenarioIndex, match] of scenarios.entries()) {
    const [, owner, number, , title, body] = match;
    assert.equal(owner, `c${index + 1}`, `${context}: wrong context ID`);
    assert.equal(number, String(scenarioIndex + 1).padStart(3, '0'), `${context}: scenario IDs must be ordered`);
    const id = `@bc-${owner}-${number}`;
    assert.ok(!ids.has(id), `duplicate ${id}`);
    ids.add(id);
    assert.ok(title.trim(), `${id}: empty title`);
    for (const keyword of ['Given', 'When', 'Then']) {
      assert.match(body, new RegExp(`^\\s+${keyword}\\b`, 'mu'), `${id}: missing ${keyword}`);
    }
  }
}

const usedContexts = new Set();
let journeyCount = 0;
for (const [slice, path] of [
  ['01', '../../plan/01-voice-to-durable/spec.feature'],
  ['04', '../../plan/04-owner-work-to-release/spec.feature'],
]) {
  const source = await readFile(resolve(dir, path), 'utf8');
  const pattern = new RegExp(`^\\s+@slice-${slice}-(\\d{3}) @(current|proposed)\\n\\s+Scenario: ([^\\n]+)\\n((?:[^\\n]*\\n)*?)(?=\\s+@slice-|$)`, 'gmu');
  const scenarios = [...source.matchAll(pattern)];
  assert.ok(scenarios.length > 0, `slice ${slice}: no scenarios`);
  journeyCount += scenarios.length;
  for (const [index, match] of scenarios.entries()) {
    const [, number, , title, body] = match;
    assert.equal(number, String(index + 1).padStart(3, '0'), `slice ${slice}: IDs must be ordered`);
    const refs = [...body.matchAll(/@bc-c[1-9]-\d{3}/gu)].map((item) => item[0]);
    assert.ok(refs.length > 0, `slice ${slice}-${number}: missing contract references`);
    const owners = new Set();
    for (const ref of refs) {
      assert.ok(ids.has(ref), `slice ${slice}-${number}: unknown ${ref}`);
      owners.add(ref.slice(4, 6));
      usedContexts.add(ref.slice(4, 6));
    }
    assert.ok(owners.size >= 2, `slice ${slice}-${number}: wrapper must cross contexts`);
    assert.ok(title.trim(), `slice ${slice}-${number}: empty title`);
    for (const keyword of ['Given', 'When', 'Then']) {
      assert.match(body, new RegExp(`^\\s+${keyword}\\b`, 'mu'), `slice ${slice}-${number}: missing ${keyword}`);
    }
  }
}
assert.equal(usedContexts.size, 9, 'journey wrapper must cite all nine contexts');
console.log(`context specs: ${contexts.length} contexts, ${ids.size} rules, ${journeyCount} cross-context journeys`);
