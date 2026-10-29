#!/usr/bin/env node
// A deterministic oracle for the adapters that turn tool output into Allure measurements.
// Synthetic fixture data contains no user content or credentials.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attachNativePlaywrightSteps, attachPlaywrightEvidence, commandGate, nativePytestResults,
  nodeTapResults, patrolResults, playwrightResults, probeResult, pytestJunitResults,
  rustTestResults, vitestResults,
} from './run-knowledge-review.mjs';
import { coverageAudit, validateC4Traceability } from './coverage-audit.mjs';
import { readOracle } from './measurement-oracle-oci.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const voiceRoot = resolve(here, '../..');
const fixtureTime = '2026-01-01T00:00:00.000Z';
const label = (item, name) => (item.labels ?? []).filter((entry) => entry.name === name)
  .map((entry) => entry.value);
const projectStep = (step) => ({
  name: step.name, status: step.status,
  ...(step.steps ? { steps: step.steps.map(projectStep) } : {}),
  ...(Number.isFinite(step.start) && Number.isFinite(step.stop)
    ? { duration: step.stop - step.start } : {}),
});

const toProjection = (items, audit, attached) => ({
  schema: 1,
  cases: items.map((item) => ({
    fullName: item.fullName,
    name: item.name,
    status: item.status,
    ...(item.statusDetails?.flaky ? { flaky: true } : {}),
    ...(item.statusDetails?.message ? { error: item.statusDetails.message } : {}),
    framework: label(item, 'framework')[0],
    suite: label(item, 'suite')[0],
    epic: label(item, 'epic')[0],
    feature: label(item, 'feature')[0],
    validationLayer: label(item, 'validationLayer')[0],
    c4Level: label(item, 'c4Level')[0],
    c4Containers: label(item, 'c4Container'),
    c4Views: label(item, 'c4View'),
    steps: (item.steps ?? []).map(projectStep),
    attachments: (item.attachments ?? []).map((attachment) => ({
      name: attachment.name, type: attachment.type,
      present: attached.has(attachment.source),
    })),
  })).sort((a, b) => a.fullName.localeCompare(b.fullName)),
  coverage: {
    cases: audit.cases,
    journeys: audit.journeys,
    activeC2: audit.c2Elements.filter((row) => row.passed + row.failed + row.skipped > 0),
    activeViews: audit.views.filter((row) => row.passed + row.failed + row.skipped > 0),
    verifiedPaths: audit.verifiedPaths,
  },
});

function compare(golden, actual) {
  const expected = `${JSON.stringify(golden, null, 2)}\n`;
  const observed = `${JSON.stringify(actual, null, 2)}\n`;
  if (expected === observed) return null;
  const a = expected.split('\n');
  const b = observed.split('\n');
  const line = a.findIndex((value, index) => value !== b[index]);
  return `measurement oracle differs at line ${line + 1}\nexpected: ${a[line] ?? '<end>'}\nactual:   ${b[line] ?? '<end>'}`;
}

async function fixtureMeasurements(work) {
  const out = join(work, 'playwright');
  const results = join(work, 'allure-results');
  await mkdir(join(out, 'test-results', 'durable'), { recursive: true });
  await mkdir(results);
  await writeFile(join(out, 'test-results', 'durable', 'trace.zip'), 'synthetic trace');
  await writeFile(join(results, 'failure.log'), 'synthetic failure');
  await writeFile(join(results, 'probe.log'), 'synthetic probe');
  const durableTitle = 'I submit a task from a voice session and follow it in Flutter';
  const skippedTitle = 'renders the official Grafana trace MCP App inside voice chat';
  const playwright = { suites: [{ specs: [
    { file: 'durable.spec.ts', title: durableTitle, tests: [{ projectName: 'durable', results: [
      { status: 'failed', startTime: fixtureTime, duration: 10, error: { message: 'first attempt failed' },
        attachments: [{ name: 'trace', contentType: 'application/zip',
          path: '/output/test-results/durable/trace.zip' }] },
      { status: 'passed', startTime: '2026-01-01T00:00:01.000Z', duration: 20,
        attachments: [{ name: 'proof', contentType: 'application/json',
          body: Buffer.from('{"ok":true}').toString('base64') }] },
    ] }] },
    { file: 'voice.spec.ts', title: skippedTitle, tests: [{ projectName: 'voice', results: [
      { status: 'skipped', startTime: fixtureTime, duration: 0 },
    ] }] },
  ] }] };
  const items = playwrightResults(playwright);
  const native = join(work, 'native');
  await mkdir(native);
  for (const [index, status] of ['failed', 'passed'].entries()) {
    await writeFile(join(native, `${index}-result.json`), JSON.stringify({
      name: durableTitle, status, start: 1000 + index * 100, stop: 1100 + index * 100,
      steps: [{ name: 'Given an owner task exists', status: 'passed', start: 1000, stop: 1020 },
        { name: status === 'passed' ? 'Then the artifact is available' : 'Then the artifact is missing',
          status, start: 1020, stop: 1040 },
        { name: 'After Hooks', status: 'passed', start: 1040, stop: 1050 }],
    }));
  }
  await attachNativePlaywrightSteps(native, items);
  await attachPlaywrightEvidence(playwright, items, out, results);

  const patrol = join(work, 'patrol');
  await mkdir(join(patrol, 'results', 'voice', 'journey'), { recursive: true });
  await mkdir(join(patrol, 'results', 'workspace'), { recursive: true });
  await mkdir(join(patrol, 'report-voice'), { recursive: true });
  await writeFile(join(patrol, 'results', 'voice', '.last-run.json'), '{"status":"passed","failedTests":[]}');
  await writeFile(join(patrol, 'results', 'workspace', '.last-run.json'),
    '{"status":"failed","failedTests":["workspace failed"]}');
  await writeFile(join(patrol, 'results', 'voice', 'journey', 'trace.zip'), 'synthetic trace');
  await writeFile(join(patrol, 'report-voice', 'index.html'), '<html>synthetic</html>');
  await writeFile(join(patrol, 'evidence.json'), '{"traces":1}');
  items.push(...await patrolResults(patrol, results, 1000, 30, ['voice', 'workspace']));

  const junit = '<testsuites><testsuite>'
    + '<testcase classname="tests.test_gateway" name="test_ok" time="0.01" />'
    + '<testcase classname="tests.test_gateway" name="test_fail" time="0.02">'
    + '<failure message="Expected &lt;value&gt;" /></testcase>'
    + '<testcase classname="tests.test_gateway" name="test_skip"><skipped /></testcase>'
    + '</testsuite></testsuites>';
  items.push(...pytestJunitResults(junit, 1000, 'failure.log'));
  items.push(...nativePytestResults([{ name: 'test_owner_client_lifecycle_and_idempotency',
    fullName: 'tests.test_owner#test_owner_client_lifecycle_and_idempotency', status: 'passed',
    start: 1000, stop: 1012,
    steps: [{ name: 'Given an owner exists', status: 'passed', start: 1000, stop: 1006 },
      { name: 'Then one result is returned', status: 'passed', start: 1006, stop: 1012 }],
    attachments: [{ name: 'owner proof', source: 'owner-proof.json', type: 'application/json' }],
  }], { suite: 'Pi Durable owner C2 mock', id: 'owner' }));
  await writeFile(join(results, 'owner-proof.json'), '{"ok":true}');

  items.push(...vitestResults({ testResults: [{ name: 'app.test.js', assertionResults: [
    { fullName: 'renders Mermaid inside the least-privilege sandbox',
      title: 'renders Mermaid inside the least-privilege sandbox', status: 'passed', duration: 3 },
    { fullName: 'rejects resources outside the explicit MCP App allowlist',
      title: 'rejects resources outside the explicit MCP App allowlist', status: 'failed',
      duration: 4, failureMessages: ['unexpected resource'] },
  ] }] }, 1000, 'failure.log'));
  items.push(...nodeTapResults('TAP version 13\nok 1 - save correction\nnot ok 2 - reject bad evidence\n1..2\n# tests 2\n',
    1000, 'failure.log'));
  items.push(...rustTestResults('test tests::one ... ok\ntest tests::two ... FAILED\ntest tests::three ... ignored\n',
    1000, 'failure.log'));
  items.push(commandGate('missing-results', { code: 1, started: 1000, duration: 2,
    error: 'Expected 1 result, received 0' }, 'failure.log'));
  items.push(probeResult({ id: 'trace-probe', suite: 'Grafana MCP observability',
    title: 'queries the live C4 dashboard and a fresh Tempo trace through Grafana MCP',
    run: { code: 0, started: 1000, duration: 2, error: '' }, attachment: 'probe.log' }));

  const attached = new Set(await readdir(results));
  assert.equal(items.length, 17, 'fixture must exercise every expected source case');
  assert.deepEqual(Object.fromEntries(['passed', 'failed', 'skipped'].map((status) =>
    [status, items.filter((item) => item.status === status).length])),
  { passed: 8, failed: 6, skipped: 3 });
  const retried = items.find((item) => item.fullName?.includes('voice.playwright.durable.'));
  assert.equal(retried?.status, 'passed');
  assert.equal(retried?.statusDetails?.flaky, true, 'failed first attempt must mark retry flaky');
  assert.deepEqual(retried?.attachments?.map((attachment) => attachment.name),
    ['Attempt 1: Playwright trace', 'Attempt 2: proof']);
  assert.equal(items.find((item) => item.fullName === 'voice.gate.missing-results')?.status, 'failed');
  const c2 = await readFile(join(voiceRoot, 'docs/architecture/c2-container.mmd'), 'utf8');
  const viewNames = (await readdir(join(voiceRoot, 'docs/architecture')))
    .filter((name) => /^(?:c[123]|d[123]|deployment-security).*\.mmd$/u.test(name)).sort();
  validateC4Traceability(items, c2, viewNames);
  const projection = toProjection(items, coverageAudit(items, c2, viewNames), attached);
  assert.ok(projection.cases.every((item) => item.attachments.every((attachment) => attachment.present)),
    'all synthetic attachments must resolve');
  assert.equal(projection.coverage.cases, 17);
  return projection;
}

async function main() {
  const mode = process.argv[2] ?? '--check';
  if (!['--check', '--candidate'].includes(mode)) {
    throw new Error('usage: node tests/allure/measurement-oracle.mjs [--check|--candidate]');
  }
  const work = await mkdtemp(join(tmpdir(), 'awp-measurement-oracle-'));
  try {
    const actual = await fixtureMeasurements(work);
    if (mode === '--candidate') {
      process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    const repeatWork = await mkdtemp(join(tmpdir(), 'awp-measurement-oracle-repeat-'));
    try {
      assert.deepEqual(await fixtureMeasurements(repeatWork), actual,
        'synthetic measurement projection must be deterministic across temporary roots');
    } finally {
      await rm(repeatWork, { recursive: true, force: true });
    }
    const { golden, digest } = await readOracle();
    const difference = compare(golden, actual);
    if (difference) throw new Error(difference);
    const mutated = structuredClone(actual);
    mutated.cases[0].status = mutated.cases[0].status === 'passed' ? 'failed' : 'passed';
    assert.ok(compare(golden, mutated), 'oracle must reject changed status');
    mutated.cases[0] = structuredClone(actual.cases[0]);
    mutated.cases.pop();
    assert.ok(compare(golden, mutated), 'oracle must reject missing case');
    const missingAttachment = structuredClone(actual);
    const withEvidence = missingAttachment.cases.find((item) => item.attachments.length > 0);
    withEvidence.attachments[0].present = false;
    assert.ok(compare(golden, missingAttachment), 'oracle must reject missing evidence');
    const wrongLayer = structuredClone(actual);
    wrongLayer.cases[0].validationLayer = 'incorrect layer';
    assert.ok(compare(golden, wrongLayer), 'oracle must reject wrong validation layer');
    console.log(`measurement oracle: ${actual.cases.length} synthetic results and coverage audit match ${digest}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
