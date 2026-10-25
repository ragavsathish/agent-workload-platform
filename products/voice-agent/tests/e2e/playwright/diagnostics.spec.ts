import * as allure from 'allure-js-commons';
import { test, expect, expectCleanBrowser } from './fixtures';
import { openDiagnostics, loadRecentReplay } from './diagnostics-journey';

test('renders lightweight conversation diagnostics', async ({ page, browserEvidence }) => {
  await openDiagnostics(page);
  await loadRecentReplay(page);

  await allure.step('And the lightweight page excludes Flutter and browser errors', async () => {
    const resources = await page.evaluate(() => performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname));
    expect(resources.some((resource) => resource.endsWith('/main.dart.js'))).toBe(false);
    expectCleanBrowser(browserEvidence);
  });
});
