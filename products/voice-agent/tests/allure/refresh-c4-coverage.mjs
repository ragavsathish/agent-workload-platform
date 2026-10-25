#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageAudit, coverageAuditMarkdown } from './coverage-audit.mjs';
import { inferC4Scope } from './c4-traceability.mjs';

const voiceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(voiceRoot, '../..');
const reportRoot = resolve(process.env.VOICE_ALLURE_ROOT || join(repoRoot, 'artifacts/test-reports'));
const manifest = JSON.parse(await readFile(join(reportRoot, 'latest.json'), 'utf8'));
const resultFiles = (await readdir(manifest.resultsRoot))
  .filter((name) => name.endsWith('-result.json')).sort();
const results = await Promise.all(resultFiles.map(async (name) => {
  const path = join(manifest.resultsRoot, name);
  const item = JSON.parse(await readFile(path, 'utf8'));
  const suite = item.labels?.find((label) => label.name === 'suite')?.value ?? '';
  const c4 = inferC4Scope(suite, item.name);
  item.labels = (item.labels ?? []).filter((label) =>
    !['c4System', 'c4Level', 'c4Container', 'c4View', 'c4Code'].includes(label.name)
    && !(label.name === 'tag' && label.value === 'c4-needs-review'));
  item.labels.push(
    { name: 'c4System', value: 'Voice Agent' }, { name: 'c4Level', value: c4.level },
    ...c4.containers.map((value) => ({ name: 'c4Container', value })),
    ...c4.views.map((value) => ({ name: 'c4View', value })),
    ...(c4.code ? [{ name: 'c4Code', value: c4.code }] : []),
    ...(c4.needsReview ? [{ name: 'tag', value: 'c4-needs-review' }] : []),
  );
  await writeFile(path, `${JSON.stringify(item)}\n`);
  return item;
}));
const allureBin = join(repoRoot, 'platform/agent-execution/gondolin-session/node_modules/.bin/allure');
execFileSync(allureBin, ['generate', manifest.resultsRoot,
  '--config', join(voiceRoot, 'tests/allure/allurerc.json'),
  '--output', manifest.reportPath, '--clean', '--cwd', repoRoot], { cwd: voiceRoot, stdio: 'inherit' });
const architecture = join(voiceRoot, 'docs/architecture');
const c2Source = await readFile(join(architecture, 'c2-container.mmd'), 'utf8');
const diagramNames = (await readdir(architecture))
  .filter((name) => /^(?:c[123]|d[123]|deployment-security).*\.mmd$/u.test(name)).sort();
const audit = coverageAudit(results, c2Source, diagramNames);
const runRoot = dirname(manifest.reportPath);
const json = `${JSON.stringify(audit, null, 2)}\n`;
await writeFile(join(runRoot, 'coverage-audit.json'), json);
await writeFile(join(manifest.reportPath, 'coverage-audit.json'), json);
await writeFile(join(manifest.reportPath, 'coverage-audit.md'),
  coverageAuditMarkdown(audit, manifest));
console.log(JSON.stringify({ reportPath: manifest.reportPath,
  cases: audit.cases, views: audit.views.length, c2Elements: audit.c2Elements.length }));
