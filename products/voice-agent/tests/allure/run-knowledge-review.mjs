#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const testResult = ({ fullName, name, status, suite, framework, start, duration = 0, message = '', attachment }) => {
  const uuid = randomUUID();
  const started = Number.isFinite(start) ? start : Date.now();
  return {
    uuid, testCaseId: digest(fullName), historyId: digest(fullName), fullName, name,
    status: allureStatus(status), stage: 'finished', start: started, stop: started + Math.max(0, Math.round(duration)),
    ...(message ? { statusDetails: { message: message.slice(0, 4000) } } : {}),
    labels: [
      { name: 'parentSuite', value: 'Voice Agent' }, { name: 'suite', value: suite },
      { name: 'framework', value: framework }, { name: 'language', value: 'javascript' },
    ],
    ...(attachment ? { attachments: [{ name: 'Test command output', source: attachment, type: 'text/plain' }] } : {}),
  };
};

export function playwrightResults(data, attachment) {
  const results = [];
  const visit = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const last = test.results?.at(-1);
          if (!last) continue;
          const fullName = `voice.playwright.${test.projectName}.${spec.file}.${spec.title}`;
          results.push(testResult({
            fullName, name: spec.title, status: last.status, suite: `Playwright · ${test.projectName}`,
            framework: 'playwright', start: Date.parse(last.startTime), duration: last.duration,
            message: last.error?.message || last.errors?.map((error) => error.message).join('\n') || '',
            attachment: last.status === 'passed' ? undefined : attachment,
          }));
        }
      }
      visit(suite.suites);
    }
  };
  visit(data.suites);
  return results;
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

export function nodeTapResults(tap, started, attachment) {
  return [...tap.matchAll(/^(not )?ok \d+ - (.+)$/gmu)].map((match) => testResult({
    fullName: `voice.node.journal-review-mcp.${match[2]}`,
    name: match[2], status: match[1] ? 'failed' : 'passed', suite: 'Journal MCP contract',
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
      start: started, duration: Number(attributes.time ?? 0) * 1000,
      message: failure ? xmlValue(failure[1]) : '',
      attachment: status === 'passed' ? undefined : attachment,
    }));
  }
  return results;
}

export function rustTestResults(output, started, attachment) {
  return [...output.matchAll(/^test (.+?) \.\.\. (ok|FAILED|ignored)$/gmu)].map((match) => testResult({
    fullName: `voice.rust.personal-knowledge-core.${match[1]}`,
    name: match[1], status: match[2] === 'ok' ? 'passed' : match[2] === 'ignored' ? 'skipped' : 'failed',
    suite: 'Knowledge core', framework: 'cargo test', start: started,
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
  const recordParsed = async (name, run, items) => {
    await emit(items);
    if (run.code !== 0 || items.length === 0) {
      const attachment = await attachLog(name, run.logPath);
      await emit([gate(name, { ...run, code: 1 }, attachment,
        items.length === 0 ? `No ${name} test results were produced. ${run.error}` : run.error)]);
    }
  };

  const playwrightDir = join(runRoot, 'playwright');
  const playwright = await runCommand('playwright-knowledge-base', 'make', ['playwright-knowledge-base'], {
    env: { PLAYWRIGHT_OUTPUT_DIR: playwrightDir },
  });
  try {
    const data = JSON.parse(await readFile(join(playwrightDir, 'results.json'), 'utf8'));
    const attachment = await attachLog('playwright-knowledge-base', playwright.logPath);
    await recordParsed('playwright-knowledge-base', playwright, playwrightResults(data, attachment));
  } catch (error) {
    const attachment = await attachLog('playwright-knowledge-base', playwright.logPath);
    await emit([gate('playwright-knowledge-base', { ...playwright, code: 1 }, attachment, `Playwright JSON unavailable: ${error.message}`)]);
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
  }

  const junit = join(runRoot, 'gateway-junit.xml');
  const gateway = await runCommand('gateway', 'uv', ['run', '--project', 'apps/gateway', 'pytest', 'apps/gateway/tests/test_gateway.py', '-q', `--junitxml=${junit}`]);
  const gatewayAttachment = await attachLog('gateway', gateway.logPath);
  try {
    await recordParsed('gateway', gateway, pytestJunitResults(await readFile(junit, 'utf8'), gateway.started, gatewayAttachment));
  } catch (error) {
    await emit([gate('gateway pytest', { ...gateway, code: 1 }, gatewayAttachment, `Pytest JUnit unavailable: ${error.message}`)]);
  }
  const rust = await runCommand('knowledge-core-rust', 'cargo', ['test', '--manifest-path', 'components/personal-knowledge-ts/core/Cargo.toml']);
  const rustAttachment = await attachLog('knowledge-core-rust', rust.logPath);
  await recordParsed('knowledge-core-rust', rust,
    rustTestResults(await readFile(rust.logPath, 'utf8'), rust.started, rustAttachment));

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
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, commit, counts }));
  if ((counts.failed ?? 0) > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
