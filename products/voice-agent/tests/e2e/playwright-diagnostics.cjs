'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.VOICE_E2E_URL;
const outputDir = process.env.VOICE_E2E_OUTPUT;
if (!baseUrl || !outputDir) throw new Error('VOICE_E2E_URL and VOICE_E2E_OUTPUT are required');
fs.mkdirSync(outputDir, { recursive: true });

const result = {
  result: 'FAIL',
  consoleErrors: [],
  requestFailures: [],
  resources: [],
  systemEvidence: null,
};

const main = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/ms-playwright/chromium-1237/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('blob:')) return;
    result.requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });
  try {
    await page.goto(`${baseUrl}/diagnostics/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('heading', { name: 'Last five conversations' }).waitFor();
    if (await page.locator('flt-glass-pane').count()) throw new Error('Diagnostics loaded Flutter');
    const load = page.getByRole('button', { name: 'Load session diagnostics' }).first();
    await load.waitFor({ timeout: 10_000 });
    await load.click();
    await page.getByRole('button', { name: 'Play Raw microphone' }).waitFor({ timeout: 30_000 });
    await page.getByText('Input and output energy · dBFS', { exact: true }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(outputDir, 'diagnostics-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(outputDir, 'diagnostics-desktop.png'), fullPage: true });
    result.resources = await page.evaluate(() => performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname));
    if (result.resources.some((resource) => resource.endsWith('/main.dart.js'))) {
      throw new Error('Diagnostics downloaded the Flutter runtime');
    }

    const systemPage = await context.newPage();
    systemPage.on('console', (message) => {
      if (message.type() === 'error') result.consoleErrors.push(message.text());
    });
    systemPage.on('requestfailed', (request) => {
      result.requestFailures.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText}`,
      );
    });
    await systemPage.goto(`${baseUrl}/metrics/d/voice-c4-heatmap/c4-operational-heat-map`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await systemPage.getByText('C4 Operational Heat Map', { exact: true }).first().waitFor({ timeout: 30_000 });
    const dashboard = await systemPage.evaluate(async () => {
      const response = await fetch('/metrics/api/dashboards/uid/voice-c4-heatmap');
      if (!response.ok) throw new Error(`Grafana dashboard API returned ${response.status}`);
      return response.json();
    });
    const diagramPanels = dashboard.dashboard.panels.filter(
      (panel) => panel.type === 'neildengg-grafmaid-panel',
    );
    if (diagramPanels.length !== 15) {
      throw new Error(`Expected 15 Grafana C4 panels, found ${diagramPanels.length}`);
    }
    if (!dashboard.dashboard.panels.some((panel) => panel.title === 'Source-backed code evidence')) {
      throw new Error('Grafana is missing the source-backed engineering evidence panel');
    }
    await systemPage.setViewportSize({ width: 1440, height: 1000 });
    await systemPage.waitForTimeout(5_000);
    const bodyText = await systemPage.locator('body').innerText();
    if (/panel plugin not found|failed to load plugin|unexpected error/i.test(bodyText)) {
      throw new Error('Grafana failed to render the C4 dashboard');
    }
    await systemPage.screenshot({
      path: path.join(outputDir, 'grafana-c4-system-evidence.png'),
      fullPage: true,
    });
    result.systemEvidence = {
      dashboard: dashboard.dashboard.title,
      diagramPanels: diagramPanels.length,
      evidencePanel: true,
      livePromql: diagramPanels.some((panel) => panel.targets.length > 0),
    };
    await systemPage.close();
    if (result.requestFailures.length) throw new Error(result.requestFailures.join('; '));
    if (result.consoleErrors.length) throw new Error(result.consoleErrors.join('; '));
    result.result = 'PASS';
  } finally {
    await context.close();
    await browser.close();
  }
};

main()
  .catch((error) => {
    result.error = error.stack || String(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(outputDir, 'diagnostics-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
