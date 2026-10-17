import * as fs from 'node:fs';
import { test, expect, expectCleanBrowser } from './fixtures';

const output = process.env.UX_PROFILE_OUTPUT;
const enforce = process.env.UX_PROFILE_ENFORCE === '1';
const results = [];
const budgets = {
  firstFrameMs: 1500,
  networkBodyBytes: 8 * 1024 * 1024,
  blockingTimeMs: {
    'phone-wasm': 700,
    'phone-js-fallback': 800,
    'desktop-wasm': 600,
  },
  idleTaskMsPerSecond: 20,
};
const profiles = [
  { name: 'phone-wasm', viewport: { width: 390, height: 844 }, query: '' },
  { name: 'phone-js-fallback', viewport: { width: 390, height: 844 }, query: '?force_js=1' },
  { name: 'desktop-wasm', viewport: { width: 1440, height: 1000 }, query: '' },
];

const metricMap = (metrics) => Object.fromEntries(
  metrics.map(({ name, value }) => [name, value]),
);

test.afterAll(() => {
  if (!output) return;
  fs.writeFileSync(output, `${JSON.stringify({
    url: process.env.UX_PROFILE_URL,
    budgets,
    results,
  }, null, 2)}\n`);
});

for (const profile of profiles) {
  test(`profiles ${profile.name}`, async ({ page, context, browserEvidence }, testInfo) => {
    await page.setViewportSize(profile.viewport);
    const networkResponses = [];
    page.on('response', (response) => {
      const contentLength = Number(response.headers()['content-length']);
      if (!Number.isFinite(contentLength) || contentLength < 0) return;
      networkResponses.push({
        name: new URL(response.url()).pathname,
        bytes: contentLength,
        resourceType: response.request().resourceType(),
      });
    });
    await page.addInitScript(() => {
      window.__uxProfile = { longTasks: [], layoutShifts: [], lcp: [] };
      new PerformanceObserver((list) => {
        window.__uxProfile.longTasks.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })));
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => {
        window.__uxProfile.layoutShifts.push(...list.getEntries()
          .filter((entry) => !entry.hadRecentInput)
          .map((entry) => entry.value));
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        window.__uxProfile.lcp.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          size: entry.size,
        })));
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const startedAt = Date.now();
    await page.goto(`/${profile.query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => window.__piUxTelemetry?.summary?.()['app.first_frame']?.samples > 0,
    );
    await page.waitForTimeout(1000);

    const beforeIdle = metricMap((await cdp.send('Performance.getMetrics')).metrics);
    await page.waitForTimeout(5000);
    const afterIdle = metricMap((await cdp.send('Performance.getMetrics')).metrics);
    const browserData = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource').map((entry) => ({
        name: new URL(entry.name).pathname,
        durationMs: entry.duration,
        transferBytes: entry.transferSize,
        decodedBytes: entry.decodedBodySize,
        initiator: entry.initiatorType,
      }));
      const longTasks = window.__uxProfile.longTasks;
      return {
        navigation: {
          domContentLoadedMs: navigation.domContentLoadedEventEnd,
          loadMs: navigation.loadEventEnd,
          responseMs: navigation.responseEnd,
        },
        paints: Object.fromEntries(
          performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]),
        ),
        lcpMs: window.__uxProfile.lcp.at(-1)?.startTime ?? null,
        cls: window.__uxProfile.layoutShifts.reduce((sum, value) => sum + value, 0),
        blockingTimeMs: longTasks.reduce(
          (sum, task) => sum + Math.max(0, task.duration - 50),
          0,
        ),
        resources,
        ux: window.__piUxTelemetry.summary(),
      };
    });
    const firstFrameMs = browserData.ux['app.first_frame']?.p50Ms ?? null;
    const networkBodyBytes = networkResponses.reduce(
      (sum, response) => sum + response.bytes,
      0,
    );
    const idleTaskMsPerSecond = (
      (afterIdle.TaskDuration - beforeIdle.TaskDuration) * 1000 / 5
    );
    const violations = [
      firstFrameMs > budgets.firstFrameMs
        ? `first frame ${firstFrameMs.toFixed(1)}ms > ${budgets.firstFrameMs}ms`
        : null,
      networkBodyBytes > budgets.networkBodyBytes
        ? `network body ${networkBodyBytes}B > ${budgets.networkBodyBytes}B`
        : null,
      browserData.blockingTimeMs > budgets.blockingTimeMs[profile.name]
        ? `blocking ${browserData.blockingTimeMs.toFixed(1)}ms > ${budgets.blockingTimeMs[profile.name]}ms`
        : null,
      idleTaskMsPerSecond > budgets.idleTaskMsPerSecond
        ? `idle work ${idleTaskMsPerSecond.toFixed(1)}ms/s > ${budgets.idleTaskMsPerSecond}ms/s`
        : null,
    ].filter(Boolean);

    const result = {
      name: profile.name,
      viewport: profile.viewport,
      wallLoadMs: Date.now() - startedAt,
      firstFrameMs,
      networkBodyBytes,
      resourceTimingTransferredBytes: browserData.resources.reduce(
        (sum, resource) => sum + resource.transferBytes,
        0,
      ),
      decodedBytes: browserData.resources.reduce(
        (sum, resource) => sum + resource.decodedBytes,
        0,
      ),
      blockingTimeMs: browserData.blockingTimeMs,
      idleTaskMsPerSecond,
      scriptDurationMs: afterIdle.ScriptDuration * 1000,
      taskDurationMs: afterIdle.TaskDuration * 1000,
      jsHeapUsedBytes: afterIdle.JSHeapUsedSize,
      nodes: afterIdle.Nodes,
      layoutCount: afterIdle.LayoutCount,
      recalcStyleCount: afterIdle.RecalcStyleCount,
      navigation: browserData.navigation,
      paints: browserData.paints,
      lcpMs: browserData.lcpMs,
      cls: browserData.cls,
      mcpAppRender: browserData.ux['mcp_app.render'] || null,
      topResources: browserData.resources
        .sort((left, right) => right.transferBytes - left.transferBytes)
        .slice(0, 12),
      topNetworkResponses: networkResponses
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, 12),
      violations,
    };
    result.lazyMcpApp = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = `profile-mcp-app-${Date.now()}`;
      host.style.width = '640px';
      host.style.height = '420px';
      document.body.append(host);
      const started = performance.now();
      const response = JSON.parse(await window.voiceBridge.mountMcpApp(
        host.id,
        JSON.stringify({
          kind: 'flow',
          title: 'Voice path',
          nodes: [
            { id: 'browser', label: 'Browser' },
            { id: 'voice', label: 'Voice agent' },
            { id: 'pi', label: 'Pi' },
          ],
          edges: [
            { from: 'browser', to: 'voice' },
            { from: 'voice', to: 'pi' },
          ],
        }),
        'ui://mermaid/main',
      ));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const probe = {
        ok: response.ok === true,
        renderMs: performance.now() - started,
        iframeCount: host.querySelectorAll('iframe').length,
      };
      host.remove();
      return probe;
    });
    expect(result.lazyMcpApp).toMatchObject({ ok: true, iframeCount: 1 });
    expectCleanBrowser(browserEvidence);
    results.push(result);
    await testInfo.attach('ux-profile', {
      body: Buffer.from(`${JSON.stringify(result, null, 2)}\n`),
      contentType: 'application/json',
    });
    if (enforce) expect(violations).toEqual([]);
  });
}
