import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const mcpFrame = async (frame, title) => {
  const testFrame = await frame();
  const iframe = testFrame.locator(`iframe[title="${title}"]`);
  await iframe.waitFor({ state: 'visible' });
  const iframeHandle = await iframe.elementHandle();
  const appFrame = await iframeHandle.contentFrame();
  if (!appFrame) throw new Error(`MCP App frame "${title}" is unavailable`);
  return appFrame;
};

const inspectMcpFrame = async ({ frame }, options) => {
  const appFrame = await mcpFrame(frame, options.title);
  const content = appFrame.locator(options.selector);
  await content.waitFor({ state: 'visible' });
  if (!options.skipAnimations) {
    await appFrame.waitForFunction(
      () => document.getAnimations().every((animation) => animation.playState === 'finished'),
    );
  }
  const text = await content.textContent();
  const mathCount = options.mathSelector
    ? await appFrame.locator(options.mathSelector).count()
    : 0;
  const attribute = options.attribute
    ? await content.getAttribute(options.attribute)
    : undefined;
  const computedStyles = options.computedStyles
    ? await content.evaluate((element, properties) => Object.fromEntries(
      properties.map((property) => [property, getComputedStyle(element).getPropertyValue(property)]),
    ), options.computedStyles)
    : undefined;
  let fit;
  if (options.measureDeck) {
    fit = await content.evaluate((slide) => {
      const slideBox = slide.getBoundingClientRect();
      const deckBox = document.querySelector('#deck').getBoundingClientRect();
      return {
        slideWidth: slideBox.width,
        slideHeight: slideBox.height,
        deckWidth: deckBox.width,
        deckHeight: deckBox.height,
      };
    });
  }
  return { text, mathCount, fit, attribute, computedStyles };
};

const clickMcpFrame = async ({ frame }, options) => {
  const appFrame = await mcpFrame(frame, options.title);
  await appFrame.locator(options.selector).click();
};

const screenshotMcpFrame = async ({ frame }, options) => {
  const testFrame = await frame();
  const iframe = testFrame.locator(`iframe[title="${options.title}"]`);
  await iframe.waitFor({ state: 'visible' });
  await iframe.screenshot({ path: options.path });
  return options.path;
};

export default defineConfig({
  publicDir: 'web',
  cacheDir: 'build/vitest-cache',
  test: {
    include: ['browser_test/**/*.browser.test.js'],
    fileParallelism: false,
    attachmentsDir: 'build/vitest-attachments',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 390, height: 844 },
      trace: {
        mode: 'on',
        tracesDir: 'build/vitest-playwright-traces',
        screenshots: true,
        snapshots: true,
      },
      screenshotFailures: true,
      screenshotDirectory: 'build/vitest-screenshots',
      commands: { inspectMcpFrame, clickMcpFrame, screenshotMcpFrame },
    },
  },
});
