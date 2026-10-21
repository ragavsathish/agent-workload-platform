import path from 'node:path';
import { defineConfig } from 'playwright/test';

const outputDir = process.env.VOICE_E2E_OUTPUT || '/tmp/pipecat-playwright';

module.exports = defineConfig({
  testDir: './playwright',
  outputDir: path.join(outputDir, 'test-results'),
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ['line'],
    ['html', { outputFolder: path.join(outputDir, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(outputDir, 'results.json') }],
  ],
  use: {
    baseURL: process.env.VOICE_E2E_URL || 'http://127.0.0.1:8080',
    headless: true,
    ignoreHTTPSErrors: false,
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      executablePath: '/ms-playwright/chromium-1237/chrome-linux/chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'voice',
      testMatch: /voice\.spec\.ts/,
      use: {
        viewport: { width: 1440, height: 1000 },
        permissions: ['microphone'],
        launchOptions: {
          executablePath: '/ms-playwright/chromium-1237/chrome-linux/chrome',
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${process.env.VOICE_E2E_AUDIO || '/fixtures/voice.wav'}`,
          ],
        },
      },
    },
    {
      name: 'diagnostics',
      testMatch: /diagnostics\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'grafana',
      testMatch: /grafana\.spec\.ts/,
      use: {
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'task-diagram',
      testMatch: /task-diagram\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: 'readme-demo',
      testMatch: /readme-demo\.spec\.ts/,
      use: { viewport: { width: 1920, height: 1080 } },
    },
    {
      name: 'ux-profile',
      testMatch: /ux-profile\.spec\.ts/,
      use: {
        baseURL: process.env.UX_PROFILE_URL,
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
