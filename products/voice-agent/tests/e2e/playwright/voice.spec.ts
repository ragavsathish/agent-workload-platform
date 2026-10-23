import {
  test,
  expect,
  enableFlutterSemantics,
  fetchJson,
  expectCleanBrowser,
} from './fixtures';

test('keeps the primary voice controls usable on a phone viewport', async ({
  page,
  browserEvidence,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await enableFlutterSemantics(page);

  for (const name of ['Replays', 'System health', 'Chat', 'Knowledge', 'Start conversation']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error(`${name} button has no layout box`);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(layout).toEqual({ viewportWidth: 390, documentWidth: 390 });

  await testInfo.attach('voice-mobile', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expectCleanBrowser(browserEvidence);
});

test('opens journal knowledge from Pi home and returns through the Pi logo', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await enableFlutterSemantics(page);

  const knowledgePagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  const knowledgePage = await knowledgePagePromise;
  await expect(knowledgePage).toHaveURL(/\/knowledge\/$/);
  await expect(knowledgePage.getByRole('heading', { name: 'Journal & knowledge' })).toBeVisible();

  await knowledgePage.locator('a.knowledge-brand').click();
  await expect(knowledgePage).toHaveURL(/\/$/);
  await expect(knowledgePage).toHaveTitle('Pi Voice');
});

test('renders the official Grafana trace MCP App inside voice chat', async ({
  page,
  browserEvidence,
}, testInfo) => {
  test.skip(
    process.env.VOICE_E2E_INGRESS !== 'tailscale',
    'Grafana remains an explicit authenticated tailnet-ingress test',
  );
  const traceId = process.env.GRAFANA_TRACE_ID;
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  await page.goto('/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async ({ id }) => {
    const host = document.createElement('div');
    host.id = 'grafana-trace-app-host';
    Object.assign(host.style, { width: '1000px', height: '720px' });
    document.body.replaceChildren(host);
    return JSON.parse(await window.voiceBridge.mountMcpApp(
      host.id,
      JSON.stringify({
        kind: 'grafana-trace',
        title: 'Latest voice trace',
        traceId: id,
        datasourceUid: 'tempo',
      }),
      'ui://grafana/trace.html',
    ));
  }, { id: traceId });
  expect(result).toEqual({ ok: true });

  const frame = page.frameLocator('iframe[title="Grafana trace"]');
  await expect(frame.getByText('Loading trace...')).toBeHidden({ timeout: 15_000 });
  await expect(frame.locator('body')).toContainText('mcp-grafana');
  const appBackground = await frame.locator('body').evaluate(
    (body) => getComputedStyle(body).backgroundColor,
  );
  const headingColor = await frame.getByText('Span waterfall').evaluate(
    (heading) => getComputedStyle(heading).color,
  );
  expect(appBackground).not.toBe('rgb(255, 255, 255)');
  expect(headingColor).not.toBe('rgb(0, 0, 0)');
  await expect(frame.getByRole('link', { name: /Open in Grafana/ })).toHaveAttribute(
    'href',
    /\/metrics\//,
  );
  await testInfo.attach('grafana-trace-mcp-app', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expectCleanBrowser(browserEvidence);
});

test('completes a deployed voice session and retains its diagnostics', async ({
  page,
  browserEvidence,
}, testInfo) => {
  const evidence = {
    transcriptObserved: false,
    responseObserved: false,
    replaySessionId: null,
    replayMetricPoints: 0,
    liveWaveformPoints: 0,
    audioPlayback: null,
  };
  let initialEntryIds;
  let initialReplayIds;

  await test.step('open the deployed Flutter client', async () => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
    const transcript = await fetchJson(page, '/api/pi-transcript');
    initialEntryIds = new Set(
      (Array.isArray(transcript?.entries) ? transcript.entries : [])
        .map((entry) => entry?.id)
        .filter((id) => typeof id === 'string'),
    );
    const diagnostics = await fetchJson(page, '/api/audio-diagnostics');
    initialReplayIds = new Set(
      (Array.isArray(diagnostics?.sessions) ? diagnostics.sessions : [])
        .map((session) => session?.id)
        .filter((id) => typeof id === 'string'),
    );
  });

  await test.step('start a conversation and preserve mute through the response', async () => {
    await page.getByRole('button', { name: 'Start conversation' }).click();
    await expect.poll(async () => {
      const live = await fetchJson(page, '/api/audio-diagnostics/live');
      return live?.active === true && Array.isArray(live.waveform) && live.waveform.length > 0;
    }, { timeout: 15_000, intervals: [250, 500, 1000] }).toBe(true);
    const voiceStatus = page.getByRole('group', { name: /Pi Voice/ });
    await expect(voiceStatus).toHaveAccessibleName(/Thinking…/, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
    await expect(voiceStatus).toHaveAccessibleName(/Speaking/, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  });

  await test.step('observe the completed transcript turn', async () => {
    let completedTurn = null;
    await expect.poll(async () => {
      const snapshot = await fetchJson(page, '/api/pi-transcript');
      const entries = (Array.isArray(snapshot?.entries) ? snapshot.entries : [])
        .filter((entry) => !initialEntryIds.has(entry?.id));
      const userIndex = entries.findIndex(
        (entry) => entry?.role === 'user' &&
          typeof entry.text === 'string' &&
          !entry.text.startsWith('The authenticated user is '),
      );
      if (userIndex < 0) return false;
      const assistant = entries.slice(userIndex + 1).find(
        (entry) => entry?.role === 'assistant' &&
          entry.status === 'completed' &&
          typeof entry.text === 'string' &&
          entry.text.trim().length > 0,
      );
      if (!assistant) return false;
      completedTurn = { user: entries[userIndex], assistant };
      return true;
    }, { timeout: 150_000, intervals: [250, 500, 1000] }).toBe(true);
    evidence.transcriptObserved = Boolean(completedTurn?.user);
    evidence.responseObserved = Boolean(completedTurn?.assistant);
  });

  await test.step('verify remote audio playback and live microphone diagnostics', async () => {
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
    evidence.audioPlayback = await page.evaluate(() => {
      const output = document.querySelector('audio[data-pipecat-output="true"]');
      const stream = output?.srcObject;
      const tracks = stream instanceof MediaStream ? stream.getAudioTracks() : [];
      return {
        outputPresent: output instanceof HTMLAudioElement,
        paused: output instanceof HTMLAudioElement ? output.paused : null,
        muted: output instanceof HTMLAudioElement ? output.muted : null,
        liveTrackCount: tracks.filter((track) => track.readyState === 'live').length,
      };
    });
    expect(evidence.audioPlayback).toMatchObject({
      outputPresent: true,
      paused: false,
      muted: false,
    });
    expect(evidence.audioPlayback.liveTrackCount).toBeGreaterThan(0);

    const live = await fetchJson(page, '/api/audio-diagnostics/live');
    evidence.liveWaveformPoints = Array.isArray(live?.waveform) ? live.waveform.length : 0;
    expect(live?.active).toBe(true);
    expect(evidence.liveWaveformPoints).toBeGreaterThan(0);
  });

  await test.step('end the conversation and observe a retained replay', async () => {
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'End conversation' }).click();
    await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
    await expect(page.getByRole('group', { name: /Pi Voice/ })).toHaveAccessibleName(/Ready/);

    let replaySession = null;
    await expect.poll(async () => {
      const diagnostics = await fetchJson(page, '/api/audio-diagnostics');
      replaySession = (Array.isArray(diagnostics?.sessions) ? diagnostics.sessions : [])
        .find((session) => !initialReplayIds.has(session?.id)) || null;
      return Boolean(replaySession);
    }, { timeout: 20_000, intervals: [250, 500, 1000] }).toBe(true);
    evidence.replaySessionId = replaySession.id;

    const metrics = await fetchJson(
      page,
      `/api/audio-diagnostics/${encodeURIComponent(replaySession.id)}/metrics`,
    );
    const points = Array.isArray(metrics?.points) ? metrics.points : [];
    evidence.replayMetricPoints = points.length;
    expect(points.length).toBeGreaterThan(0);
    const latencyKey = `${replaySession.selectedFilter}LatencyMs`;
    expect(points.some((point) => typeof point?.[latencyKey] === 'number')).toBe(true);
    if (replaySession.selectedFilter === 'voxlock') {
      expect(points.some((point) => Array.isArray(point?.lstmHiddenRms))).toBe(true);
      expect(points.some((point) => Array.isArray(point?.maskMagnitude))).toBe(true);
    }

    for (const variant of ['raw', replaySession.selectedFilter]) {
      const replay = await page.evaluate(async ({ sessionId, variantName }) => {
        const response = await fetch(
          `/api/audio-diagnostics/${encodeURIComponent(sessionId)}/${variantName}.wav`,
          { cache: 'no-store' },
        );
        return {
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          bytes: (await response.arrayBuffer()).byteLength,
        };
      }, { sessionId: replaySession.id, variantName: variant });
      expect(replay).toMatchObject({ ok: true, contentType: 'audio/wav' });
      expect(replay.bytes).toBeGreaterThan(44);
    }
  });

  await testInfo.attach('voice-session-evidence', {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: 'application/json',
  });
  expectCleanBrowser(browserEvidence);
});
