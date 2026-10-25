#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferIntent } from './intent-taxonomy.mjs';
import { inferC4Scope } from './c4-traceability.mjs';
import { coverageAudit, coverageAuditMarkdown, validateC4Traceability } from './coverage-audit.mjs';

const voiceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(voiceRoot, '../..');
const reportRoot = resolve(process.env.VOICE_ALLURE_ROOT || join(repoRoot, 'artifacts/test-reports'));
const runId = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}`;
const runRoot = join(reportRoot, runId);
const resultsRoot = join(runRoot, 'allure-results');
const reportPath = join(runRoot, 'report');
const allureBin = join(repoRoot, 'platform/agent-execution/gondolin-session/node_modules/.bin/allure');

const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const allureStatus = (status) => {
  if (status === 'passed') return 'passed';
  if (['skipped', 'pending', 'todo'].includes(status)) return 'skipped';
  return 'failed';
};
const testResult = ({ fullName, name, status, suite, framework, start, duration = 0, message = '', attachment,
  testMethod, testClass }) => {
  const uuid = randomUUID();
  const started = Number.isFinite(start) ? start : Date.now();
  const { epic, feature, story, capability, behavior, validationLayer, needsReview } = inferIntent(suite, name);
  const c4 = inferC4Scope(suite, name);
  return {
    uuid, testCaseId: digest(fullName), historyId: digest(fullName), fullName, name,
    status: allureStatus(status), stage: 'finished', start: started, stop: started + Math.max(0, Math.round(duration)),
    ...(message ? { statusDetails: { message: message.slice(0, 4000) } } : {}),
    labels: [
      { name: 'parentSuite', value: 'Voice Agent' }, { name: 'suite', value: suite },
      { name: 'framework', value: framework },
      { name: 'language', value: ({ patrol: 'dart', pytest: 'python', 'cargo test': 'rust' })[framework] ?? 'javascript' },
      { name: 'epic', value: epic }, { name: 'feature', value: feature }, { name: 'story', value: story },
      { name: 'capability', value: capability }, { name: 'behavior', value: behavior },
      { name: 'validationLayer', value: validationLayer },
      { name: 'c4System', value: 'Voice Agent' },
      { name: 'c4Level', value: c4.level },
      ...c4.containers.map((value) => ({ name: 'c4Container', value })),
      ...c4.views.map((value) => ({ name: 'c4View', value })),
      ...(c4.code ? [{ name: 'c4Code', value: c4.code }] : []),
      ...(testMethod ? [{ name: 'testMethod', value: testMethod }] : []),
      ...(testClass ? [{ name: 'testClass', value: testClass }] : []),
      ...(needsReview ? [{ name: 'tag', value: 'intent-needs-review' }] : []),
      ...(c4.needsReview ? [{ name: 'tag', value: 'c4-needs-review' }] : []),
    ],
    ...(attachment ? { attachments: [{ name: 'Test command output', source: attachment, type: 'text/plain' }] } : {}),
  };
};

function playwrightCases(data) {
  const cases = [];
  const visit = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const last = test.results?.at(-1);
          if (!last) continue;
          const fullName = `voice.playwright.${test.projectName}.${spec.file}.${spec.title}`;
          cases.push({ spec, test, last, fullName });
        }
      }
      visit(suite.suites);
    }
  };
  visit(data.suites);
  return cases;
}

export async function attachNativePlaywrightSteps(nativeResultsDir, items) {
  const byName = new Map();
  for (const item of items) {
    if (byName.has(item.name)) throw new Error(`Ambiguous Playwright test title: ${item.name}`);
    byName.set(item.name, item);
  }
  const attempts = new Map();
  for (const file of await readdir(nativeResultsDir)) {
    if (!file.endsWith('-result.json')) continue;
    const result = JSON.parse(await readFile(join(nativeResultsDir, file), 'utf8'));
    const item = byName.get(result.name);
    if (!item) continue;
    const steps = (result.steps ?? []).filter((step) => /^(?:Given|When|Then|And|But)\b/u.test(step.name));
    if (!steps.length) continue;
    if (!attempts.has(item.uuid)) attempts.set(item.uuid, []);
    attempts.get(item.uuid).push({ status: result.status, start: result.start, stop: result.stop, steps });
  }
  for (const item of items) {
    const recorded = (attempts.get(item.uuid) ?? []).sort((left, right) => left.start - right.start);
    if (item.status !== 'skipped' && recorded.length === 0) {
      throw new Error(`No Allure.step entries for ${item.fullName}`);
    }
    if (recorded.length === 1) item.steps = recorded[0].steps;
    else if (recorded.length > 1) item.steps = recorded.map((attempt, index) => ({
      name: `Attempt ${index + 1}`, status: attempt.status, stage: 'finished',
      start: attempt.start, stop: attempt.stop, steps: attempt.steps,
    }));
  }
}

export function playwrightResults(data, attachment) {
  return playwrightCases(data).map(({ spec, test, last, fullName }) => {
    const item = testResult({
      fullName, name: spec.title, status: last.status, suite: `Playwright · ${test.projectName}`,
      framework: 'playwright', start: Date.parse(last.startTime), duration: last.duration,
      message: last.error?.message || last.errors?.map((error) => error.message).join('\n') || '',
      attachment: last.status === 'passed' ? undefined : attachment,
    });
    if (item.status === 'passed' && test.results.slice(0, -1).some((attempt) => attempt.status !== 'passed')) {
      item.statusDetails = { ...item.statusDetails, flaky: true };
    }
    return item;
  });
}

const extensionFor = (type) => ({
  'application/json': '.json', 'application/zip': '.zip', 'image/png': '.png',
  'image/jpeg': '.jpg', 'text/plain': '.txt', 'video/webm': '.webm',
})[type] ?? '.bin';

export async function attachPlaywrightEvidence(data, items, outputDir, allureResultsDir) {
  const byName = new Map(items.map((item) => [item.fullName, item]));
  for (const { fullName, test } of playwrightCases(data)) {
    const item = byName.get(fullName);
    if (!item) throw new Error(`Missing Allure result for ${fullName}`);
    for (const [attemptIndex, attempt] of test.results.entries()) {
      for (const [index, attachment] of (attempt.attachments ?? []).entries()) {
        const isTrace = attachment.path?.endsWith('/trace.zip') ||
          (attachment.name === 'trace' && attachment.contentType === 'application/zip');
        const source = `${item.uuid}-${attemptIndex}-${index}${attachment.path ? extname(attachment.path) : extensionFor(attachment.contentType)}`;
        const target = join(allureResultsDir, source);
        if (attachment.path) {
          const origin = attachment.path.startsWith('/output/')
            ? resolve(outputDir, attachment.path.slice('/output/'.length))
            : resolve(attachment.path);
          if (!origin.startsWith(`${resolve(outputDir)}${sep}`)) throw new Error(`Playwright evidence escapes its output directory for ${fullName}`);
          await copyFile(origin, target);
        } else if (attachment.body) {
          await writeFile(target, Buffer.from(attachment.body, 'base64'));
        } else {
          throw new Error(`Playwright evidence is missing its contents for ${fullName}`);
        }
        item.attachments ??= [];
        const name = isTrace ? 'Playwright trace' : attachment.name || 'Playwright evidence';
        item.attachments.push({ name: test.results.length > 1 ? `Attempt ${attemptIndex + 1}: ${name}` : name,
          source, type: isTrace ? 'application/vnd.allure.playwright-trace'
            : attachment.contentType || 'application/octet-stream' });
      }
    }
  }
}

const patrolAttachmentType = (name) => name.endsWith('trace.zip')
  ? 'application/vnd.allure.playwright-trace' : ({
    '.html': 'text/html', '.json': 'application/json', '.png': 'image/png',
    '.webm': 'video/webm', '.zip': 'application/zip', '.log': 'text/plain',
  })[extname(name)] ?? 'application/octet-stream';

async function patrolEvidenceFiles(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await patrolEvidenceFiles(path));
    else if (entry.isFile() && entry.name !== '.last-run.json') files.push(path);
  }
  return files;
}

export async function patrolResults(runDir, allureResultsDir, started, duration, targets = ['voice', 'workspace']) {
  const items = [];
  for (const target of targets) {
    let rawResult;
    try {
      rawResult = await readFile(join(runDir, 'results', target, '.last-run.json'), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const result = JSON.parse(rawResult);
    const item = testResult({
      fullName: `voice.patrol-web.${target}`,
      name: target === 'voice' ? 'Voice shell and navigation' : target === 'workspace'
        ? 'Workspace and durable work' : 'Live edge typed turn',
      status: result.status, suite: 'Patrol web', framework: 'patrol',
      start: started, duration: Math.round(duration / targets.length),
      message: result.failedTests?.join('\n') ?? '',
    });
    const evidence = [
      ...await patrolEvidenceFiles(join(runDir, 'results', target)),
      join(runDir, `report-${target}`, 'index.html'),
      join(runDir, 'evidence.json'),
      ...(target === 'workspace' ? [join(runDir, 'fixture-evidence.json')] : []),
    ];
    for (const [index, path] of evidence.entries()) {
      const source = `${item.uuid}-${index}${extname(path)}`;
      try {
        await copyFile(path, join(allureResultsDir, source));
      } catch (error) {
        if (result.status !== 'passed' && error.code === 'ENOENT') continue;
        throw error;
      }
      item.attachments ??= [];
      item.attachments.push({ name: path.endsWith('trace.zip') ? 'Patrol Playwright trace'
        : path.endsWith('index.html') ? 'Patrol HTML report'
          : path.endsWith('fixture-evidence.json') ? 'Patrol HTTP fixture evidence'
          : path.endsWith('evidence.json') ? 'Patrol trace evidence'
            : `Patrol ${extname(path).slice(1)}: ${path.split(sep).at(-1)}`,
      source, type: patrolAttachmentType(path) });
    }
    items.push(item);
  }
  return items;
}

export function vitestResults(data, started, attachment) {
  return (data.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).map((item) => testResult({
    fullName: `voice.vitest.${file.name}.${item.fullName}`,
    name: item.title, status: item.status, suite: 'MCP App browser', framework: 'vitest',
    start: started, duration: item.duration,
    message: item.failureMessages?.join('\n') || '',
    attachment: item.status === 'passed' ? undefined : attachment,
  })));
}

export function nodeTapResults(tap, started, attachment, { suite = 'Journal MCP contract', id = 'journal-review-mcp' } = {}) {
  return [...tap.matchAll(/^(not )?ok \d+ - (.+)$/gmu)].map((match) => testResult({
    fullName: `voice.node.${id}.${match[2]}`,
    name: match[2], status: match[1] ? 'failed' : 'passed', suite,
    framework: 'node:test', start: started,
    message: match[1] ? 'See the attached Node test output.' : '',
    attachment: match[1] ? attachment : undefined,
  }));
}

const xmlValue = (value) => value.replace(/&quot;/gu, '"').replace(/&apos;/gu, "'")
  .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');

export function pytestJunitResults(xml, started, attachment) {
  const results = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\s*\/>|>([\s\S]*?)<\/testcase>)/gu)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/gu)]
      .map(([, key, value]) => [key, xmlValue(value)]));
    if (!attributes.name || !attributes.classname) continue;
    const body = match[2] ?? '';
    const status = /<(?:failure|error)\b/u.test(body) ? 'failed' : /<skipped\b/u.test(body) ? 'skipped' : 'passed';
    const failure = body.match(/<(?:failure|error)\b[^>]*message="([^"]*)"/u);
    results.push(testResult({
      fullName: `voice.pytest.${attributes.classname}.${attributes.name}`,
      name: attributes.name, status, suite: 'Gateway', framework: 'pytest',
      testMethod: attributes.name, testClass: attributes.classname,
      start: started, duration: Number(attributes.time ?? 0) * 1000,
      message: failure ? xmlValue(failure[1]) : '',
      attachment: status === 'passed' ? undefined : attachment,
    }));
  }
  return results;
}

export function nativePytestResults(results, { suite, id }) {
  return results.map((result) => {
    const item = testResult({
      fullName: `voice.pytest.${id}.${result.fullName}`,
      name: result.name, status: result.status, suite, framework: 'pytest',
      start: result.start, duration: result.stop - result.start,
      message: result.statusDetails?.message ?? '',
    });
    if (item.status !== 'skipped' && !(result.steps ?? []).some((step) =>
      /^(?:Given|When|Then|And|But)\b/u.test(step.name))) {
      throw new Error(`No native Gherkin Allure steps for ${item.fullName}`);
    }
    item.steps = result.steps ?? [];
    if (result.attachments?.length) item.attachments = result.attachments;
    return item;
  });
}

export async function readNativePytestResults(nativeDir, combinedDir, options) {
  const results = [];
  for (const file of await readdir(nativeDir)) {
    if (file.endsWith('-result.json')) {
      results.push(JSON.parse(await readFile(join(nativeDir, file), 'utf8')));
    } else if (!file.endsWith('-container.json')) {
      await copyFile(join(nativeDir, file), join(combinedDir, file));
    }
  }
  return nativePytestResults(results, options);
}

export function rustTestResults(output, started, attachment) {
  return [...output.matchAll(/^test (.+?) \.\.\. (ok|FAILED|ignored)$/gmu)].map((match) => testResult({
    fullName: `voice.rust.personal-knowledge-core.${match[1]}`,
    name: match[1], status: match[2] === 'ok' ? 'passed' : match[2] === 'ignored' ? 'skipped' : 'failed',
    suite: 'Knowledge core', framework: 'cargo test', start: started,
    testMethod: match[1],
    message: match[2] === 'FAILED' ? 'See the attached Cargo test output.' : '',
    attachment: match[2] === 'ok' ? undefined : attachment,
  }));
}

async function runCommand(name, command, args, { cwd = voiceRoot, env = {} } = {}) {
  const logPath = join(runRoot, `${name}.log`);
  const log = createWriteStream(logPath);
  const started = Date.now();
  let tail = '';
  let commandError;
  const code = await new Promise((done) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk) => {
      log.write(chunk);
      tail = (tail + chunk.toString()).slice(-8000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => { commandError = error; done(1); });
    child.on('close', (exitCode) => done(exitCode ?? 1));
  });
  await new Promise((done) => log.end(done));
  console.log(`${name}: ${code === 0 ? 'passed' : 'failed'} (${Math.round((Date.now() - started) / 1000)}s)`);
  return { code, started, duration: Date.now() - started, logPath, tail,
    error: commandError?.message || (code ? tail.slice(-2000) : '') };
}

async function main() {
  await mkdir(resultsRoot, { recursive: true });
  const emitted = [];
  const attachLog = async (name, logPath) => {
    const target = `${name}-command.log`;
    await copyFile(logPath, join(resultsRoot, target));
    return target;
  };
  const emit = async (items) => {
    for (const item of items) {
      emitted.push(item);
      await writeFile(join(resultsRoot, `${item.uuid}-result.json`), `${JSON.stringify(item)}\n`);
    }
  };
  const gate = (name, run, attachment, message = run.error) => testResult({
    fullName: `voice.gate.${name}`, name, status: run.code === 0 ? 'passed' : 'failed',
    suite: 'Command gates', framework: 'repository-runner', start: run.started,
    duration: run.duration, message, attachment,
  });
  const recordParsed = async (name, run, items, expectedCount = 1) => {
    await emit(items);
    if (run.code !== 0 || items.length < expectedCount) {
      const attachment = await attachLog(name, run.logPath);
      await emit([gate(name, { ...run, code: 1 }, attachment,
        items.length < expectedCount ? `Expected ${expectedCount} ${name} test results, received ${items.length}. ${run.error}` : run.error)]);
    }
  };
  const recordProbe = async ({ id, suite, title, command, args, validate }) => {
    const run = await runCommand(id, command, args);
    const output = await readFile(run.logPath, 'utf8');
    let proof;
    let message = run.error;
    if (run.code === 0) {
      try { proof = validate(output); } catch (error) { message = error.message; }
    }
    const attachment = await attachLog(id, run.logPath);
    const item = testResult({
      fullName: `voice.probe.${id}`, name: title, status: run.code === 0 && !message ? 'passed' : 'failed',
      suite, framework: 'repository-probe', start: run.started, duration: run.duration,
      message, attachment,
    });
    if (proof) {
      const source = `${item.uuid}-proof.json`;
      await writeFile(join(resultsRoot, source), `${JSON.stringify(proof, null, 2)}\n`);
      item.attachments.push({ name: 'Verified boundary evidence', source, type: 'application/json' });
    }
    await emit([item]);
  };

  const browserProjects = ['knowledge-base', 'knowledge-c2-mock', 'knowledge-live', 'voice',
    'voice-telemetry', 'diagnostics', 'diagnostics-c2-mock', 'durable-c2-mock',
    'flutter-responsive-c2-mock', 'task-diagram', 'grafana'];
  if (process.env.VOICE_RUN_DURABLE_E2E === 'true') browserProjects.push('durable');
  for (const project of browserProjects) {
    const name = `playwright-${project}`;
    const outputDir = join(runRoot, name);
    const run = await runCommand(name, 'make', [name], { env: {
      PLAYWRIGHT_OUTPUT_DIR: outputDir,
      ...(project === 'voice' ? { VOICE_E2E_RETRIES: '1' } : {}),
    } });
    try {
      const data = JSON.parse(await readFile(join(outputDir, 'results.json'), 'utf8'));
      const attachment = await attachLog(name, run.logPath);
      const items = playwrightResults(data, attachment);
      await attachPlaywrightEvidence(data, items, outputDir, resultsRoot);
      await attachNativePlaywrightSteps(join(outputDir, 'native-allure-results'), items);
      await recordParsed(name, run, items);
    } catch (error) {
      const attachment = await attachLog(name, run.logPath);
      await emit([gate(name, { ...run, code: 1 }, attachment, `Playwright results unavailable: ${error.message}`)]);
    }
  }

  const piIntegrationOutput = join(runRoot, 'playwright-pi-durable-mcp-integration');
  const piIntegration = await runCommand('pi-durable-mcp-integration', 'make',
    ['test-pi-durable-mcp'], { env: { VOICE_E2E_OUTPUT: piIntegrationOutput } });
  try {
    const data = JSON.parse(await readFile(join(piIntegrationOutput, 'results.json'), 'utf8'));
    const attachment = await attachLog('pi-durable-mcp-integration', piIntegration.logPath);
    const items = playwrightResults(data, attachment);
    await attachPlaywrightEvidence(data, items, piIntegrationOutput, resultsRoot);
    await attachNativePlaywrightSteps(join(piIntegrationOutput, 'native-allure-results'), items);
    await recordParsed('pi-durable-mcp-integration', piIntegration, items, 4);
  } catch (error) {
    const attachment = await attachLog('pi-durable-mcp-integration', piIntegration.logPath);
    await emit([gate('pi-durable-mcp-integration', { ...piIntegration, code: 1 }, attachment,
      `Pi Durable integration results unavailable: ${error.message}`)]);
  }
  const ingressOutput = join(runRoot, 'playwright-tailnet-owner-integration');
  const ingress = await runCommand('tailnet-owner-integration', 'make', ['test-tailnet-owner'],
    { env: { VOICE_E2E_OUTPUT: ingressOutput } });
  try {
    const data = JSON.parse(await readFile(join(ingressOutput, 'results.json'), 'utf8'));
    const attachment = await attachLog('tailnet-owner-integration', ingress.logPath);
    const items = playwrightResults(data, attachment);
    await attachPlaywrightEvidence(data, items, ingressOutput, resultsRoot);
    await attachNativePlaywrightSteps(join(ingressOutput, 'native-allure-results'), items);
    await recordParsed('tailnet-owner-integration', ingress, items);
  } catch (error) {
    const attachment = await attachLog('tailnet-owner-integration', ingress.logPath);
    await emit([gate('tailnet-owner-integration', { ...ingress, code: 1 }, attachment,
      `Tailnet owner integration results unavailable: ${error.message}`)]);
  }

  await recordProbe({
    id: 'voice-edge-broker-mock', suite: 'Voice Edge broker mock',
    title: 'normalizes typed Pi responses and failures through the C2 broker mock',
    command: 'make', args: ['test-voice-edge-c2-mock'],
    validate: (output) => {
      const line = output.split('\n').find((value) => value.startsWith('C2_BROKER_EVIDENCE='));
      if (!line || !/Ran 1 test .*\n\nOK/u.test(output)) throw new Error('Broker boundary result or receipt missing');
      const evidence = JSON.parse(line.slice('C2_BROKER_EVIDENCE='.length));
      if (evidence.boundary !== 'Voice Edge → Inference Broker'
          || JSON.stringify(evidence.scenarios.map(({ scenario, brokerStatus, edgeStatus }) =>
            [scenario, brokerStatus, edgeStatus])) !== JSON.stringify([
          ['ready', 200, 200], ['unavailable', 502, 502],
          ['invalid-response', 200, 502], ['empty-response', 200, 502],
        ])) throw new Error('Broker boundary receipt did not cover expected scenarios');
      return evidence;
    },
  });

  await recordProbe({
    id: 'broker-pi-stream-mock', suite: 'Broker Pi stream mock',
    title: 'translates Pi deltas and failures through the C2 stream mock',
    command: 'make', args: ['test-broker-pi-stream-c2-mock'],
    validate: (output) => {
      if (!/4 passed/u.test(output)) throw new Error('Four Pi streaming scenarios did not pass');
      return { boundary: 'Inference Broker → Pi Voice',
        scenarios: ['ready', 'malformed-event', 'turn-error', 'upstream-unavailable'] };
    },
  });

  const patrolDir = join(runRoot, 'patrol-web');
  const patrol = await runCommand('patrol-web', 'npm', ['--prefix', 'apps/client', 'run', 'test:patrol'], {
    env: { PATROL_RUN_DIR: patrolDir },
  });
  try {
    const targets = process.env.PATROL_LIVE_ONLY === 'true' ? ['live-edge']
      : process.env.PATROL_LIVE_EDGE_URL ? ['voice', 'workspace', 'live-edge'] : ['voice', 'workspace'];
    await recordParsed('patrol-web', patrol,
      await patrolResults(patrolDir, resultsRoot, patrol.started, patrol.duration, targets), targets.length);
  } catch (error) {
    const attachment = await attachLog('patrol-web', patrol.logPath);
    await emit([gate('patrol-web', { ...patrol, code: 1 }, attachment, `Patrol result unavailable: ${error.message}`)]);
  }

  const vitestJson = join(runRoot, 'vitest.json');
  const vitest = await runCommand('vitest-mcp-browser', 'pnpm', [
    '--dir', 'apps/client', 'exec', 'vitest', 'run', '--config', 'vitest.browser.config.mjs',
    'browser_test/mcp_app_renderers.browser.test.js', '--reporter=json', `--outputFile=${vitestJson}`,
  ]);
  try {
    const data = JSON.parse(await readFile(vitestJson, 'utf8'));
    const attachment = await attachLog('vitest-mcp-browser', vitest.logPath);
    await recordParsed('vitest-mcp-browser', vitest, vitestResults(data, vitest.started, attachment));
  } catch (error) {
    const attachment = await attachLog('vitest-mcp-browser', vitest.logPath);
    await emit([gate('vitest-mcp-browser', { ...vitest, code: 1 }, attachment, `Vitest JSON unavailable: ${error.message}`)]);
  }

  const build = await runCommand('journal-mcp-build', 'pnpm', ['--dir', 'apps/journal-review-mcp', 'build']);
  if (build.code !== 0) {
    await emit([gate('journal-mcp-build', build, await attachLog('journal-mcp-build', build.logPath))]);
  } else {
    const node = await runCommand('journal-mcp-contract', process.execPath,
      ['--test', '--test-reporter=tap', 'tests/server.test.mjs'], { cwd: join(voiceRoot, 'apps/journal-review-mcp') });
    const attachment = await attachLog('journal-mcp-contract', node.logPath);
    await recordParsed('journal-mcp-contract', node, nodeTapResults(await readFile(node.logPath, 'utf8'), node.started, attachment));
    const deployed = await runCommand('journal-mcp-deployed-roundtrip', process.execPath,
      ['--test', '--test-reporter=tap', 'tests/deployed-roundtrip.test.mjs'], { cwd: join(voiceRoot, 'apps/journal-review-mcp') });
    const deployedAttachment = await attachLog('journal-mcp-deployed-roundtrip', deployed.logPath);
    await recordParsed('journal-mcp-deployed-roundtrip', deployed,
      nodeTapResults(await readFile(deployed.logPath, 'utf8'), deployed.started, deployedAttachment,
        { suite: 'Deployed MCP save round trip', id: 'journal-review-mcp-deployed' }));
  }

  const junit = join(runRoot, 'gateway-junit.xml');
  const gateway = await runCommand('gateway', 'uv', ['run', '--project', 'apps/gateway', 'pytest', 'apps/gateway/tests/test_gateway.py', '-q', `--junitxml=${junit}`]);
  const gatewayAttachment = await attachLog('gateway', gateway.logPath);
  try {
    await recordParsed('gateway', gateway, pytestJunitResults(await readFile(junit, 'utf8'), gateway.started, gatewayAttachment));
  } catch (error) {
    await emit([gate('gateway pytest', { ...gateway, code: 1 }, gatewayAttachment, `Pytest JUnit unavailable: ${error.message}`)]);
  }
  const ownerResults = join(runRoot, 'pi-durable-owner-native-allure');
  const owner = await runCommand('pi-durable-owner-c2', 'uv', [
    'run', '--project', 'apps/gateway', 'pytest', '-q',
    'packages/tasking/tests/infrastructure/test_pi_durable_owner_mock.py',
    `--alluredir=${ownerResults}`,
  ], { env: { PYTHONPATH: 'apps/gateway/src:packages/tasking/src:packages/telemetry/src' } });
  const ownerAttachment = await attachLog('pi-durable-owner-c2', owner.logPath);
  try {
    const items = await readNativePytestResults(ownerResults, resultsRoot,
      { suite: 'Pi Durable owner C2 mock', id: 'pi-durable-owner-c2' });
    await recordParsed('pi-durable-owner-c2', owner, items, 2);
  } catch (error) {
    await emit([gate('pi-durable-owner-c2', { ...owner, code: 1 }, ownerAttachment,
      `Native Pytest Allure results unavailable: ${error.message}`)]);
  }
  const rust = await runCommand('knowledge-core-rust', 'cargo', ['test', '--manifest-path', 'components/personal-knowledge-ts/core/Cargo.toml']);
  const rustAttachment = await attachLog('knowledge-core-rust', rust.logPath);
  await recordParsed('knowledge-core-rust', rust,
    rustTestResults(await readFile(rust.logPath, 'utf8'), rust.started, rustAttachment));

  await recordProbe({
    id: 'personal-knowledge-wassette', suite: 'Deployed personal knowledge',
    title: 'retrieves sourced personal knowledge through deployed Wassette',
    command: 'python3', args: ['tests/e2e/personal-knowledge-regression.py'],
    validate: (output) => {
      const checks = [
        'Wassette returned a relevant Oxigraph fact despite unmatched query terms',
        'Wassette query-journal returned the journal entry, source transcript, and topic',
      ];
      for (const check of checks) if (!output.includes(`PASS ${check}`)) throw new Error(`Missing Wassette proof: ${check}`);
      return { boundary: 'Wassette → Agent Gateway / Oxigraph', checks };
    },
  });

  await recordProbe({
    id: 'grafana-mcp-live', suite: 'Grafana MCP observability',
    title: 'queries the live C4 dashboard and a fresh Tempo trace through Grafana MCP',
    command: 'python3', args: ['tests/e2e/grafana-mcp.py'],
    validate: (output) => {
      const proof = JSON.parse(output);
      if (proof.dashboard !== 'voice-c4-heatmap' || proof.traceApp !== 'ui://grafana/trace.html'
        || !/^[a-f0-9]{32}$/u.test(proof.traceId) || proof.promql !== 'up{job="grafana-mcp"}') {
        throw new Error('Grafana MCP proof lacks a fresh trace, trace App, dashboard, or PromQL result');
      }
      return proof;
    },
  });

  await recordProbe({
    id: 'c4-dashboard-contract', suite: 'C4 dashboard contract',
    title: 'compiles the source-backed C4 operational dashboard',
    command: 'bb', args: ['deploy/observability/c4-dashboard_test.clj'],
    validate: (output) => {
      if (!/Ran 4 tests containing 16 assertions\.[\s\S]*0 failures, 0 errors\./u.test(output)) {
        throw new Error('C4 dashboard contract did not report its expected assertions');
      }
      return { diagramPanels: 16, evidencePanel: 1, assertions: 16 };
    },
  });

  const counts = emitted.reduce((result, item) => {
    result[item.status] = (result[item.status] ?? 0) + 1;
    return result;
  }, {});
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const manifest = { runId, commit, counts, reportPath, resultsRoot, createdAt: new Date().toISOString() };
  await writeFile(join(runRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const allure = await runCommand('allure-generate', allureBin, [
    'generate', resultsRoot, '--config', join(voiceRoot, 'tests/allure/allurerc.json'),
    '--output', reportPath, '--clean', '--cwd', repoRoot,
  ]);
  if (allure.code !== 0) throw new Error(`Allure generation failed: ${allure.error}`);
  const c2Source = await readFile(join(voiceRoot, 'docs/architecture/c2-container.mmd'), 'utf8');
  const diagramNames = (await readdir(join(voiceRoot, 'docs/architecture')))
    .filter((name) => /^(?:c[123]|d[123]|deployment-security).*\.mmd$/u.test(name)).sort();
  validateC4Traceability(emitted, c2Source, diagramNames);
  const audit = coverageAudit(emitted, c2Source, diagramNames);
  const auditJson = `${JSON.stringify(audit, null, 2)}\n`;
  await writeFile(join(runRoot, 'coverage-audit.json'), auditJson);
  await writeFile(join(reportPath, 'coverage-audit.json'), auditJson);
  await writeFile(join(reportPath, 'coverage-audit.md'), coverageAuditMarkdown(audit, manifest));
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, commit, counts }));
  if ((counts.failed ?? 0) > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
