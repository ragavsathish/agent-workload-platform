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
  labels: [],
  visualizerStates: [],
  finalLabel: null,
  consoleErrors: [],
  requestFailures: [],
  screenshot: path.join(outputDir, 'voice-e2e.png'),
  replayScreenshot: path.join(outputDir, 'voice-replays-e2e.png'),
};

const main = async () => {
  const browser = await chromium.launch({
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

  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    result.requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
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
  while (Date.now() - startedAt < 150_000) {
    const label = (await page.locator('.voice-state-label').textContent())?.trim() || '';
    if (label && label !== lastLabel) {
      result.labels.push(label);
      lastLabel = label;
    }
    const visualizerState = await page
      .locator('canvas[aria-label="Pi bot audio activity"]')
      .getAttribute('data-state')
      .catch(() => null);
    if (visualizerState && visualizerState !== lastVisualizerState) {
      result.visualizerStates.push(visualizerState);
      lastVisualizerState = visualizerState;
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
        break;
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

  await page.screenshot({ path: result.screenshot, fullPage: true });
  await page.getByRole('button', { name: 'End conversation' }).click();
  await page.getByRole('button', { name: 'Start conversation' }).waitFor({ timeout: 20_000 });
  result.finalLabel = (await page.locator('.voice-state-label').textContent())?.trim() || null;
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

  const replayPage = await context.newPage();
  await replayPage.goto(`${baseUrl}/?view=audio-diagnostics`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await replayPage.getByText('Last five conversations').waitFor();
  await replayPage.getByRole('button', { name: 'Load waveform comparison' }).first().click();
  await replayPage.waitForFunction(() => {
    const controls = [...document.querySelectorAll('button[aria-label^="Play "]')];
    return controls.length === 3 && controls.every((control) => !control.disabled);
  }, { timeout: 20_000 });
  await replayPage.getByText('Mean predicted complex-mask magnitude · model band').waitFor();
  await replayPage.waitForFunction(() => (
    document.querySelectorAll('.audio-spectrogram canvas').length >= 4
  ), { timeout: 30_000 });
  result.spectrogramCanvases = await replayPage.locator('.audio-spectrogram canvas').count();
  result.spectrogramLayout = await replayPage.locator('.audio-spectrogram').evaluateAll((elements) => (
    elements.map((element) => ({
      childCount: element.childElementCount,
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
      canvases: [...element.querySelectorAll('canvas')].map((canvas) => ({
        height: canvas.getBoundingClientRect().height,
        width: canvas.getBoundingClientRect().width,
        pixelHeight: canvas.height,
        pixelWidth: canvas.width,
      })),
    }))
  ));
  if (result.spectrogramLayout.some((layout) => layout.width <= 0 || layout.height <= 0)) {
    throw new Error(`Spectrogram has no visible layout: ${JSON.stringify(result.spectrogramLayout)}`);
  }
  const metrics = await replayPage.evaluate(async (sessionId) => {
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
  await replayPage.waitForTimeout(1_500);
  await replayPage.screenshot({ path: result.replayScreenshot, fullPage: true });
  const replayChecks = await replayPage.evaluate(async (sessionId) => {
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
  await browser.close();
};

main()
  .catch((error) => {
    result.error = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(process.exitCode || 0);
  });
