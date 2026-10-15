'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.VOICE_E2E_URL;
const outputDir = process.env.VOICE_E2E_OUTPUT;

if (!baseUrl || !outputDir) {
  throw new Error('VOICE_E2E_URL and VOICE_E2E_OUTPUT are required');
}

fs.mkdirSync(outputDir, { recursive: true });

const result = {
  result: 'FAIL',
  views: {},
  consoleErrors: [],
  responseErrors: [],
  requestFailures: [],
  runtimeResources: [],
  trace: path.join(outputDir, 'mermaid-exploratory-trace.zip'),
};

let browser;
let context;

const waitForDiagram = async (page) => {
  const elementId = await page.evaluate(async () => {
    const id = 'mermaid-exploratory-host';
    const host = document.createElement('div');
    host.id = id;
    host.style.width = 'min(90vw, 900px)';
    host.style.height = 'min(65vh, 620px)';
    host.style.margin = '24px auto';
    host.style.overflow = 'auto';
    host.style.position = 'relative';
    host.style.zIndex = '1000';
    host.style.background = '#07100e';
    document.body.append(host);
    const result = JSON.parse(await window.voiceBridge.renderMermaid(
      id,
      'flowchart LR\n  browser[Browser] --> edge[Voice edge]\n  edge --> pi[Pi session]\n  pi --> audio[Spoken response]',
    ));
    if (!result.ok) throw new Error('Initial Mermaid render failed');
    return id;
  });
  const target = page.locator(`#${elementId}`);
  await target.locator('svg').waitFor({ timeout: 30_000 });
  return target;
};

const pointer = async (target, type, pointerId, x, y) => target.evaluate(
  (element, event) => element.dispatchEvent(new PointerEvent(event.type, {
    bubbles: true,
    cancelable: true,
    clientX: event.x,
    clientY: event.y,
    pointerId: event.pointerId,
    pointerType: 'touch',
    isPrimary: event.pointerId === 1,
  })),
  { type, pointerId, x, y },
);

const pinch = async (target, startDistance, endDistance, centerX, centerY) => {
  await pointer(target, 'pointerdown', 1, centerX - startDistance / 2, centerY);
  await pointer(target, 'pointerdown', 2, centerX + startDistance / 2, centerY);
  await pointer(target, 'pointermove', 1, centerX - endDistance / 2, centerY);
  await pointer(target, 'pointermove', 2, centerX + endDistance / 2, centerY);
  await pointer(target, 'pointerup', 1, centerX - endDistance / 2, centerY);
  await pointer(target, 'pointerup', 2, centerX + endDistance / 2, centerY);
};

const viewportState = (target) => target.evaluate((element) => ({
  zoom: Number(element.dataset.zoom),
  scrollLeft: element.scrollLeft,
  scrollTop: element.scrollTop,
  scrollWidth: element.scrollWidth,
  scrollHeight: element.scrollHeight,
  clientWidth: element.clientWidth,
  clientHeight: element.clientHeight,
  svgCount: element.querySelectorAll('svg').length,
  stageWidth: Number.parseFloat(element.firstElementChild?.style.width || '0'),
  stageHeight: Number.parseFloat(element.firstElementChild?.style.height || '0'),
}));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const inspectView = async (page, name, viewport) => {
  await page.setViewportSize(viewport);
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  const target = await waitForDiagram(page);
  const box = await target.boundingBox();
  assert(box, `${name}: Mermaid viewport has no bounding box`);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  const initial = await viewportState(target);
  assert(initial.zoom === 1, `${name}: initial zoom was ${initial.zoom}`);
  assert(initial.svgCount === 1, `${name}: expected exactly one SVG`);

  await pinch(target, 80, 240, centerX, centerY);
  const zoomed = await viewportState(target);
  assert(zoomed.zoom > 1.5, `${name}: pinch-out did not zoom, got ${zoomed.zoom}`);
  assert(zoomed.scrollWidth >= initial.scrollWidth, `${name}: zoom did not expand horizontal bounds`);

  const beforePan = await viewportState(target);
  await pointer(target, 'pointerdown', 1, centerX, centerY);
  await pointer(target, 'pointermove', 1, centerX - 70, centerY - 45);
  await pointer(target, 'pointerup', 1, centerX - 70, centerY - 45);
  const afterPan = await viewportState(target);
  assert(
    afterPan.scrollLeft > beforePan.scrollLeft || afterPan.scrollTop > beforePan.scrollTop,
    `${name}: one-finger drag did not pan`,
  );

  await pinch(target, 20, 800, centerX, centerY);
  const maximum = await viewportState(target);
  assert(maximum.zoom === 4, `${name}: maximum zoom was not clamped to 4, got ${maximum.zoom}`);

  await pinch(target, 800, 20, centerX, centerY);
  const minimum = await viewportState(target);
  assert(minimum.zoom === 0.5, `${name}: minimum zoom was not clamped to 0.5, got ${minimum.zoom}`);

  await target.dispatchEvent('dblclick', { clientX: centerX, clientY: centerY });
  const reset = await viewportState(target);
  assert(reset.zoom === 1, `${name}: double-click did not reset zoom, got ${reset.zoom}`);

  const elementId = await target.getAttribute('id');
  const invalid = await page.evaluate(
    ({ id }) => window.voiceBridge.renderMermaid(id, 'flowchart TD\n  broken['),
    { id: elementId },
  );
  assert(JSON.parse(invalid).ok === false, `${name}: invalid Mermaid unexpectedly rendered`);
  assert(await target.textContent() === 'Diagram unavailable', `${name}: invalid diagram fallback was absent`);

  const recovered = await page.evaluate(
    ({ id }) => window.voiceBridge.renderMermaid(
      id,
      'flowchart LR\n  browser[Browser] --> edge[Voice edge]\n  edge --> pi[Pi session]\n  pi --> audio[Spoken response]',
    ),
    { id: elementId },
  );
  assert(JSON.parse(recovered).ok === true, `${name}: valid render did not recover after an error`);
  await target.locator('svg').waitFor({ timeout: 15_000 });
  const rerendered = await viewportState(target);
  assert(rerendered.zoom === 1, `${name}: re-render did not reset zoom`);
  assert(rerendered.svgCount === 1, `${name}: re-render left duplicate SVGs`);

  const screenshot = path.join(outputDir, `mermaid-${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  result.views[name] = { initial, zoomed, afterPan, maximum, minimum, reset, rerendered, screenshot };
};

const main = async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: '/ms-playwright/chromium-1237/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  context = await browser.newContext({ ignoreHTTPSErrors: false });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource:')
    ) {
      result.consoleErrors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (pathname === '/api/pi-context') return;
    result.responseErrors.push(`${response.status()} ${pathname}`);
  });
  page.on('requestfailed', (request) => {
    result.requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });

  await inspectView(page, 'phone', { width: 390, height: 844 });
  await inspectView(page, 'desktop', { width: 1440, height: 1000 });

  result.runtimeResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/voice-runtime/'))
    .map((entry) => ({
      name: new URL(entry.name).pathname,
      decodedBytes: entry.decodedBodySize,
      transferredBytes: entry.transferSize,
    })));
  assert(result.requestFailures.length === 0, `Request failures: ${result.requestFailures.join('; ')}`);
  assert(result.responseErrors.length === 0, `HTTP failures: ${result.responseErrors.join('; ')}`);
  assert(result.consoleErrors.length === 0, `Console errors: ${result.consoleErrors.join('; ')}`);
  result.result = 'PASS';
};

main()
  .catch((error) => {
    result.error = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (context) {
      await context.tracing.stop({ path: result.trace }).catch((error) => {
        result.traceError = error instanceof Error ? error.message : String(error);
      });
    }
    if (browser) await browser.close().catch(() => {});
    fs.writeFileSync(
      path.join(outputDir, 'mermaid-exploratory-result.json'),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(process.exitCode || 0);
  });
