import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(resolve(process.cwd(), 'node_modules/playwright/index.mjs')).href);
const base = process.env.PROFILE_BASE_URL || 'http://127.0.0.1:8765';
const output = resolve('build/flutter-ux-profile');
const routes = [
  { name: 'voice-home', path: '/' },
  { name: 'transcript', path: '/?view=transcript' },
  { name: 'journal-review', path: '/?view=journal-review-preview' },
];
const fixtures = (url) => {
  const path = new URL(url).pathname;
  if (path.endsWith('/pi-sessions')) return { sessions: [] };
  if (path.endsWith('/pi-transcript')) return { revision: 0, entries: [] };
  if (path.endsWith('/tasks')) return [];
  if (path.includes('/tasks/')) return [];
  if (path.endsWith('/pi-context')) return {};
  return {};
};
const results = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'phone', width: 390, height: 844 }]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        recordVideo: { dir: output, size: { width: viewport.width, height: viewport.height } },
        colorScheme: theme,
      });
      await context.addInitScript((value) => {
        if (window !== window.top) return;
        try { localStorage.setItem('pi-voice-theme', value); } catch (_) {}
        window.__longTasks = [];
        try {
          new PerformanceObserver((entries) => window.__longTasks.push(...entries.getEntries().map((entry) => Math.round(entry.duration))))
            .observe({ type: 'longtask', buffered: true });
        } catch (_) {}
        window.__shellSamples = [];
        const sample = () => {
          const root = document.documentElement;
          window.__shellSamples.push({
            at: Math.round(performance.now()),
            theme: root.dataset.piTheme ?? null,
            background: getComputedStyle(document.body).backgroundColor,
          });
          if (window.__shellSamples.length < 8) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, theme);
      const page = await context.newPage();
      await page.route('**/api/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtures(route.request().url())) });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 240)); });
      for (const route of routes) {
        const start = performance.now();
        const response = await page.goto(`${base}${route.path}`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.locator('flutter-view').waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForTimeout(900);
        const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
        const data = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const paints = Object.fromEntries(performance.getEntriesByType('paint').map(({ name, startTime }) => [name, Math.round(startTime)]));
          const pane = document.querySelector('flt-glass-pane');
          const canvas = document.querySelector('canvas');
          return {
            title: document.title,
            view: new URL(location.href).searchParams.get('view') || 'voice-home',
            theme: document.documentElement.dataset.piTheme || 'system',
            htmlBg: getComputedStyle(document.documentElement).backgroundColor,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            paneBg: pane ? getComputedStyle(pane).backgroundColor : null,
            canvasCount: document.querySelectorAll('canvas').length,
            canvasBg: canvas ? getComputedStyle(canvas).backgroundColor : null,
            flutterViewportHeight: Number.parseFloat(
              document.querySelector('flutter-view')?.style.height ?? 'NaN',
            ),
            visualViewportHeight: Math.round(window.visualViewport?.height ?? innerHeight),
            navMs: Math.round(nav?.duration ?? 0),
            domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd ?? 0),
            paints,
            shellSamples: window.__shellSamples,
            longTasksMs: window.__longTasks,
            ux: window.__piUxTelemetry?.summary?.() ?? null,
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          };
        });
        const safeName = `${theme}-${viewport.name}-${route.name}`;
        await page.screenshot({ path: resolve(output, `${safeName}.png`) });
        results.push({ theme, viewport: viewport.name, route: route.name, httpStatus: response?.status(), elapsedMs: Math.round(performance.now() - start), metrics, ...data, consoleErrors: [...errors] });
        console.log(JSON.stringify(results.at(-1)));
      }
      const video = page.video();
      await context.close();
      if (video) {
        await video.saveAs(resolve(output, `${theme}-${viewport.name}.webm`));
        await video.delete();
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(resolve(output, 'profile.json'), `${JSON.stringify({ base, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
const report = [
  '# Flutter web Chrome UX profile',
  '',
  `Production build served at ${base}. Captured ${new Date().toISOString()}.`,
  'API responses were fixtures; no live session data was loaded. Routes: voice home, transcript, and embedded journal review preview.',
  '',
  '| Theme | Viewport | Screen | FCP | Flutter first frame | View height (Flutter / visible) | Navigation | Shell background stable | Console errors |',
  '|---|---|---|---:|---:|---:|---:|---|---:|',
  ...results.map((result) => {
    const { width, height } = result.viewport;
    const viewport = width > 600 ? 'desktop' : 'phone';
    const backgroundStable = result.shellSamples.every((sample) => sample.background === result.bodyBg);
    const firstFrame = result.ux?.['app.first_frame']?.p50Ms;
    return `| ${result.theme} | ${viewport} ${width}×${height} | ${result.route} | ${result.paints['first-contentful-paint']} ms | ${firstFrame ?? 'n/a'} ms | ${result.flutterViewportHeight} / ${result.visualViewportHeight} px | ${result.navMs} ms | ${backgroundStable ? result.bodyBg : 'MISMATCH'} | ${result.consoleErrors.length} |`;
  }),
  '',
  '## Notes',
  '',
  '- First visit per theme and viewport includes Flutter startup; later visits reuse the browser context and WebAssembly runtime.',
  '- A long task is a main-thread task over 50 ms. See `profile.json` for per-route observations and raw Chrome metrics.',
  '- This covers Flutter routes and the embedded MCP preview. Separate React/Grafana pages linked from the app are not Flutter screens.',
  '',
  '## Method',
  '',
  '- Chromium via Playwright against the production Flutter WebAssembly build.',
  '- Viewports: desktop 1440×1000 and phone 390×844 at DPR 1.',
  '- Themes: saved light and dark preference; local fixtures return empty sessions, transcripts, and tasks.',
  '- Metrics: Navigation Timing, Paint Timing/FCP, CDP Performance metrics, app `app.first_frame` telemetry, first eight shell animation frames, long tasks, and console errors.',
  '',
];
await writeFile(resolve(output, 'report.md'), report.join('\n'));
