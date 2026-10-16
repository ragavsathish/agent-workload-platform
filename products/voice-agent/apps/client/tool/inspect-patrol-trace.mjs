import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [resultsDir, outputPath] = process.argv.slice(2);
if (!resultsDir || !outputPath) {
  throw new Error('Usage: inspect-patrol-trace.mjs <results-dir> <output-json>');
}

function tracesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return tracesUnder(candidate);
    return entry.name === 'trace.zip' ? [candidate] : [];
  });
}

function ndjson(zipPath, member) {
  const raw = execFileSync('unzip', ['-p', zipPath, member], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const traces = tracesUnder(resultsDir);
if (traces.length === 0) throw new Error(`No trace.zip found below ${resultsDir}`);

const evidence = traces.map((tracePath) => {
  execFileSync('unzip', ['-tqq', tracePath]);
  const trace = ndjson(tracePath, 'trace.trace');
  const network = ndjson(tracePath, 'trace.network');
  const calls = trace.filter((event) => event.type === 'before');
  const consoleEvents = trace.filter((event) => event.type === 'console');
  const resources = network.filter((event) => event.type === 'resource-snapshot');
  const badResponses = resources
    .filter((event) => (event.snapshot?.response?.status ?? 0) >= 400)
    .map((event) => ({
      method: event.snapshot.request.method,
      path: new URL(event.snapshot.request.url).pathname,
      status: event.snapshot.response.status,
    }));
  const methods = Object.fromEntries(
    [...new Set(calls.map((event) => event.method))]
      .sort()
      .map((method) => [method, calls.filter((event) => event.method === method).length]),
  );
  const apiRequests = resources
    .map((event) => ({
      method: event.snapshot.request.method,
      path: new URL(event.snapshot.request.url).pathname,
      status: event.snapshot.response.status,
    }))
    .filter((request) => request.path.startsWith('/api/'));
  const bytes = fs.readFileSync(tracePath);
  return {
    trace: path.relative(process.cwd(), tracePath),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    browserActions: methods,
    networkRequests: resources.length,
    apiRequests,
    badResponses,
    consoleErrors: consoleEvents
      .filter((event) => event.messageType === 'error')
      .map((event) => event.text),
    consoleWarnings: consoleEvents
      .filter((event) => event.messageType === 'warning')
      .map((event) => event.text),
    screenshots: trace.filter((event) => event.type === 'screencast-frame').length,
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  traces: evidence,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

for (const item of evidence) {
  console.log(`Trace evidence: ${item.trace}`);
  console.log(`  SHA-256: ${item.sha256}`);
  console.log(`  Actions: ${Object.values(item.browserActions).reduce((a, b) => a + b, 0)}`);
  console.log(`  Network: ${item.networkRequests} requests, ${item.badResponses.length} bad responses`);
  console.log(`  Console: ${item.consoleErrors.length} errors, ${item.consoleWarnings.length} warnings`);
  console.log(`  API requests: ${item.apiRequests.length}`);
  console.log(`  Screenshots: ${item.screenshots}`);
  for (const response of item.badResponses) {
    console.log(`    ${response.status} ${response.method} ${response.path}`);
  }
}

if (
  evidence.some(
    (item) => item.badResponses.length > 0 || item.consoleErrors.length > 0,
  )
) {
  process.exitCode = 1;
}
