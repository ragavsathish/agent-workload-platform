'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.VOICE_E2E_URL;
const outputDir = process.env.VOICE_E2E_OUTPUT;
if (!baseUrl || !outputDir) throw new Error('VOICE_E2E_URL and VOICE_E2E_OUTPUT are required');
fs.mkdirSync(outputDir, { recursive: true });

const presentations = [
  {
    name: 'mermaid',
    uri: 'ui://mermaid/main',
    framePath: '/mermaid/index.html',
    selector: '.diagram svg',
    labels: ['Browser [voice]', 'Pi "agent"'],
    value: {
      kind: 'flow',
      title: 'Voice path',
      nodes: [
        { id: 'browser', label: 'Browser [voice]' },
        { id: 'pi', label: 'Pi "agent"' },
      ],
      edges: [{ from: 'browser', to: 'pi', label: 'safe | route' }],
    },
  },
  {
    name: 'excalidraw',
    uri: 'ui://excalidraw/mcp-app.html',
    framePath: '/excalidraw/mcp-app.html',
    selector: '.excalidraw-container svg',
    labels: ['Voice', 'Pi'],
    value: {
      kind: 'excalidraw',
      title: 'Voice architecture',
      elements: [
        { type: 'cameraUpdate', x: 0, y: 0, width: 800, height: 600 },
        {
          type: 'rectangle', id: 'voice', x: 80, y: 120, width: 180, height: 80,
          backgroundColor: '#a5d8ff', fillStyle: 'solid', label: { text: 'Voice', fontSize: 20 },
        },
        {
          type: 'arrow', id: 'voice-to-pi', x: 260, y: 160, width: 180, height: 0,
          points: [[0, 0], [180, 0]], endArrowhead: 'arrow',
        },
        {
          type: 'rectangle', id: 'pi', x: 440, y: 120, width: 180, height: 80,
          backgroundColor: '#b2f2bb', fillStyle: 'solid', label: { text: 'Pi', fontSize: 20 },
        },
      ],
    },
  },
  {
    name: 'excalidraw-malformed-camera',
    uri: 'ui://excalidraw/mcp-app.html',
    framePath: '/excalidraw/mcp-app.html',
    selector: '.excalidraw-container svg',
    labels: ['Recovered voice', 'Recovered Pi'],
    value: {
      kind: 'excalidraw',
      title: 'Recovered transcript drawing',
      elements: [
        { type: 'cameraUpdate', x: 0, y: 0, width: 0, height: 0 },
        {
          type: 'rectangle', id: 'recovered-voice', x: 80, y: 120, width: 180, height: 80,
          backgroundColor: '#a5d8ff', fillStyle: 'solid', label: 'Recovered voice',
        },
        {
          type: 'rectangle', id: 'recovered-pi', x: 440, y: 120, width: 180, height: 80,
          backgroundColor: '#b2f2bb', fillStyle: 'solid', label: 'Recovered Pi',
        },
      ],
    },
  },
];

const main = async () => {
  const browserArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
  if (process.env.PLAYWRIGHT_HOST_RESOLVER_RULES) {
    browserArgs.push(`--host-resolver-rules=${process.env.PLAYWRIGHT_HOST_RESOLVER_RULES}`);
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: browserArgs,
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route('**/api/pi-context', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tokens: 0, contextWindow: 272000, percent: 0, estimated: false, canCompact: false,
      }),
    }));
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });

    for (const presentation of presentations) {
      await page.evaluate(() => {
        const previous = document.querySelector('#renderer-smoke-host');
        previous?.remove();
        const host = document.createElement('div');
        host.id = 'renderer-smoke-host';
        Object.assign(host.style, {
          position: 'fixed', inset: '16px', zIndex: '2147483640',
          background: '#0c1216', borderRadius: '16px', overflow: 'hidden',
        });
        document.body.append(host);
      });
      const result = JSON.parse(await page.evaluate(
        ({ value, uri }) => window.voiceBridge.mountMcpApp(
          'renderer-smoke-host', JSON.stringify(value), uri,
        ),
        presentation,
      ));
      if (!result.ok) throw new Error(`${presentation.name} mount failed: ${result.error}`);
      let frame;
      const frameDeadline = Date.now() + 15_000;
      while (!frame && Date.now() < frameDeadline) {
        frame = page.frames().find((candidate) => candidate.url().includes(presentation.framePath));
        if (!frame) await page.waitForTimeout(50);
      }
      if (!frame) throw new Error(`${presentation.name} iframe did not load`);
      const diagram = frame.locator(presentation.selector);
      await diagram.waitFor({ timeout: 15_000 });
      await frame.waitForFunction(
        () => document.getAnimations().every((animation) => animation.playState === 'finished'),
        undefined,
        { timeout: 15_000 },
      );
      const text = await diagram.textContent();
      for (const label of presentation.labels) {
        if (!text?.includes(label)) throw new Error(`${presentation.name} did not render ${label}`);
      }
      await page.screenshot({
        path: path.join(outputDir, `${presentation.name}-mcp-app.png`),
        fullPage: true,
      });
    }
    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
    process.stdout.write('PASS: Mermaid and Excalidraw MCP Apps rendered\n');
  } finally {
    await context.tracing.stop({ path: path.join(outputDir, 'mcp-app-renderers-trace.zip') });
    await context.close();
    await browser.close();
  }
};

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
