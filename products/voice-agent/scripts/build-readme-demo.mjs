#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const voiceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(voiceRoot, '../..');
const artifactRoot = resolve(
  process.env.PLAYWRIGHT_TRACE_ARTIFACT_ROOT
    ?? join(homedir(), 'Library/Application Support/PipecatEdge/playwright-traces'),
);
const outputDirectory = join(artifactRoot, 'readme-demo', 'current');
const rawVideoAsset = join(outputDirectory, 'readme-demo-with-subtitle-track.mp4');
const assetDirectory = join(voiceRoot, 'docs/assets');
const videoAsset = join(assetDirectory, 'voice-agent-demo.mp4');
const posterAsset = join(assetDirectory, 'voice-agent-demo.png');
const transcriptAsset = join(assetDirectory, 'voice-agent-demo.srt');
const metadataAsset = join(assetDirectory, 'voice-agent-demo.json');
const traceService = (process.env.PLAYWRIGHT_TRACE_MCP_URL ?? 'http://127.0.0.1:9450')
  .replace(/\/$/u, '');
const traceMcpRequire = createRequire(join(
  voiceRoot,
  'apps/trace-explainer-mcp/package.json',
));
const { Client } = await import(traceMcpRequire.resolve(
  '@modelcontextprotocol/sdk/client/index.js',
));
const { StreamableHTTPClientTransport } = await import(traceMcpRequire.resolve(
  '@modelcontextprotocol/sdk/client/streamableHttp.js',
));
const narrationBrief = [
  'I should not have to read every agent transcript. Let me hear and see the work, move between sessions, and choose what becomes lasting knowledge.',
].join(' ');

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolvePromise();
    else reject(new Error(`${command} exited ${String(code)}${signal ? ` (${signal})` : ''}`));
  });
});

const find = async (directory, filename) => {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await find(path, filename));
    else if (entry.isFile() && entry.name === filename) matches.push(path);
  }
  return matches;
};

const pause = (milliseconds) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, milliseconds);
});

const toolFailure = (result, fallback) => {
  const message = result?.content?.find(({ type }) => type === 'text')?.text;
  return new Error(message || fallback);
};

await mkdir(outputDirectory, { recursive: true });
await run(join(voiceRoot, 'tests/e2e/run-playwright-local'), ['readme-demo'], {
  cwd: voiceRoot,
  env: { ...process.env, PLAYWRIGHT_OUTPUT_DIR: outputDirectory },
});

const traces = await find(outputDirectory, 'trace.zip');
if (traces.length !== 1) {
  throw new Error(`Expected one README trace, found ${traces.length}`);
}
const tracePath = traces[0];
const traceRelativePath = relative(artifactRoot, tracePath);
const traceId = createHash('sha256').update(traceRelativePath).digest('hex').slice(0, 32);

const client = new Client({ name: 'readme-video-builder', version: '1.0.0' });
let renderId;
let narratedVideoUrl;
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${traceService}/mcp`)));
  const submitted = await client.callTool({
    name: 'render_narrated_trace_export',
    arguments: { traceId, narrationBrief },
  });
  if (submitted.isError) throw toolFailure(submitted, 'Trace narration submission failed');
  renderId = submitted.structuredContent?.render?.renderId;
  if (!/^[a-f0-9]{32}$/u.test(renderId ?? '')) {
    throw new Error('Trace narration MCP tool returned an invalid render ID');
  }

  const deadline = Date.now() + 10 * 60 * 1000;
  let status = submitted.structuredContent?.render?.status ?? 'pending';
  while (Date.now() < deadline) {
    process.stdout.write(`Trace narration: ${status}\r`);
    if (status === 'failed') throw toolFailure(submitted, 'Trace narration failed');
    await pause(2_000);
    const result = await client.callTool({
      name: 'get_trace_explainer',
      arguments: { renderId },
    });
    if (result.isError) throw toolFailure(result, 'Trace narration status failed');
    const presentation = result.structuredContent?.presentation;
    if (presentation?.narratedVideoUrl) {
      narratedVideoUrl = presentation.narratedVideoUrl;
      status = 'completed';
      break;
    }
    status = result.structuredContent?.render?.status ?? 'pending';
  }
  process.stdout.write('\n');
  if (!narratedVideoUrl) throw new Error(`Trace narration did not complete: ${status}`);
} finally {
  await client.close();
}

const videoUrl = new URL(narratedVideoUrl);
if (
  videoUrl.origin !== new URL(traceService).origin
  || !/^\/api\/trace-explainers\/[a-f0-9]{32}\/video$/u.test(videoUrl.pathname)
) throw new Error('Trace narration MCP tool returned an invalid video URL');
const videoResponse = await fetch(videoUrl);
if (!videoResponse.ok) throw new Error(`Video download returned HTTP ${videoResponse.status}`);
await mkdir(assetDirectory, { recursive: true });
await writeFile(rawVideoAsset, Buffer.from(await videoResponse.arrayBuffer()));
await run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideoAsset,
  '-map', '0:s:0', '-c:s', 'srt', transcriptAsset,
]);
await writeFile(transcriptAsset, `${(await readFile(transcriptAsset, 'utf8')).trimEnd()}\n`);
// Captions are already burned into the lower band. Keep the SRT as a separate
// transcript, but do not embed it again for players to overlay on the picture.
await run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideoAsset,
  '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-sn',
  '-movflags', '+faststart', videoAsset,
]);
await unlink(rawVideoAsset);
await run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', videoAsset,
  '-frames:v', '1', '-vf', 'scale=1280:-2', posterAsset,
]);
await writeFile(metadataAsset, `${JSON.stringify({
  kind: 'playwright-trace-readme-demo',
  traceId,
  renderId,
  generatedAt: new Date().toISOString(),
  source: traceRelativePath,
  narrationBrief,
}, null, 2)}\n`);

console.log(`README video: ${relative(repositoryRoot, videoAsset)}`);
console.log(`README poster: ${relative(repositoryRoot, posterAsset)}`);
console.log(`README transcript: ${relative(repositoryRoot, transcriptAsset)}`);
console.log(`Playwright trace ID: ${traceId}`);
console.log(`Trace render ID: ${renderId}`);
