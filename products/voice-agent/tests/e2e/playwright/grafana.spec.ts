import { test, expect, expectCleanBrowser } from './fixtures';

const evidenceFills = new Set([
  'rgb(35, 111, 79)',
  'rgb(124, 94, 39)',
  'rgb(39, 99, 142)',
  'rgb(125, 48, 61)',
]);

test('renders every operational C4 panel with accessible color semantics', async ({
  page,
  browserEvidence,
}, testInfo) => {
  await page.goto('/metrics/d/voice-c4-heatmap/c4-operational-heat-map', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByText('C4 Operational Heat Map', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });

  const dashboard = await page.evaluate(async () => {
    const response = await fetch('/metrics/api/dashboards/uid/voice-c4-heatmap');
    if (!response.ok) throw new Error(`Grafana dashboard API returned ${response.status}`);
    return response.json();
  });
  const diagramPanels = dashboard.dashboard.panels.filter(
    (panel) => panel.type === 'neildengg-grafmaid-panel',
  );
  expect(diagramPanels).toHaveLength(15);
  expect(dashboard.dashboard.refresh).toBe('30s');
  expect(dashboard.dashboard.links).toHaveLength(2);
  expect(dashboard.dashboard.annotations.list[0].name).toBe('Deployments and E2E runs');

  for (const panel of diagramPanels) {
    const title = page.getByText(panel.title, { exact: true }).first();
    await title.scrollIntoViewIfNeeded();
    await expect(title).toBeVisible();
    await expect.poll(async () => title.evaluate((element) => {
      let ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 10; depth += 1) {
        if (ancestor.querySelector('svg')) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    }), { message: `${panel.title} did not render an SVG` }).toBe(true);
  }

  const colors = await page.locator('svg *').evaluateAll((elements) => ({
    fills: [...new Set(elements.map((element) => getComputedStyle(element).fill))],
    strokes: [...new Set(elements.map((element) => getComputedStyle(element).stroke))],
  }));
  for (const fill of evidenceFills) expect(colors.fills).toContain(fill);
  expect(colors.strokes.some((stroke) => [
    'rgb(148, 163, 184)',
    'rgb(56, 189, 248)',
    'rgb(34, 211, 238)',
    'rgb(45, 212, 191)',
  ].includes(stroke))).toBe(true);

  await testInfo.attach('grafana-color-evidence', {
    body: Buffer.from(`${JSON.stringify(colors, null, 2)}\n`),
    contentType: 'application/json',
  });
  await testInfo.attach('grafana-dashboard', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await expect(page.locator('body')).not.toContainText(
    /panel plugin not found|failed to load plugin|unexpected error/i,
  );
  expectCleanBrowser(browserEvidence);
});
