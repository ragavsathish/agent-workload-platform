'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.VOICE_E2E_URL;
const outputDir = process.env.VOICE_E2E_OUTPUT;
if (!baseUrl || !outputDir) throw new Error('VOICE_E2E_URL and VOICE_E2E_OUTPUT are required');
fs.mkdirSync(outputDir, { recursive: true });

const main = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/ms-playwright/chromium-1237/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/?view=transcript`, { waitUntil: 'networkidle', timeout: 60_000 });
    const delayedMount = await page.evaluate(async () => {
      const render = window.voiceBridge.mountMcpApp(
        'delayed-mcp-app-mount',
        JSON.stringify({
          kind: 'flow', title: 'Task result',
          nodes: [{ id: 'task', label: 'Task' }, { id: 'result', label: 'Result' }],
          edges: [{ from: 'task', to: 'result' }],
        }),
        'ui://mermaid/main',
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const target = document.createElement('div');
      target.id = 'delayed-mcp-app-mount';
      target.style.width = '320px';
      target.style.height = '200px';
      document.body.append(target);
      const result = JSON.parse(await render);
      return result;
    });
    if (!delayedMount.ok) throw new Error(`Delayed MCP App mount failed: ${delayedMount.error}`);
    const mermaidFrame = page.frames().find((frame) => frame.url().includes('/mermaid/index.html'));
    if (!mermaidFrame) throw new Error('Mermaid MCP App iframe did not load');
    const diagram = mermaidFrame.locator('.diagram svg');
    await diagram.waitFor({ timeout: 10_000 });
    const diagramText = await diagram.textContent();
    if (!diagramText?.includes('Task') || !diagramText.includes('Result')) {
      throw new Error(`Mermaid labels were not rendered: ${diagramText}`);
    }
    await page.evaluate(() => document.querySelector('#delayed-mcp-app-mount')?.remove());
    const placeholder = page.locator('flt-semantics-placeholder');
    if (await placeholder.count()) await placeholder.evaluate((element) => element.click());
    await page.getByText(/^Tasks \d+$/).click();
    const showDiagrams = page.getByText('Show diagram', { exact: true });
    await showDiagrams.first().waitFor({ timeout: 10_000 });
    const diagramCount = await showDiagrams.count();
    for (let index = 0; index < diagramCount; index += 1) {
      await showDiagrams.first().click();
    }
    await page.waitForTimeout(1_000);
    const unavailable = page.getByText('Visual unavailable', { exact: true });
    const count = await unavailable.count();
    await page.screenshot({ path: path.join(outputDir, 'task-diagram-regression.png'), fullPage: true });
    if (count !== 0) throw new Error(`Found ${count} unavailable task diagram(s)`);
    process.stdout.write('PASS: all expanded task diagrams rendered\n');
  } finally {
    await context.close();
    await browser.close();
  }
};

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
