'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.VOICE_E2E_URL;
const audioFile = process.env.VOICE_E2E_AUDIO;
const outputDir = process.env.VOICE_E2E_OUTPUT;

if (!baseUrl || !audioFile || !outputDir) {
  throw new Error('VOICE_E2E_URL, VOICE_E2E_AUDIO, and VOICE_E2E_OUTPUT are required');
}

fs.mkdirSync(outputDir, { recursive: true });

const result = {
  result: 'FAIL',
  hostsEntry: fs.readFileSync('/etc/hosts', 'utf8')
    .split('\n')
    .find((line) => line.includes('pipecat-edge.tailf6d713.ts.net')),
  userTranscript: null,
  assistantResponse: null,
  replaySession: null,
  replayVariants: [],
  replayMetricPoints: 0,
  liveWaveformPoints: 0,
  audioPlayback: null,
  muteDuringThinking: null,
  labels: [],
  visualizerStates: [],
  finalLabel: null,
  consoleErrors: [],
  requestFailures: [],
  screenshot: path.join(outputDir, 'voice-e2e.png'),
  trace: path.join(outputDir, 'voice-e2e-trace.zip'),
};

let browser;
let context;

const enableFlutterSemantics = async (page) => {
  const placeholder = page.locator('flt-semantics-placeholder');
  if (await placeholder.count()) {
    await placeholder.evaluate((element) => element.click());
    await page.locator('flt-semantics').first().waitFor({ timeout: 10_000 });
  }
};

const readVoiceLabel = async (page) => {
  const labels = ['Ready', 'Starting…', 'Listening', 'Muted', 'Thinking…', 'Speaking'];
  for (const label of labels) {
    if (await page.locator(`flt-semantics[aria-label="${label}"]`).count()) return label;
  }
  const header = await page
    .locator('flt-semantics[role="group"][aria-label*="Pi Voice"]')
    .first()
    .getAttribute('aria-label')
    .catch(() => '');
  return labels
    .find((label) => header?.split('\n').includes(label)) || '';
};

const main = async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: '/ms-playwright/chromium-1237/chrome-linux/chrome',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFile}`,
    ],
  });

  context = await browser.newContext({
    ignoreHTTPSErrors: false,
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    result.requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await enableFlutterSemantics(page);
  const initialSnapshot = await page.evaluate(async () => {
    const response = await fetch('/api/pi-transcript', { cache: 'no-store' });
    return response.ok ? response.json() : null;
  });
  const initialEntryIds = new Set(
    (Array.isArray(initialSnapshot?.entries) ? initialSnapshot.entries : [])
      .map((entry) => entry?.id)
      .filter((id) => typeof id === 'string'),
  );
  const initialDiagnostics = await page.evaluate(async () => {
    const response = await fetch('/api/audio-diagnostics', { cache: 'no-store' });
    return response.ok ? response.json() : null;
  });
  const initialReplayIds = new Set(
    (Array.isArray(initialDiagnostics?.sessions) ? initialDiagnostics.sessions : [])
      .map((session) => session?.id)
      .filter((id) => typeof id === 'string'),
  );
  await page.getByRole('button', { name: 'Start conversation' }).click();

  const startedAt = Date.now();
  let lastLabel = '';
  let lastVisualizerState = '';
  let mutedDuringThinking = false;
  let observedMutedTransition = false;
  while (Date.now() - startedAt < 150_000) {
    const label = await readVoiceLabel(page);
    if (label && label !== lastLabel) {
      result.labels.push(label);
      lastLabel = label;
    }
    // The Flutter activity indicator is state-driven rather than a DOM canvas.
    // Keep the legacy result field stable for downstream result readers.
    lastVisualizerState = label || lastVisualizerState;

    if (label === 'Thinking…' && !mutedDuringThinking) {
      await page.getByRole('button', { name: 'Mute', exact: true }).click();
      await page.getByRole('button', { name: 'Unmute', exact: true }).waitFor({ timeout: 500 });
      mutedDuringThinking = true;
      result.muteDuringThinking = { clickedDuring: label, remainedMutedDuring: null };
    } else if (mutedDuringThinking && label === 'Speaking' && !observedMutedTransition) {
      await page.getByRole('button', { name: 'Unmute', exact: true }).waitFor({ timeout: 3_000 });
      observedMutedTransition = true;
      result.muteDuringThinking.remainedMutedDuring = label;
    }

    const snapshot = await page.evaluate(async () => {
      const response = await fetch('/api/pi-transcript', { cache: 'no-store' });
      return response.ok ? response.json() : null;
    });
    const entries = (Array.isArray(snapshot?.entries) ? snapshot.entries : [])
      .filter((entry) => !initialEntryIds.has(entry?.id));
    const userIndex = entries.findIndex(
      (entry) =>
        entry?.role === 'user' &&
        typeof entry.text === 'string' &&
        !entry.text.startsWith('The authenticated user is '),
    );
    if (userIndex >= 0) {
      const assistantEntry = entries
        .slice(userIndex + 1)
        .find(
          (entry) =>
            entry?.role === 'assistant' &&
            entry.status === 'completed' &&
            typeof entry.text === 'string' &&
            entry.text.trim().length > 0,
        );
      if (assistantEntry) {
        result.userTranscript = entries[userIndex].text;
        result.assistantResponse = assistantEntry.text;
        if (observedMutedTransition) break;
      }
    }
    await page.waitForTimeout(250);
  }

  if (!result.userTranscript || !result.assistantResponse) {
    throw new Error('No completed user-to-assistant voice turn appeared in the Pi transcript');
  }
  if (!result.labels.includes('Thinking…')) {
    throw new Error('The UI never exposed the Thinking state');
  }
  if (!result.labels.includes('Speaking')) {
    throw new Error('The UI never exposed the Speaking state');
  }
  if (!mutedDuringThinking || !observedMutedTransition) {
    throw new Error('Mute did not remain active across the Thinking state transition');
  }

  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await page.getByRole('button', { name: 'Mute', exact: true }).waitFor({ timeout: 10_000 });

  result.audioPlayback = await page.evaluate(() => {
    const output = document.querySelector('audio[data-pipecat-output="true"]');
    const stream = output?.srcObject;
    const tracks = stream instanceof MediaStream ? stream.getAudioTracks() : [];
    return {
      outputPresent: output instanceof HTMLAudioElement,
      paused: output instanceof HTMLAudioElement ? output.paused : null,
      muted: output instanceof HTMLAudioElement ? output.muted : null,
      trackCount: tracks.length,
      liveTrackCount: tracks.filter((track) => track.readyState === 'live').length,
    };
  });
  if (
    !result.audioPlayback.outputPresent ||
    result.audioPlayback.paused !== false ||
    result.audioPlayback.muted !== false ||
    result.audioPlayback.liveTrackCount === 0
  ) {
    throw new Error(`Remote audio is not playing: ${JSON.stringify(result.audioPlayback)}`);
  }

  const liveDiagnostics = await page.evaluate(async () => {
    const response = await fetch('/api/audio-diagnostics/live', { cache: 'no-store' });
    return response.ok ? response.json() : null;
  });
  result.liveWaveformPoints = Array.isArray(liveDiagnostics?.waveform)
    ? liveDiagnostics.waveform.length
    : 0;
  if (liveDiagnostics?.active !== true || result.liveWaveformPoints === 0) {
    throw new Error('Live microphone envelope was not available during the conversation');
  }

  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await page.getByRole('button', { name: 'Unmute', exact: true }).waitFor({ timeout: 10_000 });
  result.labels.push('Muted');
  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await page.getByRole('button', { name: 'Mute', exact: true }).waitFor({ timeout: 10_000 });
  result.labels.push('Listening');

  await page.screenshot({ path: result.screenshot, fullPage: true });
  await page.getByRole('button', { name: 'End conversation' }).click();
  await page.getByRole('button', { name: 'Start conversation' }).waitFor({ timeout: 20_000 });
  result.finalLabel = await readVoiceLabel(page) || null;
  if (result.finalLabel !== 'Ready') throw new Error(`Expected Ready, got ${result.finalLabel}`);

  const replayDeadline = Date.now() + 20_000;
  while (Date.now() < replayDeadline && !result.replaySession) {
    const diagnostics = await page.evaluate(async () => {
      const response = await fetch('/api/audio-diagnostics', { cache: 'no-store' });
      return response.ok ? response.json() : null;
    });
    result.replaySession = (Array.isArray(diagnostics?.sessions) ? diagnostics.sessions : [])
      .find((session) => !initialReplayIds.has(session?.id)) || null;
    if (!result.replaySession) await page.waitForTimeout(250);
  }
  if (!result.replaySession) throw new Error('Completed conversation did not create an audio replay');

  // Patrol owns Flutter layout assertions. This deployed-browser test stays at
  // the media contract: WebRTC playback plus retained replay APIs.
  const metrics = await page.evaluate(async (sessionId) => {
    const response = await fetch(
      `/api/audio-diagnostics/${encodeURIComponent(sessionId)}/metrics`,
      { cache: 'no-store' },
    );
    return response.ok ? response.json() : null;
  }, result.replaySession.id);
  const metricPoints = Array.isArray(metrics?.points) ? metrics.points : [];
  result.replayMetricPoints = metricPoints.length;
  if (
    metricPoints.length === 0 ||
    !metricPoints.some((point) => Array.isArray(point?.lstmHiddenRms)) ||
    !metricPoints.some((point) => Array.isArray(point?.maskMagnitude))
  ) {
    throw new Error('VoxLock model diagnostics were not retained');
  }
  const replayChecks = await page.evaluate(async (sessionId) => {
    const variants = ['raw', 'voxlock', 'rnnoise'];
    return Promise.all(variants.map(async (variant) => {
      const response = await fetch(
        `/api/audio-diagnostics/${encodeURIComponent(sessionId)}/${variant}.wav`,
        { cache: 'no-store' },
      );
      return {
        variant,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        bytes: (await response.arrayBuffer()).byteLength,
      };
    }));
  }, result.replaySession.id);
  result.replayVariants = replayChecks;
  if (replayChecks.some((replay) => !replay.ok || replay.contentType !== 'audio/wav' || replay.bytes <= 44)) {
    throw new Error(`Invalid audio replay response: ${JSON.stringify(replayChecks)}`);
  }

  result.result = 'PASS';
};

main()
  .catch((error) => {
    result.error = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (context) {
      await context.tracing.stop({ path: result.trace }).catch((error) => {
        result.traceError = error instanceof Error ? error.message : String(error);
      });
    }
    if (browser) await browser.close().catch(() => {});
    fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(process.exitCode || 0);
  });
