import { randomBytes } from 'node:crypto';
import * as allure from 'allure-js-commons';
import {
  test,
  expect,
  enableFlutterSemantics,
  fetchJson,
  expectCleanBrowser,
} from './fixtures';

async function completedTurnMetric(page) {
  return page.evaluate(async () => {
    const expression = 'pipecat_operation_total{service_name="pipecat-voice-edge",app_operation="pipecat.turn.completed"}';
    const query = new URLSearchParams({ query: expression });
    const response = await fetch(`/metrics/api/datasources/proxy/uid/prometheus/api/v1/query?${query}`);
    if (!response.ok) throw new Error(`Prometheus turn query returned ${response.status}`);
    const payload = await response.json();
    return (payload.data?.result ?? []).reduce((sum, series) =>
      sum + Number(series.value?.[1] ?? 0), 0);
  });
}

test('keeps the primary voice controls usable on a phone viewport', async ({
  page,
  browserEvidence,
}, testInfo) => {
  await allure.step('Given the voice home is open on a phone viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
  });

  await allure.step('Then primary controls are visible and have usable touch targets', async () => {
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
  });

  await allure.step('Then the page fits the viewport without horizontal overflow', async () => {
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(layout).toEqual({ viewportWidth: 390, documentWidth: 390 });
  });

  await testInfo.attach('voice-mobile', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await allure.step('And the browser reports no unexpected errors', async () => {
    expectCleanBrowser(browserEvidence);
  });
});

test('opens journal knowledge from Pi home and returns through the Pi logo', async ({ page }) => {
  await allure.step('Given Pi home is open', async () => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
  });

  const knowledgePage = await allure.step('When I open Knowledge', async () => {
    const knowledgePagePromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    return knowledgePagePromise;
  });
  await allure.step('Then the journal knowledge page is visible', async () => {
    await expect(knowledgePage).toHaveURL(/\/knowledge\/$/);
    await expect(knowledgePage.getByRole('heading', { name: 'Journal & knowledge' })).toBeVisible();
  });

  await allure.step('When I select the Pi logo', async () => {
    await knowledgePage.locator('a.knowledge-brand').click();
  });
  await allure.step('Then Pi home reopens', async () => {
    await expect(knowledgePage).toHaveURL(/\/$/);
    await expect(knowledgePage).toHaveTitle('Pi Voice');
  });
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
  await allure.step('Given an authenticated voice page and a trace ID', async () => {
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    await page.goto('/', { waitUntil: 'networkidle' });
  });
  await allure.step('When I mount the Grafana trace MCP App', async () => {
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
  });

  await allure.step('Then the trace waterfall and Grafana link are visible', async () => {
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
  });
  await testInfo.attach('grafana-trace-mcp-app', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await allure.step('And the browser reports no unexpected errors', async () => {
    expectCleanBrowser(browserEvidence);
  });
});

test('completes a deployed voice session and retains its diagnostics', async ({
  page,
  browserEvidence,
}, testInfo) => {
  test.setTimeout(240_000);
  const traceEnabled = process.env.VOICE_E2E_INGRESS === 'tailscale';
  const traceId = traceEnabled ? randomBytes(16).toString('hex') : null;
  let offerRequests = 0;
  let initialTurnMetric = 0;
  const evidence = {
    transcriptObserved: false,
    responseObserved: false,
    replaySessionId: null,
    replayMetricPoints: 0,
    liveWaveformPoints: 0,
    audioPlayback: null,
    traceId,
    offerRequests: 0,
    completedTurnMetricBefore: 0,
    completedTurnMetricAfter: 0,
    traceSpanNames: [],
  };
  let initialEntryIds;
  let initialReplayIds;

  await allure.step('Given the deployed Flutter client is open', async () => {
    if (traceEnabled) {
      await page.route('**/api/offer', async (route) => {
        offerRequests += 1;
        await route.continue({ headers: {
          ...route.request().headers(),
          traceparent: `00-${traceId}-0123456789abcdef-01`,
        } });
      });
    }
    await page.goto('/', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
    if (traceEnabled) {
      initialTurnMetric = await completedTurnMetric(page);
      evidence.completedTurnMetricBefore = initialTurnMetric;
    }
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

  await allure.step('When I start a conversation and mute during the response', async () => {
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

  await allure.step('Then the completed transcript turn is visible', async () => {
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

  await allure.step('And remote audio playback and microphone diagnostics are live', async () => {
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

  await allure.step('When I end the conversation', async () => {
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'End conversation' }).click();
  });

  await allure.step('Then the voice session retains a replay and metrics', async () => {
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

  if (traceEnabled) {
    await allure.step('And the same turn has a Tempo trace and an OTel metric increment', async () => {
      expect(offerRequests).toBeGreaterThan(0);
      evidence.offerRequests = offerRequests;
      await expect.poll(() => completedTurnMetric(page), {
        timeout: 60_000, intervals: [1000, 3000, 5000],
      }).toBeGreaterThan(initialTurnMetric);
      evidence.completedTurnMetricAfter = await completedTurnMetric(page);
      await expect.poll(async () => {
        const response = await page.request.get(
          `/metrics/api/datasources/proxy/uid/tempo/api/traces/${traceId}`,
        );
        if (!response.ok()) return false;
        const payload = await response.json();
        const names = (payload.batches ?? []).flatMap((batch) =>
          (batch.scopeSpans ?? []).flatMap((scope) => (scope.spans ?? []).map((span) => span.name)));
        evidence.traceSpanNames = names.filter((name) => typeof name === 'string').slice(0, 30);
        return names.some((name) => typeof name === 'string' && name.includes('voice.session'));
      }, { timeout: 60_000, intervals: [1000, 3000, 5000] }).toBe(true);
    });
  }

  await allure.step('And the browser reports no unexpected errors', async () => {
    const expectedNavigationAborts = browserEvidence.requestFailures.filter((failure) =>
      failure.method === 'GET' && failure.error === 'net::ERR_ABORTED'
      && new URL(failure.url).origin === new URL(page.url()).origin
      && ['/api/pi-context', '/api/pi-transcript', '/api/pi-sessions']
        .includes(new URL(failure.url).pathname));
    expect(expectedNavigationAborts.length).toBeLessThanOrEqual(3);
    evidence.expectedNavigationAborts = expectedNavigationAborts.map((failure) =>
      new URL(failure.url).pathname);
    expectCleanBrowser({ ...browserEvidence,
      requestFailures: browserEvidence.requestFailures.filter((failure) =>
        !expectedNavigationAborts.includes(failure)) });
  });
  await testInfo.attach('voice-session-evidence', {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: 'application/json',
  });
});
