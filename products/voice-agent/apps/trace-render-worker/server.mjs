#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import express from 'express';

import { telemetry } from './telemetry.mjs';

const ID = /^[a-f0-9]{32}$/u;
const MAX_TRACE_BYTES = 256 * 1024 * 1024;
const MAX_NARRATION_BRIEF_CHARS = 2_000;
const MAX_SUBMISSION_BYTES = MAX_TRACE_BYTES + (64 * 1024);
const RENDER_TIMEOUT_MS = Number(process.env.TRACE_RENDER_TIMEOUT_MS ?? '600000');
const port = Number(process.env.TRACE_RENDER_WORKER_PORT ?? '9460');
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('invalid worker port');
if (!Number.isFinite(RENDER_TIMEOUT_MS) || RENDER_TIMEOUT_MS < 1_000) {
  throw new Error('invalid render timeout');
}
const bucket = process.env.ARTIFACT_BUCKET ?? 'agent-artifacts';
const endpoint = process.env.ARTIFACT_ENDPOINT_URL ?? 'http://s3mock:9090';
const renderer = new URL('./tool/prototype-trace-explainer.mjs', import.meta.url).pathname;
const tokenFile = process.env.INFERENCE_BROKER_TOKEN_FILE ?? '/run/secrets/broker-token';
const s3 = new S3Client({
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.ARTIFACT_ACCESS_KEY ?? 'local-test',
    secretAccessKey: process.env.ARTIFACT_SECRET_KEY ?? 'local-test',
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
const app = express();
let queue = Promise.resolve();

const structuredLog = (event, fields = {}) => console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  service: 'playwright-trace-render-worker',
  event,
  ...fields,
}));

const key = (renderId, name) => `trace-renders/${renderId}/${name}`;
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const bodyBytes = async (body) => Buffer.from(await body.transformToByteArray());

async function put(renderId, name, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key(renderId, name), Body: body, ContentType: contentType }));
}

async function get(renderId, name) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(renderId, name) }));
  if (!response.Body) throw new Error(`${name} is missing`);
  return bodyBytes(response.Body);
}

async function readJob(renderId) {
  return JSON.parse((await get(renderId, 'job.json')).toString('utf8'));
}

async function writeJob(job) {
  await put(job.renderId, 'job.json', json(job), 'application/json');
}

const publicJob = ({ narrationBrief: _narrationBrief, traceSha256: _traceSha256, ...job }) => job;

const narrationBrief = (value) => {
  if (typeof value !== 'string') throw new Error('narration brief is required');
  const normalized = value.trim();
  if (!normalized) throw new Error('narration brief is required');
  if (normalized.length > MAX_NARRATION_BRIEF_CHARS) {
    throw new Error(`narration brief exceeds ${MAX_NARRATION_BRIEF_CHARS} characters`);
  }
  return normalized;
};

async function submission(request) {
  const contentType = request.header('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new Error('multipart render submission is required');
  }
  const form = await new Request('http://trace-render-worker/submission', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: request.body,
  }).formData();
  const tracePart = form.get('trace');
  const metadataPart = form.get('metadata');
  if (!(tracePart instanceof Blob) || tracePart.size === 0 || tracePart.size > MAX_TRACE_BYTES) {
    throw new Error('trace body is required');
  }
  if (typeof metadataPart !== 'string' || metadataPart.length > 8_192) {
    throw new Error('render metadata is required');
  }
  const metadata = JSON.parse(metadataPart);
  const traceId = String(metadata?.traceId ?? '');
  if (!ID.test(traceId)) throw new Error('invalid trace ID');
  return {
    trace: Buffer.from(await tracePart.arrayBuffer()),
    traceId,
    narrationBrief: narrationBrief(metadata?.narrationBrief),
  };
}

function runRenderer(tracePath, outputDirectory, narrationContextPath, brokerToken, log) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = spawn(process.execPath, [renderer, tracePath, outputDirectory, narrationContextPath], {
      env: {
        ...process.env,
        HOME: '/tmp',
        INFERENCE_BROKER_TOKEN: brokerToken,
        PLAYWRIGHT_TRACE_OUTPUT_ROOT: '/scratch',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => log.push(chunk));
    child.stderr.on('data', (chunk) => log.push(chunk));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, RENDER_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) reject(new Error('renderer exceeded its time limit'));
      else if (code === 0) resolve();
      else reject(new Error(`renderer exited ${String(code)}${signal ? ` (${signal})` : ''}`));
    });
  });
}

async function render(job) {
  const running = { ...job, status: 'running', updatedAt: new Date().toISOString() };
  await writeJob(running);
  const scratch = await mkdtemp(join('/scratch', `${job.renderId}-`));
  const log = [];
  try {
    const trace = await get(job.renderId, 'trace.zip');
    const digest = createHash('sha256').update(trace).digest('hex');
    if (digest !== job.traceSha256) throw new Error('trace artifact digest mismatch');
    const tracePath = join(scratch, 'trace.zip');
    const narrationContextPath = join(scratch, 'narration-context.json');
    const output = join(scratch, 'output');
    await mkdir(output, { mode: 0o700 });
    await writeFile(tracePath, trace, { mode: 0o600 });
    await writeFile(
      narrationContextPath,
      `${JSON.stringify({ narrationBrief: job.narrationBrief })}\n`,
      { mode: 0o600 },
    );
    const brokerToken = (await readFile(tokenFile, 'utf8')).trim();
    await runRenderer(tracePath, output, narrationContextPath, brokerToken, log);
    const [video, manifest] = await Promise.all([
      readFile(join(output, 'trace-explainer.mp4')),
      readFile(join(output, 'manifest.json')),
    ]);
    await Promise.all([
      put(job.renderId, 'trace-explainer.mp4', video, 'video/mp4'),
      put(job.renderId, 'manifest.json', manifest, 'application/json'),
      put(job.renderId, 'renderer.log', Buffer.concat(log).subarray(0, 64 * 1024), 'text/plain'),
    ]);
    await writeJob({ ...running, status: 'completed', updatedAt: new Date().toISOString() });
    structuredLog('render.completed', { renderId: job.renderId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await put(job.renderId, 'renderer.log', Buffer.concat(log).subarray(0, 64 * 1024), 'text/plain').catch(() => {});
    await writeJob({ ...running, status: 'failed', updatedAt: new Date().toISOString(), error: message.slice(0, 1000) });
    structuredLog('render.failed', { renderId: job.renderId, errorType: error?.name ?? 'Error' });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function schedule(job) {
  const operation = () => telemetry.observe('render', () => render(job));
  const scheduled = queue.then(operation, operation);
  queue = scheduled.catch(() => undefined);
}

app.get('/health', (_request, response) => response.json({ status: 'ok', storage: 's3' }));
app.post(
  '/v1/renders/:renderId',
  express.raw({ type: 'multipart/form-data', limit: MAX_SUBMISSION_BYTES }),
  async (request, response) => {
  try {
    const { renderId } = request.params;
    if (!ID.test(renderId)) return response.status(400).json({ error: 'invalid render ID' });
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({ error: 'render submission is required' });
    }
    const submitted = await submission(request);
    try {
      const existing = await readJob(renderId);
      const submittedTraceSha256 = createHash('sha256').update(submitted.trace).digest('hex');
      const submittedBriefSha256 = createHash('sha256').update(submitted.narrationBrief).digest('hex');
      if (
        existing.traceId !== submitted.traceId
        || existing.traceSha256 !== submittedTraceSha256
        || existing.narrationBriefSha256 !== submittedBriefSha256
      ) return response.status(409).json({ error: 'render ID already belongs to another submission' });
      return response.status(200).json(publicJob(existing));
    } catch (error) {
      if (error?.name !== 'NoSuchKey') throw error;
    }
    const now = new Date().toISOString();
    const job = {
      renderId,
      traceId: submitted.traceId,
      traceSha256: createHash('sha256').update(submitted.trace).digest('hex'),
      narrationBrief: submitted.narrationBrief,
      narrationBriefSha256: createHash('sha256').update(submitted.narrationBrief).digest('hex'),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await put(renderId, 'trace.zip', submitted.trace, 'application/zip');
    await writeJob(job);
    schedule(job);
    telemetry.record('submit');
    structuredLog('render.accepted', {
      renderId,
      traceId: submitted.traceId,
      narrationBriefSha256: job.narrationBriefSha256,
    });
    return response.status(202).json(publicJob(job));
  } catch (error) {
    if (error instanceof SyntaxError || /required|exceeds|invalid trace ID|multipart/u.test(error?.message ?? '')) {
      return response.status(400).json({ error: error.message });
    }
    structuredLog('submit.failed', { errorType: error?.name ?? 'Error' });
    return response.status(500).json({ error: 'render submission failed' });
  }
});
app.get('/v1/renders/:renderId', async (request, response) => {
  try {
    if (!ID.test(request.params.renderId)) return response.status(400).json({ error: 'invalid render ID' });
    const job = await readJob(request.params.renderId);
    if (job.status !== 'completed') return response.json(publicJob(job));
    const manifest = JSON.parse((await get(job.renderId, 'manifest.json')).toString('utf8'));
    return response.json({ ...publicJob(job), manifest });
  } catch (error) {
    if (error?.name === 'NoSuchKey') return response.status(404).json({ error: 'render not found' });
    structuredLog('status.failed', { errorType: error?.name ?? 'Error' });
    return response.status(500).json({ error: 'render status failed' });
  }
});
app.get('/v1/renders/:renderId/video', async (request, response) => {
  try {
    if (!ID.test(request.params.renderId)) return response.status(400).end();
    const job = await readJob(request.params.renderId);
    if (job.status !== 'completed') return response.status(409).json({ error: `render is ${job.status}` });
    const video = await get(job.renderId, 'trace-explainer.mp4');
    response.type('video/mp4').set('Content-Length', String(video.length)).send(video);
  } catch (error) {
    if (error?.name === 'NoSuchKey') return response.status(404).end();
    structuredLog('video.failed', { errorType: error?.name ?? 'Error' });
    return response.status(500).end();
  }
});

async function recover() {
  let continuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'trace-renders/', ContinuationToken: continuationToken }));
    for (const object of page.Contents ?? []) {
      const match = object.Key?.match(/^trace-renders\/([a-f0-9]{32})\/job\.json$/u);
      if (!match) continue;
      const job = await readJob(match[1]);
      if (job.status === 'pending' || job.status === 'running') {
        telemetry.record('recover');
        structuredLog('render.recovered', { renderId: job.renderId });
        schedule({ ...job, status: 'pending' });
      }
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
}

await recover();
telemetry.record('component.started');
app.listen(port, '0.0.0.0', () => structuredLog('component.started', { port }));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await telemetry.shutdown();
    process.exit(0);
  });
}
