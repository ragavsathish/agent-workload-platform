'use strict';

const fs = require('node:fs');
const { chromium } = require('playwright');

const url = process.env.UX_PROFILE_URL || 'http://host.docker.internal:8123';
const output = process.env.UX_PROFILE_OUTPUT;
const enforce = process.env.UX_PROFILE_ENFORCE === '1';

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

const metricMap = (metrics) => Object.fromEntries(
  metrics.map(({ name, value }) => [name, value]),
);

const profileViewport = async (browser, name, viewport, query = '') => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
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
  await page.goto(`${url}${query}`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__piUxTelemetry?.summary?.()['app.first_frame']?.samples > 0,
    null,
    { timeout: 30_000 },
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
      longTasks,
      resources,
      ux: window.__piUxTelemetry.summary(),
    };
  });
  const transferredBytes = browserData.resources.reduce(
    (sum, resource) => sum + resource.transferBytes,
    0,
  );
  const decodedBytes = browserData.resources.reduce(
    (sum, resource) => sum + resource.decodedBytes,
    0,
  );
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
    browserData.blockingTimeMs > budgets.blockingTimeMs[name]
      ? `blocking ${browserData.blockingTimeMs.toFixed(1)}ms > ${budgets.blockingTimeMs[name]}ms`
      : null,
    idleTaskMsPerSecond > budgets.idleTaskMsPerSecond
      ? `idle work ${idleTaskMsPerSecond.toFixed(1)}ms/s > ${budgets.idleTaskMsPerSecond}ms/s`
      : null,
  ].filter(Boolean);

  const result = {
    name,
    viewport,
    wallLoadMs: Date.now() - startedAt,
    firstFrameMs,
    networkBodyBytes,
    resourceTimingTransferredBytes: transferredBytes,
    decodedBytes,
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
    host.style.overflow = 'auto';
    document.body.append(host);
    const started = performance.now();
    const response = JSON.parse(await window.voiceBridge.mountMcpApp(
      host.id,
      JSON.stringify({
        kind: 'flow', title: 'Voice path',
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
  if (!result.lazyMcpApp.ok || result.lazyMcpApp.iframeCount !== 1) {
    throw new Error(`${name}: lazy MCP App mount failed`);
  }
  await context.close();
  return result;
};

const main = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/ms-playwright/chromium-1237/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const results = [];
    results.push(await profileViewport(browser, 'phone-wasm', { width: 390, height: 844 }));
    results.push(await profileViewport(
      browser,
      'phone-js-fallback',
      { width: 390, height: 844 },
      '?force_js=1',
    ));
    results.push(await profileViewport(browser, 'desktop-wasm', { width: 1440, height: 1000 }));
    const report = { url, budgets, results };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (output) fs.writeFileSync(output, serialized);
    process.stdout.write(serialized);
    if (enforce && results.some((result) => result.violations.length > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
