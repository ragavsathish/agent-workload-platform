import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inferIntent } from './intent-taxonomy.mjs';
import { inferC4Scope } from './c4-traceability.mjs';
import { c2Elements, coverageAudit, coverageAuditMarkdown, evidenceMode } from './coverage-audit.mjs';
import { attachNativePlaywrightSteps, attachPlaywrightEvidence, nodeTapResults, patrolResults, playwrightResults, pytestJunitResults, rustTestResults, vitestResults } from './run-knowledge-review.mjs';

test('groups known behaviors and marks new test intent for review', () => {
  assert.deepEqual(inferIntent('Playwright · knowledge-base', 'saves a note correction, assertion review, and removal through the owner route'), {
    epic: 'Knowledge and review', feature: 'Correct and review journal knowledge', story: '03 · App and fixture integration (grey box)',
    capability: 'Review decisions', behavior: 'Save a correction and review assertions', validationLayer: 'integration',
  });
  assert.deepEqual(inferIntent('Gateway', 'test_task_artifact_download_requires_owner_and_returns_attachment'), {
    epic: 'Durable work', feature: 'Continue durable work', story: '05 · Component contract',
    capability: 'Task artifacts', behavior: 'Download an owned artifact', validationLayer: 'contract',
  });
  assert.deepEqual(inferIntent('MCP App browser', 'renders Playwright trace viewer inside the least-privilege sandbox'), {
    epic: 'Embedded apps', feature: 'Inspect a trace in Pi', story: '04 · Observability',
    capability: 'Trace inspection', behavior: 'Inspect a Playwright recording', validationLayer: 'observability',
  });
  assert.equal(inferIntent('New suite', 'new behavior').needsReview, true);
  assert.equal(inferIntent('Playwright · knowledge-base', 'new knowledge behavior').needsReview, true);
});

test('puts user journeys before their deployed, app, contract, and unit evidence', () => {
  const cases = [
    ['Playwright · knowledge-base', 'saves a note correction through the owner route', 'integration'],
    ['Playwright · knowledge-c2-mock', 'reviewed journal entry stays linked across the C2 mock boundaries', 'integration'],
    ['Playwright · diagnostics-c2-mock', 'replays a recorded conversation through the C2 Voice Edge mock', 'integration'],
    ['Voice Edge broker mock', 'normalizes typed Pi responses and failures through the C2 broker mock', 'integration'],
    ['Deployed MCP save round trip', 'deployed MCP correction reaches the gateway and Oxigraph, then removes its fixture', 'deployedIntegration'],
    ['Journal MCP contract', 'saves an exact-evidence correction through the gateway before marking it reviewed', 'integration'],
    ['Patrol web', 'Workspace and durable work', 'integration'],
    ['Playwright · durable', 'approves real durable work and retrieves its workspace artifact', 'journey'],
    ['Gateway', 'test_journal_feedback_updates_private_review_state', 'contract'],
    ['Knowledge core', 'tests::assertion_review_requires_authorship_and_consistent_profile_field', 'unit'],
  ];
  for (const [suite, title, layer] of cases) {
    const intent = inferIntent(suite, title);
    assert.equal(intent.validationLayer, layer);
    assert.ok(intent.feature.length > 0);
    assert.equal(intent.needsReview, undefined);
  }
  assert.equal(inferIntent('Gateway', 'test_health_requires_the_separate_gateway_capability').validationLayer, 'observability');
});

test('maps tests to existing C4 boundaries without claiming fixture-backed infrastructure', () => {
  assert.deepEqual(inferC4Scope('Playwright · voice', 'completes a deployed voice session and retains its diagnostics'), {
    level: 'C1/C2 system journey',
    containers: ['Browser Voice Client', 'Voice Edge', 'Inference Broker', 'Pi Voice Service', 'Metrics and Traces'],
    views: ['c1-system-context.mmd', 'c2-container.mmd', 'c3-browser-client.mmd',
      'c3-voice-edge.mmd', 'c3-inference-broker.mmd', 'c3-pi-voice-service.mmd',
      'd1-interactive-voice-turn.mmd'],
  });
  assert.deepEqual(inferC4Scope('Playwright · knowledge-c2-mock', 'reviewed journal entry stays linked across the C2 mock boundaries'), {
    level: 'C2 fixture-backed integration',
    containers: ['Journal & Knowledge', 'Voice Edge', 'Knowledge Graph Store'],
    views: ['c2-container.mmd', 'c3-journal-knowledge.mmd'],
  });
  assert.deepEqual(inferC4Scope('Playwright · diagnostics-c2-mock', 'replays a recorded conversation through the C2 Voice Edge mock'), {
    level: 'C2 fixture-backed integration',
    containers: ['Input Diagnostics', 'Voice Edge'],
    views: ['c2-container.mmd', 'c3-input-diagnostics.mmd'],
  });
  assert.deepEqual(inferC4Scope('Voice Edge broker mock', 'normalizes typed Pi responses and failures through the C2 broker mock'), {
    level: 'C2 fixture-backed integration',
    containers: ['Voice Edge', 'Inference Broker'],
    views: ['c2-container.mmd', 'c3-voice-edge.mmd'],
  });
  assert.deepEqual(inferC4Scope('Playwright · knowledge-base', 'saves a note correction through the owner route'), {
    level: 'C3 browser integration with route fixtures',
    containers: ['Journal & Knowledge'],
    views: ['c3-journal-knowledge.mmd'],
  });
  assert.deepEqual(inferC4Scope('Patrol web', 'Workspace and durable work'), {
    level: 'C3 browser journey', containers: ['Browser Voice Client'], views: ['c3-browser-client.mmd'],
  });
  assert.deepEqual(inferC4Scope('Playwright · durable', 'approves real durable work and retrieves its workspace artifact'), {
    level: 'C1/C2 system journey',
    containers: ['Tailnet Ingress', 'Path Router', 'Browser Voice Client', 'Voice Edge', 'Agent Gateway',
      'Task Database and Queue', 'Pi Task Worker', 'Pi Task Session', 'Task Tool Sandbox',
      'Workspace and Result Store'],
    views: ['c1-system-context.mmd', 'c2-container.mmd', 'd2-delegated-task.mmd'],
  });
  assert.deepEqual(inferC4Scope('Playwright · grafana', 'renders every operational C4 panel with accessible color semantics'), {
    level: 'C2 authenticated dashboard journey',
    containers: ['Tailnet Ingress', 'Path Router', 'Metrics and Traces'],
    views: ['c2-container.mmd', 'deployment-security.mmd'],
  });
  assert.deepEqual(inferC4Scope('Knowledge core', 'tests::encodes_only_bounded_journal_edits'), {
    level: 'Code-level unit', containers: [], views: [], code: 'Personal Knowledge Core',
  });
  assert.equal(inferC4Scope('New suite', 'new behavior').needsReview, true);
});

test('audits C2 gaps and counts only passed evidence for each journey layer', () => {
  const model = '    BROWSER["Container<br/><b>Browser Voice Client</b>"]\n'
    + '    GATEWAY[("Container database<br/><b>Agent Gateway</b>")]\n'
    + '    class BROWSER container;\n    class GATEWAY data;\n';
  assert.deepEqual(c2Elements(model), ['Browser Voice Client', 'Agent Gateway']);
  const items = [
    { status: 'passed', labels: [
      { name: 'epic', value: 'Voice conversation' }, { name: 'feature', value: 'Talk with Pi' },
      { name: 'validationLayer', value: 'journey' }, { name: 'c4Container', value: 'Browser Voice Client' },
      { name: 'c4Level', value: 'C1/C2 system journey' },
      { name: 'c4View', value: 'd1-interactive-voice-turn.mmd' },
    ] },
    { status: 'skipped', labels: [
      { name: 'epic', value: 'Voice conversation' }, { name: 'feature', value: 'Talk with Pi' },
      { name: 'validationLayer', value: 'observability' }, { name: 'c4Container', value: 'Agent Gateway' },
    ] },
  ];
  const audit = coverageAudit(items, model, ['d1-interactive-voice-turn.mmd', 'd2-delegated-task.mmd']);
  assert.equal(audit.journeys[0].layers.journey.passed, 1);
  assert.equal(audit.journeys[0].systemPathPassed, 1);
  assert.equal(audit.journeys[0].layers.observability.skipped, 1);
  assert.deepEqual(audit.c2Elements[1], { name: 'Agent Gateway', passed: 0, skipped: 1, failed: 0,
    deployedPassed: 0, fixturePassed: 0, contractPassed: 0 });
  assert.equal(audit.views[0].deployedPassed, 1);
  assert.equal(audit.views[1].passed, 0);
  const markdown = coverageAuditMarkdown(audit,
    { runId: 'test-run', commit: 'abc', counts: { passed: 1, skipped: 1 } });
  assert.match(markdown, /C2 elements without deployed evidence[\s\S]*- Agent Gateway/u);
  assert.match(markdown, /Talk with Pi \| 1 \|/u);
  const withDurable = coverageAudit([...items, { status: 'passed', labels: [
    { name: 'epic', value: 'Durable work' }, { name: 'feature', value: 'Continue durable work' },
    { name: 'validationLayer', value: 'journey' }, { name: 'c4Level', value: 'C1/C2 system journey' },
  ] }], model);
  assert.doesNotMatch(coverageAuditMarkdown(withDurable,
    { runId: 'test-run', commit: 'abc', counts: { passed: 2, skipped: 1 } }),
  /Approve a real durable task/u);
});

test('keeps a mocked downstream C2 target separate from deployed evidence', () => {
  const item = { status: 'passed', labels: [
    { name: 'suite', value: 'Playwright · durable-c2-mock' },
    { name: 'validationLayer', value: 'integration' },
    { name: 'c4Level', value: 'C2 fixture-backed integration' },
    { name: 'c4Container', value: 'Pi Task Worker' },
    { name: 'c4View', value: 'd2-delegated-task.mmd' },
  ] };
  assert.equal(evidenceMode(item), 'fixture');
  const model = '    WORKER["Container<br/><b>Pi Task Worker</b>"]\n    class WORKER container;\n';
  const audit = coverageAudit([item], model, ['d2-delegated-task.mmd']);
  assert.equal(audit.c2Elements[0].fixturePassed, 1);
  assert.equal(audit.c2Elements[0].deployedPassed, 0);
  assert.equal(audit.views[0].fixturePassed, 1);
});

test('converts Playwright cases with stable identities and failed status', () => {
  const data = { suites: [{ specs: [{ file: 'knowledge-base.spec.ts', title: 'saves a note correction through the owner route', tests: [{
    projectName: 'knowledge-base', results: [{ status: 'failed', startTime: '2026-10-25T00:00:00Z', duration: 140,
      error: { message: 'Correction missing' } }],
  }] }] }] };
  const [result] = playwrightResults(data, 'playwright.log');
  assert.equal(result.status, 'failed');
  assert.equal(result.name, 'saves a note correction through the owner route');
  assert.equal(result.statusDetails.message, 'Correction missing');
  assert.equal(result.attachments[0].source, 'playwright.log');
  assert.deepEqual(result.labels.filter(({ name }) => ['epic', 'feature', 'story'].includes(name)), [
    { name: 'epic', value: 'Knowledge and review' },
    { name: 'feature', value: 'Correct and review journal knowledge' },
    { name: 'story', value: '03 · App and fixture integration (grey box)' },
  ]);
  assert.equal(result.labels.find(({ name }) => name === 'validationLayer').value, 'integration');
  assert.deepEqual(result.labels.filter(({ name }) => name === 'c4View').map(({ value }) => value),
    ['c3-journal-knowledge.mmd']);
  assert.equal(result.historyId, playwrightResults(data, 'other.log')[0].historyId);
});

test('uses native Allure.step intervals without hook or attachment noise', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-allure-native-steps-'));
  try {
    const item = { uuid: 'one', fullName: 'voice.playwright.voice.case', name: 'voice case', status: 'passed' };
    await writeFile(join(root, 'one-result.json'), JSON.stringify({
      name: 'voice case', status: 'passed', start: 100, stop: 180, steps: [
        { name: 'Given Pi home is open', status: 'passed', stage: 'finished', start: 100, stop: 120 },
        { name: 'When I open Knowledge', status: 'passed', stage: 'finished', start: 120, stop: 150 },
        { name: 'Then the journal is visible', status: 'passed', stage: 'finished', start: 150, stop: 180 },
        { name: 'After Hooks', status: 'passed', stage: 'finished', start: 180, stop: 181 },
      ],
    }));
    await attachNativePlaywrightSteps(root, [item]);
    assert.deepEqual(item.steps.map(({ name }) => name), [
      'Given Pi home is open', 'When I open Knowledge', 'Then the journal is visible',
    ]);
    assert.equal(item.steps[1].stop - item.steps[1].start, 30);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('attaches a Playwright trace and inline evidence to its Allure case', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-allure-evidence-'));
  try {
    const output = join(root, 'playwright');
    const results = join(root, 'allure-results');
    await mkdir(join(output, 'test-results', 'case'), { recursive: true });
    await mkdir(results);
    await writeFile(join(output, 'test-results', 'case', 'trace.zip'), 'trace bytes');
    const data = { suites: [{ specs: [{ file: 'voice.spec.ts', title: 'voice journey', tests: [{
      projectName: 'voice', results: [{ status: 'passed', startTime: '2026-10-25T00:00:00Z',
        duration: 10, attachments: [
          { name: 'trace', contentType: 'application/zip', path: '/output/test-results/case/trace.zip' },
          { name: 'session evidence', contentType: 'application/json', body: Buffer.from('{"ok":true}').toString('base64') },
        ] }],
    }] }] }] };
    const items = playwrightResults(data);
    await attachPlaywrightEvidence(data, items, output, results);
    assert.deepEqual(items[0].attachments.map(({ name, type }) => [name, type]), [
      ['Playwright trace', 'application/vnd.allure.playwright-trace'], ['session evidence', 'application/json'],
    ]);
    assert.equal(await readFile(join(results, items[0].attachments[0].source), 'utf8'), 'trace bytes');
    assert.equal(await readFile(join(results, items[0].attachments[1].source), 'utf8'), '{"ok":true}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps evidence from a failed Playwright attempt when its retry passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-allure-retries-'));
  try {
    const output = join(root, 'playwright');
    const results = join(root, 'allure-results');
    await mkdir(join(output, 'test-results', 'retry'), { recursive: true });
    await mkdir(results);
    await writeFile(join(output, 'test-results', 'retry', 'trace.zip'), 'failed attempt trace');
    const data = { suites: [{ specs: [{ file: 'voice.spec.ts', title: 'retries voice', tests: [{
      projectName: 'voice', results: [
        { status: 'failed', startTime: '2026-10-25T00:00:00Z', duration: 10, attachments: [
          { name: 'trace', contentType: 'application/zip', path: '/output/test-results/retry/trace.zip' },
        ] },
        { status: 'passed', startTime: '2026-10-25T00:00:20Z', duration: 12, attachments: [
          { name: 'retry screenshot', contentType: 'image/png', body: Buffer.from('image').toString('base64') },
        ] },
      ],
    }] }] }] };
    const items = playwrightResults(data);
    await attachPlaywrightEvidence(data, items, output, results);
    assert.equal(items[0].status, 'passed');
    assert.equal(items[0].statusDetails.flaky, true);
    assert.deepEqual(items[0].attachments.map(({ name, type }) => [name, type]), [
      ['Attempt 1: Playwright trace', 'application/vnd.allure.playwright-trace'],
      ['Attempt 2: retry screenshot', 'image/png'],
    ]);
    assert.equal(await readFile(join(results, items[0].attachments[0].source), 'utf8'), 'failed attempt trace');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('attaches Patrol web traces, reports, and run evidence to each journey', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-allure-patrol-'));
  try {
    const output = join(root, 'patrol');
    const results = join(root, 'allure-results');
    for (const target of ['voice', 'workspace']) {
      await mkdir(join(output, 'results', target, 'journey'), { recursive: true });
      await mkdir(join(output, `report-${target}`), { recursive: true });
      await writeFile(join(output, 'results', target, '.last-run.json'), JSON.stringify({ status: 'passed', failedTests: [] }));
      await writeFile(join(output, 'results', target, 'journey', 'trace.zip'), `${target} trace`);
      await writeFile(join(output, `report-${target}`, 'index.html'), `${target} report`);
    }
    await writeFile(join(output, 'evidence.json'), '{"traces":2}');
    await writeFile(join(output, 'fixture-evidence.json'), '{"events":[]}');
    await mkdir(results);
    const items = await patrolResults(output, results, 1000, 200);
    assert.deepEqual(items.map(({ fullName, status }) => [fullName, status]), [
      ['voice.patrol-web.voice', 'passed'], ['voice.patrol-web.workspace', 'passed'],
    ]);
    for (const [index, item] of items.entries()) {
      assert.deepEqual(item.attachments.map(({ name, type }) => [name, type]), [
        ['Patrol Playwright trace', 'application/vnd.allure.playwright-trace'],
        ['Patrol HTML report', 'text/html'],
        ['Patrol trace evidence', 'application/json'],
        ...(index === 1 ? [['Patrol HTTP fixture evidence', 'application/json']] : []),
      ]);
      assert.equal(await readFile(join(results, item.attachments[0].source), 'utf8'),
        `${index === 0 ? 'voice' : 'workspace'} trace`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps available Patrol failure evidence when another journey never starts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-allure-patrol-failure-'));
  try {
    const output = join(root, 'patrol');
    const results = join(root, 'allure-results');
    await mkdir(join(output, 'results', 'voice', 'journey'), { recursive: true });
    await mkdir(results);
    await writeFile(join(output, 'results', 'voice', '.last-run.json'),
      JSON.stringify({ status: 'failed', failedTests: ['voice shell'] }));
    await writeFile(join(output, 'results', 'voice', 'journey', 'trace.zip'), 'failure trace');
    const items = await patrolResults(output, results, 1000, 200);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'failed');
    assert.equal(items[0].statusDetails.message, 'voice shell');
    assert.deepEqual(items[0].attachments.map(({ name, type }) => [name, type]), [
      ['Patrol Playwright trace', 'application/vnd.allure.playwright-trace'],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('converts pytest JUnit and Cargo cases with failures intact', () => {
  const junit = '<?xml version="1.0"?><testsuites><testsuite>'
    + '<testcase classname="tests.test_gateway" name="test_ok" time="0.01" />'
    + '<testcase classname="tests.test_gateway" name="test_failure" time="0.02"><failure message="Expected &lt;value&gt;" /></testcase>'
    + '</testsuite></testsuites>';
  const py = pytestJunitResults(junit, 1000, 'gateway.log');
  assert.deepEqual(py.map((result) => result.status), ['passed', 'failed']);
  assert.equal(py[1].statusDetails.message, 'Expected <value>');
  assert.equal(py[0].labels.find(({ name }) => name === 'testMethod').value, 'test_ok');
  assert.equal(py[0].labels.find(({ name }) => name === 'testClass').value, 'tests.test_gateway');
  const rust = rustTestResults('test tests::one ... ok\ntest tests::two ... FAILED\n', 1000, 'rust.log');
  assert.deepEqual(rust.map((result) => result.status), ['passed', 'failed']);
  assert.equal(rust[1].attachments[0].source, 'rust.log');
  assert.equal(rust[0].labels.find(({ name }) => name === 'testMethod').value, 'tests::one');
});

test('converts Vitest cases and Node TAP subtests without counting TAP totals', () => {
  const vitest = vitestResults({ testResults: [{ name: 'review.test.js', assertionResults: [
    { fullName: 'review opens form', title: 'opens form', status: 'passed', duration: 20 },
    { fullName: 'review saves form', title: 'saves form', status: 'failed', duration: 30,
      failureMessages: ['Save failed'] },
  ] }] }, 1000, 'vitest.log');
  assert.deepEqual(vitest.map((result) => result.status), ['passed', 'failed']);
  assert.equal(vitest[1].statusDetails.message, 'Save failed');
  const tap = nodeTapResults('TAP version 13\n# Subtest: save correction\nok 1 - save correction\n# Subtest: reject bad evidence\nnot ok 2 - reject bad evidence\n1..2\n# tests 2\n', 1000, 'node.log');
  assert.deepEqual(tap.map((result) => result.status), ['passed', 'failed']);
  assert.equal(tap.length, 2);
});
