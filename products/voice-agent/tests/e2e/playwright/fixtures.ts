import { test as base, expect } from 'playwright/test';

const test = base.extend({
  browserEvidence: [async ({ page }, use, testInfo) => {
    const evidence = { consoleErrors: [], pageErrors: [], requestFailures: [] };
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('blob:')) return;
      evidence.requestFailures.push({
        method: request.method(),
        url: request.url(),
        error: request.failure()?.errorText || 'unknown failure',
      });
    });
    await use(evidence);
    await testInfo.attach('browser-evidence', {
      body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
      contentType: 'application/json',
    });
  }, { auto: true }],
});

const enableFlutterSemantics = async (page) => {
  const placeholder = page.locator('flt-semantics-placeholder');
  if (await placeholder.count()) {
    await placeholder.evaluate((element) => element.click());
    await page.locator('flt-semantics').first().waitFor();
  }
};

const fetchJson = (page, url) => page.evaluate(async (path) => {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}, url);

const expectCleanBrowser = (evidence, options = {}) => {
  const ignoredFailures = options.ignoredFailures || [];
  const ignoredConsoleErrors = options.ignoredConsoleErrors || [
    /^Chrome Report: \[deprecation\] /,
  ];
  const failures = evidence.requestFailures.filter(
    (failure) => !ignoredFailures.some((pattern) => pattern.test(failure.url)),
  );
  const consoleErrors = evidence.consoleErrors.filter(
    (message) => !ignoredConsoleErrors.some((pattern) => pattern.test(message)),
  );
  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(evidence.pageErrors, 'uncaught browser errors').toEqual([]);
  expect(failures, 'unexpected request failures').toEqual([]);
};

export { test, expect, enableFlutterSemantics, fetchJson, expectCleanBrowser };
