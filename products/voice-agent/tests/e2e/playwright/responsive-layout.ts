import type { Page, TestInfo } from 'playwright/test';
import { expect } from './fixtures';

export const responsiveViewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

export async function captureResponsiveLayout(page: Page, testInfo: TestInfo,
  surface: string, viewport: typeof responsiveViewports[number]) {
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    title: document.title,
    protrudingElements: [...document.querySelectorAll('body *')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName.toLowerCase(), className: typeof element.className === 'string'
        ? element.className.slice(0, 120) : '', right: Math.round(rect.right),
      width: Math.round(rect.width), text: element.textContent?.trim().slice(0, 60) ?? '' };
    }).filter((element) => element.width > 0 && element.right > window.innerWidth + 1)
      .slice(0, 20),
  }));
  await testInfo.attach(`${surface}-${viewport.name}-layout`, {
    body: Buffer.from(`${JSON.stringify({ viewport, ...layout }, null, 2)}\n`),
    contentType: 'application/json',
  });
  await testInfo.attach(`${surface}-${viewport.name}-screen`, {
    body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  });
  if (surface === 'journal' || surface === 'knowledge-map') {
    await testInfo.attach(`${surface}-${viewport.name}-full-page`, {
      body: await page.screenshot({ animations: 'disabled', fullPage: true }),
      contentType: 'image/png',
    });
  }
  expect(layout.viewportWidth).toBe(viewport.width);
  expect(layout.documentWidth, `${surface} document overflows ${viewport.name}`).toBeLessThanOrEqual(viewport.width + 1);
}
