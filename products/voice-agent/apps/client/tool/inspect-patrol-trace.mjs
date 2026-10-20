import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [resultsDir, outputPath] = process.argv.slice(2);
if (!resultsDir || !outputPath) {
  throw new Error('Usage: inspect-patrol-trace.mjs <results-dir> <output-json>');
}

const tracesUnder = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory()
      ? tracesUnder(candidate)
      : entry.name === 'trace.zip' ? [candidate] : [];
  });
};

const ndjson = (zipPath, member) => execFileSync(
  'unzip',
  ['-p', zipPath, member],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return '<invalid-url>';
  }
};

const routeOf = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '<invalid-url>';
  }
};

const headerValue = (headers, name) => headers
  ?.find((header) => header.name.toLowerCase() === name.toLowerCase())
  ?.value ?? '';

const requestOf = (event) => ({
  method: event.snapshot?.request?.method ?? '<unknown>',
  path: pathOf(event.snapshot?.request?.url ?? ''),
  initiator: routeOf(headerValue(event.snapshot?.request?.headers, 'referer')),
  status: event.snapshot?.response?.status ?? -1,
  failureText: event.snapshot?.response?._failureText ?? '',
});

const methodCounts = (calls) => calls.reduce((counts, event) => {
  const method = event.method ?? '<unknown>';
  return { ...counts, [method]: (counts[method] ?? 0) + 1 };
}, {});

const redactedConsoleMessage = (event) => {
  const text = String(event.text ?? '');
  return {
    type: event.messageType ?? 'unknown',
    bytes: Buffer.byteLength(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
  };
};

const isPopupStaticAsset = (request) =>
  request.path === '/flutter_bootstrap.js' ||
  /^\/voice-runtime\/[a-zA-Z0-9_-]+\.js$/.test(request.path);

const isNavigationPopup = (request) =>
  request.initiator === '/?view=transcript' ||
  request.initiator === '/metrics/d/voice-c4-heatmap/c4-operational-heat-map' ||
  (request.path.startsWith('/voice-runtime/chunk-') &&
    request.initiator === '/voice-runtime/voice_bridge.js');

const isExpectedCancellation = (request) => request.status <= 0 && (
  (request.method === 'POST' && request.path === '/api/pi-speech') ||
  (request.method === 'GET' &&
    isPopupStaticAsset(request) &&
    isNavigationPopup(request)) ||
  (request.method === 'GET' &&
    request.failureText === 'net::ERR_ABORTED' &&
    ((isPopupStaticAsset(request) && request.initiator === '<invalid-url>') ||
      (request.path === '/excalidraw/mcp-app.html' &&
        request.initiator === '/?view=transcript')))
);

const summarizeTrace = (tracePath) => {
  execFileSync('unzip', ['-tqq', tracePath]);
  const trace = ndjson(tracePath, 'trace.trace');
  const network = ndjson(tracePath, 'trace.network');
  const calls = trace.filter((event) => event.type === 'before');
  const consoleEvents = trace.filter((event) => event.type === 'console');
  const requests = network
    .filter((event) => event.type === 'resource-snapshot')
    .map(requestOf);
  const networkFailures = requests.filter(
    (request) => request.status <= 0 && !isExpectedCancellation(request),
  );
  const expectedCancellations = requests.filter(isExpectedCancellation);
  const badResponses = requests.filter((request) => request.status >= 400);
  const bytes = fs.readFileSync(tracePath);
  return {
    trace: path.relative(process.cwd(), tracePath),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    browserActions: methodCounts(calls),
    networkRequests: requests.length,
    apiRequests: requests.filter((request) => request.path.startsWith('/api/')),
    badResponses,
    networkFailures,
    expectedCancellations,
    consoleErrors: consoleEvents
      .filter((event) => event.messageType === 'error')
      .map(redactedConsoleMessage),
    consoleWarnings: consoleEvents
      .filter((event) => event.messageType === 'warning')
      .map(redactedConsoleMessage),
    screenshots: trace.filter((event) => event.type === 'screencast-frame').length,
  };
};

const inspectTrace = (tracePath) => {
  try {
    return { type: 'Ok', value: summarizeTrace(tracePath) };
  } catch {
    return {
      type: 'Err',
      error: {
        type: 'TraceInspectionFailed',
        trace: path.relative(process.cwd(), tracePath),
      },
    };
  }
};

const traces = tracesUnder(resultsDir);
const inspected = traces.map(inspectTrace);
const evidence = inspected
  .filter((result) => result.type === 'Ok')
  .map((result) => result.value);
const inspectionFailures = inspected
  .filter((result) => result.type === 'Err')
  .map((result) => result.error);
if (traces.length === 0) {
  inspectionFailures.push({
    type: 'TraceNotFound',
    directory: path.relative(process.cwd(), resultsDir),
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  traces: evidence,
  inspectionFailures,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

for (const item of evidence) {
  console.log(`Trace evidence: ${item.trace}`);
  console.log(`  SHA-256: ${item.sha256}`);
  console.log(`  Actions: ${Object.values(item.browserActions).reduce((a, b) => a + b, 0)}`);
  console.log(`  Network: ${item.networkRequests} requests, ${item.badResponses.length} bad responses, ${item.networkFailures.length} failures`);
  console.log(`  Console: ${item.consoleErrors.length} errors, ${item.consoleWarnings.length} warnings`);
  console.log(`  API requests: ${item.apiRequests.length}`);
  console.log(`  Screenshots: ${item.screenshots}`);
}

const violatesPolicy = inspectionFailures.length > 0 || evidence.some((item) =>
  item.badResponses.length > 0 ||
  item.networkFailures.length > 0 ||
  item.consoleErrors.length > 0,
);
if (violatesPolicy) process.exitCode = 1;
