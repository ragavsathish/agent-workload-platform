import * as allure from 'allure-js-commons';
import { test, expect, expectCleanBrowser } from './fixtures';
import { loadRecentReplay, openDiagnostics } from './diagnostics-journey';
import { captureResponsiveLayout, responsiveViewports } from './responsive-layout';

const sessionId = '11111111-1111-4111-8111-111111111111';

async function selectScenario(page: Parameters<typeof openDiagnostics>[0], scenario: string) {
  const response = await page.request.post('/__fixture/diagnostics/scenario', { data: { scenario } });
  expect(response.status()).toBe(200);
}

test('replay dashboard stays usable across mobile, tablet, and desktop', async ({ page, browserEvidence }, testInfo) => {
  await selectScenario(page, 'ready');
  for (const viewport of responsiveViewports) {
    await allure.step(`Given the replay dashboard opens at ${viewport.name} resolution`, async () => {
      await page.setViewportSize(viewport);
      await openDiagnostics(page);
      await loadRecentReplay(page, sessionId);
      await captureResponsiveLayout(page, testInfo, 'diagnostics-replay', viewport);
      await page.getByRole('heading', { name: 'Turn events' }).scrollIntoViewIfNeeded();
      await testInfo.attach(`diagnostics-replay-${viewport.name}-charts`, {
        body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
      });
    });
  }
  await allure.step('Then the browser reports no unexpected errors', async () => {
    expectCleanBrowser(browserEvidence);
  });
});

test('replays a recorded conversation through the C2 Voice Edge mock', async ({ page, browserEvidence }, testInfo) => {
  await selectScenario(page, 'ready');
  await openDiagnostics(page);
  await loadRecentReplay(page, sessionId);
  await allure.step('And the mock records the exact C2 endpoints used by the browser', async () => {
    const evidence = await (await page.request.get('/__fixture/diagnostics/evidence')).json();
    expect(evidence.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ containerId: 'EDGE', path: '/api/audio-diagnostics', status: 200 }),
      expect.objectContaining({ containerId: 'EDGE', path: `/api/audio-diagnostics/${sessionId}/metrics`, status: 200 }),
      expect.objectContaining({ containerId: 'EDGE', path: `/api/audio-diagnostics/${sessionId}/raw.wav`, status: 200 }),
    ]));
    await testInfo.attach('c2-diagnostics-evidence', {
      body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`), contentType: 'application/json',
    });
    expectCleanBrowser(browserEvidence);
  });
});

test('shows the empty replay state without inventing a session', async ({ page, browserEvidence }) => {
  await selectScenario(page, 'empty');
  await openDiagnostics(page);
  await allure.step('Then the page explains that no conversation has completed', async () => {
    await expect(page.getByText('No completed conversations yet.', { exact: false })).toBeVisible();
    await expect(page.locator('[data-session-id]')).toHaveCount(0);
    expectCleanBrowser(browserEvidence);
  });
});

test('explains a truncated replay while keeping its available evidence', async ({ page, browserEvidence }) => {
  await selectScenario(page, 'truncated');
  await openDiagnostics(page);
  await loadRecentReplay(page, sessionId);
  await allure.step('Then the replay warning names the lost chunks and duration limit', async () => {
    await expect(page.locator(`[data-session-id="${sessionId}"]`))
      .toContainText('2 chunks were not recorded. Recording reached the configured duration limit.');
    expectCleanBrowser(browserEvidence);
  });
});

test('reports an unavailable replay list without showing stale sessions', async ({ page, browserEvidence }) => {
  await selectScenario(page, 'unavailable');
  await openDiagnostics(page);
  await allure.step('Then the failed Voice Edge request is visible and attributable', async () => {
    await expect(page.getByRole('alert')).toHaveText('Audio replays are unavailable.');
    await expect(page.locator('[data-session-id]')).toHaveCount(0);
    expect(browserEvidence.pageErrors).toEqual([]);
    expect(browserEvidence.requestFailures).toEqual([]);
    expect(browserEvidence.consoleErrors).toEqual([
      expect.stringContaining('503 (Service Unavailable)'),
    ]);
    expect(browserEvidence.httpErrors).toEqual([
      expect.objectContaining({ status: 503, url: expect.stringContaining('/api/audio-diagnostics') }),
    ]);
  });
});

test('keeps replay controls visible when metrics fail', async ({ page, browserEvidence }) => {
  await selectScenario(page, 'metrics-unavailable');
  await openDiagnostics(page);
  await allure.step('When I open the recorded session', async () => {
    await page.locator(`[data-session-id="${sessionId}"]`)
      .getByRole('button', { name: 'Load session diagnostics' }).click();
  });
  await allure.step('Then the missing metrics are explained without hiding audio replay', async () => {
    await expect(page.getByText('Diagnostic metrics are unavailable for this session.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play Raw microphone' })).toBeVisible();
    expect(browserEvidence.pageErrors).toEqual([]);
    expect(browserEvidence.requestFailures).toEqual([]);
    expect(browserEvidence.consoleErrors).toEqual([
      expect.stringContaining('503 (Service Unavailable)'),
    ]);
    expect(browserEvidence.httpErrors).toEqual([
      expect.objectContaining({ status: 503, url: expect.stringContaining(`/${sessionId}/metrics`) }),
    ]);
  });
});
