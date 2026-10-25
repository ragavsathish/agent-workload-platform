import type { Page } from 'playwright/test';
import { expect, expectCleanBrowser } from './fixtures';

export function expectCleanFlutterBrowser(page: Page, browserEvidence, maxFontAborts: number) {
  const fontAborts = browserEvidence.requestFailures.filter((failure: {
    method: string; url: string; error: string,
  }) => failure.method === 'GET' && failure.error === 'net::ERR_ABORTED'
    && new URL(failure.url).origin === new URL(page.url()).origin
    && /^\/assets\/(?:fonts\/MaterialIcons-Regular\.otf|packages\/cupertino_icons\/assets\/CupertinoIcons\.ttf|design_system\/fonts\/SourceCodePro-(?:Regular|Semibold)\.ttf)$/u
      .test(new URL(failure.url).pathname));
  expect(fontAborts.length).toBeLessThanOrEqual(maxFontAborts);
  expectCleanBrowser({ ...browserEvidence,
    requestFailures: browserEvidence.requestFailures.filter((failure: unknown) =>
      !fontAborts.includes(failure)) });
}
