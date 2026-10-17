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
