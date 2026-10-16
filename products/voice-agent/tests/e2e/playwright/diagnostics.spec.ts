import { test, expect, expectCleanBrowser } from './fixtures';

test('renders lightweight conversation diagnostics', async ({ page, browserEvidence }) => {
  await page.goto('/diagnostics/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Last five conversations' })).toBeVisible();
  await expect(page.locator('flt-glass-pane')).toHaveCount(0);

  const load = page.getByRole('button', { name: 'Load session diagnostics' }).first();
  await expect(load).toBeVisible();
  await load.click();
  await expect(page.getByRole('button', { name: 'Play Raw microphone' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Input and output energy · dBFS', { exact: true })).toBeVisible();

  const resources = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname));
  expect(resources.some((resource) => resource.endsWith('/main.dart.js'))).toBe(false);
  expectCleanBrowser(browserEvidence);
});

test('renders the operational C4 dashboard', async ({ page, browserEvidence }) => {
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
  expect(
    dashboard.dashboard.panels.some(
      (panel) => panel.title === 'Source-backed code evidence',
    ),
  ).toBe(true);
  expect(diagramPanels.some((panel) => panel.targets.length > 0)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('body')).not.toContainText(
    /panel plugin not found|failed to load plugin|unexpected error/i,
  );
  expectCleanBrowser(browserEvidence);
});
