import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const inspector = join(dirname(fileURLToPath(import.meta.url)), 'inspect-patrol-trace.mjs');

const inspectRequest = async ({ url, referer, failureText }) => {
  const root = await mkdtemp(join(tmpdir(), 'patrol-trace-policy-'));
  try {
    const results = join(root, 'results');
    const traceDir = join(results, 'journey');
    await mkdir(traceDir, { recursive: true });
    await writeFile(join(root, 'trace.trace'), '');
    await writeFile(join(root, 'trace.network'), `${JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        request: {
          method: 'GET',
          url,
          headers: referer ? [{ name: 'referer', value: referer }] : [],
        },
        response: { status: -1, _failureText: failureText },
      },
    })}\n`);
    const archive = spawnSync('zip', ['-q', join(traceDir, 'trace.zip'), 'trace.trace', 'trace.network'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(archive.status, 0, archive.stderr);
    const output = join(root, 'evidence.json');
    const result = spawnSync(process.execPath, [inspector, results, output], { encoding: 'utf8' });
    const evidence = JSON.parse(await readFile(output, 'utf8'));
    return { status: result.status, trace: evidence.traces[0] };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('navigation aborts of the embedded app and popup assets are expected', async () => {
  for (const request of [
    {
      url: 'http://localhost/excalidraw/mcp-app.html',
      referer: 'http://localhost/?view=transcript',
      failureText: 'net::ERR_ABORTED',
    },
    {
      url: 'http://localhost/flutter_bootstrap.js',
      failureText: 'net::ERR_ABORTED',
    },
    {
      url: 'http://localhost/voice-runtime/voice_bridge.js',
      failureText: 'net::ERR_ABORTED',
    },
  ]) {
    const result = await inspectRequest(request);
    assert.equal(result.status, 0, request.url);
    assert.equal(result.trace.networkFailures.length, 0, request.url);
    assert.equal(result.trace.expectedCancellations.length, 1, request.url);
  }
});

test('failed asset requests outside the observed navigation aborts still fail', async () => {
  for (const request of [
    {
      url: 'http://localhost/excalidraw/mcp-app.html',
      referer: 'http://localhost/?view=transcript',
      failureText: 'net::ERR_CONNECTION_RESET',
    },
    {
      url: 'http://localhost/flutter_bootstrap.js',
      failureText: 'net::ERR_CONNECTION_RESET',
    },
    {
      url: 'http://localhost/unrelated.js',
      failureText: 'net::ERR_ABORTED',
    },
  ]) {
    const result = await inspectRequest(request);
    assert.equal(result.status, 1, request.url);
    assert.equal(result.trace.networkFailures.length, 1, request.url);
  }
});
