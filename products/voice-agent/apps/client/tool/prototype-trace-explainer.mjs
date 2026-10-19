#!/usr/bin/env node

// Narrated Playwright trace export: playwright-recast owns trace/video timing;
// the local inference broker remains the only TTS provider.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyNarrationBrief,
  applyNarrationPlan,
  applyTourFrameAttachments,
  assertSafeOutputDirectory,
  buildTraceScenes,
} from './trace-explainer-analysis.mjs';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const voiceRoot = resolve(clientRoot, '../..');
const defaultOutput = join(clientRoot, 'build/prototype-trace-explainer');
const narrationSystemPrompt = readFileSync(
  new URL('./prompts/trace-narration/SYSTEM.md', import.meta.url),
  'utf8',
).trim();

const walk = (root, name) => {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...walk(path, name));
    else if (entry.isFile() && entry.name === name) output.push(path);
  }
  return output;
};

const defaultTrace = () => {
  const latest = realpathSync(join(clientRoot, 'build/patrol-latest'));
  const traces = walk(join(latest, 'results'), 'trace.zip');
  return traces.find((path) => path.includes('/voice/')) ?? traces[0];
};

const tracePath = resolve(process.argv[2] ?? defaultTrace());
const outputDir = resolve(process.argv[3] ?? defaultOutput);
const narrationContextPath = process.argv[4] ? resolve(process.argv[4]) : undefined;
if (!existsSync(tracePath) || !statSync(tracePath).isFile()) {
  throw new Error(`Trace does not exist: ${tracePath}`);
}
if (!narrationContextPath || !existsSync(narrationContextPath)) {
  throw new Error('Narration context does not exist');
}
const narrationContext = JSON.parse(readFileSync(narrationContextPath, 'utf8'));
const narrationBrief = typeof narrationContext?.narrationBrief === 'string'
  ? narrationContext.narrationBrief.trim()
  : '';
if (!narrationBrief || narrationBrief.length > 2_000) {
  throw new Error('Narration brief must contain 1 to 2,000 characters');
}
assertSafeOutputDirectory(outputDir, [
  join(clientRoot, 'build'),
  process.env.PLAYWRIGHT_TRACE_OUTPUT_ROOT,
]);

mkdirSync(outputDir, { recursive: true });
for (const entry of readdirSync(outputDir)) {
  if (!['job.json', 'renderer.log'].includes(entry)) {
    rmSync(join(outputDir, entry), { force: true, recursive: true });
  }
}
mkdirSync(join(outputDir, 'audio'), { recursive: true });

const zipMembers = execFileSync('unzip', ['-Z1', tracePath], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const traceMembers = zipMembers.filter((member) => member.endsWith('.trace'));
const events = traceMembers.flatMap((member) => execFileSync(
  'unzip', ['-p', tracePath, member],
  { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
).split('\n').filter(Boolean).map((line) => JSON.parse(line)));

const frames = events.filter((event) => event.type === 'screencast-frame');
if (!frames.length) throw new Error('Trace has no screencast frames');
const framesByPage = Map.groupBy(frames, (frame) => frame.pageId);
const [pageId, pageFrames] = [...framesByPage.entries()]
  .sort((left, right) => right[1].length - left[1].length)[0];
pageFrames.sort((left, right) => left.timestamp - right.timestamp);

const calls = events.filter((event) => event.type === 'before');
const actionErrors = events.filter((event) => event.type === 'after' && event.error);
const sourceDuration = Math.max(
  0.1,
  (pageFrames.at(-1).timestamp - pageFrames[0].timestamp) / 1000,
);
const framePath = (frame) => frame.file ?? `resources/${frame.sha1}`;
let scenes = buildTraceScenes({
  pageId,
  pageFrames,
  calls,
  actionErrors,
  sourceDuration,
  framePath,
});
scenes = applyTourFrameAttachments(scenes, events);
scenes = applyNarrationBrief(scenes, narrationBrief);

const parseEnv = (path) => {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match) return [];
    return [[match[1], match[2].trim().replace(/^['"]|['"]$/gu, '')]];
  }));
};

const deployEnv = parseEnv(join(voiceRoot, 'deploy/.env'));
const brokerToken = process.env.INFERENCE_BROKER_TOKEN ?? deployEnv.INFERENCE_BROKER_TOKEN;
const brokerBaseUrl = (process.env.INFERENCE_BROKER_BASE_URL
  ?? 'http://127.0.0.1:9443/v1').replace(/\/$/u, '');
const narrationModel = process.env.INFERENCE_LLM_MODEL ?? deployEnv.OLLAMA_MODEL;
if (!brokerToken) throw new Error('INFERENCE_BROKER_TOKEN is required');

const narrationEvidence = scenes.map(({ id, title, spoken, evidence }) => ({
  id,
  title,
  groundedFallback: spoken,
  eventIds: evidence.eventIds,
}));

if (narrationModel) {
  try {
    const response = await fetch(`${brokerBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${brokerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: narrationModel,
        stream: false,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: narrationSystemPrompt,
          },
          {
            role: 'user',
            content: JSON.stringify({ providedIntent: narrationBrief, scenes: narrationEvidence }),
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('missing completion text');
    const json = content.match(/\{[\s\S]*\}/u)?.[0];
    if (!json) throw new Error('missing narration JSON');
    scenes = applyNarrationPlan(scenes, JSON.parse(json));
    console.log(`Planned ${scenes.length} grounded narration scenes with local inference`);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 160) : 'unknown error';
    console.warn(`Narration planner unavailable (${reason}); using grounded deterministic narration`);
  }
}

const formatSrtTime = (seconds) => {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};

const formatAssTime = (seconds) => {
  const centiseconds = Math.round(seconds * 100);
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
};

const escapeAss = (value) => String(value)
  .replaceAll('\\', '\\\\')
  .replaceAll('{', '\\{')
  .replaceAll('}', '\\}')
  .replaceAll(/\r?\n/gu, '\\N');

console.log(`Prepared ${scenes.length} evidence-backed narration scenes`);

const wavFromPcm = (pcm, sampleRate = 24_000, channels = 1) => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

const generatedAudio = [];
const kokoroProvider = {
  name: 'local-kokoro-broker',
  async isAvailable() { return Boolean(brokerToken); },
  async synthesize(texts, options = {}) {
    const workDir = options.workDir ?? join(outputDir, 'audio');
    mkdirSync(workDir, { recursive: true });
    const results = [];
    for (const [index, input] of texts.entries()) {
      console.log(`TTS ${index + 1}/${texts.length}`);
      const response = await fetch(`${brokerBaseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${brokerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'kokoro', input, voice: 'af_heart', response_format: 'pcm', speed: 1.0,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        throw new Error(`Broker TTS failed for scene ${index + 1}: HTTP ${response.status}`);
      }
      const pcm = Buffer.from(await response.arrayBuffer());
      const path = join(workDir, `kokoro-${index + 1}.wav`);
      writeFileSync(path, wavFromPcm(pcm));
      const durationMs = Math.round((pcm.length / (24_000 * 2)) * 1000);
      generatedAudio.push({ path, durationMs });
      results.push({
        path,
        durationMs,
        format: { sampleRate: 24_000, channels: 1, codec: 'pcm_s16le' },
      });
    }
    return results;
  },
  async dispose() {},
};

const audio = await kokoroProvider.synthesize(
  scenes.map(({ spoken }) => spoken),
  { workDir: join(outputDir, 'audio') },
);
await kokoroProvider.dispose();

const framesDirectory = join(outputDir, 'frames');
const segmentsDirectory = join(outputDir, 'segments');
mkdirSync(framesDirectory, { recursive: true });
mkdirSync(segmentsDirectory, { recursive: true });
const holdSeconds = 0.6;
const segmentDurations = [];
const segmentPaths = [];
for (const [index, scene] of scenes.entries()) {
  const member = scene.evidence.frame ?? framePath(pageFrames.at(-1));
  const imagePath = join(framesDirectory, `scene-${index + 1}.jpg`);
  writeFileSync(imagePath, execFileSync(
    'unzip', ['-p', tracePath, member], { maxBuffer: 32 * 1024 * 1024 },
  ));
  const duration = (audio[index].durationMs / 1000) + holdSeconds;
  const segmentPath = join(segmentsDirectory, `scene-${index + 1}.mp4`);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-i', imagePath,
    '-i', audio[index].path,
    '-vf', [
      'scale=1920:1080:force_original_aspect_ratio=decrease',
      'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b0f12',
      'pad=1920:1240:0:0:color=0x0b0f12',
      'format=yuv420p',
    ].join(','),
    '-af', `apad=pad_dur=${holdSeconds}`,
    '-t', duration.toFixed(3), '-r', '30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    segmentPath,
  ]);
  segmentDurations.push(duration);
  segmentPaths.push(segmentPath);
}

let captionClock = 0;
const sceneTimings = [];
const captionsPath = join(outputDir, 'captions.srt');
writeFileSync(captionsPath, `${scenes.map((scene, index) => {
  const start = captionClock;
  const end = start + (audio[index].durationMs / 1000);
  captionClock += segmentDurations[index];
  sceneTimings.push({ start, narrationEnd: end, sceneEnd: captionClock });
  return [
    String(index + 1),
    `${formatSrtTime(start)} --> ${formatSrtTime(end)}`,
    scene.spoken,
  ].join('\n');
}).join('\n\n')}\n`);

const presentationPath = join(outputDir, 'presentation.ass');
const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1240
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Arial,44,&H00FFFFFF,&H00FFFFFF,&H0010171B,&H980B0F12,-1,0,0,0,100,100,0,0,3,1,0,7,54,54,44,1
Style: Caption,Arial,31,&H00FFFFFF,&H00FFFFFF,&H0010171B,&H000B0F12,0,0,0,0,100,100,0,0,1,1,0,2,80,80,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
const titleEvents = scenes.map((scene, index) => (
  `Dialogue: 1,${formatAssTime(sceneTimings[index].start)},${formatAssTime(sceneTimings[index].sceneEnd)},Title,,0,0,0,,${escapeAss(scene.title)}`
));
const captionEvents = scenes.map((scene, index) => (
  `Dialogue: 2,${formatAssTime(sceneTimings[index].start)},${formatAssTime(sceneTimings[index].narrationEnd)},Caption,,0,0,0,,${escapeAss(scene.spoken)}`
));
writeFileSync(presentationPath, `${assHeader}\n${[...titleEvents, ...captionEvents].join('\n')}\n`);

const concatPath = join(outputDir, 'segments.txt');
writeFileSync(concatPath, `${segmentPaths.map((path) => `file '${path}'`).join('\n')}\n`);
const silentCaptionsVideo = join(outputDir, 'trace-explainer-without-captions.mp4');
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'concat', '-safe', '0', '-i', concatPath,
  '-c', 'copy', silentCaptionsVideo,
]);
const finalVideo = join(outputDir, 'trace-explainer.mp4');
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', silentCaptionsVideo, '-i', captionsPath,
  '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0',
  '-vf', `ass=${presentationPath}`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-c:a', 'copy', '-c:s', 'mov_text',
  '-metadata:s:s:0', 'language=eng', '-movflags', '+faststart', finalVideo,
]);

const outputDurationSeconds = Number(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=noprint_wrappers=1:nokey=1', finalVideo,
], { encoding: 'utf8' }).trim());
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = {
  kind: 'trace-explainer',
  title: 'Playwright trace explainer',
  status: 'completed',
  summary: `${pageFrames.length} screenshots, ${calls.length} browser actions, ${actionErrors.length} action errors`,
  renderer: { name: 'playwright-evidence-slides', version: '2' },
  trace: relative(clientRoot, tracePath),
  traceSha256: sha256(tracePath),
  narrationBriefSha256: createHash('sha256').update(narrationBrief).digest('hex'),
  primaryPageId: pageId,
  traceFrames: pageFrames.length,
  traceActions: calls.length,
  traceActionErrors: actionErrors.length,
  sourceDurationSeconds: sourceDuration,
  outputDurationSeconds,
  tts: { provider: 'local inference broker', model: 'configured Kokoro', sampleRate: 24_000 },
  scenes: scenes.map((scene, index) => ({
    ...scene,
    durationSeconds: (generatedAudio[index]?.durationMs ?? 0) / 1000,
    spokenSha256: createHash('sha256').update(scene.spoken).digest('hex'),
  })),
  output: basename(finalVideo),
  outputSha256: sha256(finalVideo),
};
writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const escapedManifest = JSON.stringify(manifest, null, 2)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
writeFileSync(join(outputDir, 'report.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Playwright trace explainer</title>
<style>body{margin:0;padding:32px;background:#0c1216;color:#eef6f2;font:16px system-ui;display:grid;gap:24px}video{width:min(100%,960px);border:1px solid #34464e}pre{white-space:pre-wrap;background:#121b20;padding:16px;border-radius:8px}</style>
<h1>Playwright trace explainer</h1>
<video controls src="trace-explainer.mp4"></video>
<details open><summary>Observable render state</summary><pre>${escapedManifest}</pre></details>
</html>\n`);

console.log(`Video: ${finalVideo}`);
console.log(`Report: ${join(outputDir, 'report.html')}`);
