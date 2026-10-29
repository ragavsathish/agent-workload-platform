#!/usr/bin/env node
// Keep the component contract complete as Go modules and source files change.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(specDir, '../../..');
const excluded = new Set(['.git', 'loyly', 'worktrees', 'node_modules', 'vendor', 'artifacts', '.venv', 'dist', 'build']);
const modules = [];

async function findModules(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'go.mod')) {
    modules.push(dir);
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !excluded.has(entry.name)) await findModules(join(dir, entry.name));
  }
}

async function goSources(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) files.push(entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) {
      for (const child of await goSources(join(dir, entry.name))) files.push(join(entry.name, child));
    }
  }
  return files;
}

await findModules(root);
assert.ok(modules.length > 0, 'no Go modules found');
const index = await readFile(join(specDir, 'index.md'), 'utf8');
const features = (await readdir(specDir)).filter((name) => name.endsWith('.feature')).sort();
const referencedFeatures = new Set();
let sources = 0;
for (const moduleDir of modules) {
  const modulePath = `${relative(root, moduleDir).split('\\').join('/')}/go.mod`;
  const moduleFiles = await goSources(moduleDir);
  assert.ok(moduleFiles.length > 0, `${modulePath}: no production Go files`);
  for (const source of moduleFiles) {
    const normalized = source.split('\\').join('/');
    const row = index.split('\n').find((line) => line.includes(`\`${modulePath}\` | \`${normalized}\``));
    assert.ok(row, `unmapped Go source: ${modulePath} ${normalized}`);
    const links = [...row.matchAll(/\]\(([^)]+\.feature)\)/gu)].map((match) => match[1]);
    assert.ok(links.length > 0, `${normalized}: no feature link`);
    for (const link of links) {
      assert.ok(features.includes(link), `${normalized}: missing feature ${link}`);
      referencedFeatures.add(link);
    }
    sources++;
  }
}
assert.deepEqual([...referencedFeatures].sort(), features, 'every feature must map to production Go source');

const ids = new Set();
let scenarios = 0;
for (const feature of features) {
  const stem = feature.slice(0, -8);
  const source = await readFile(join(specDir, feature), 'utf8');
  assert.doesNotMatch(source, /\b(?:ansible|golang|go)\b|@(?:ansible|go)-/iu,
    `${feature}: feature must be implementation-neutral`);
  const lines = source.split(/\r?\n/u);
  assert.ok(lines.some((line) => /^Feature: \S/u.test(line)), `${feature}: missing Feature`);
  let count = 0;
  for (const [index, line] of lines.entries()) {
    if (!/^\s*Scenario(?: Outline)?:\s*\S/u.test(line)) continue;
    const tag = lines[index - 1]?.trim();
    count++;
    assert.equal(tag, `@behavior-${stem}-${String(count).padStart(3, '0')}`,
      `${feature}:${index + 1}: scenario ID must be ordered and source-specific`);
    assert.ok(!ids.has(tag), `duplicate scenario ID ${tag}`);
    ids.add(tag);
    scenarios++;
    const next = lines.findIndex((candidate, offset) => offset > index && /^\s*Scenario(?: Outline)?:/u.test(candidate));
    const body = lines.slice(index + 1, next < 0 ? undefined : next).join('\n');
    for (const keyword of ['Given', 'When', 'Then']) {
      assert.match(body, new RegExp(`^\\s*${keyword}\\b`, 'mu'), `${tag}: missing ${keyword}`);
    }
    if (/^\s*Scenario Outline:/u.test(line)) assert.match(body, /^\s*Examples:/mu, `${tag}: missing Examples`);
  }
  assert.ok(count > 0, `${feature}: empty feature`);
}
console.log(`Go spec: ${modules.length} modules, ${sources} source files, ${features.length} features, ${scenarios} scenarios`);
