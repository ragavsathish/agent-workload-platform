import * as allure from 'allure-js-commons';
import type { Page } from 'playwright/test';
import { expect } from './fixtures';

export async function openDiagnostics(page: Page) {
  await allure.step('Given the diagnostics page is open', async () => {
    await page.goto('/diagnostics/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
    await expect(page.locator('flt-glass-pane')).toHaveCount(0);
  });
}

export async function loadRecentReplay(page: Page, sessionId?: string) {
  await allure.step('When I load a recent conversation', async () => {
    const card = sessionId ? page.locator(`[data-session-id="${sessionId}"]`) : page.locator('[data-session-id]').first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Load session diagnostics' }).click();
  });
  await allure.step('Then replay and input energy are available', async () => {
    await expect(page.getByRole('button', { name: 'Play Raw microphone' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Input and output energy · dBFS', { exact: true })).toBeVisible();
  });
}
