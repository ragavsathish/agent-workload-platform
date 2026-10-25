#!/usr/bin/env node
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const voiceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportRoot = resolve(voiceRoot, '../../artifacts/test-reports');
const { runId } = JSON.parse(await readFile(join(reportRoot, 'latest.json'), 'utf8'));
if (!/^\d{4}-\d{2}-\d{2}T[\w-]+Z-\d+$/u.test(runId)) {
  throw new Error('The latest Allure run ID is invalid');
}
const source = join(reportRoot, runId, 'report');
if (!(await stat(join(source, 'index.html'))).isFile()) {
  throw new Error('The latest Allure report has no index.html');
}
const published = join(reportRoot, 'published');
await mkdir(published, { recursive: true });
const target = join(published, runId);
const staging = join(published, `${runId}.staging`);
await rm(staging, { recursive: true, force: true });
await cp(source, staging, { recursive: true });
await rm(target, { recursive: true, force: true });
await rename(staging, target);
console.log(`/knowledge/allure/${runId}/index.html`);
