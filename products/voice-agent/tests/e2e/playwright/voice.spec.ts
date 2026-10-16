import {
  test,
  expect,
  enableFlutterSemantics,
  fetchJson,
  expectCleanBrowser,
} from './fixtures';

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
  expectCleanBrowser(browserEvidence, {
    ignoredFailures: [/\/api\/pi-speech$/],
  });
});
