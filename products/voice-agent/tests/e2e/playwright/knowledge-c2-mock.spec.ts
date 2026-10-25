import * as allure from 'allure-js-commons';
import { test, expect, expectCleanBrowser } from './fixtures';
import { captureResponsiveLayout, responsiveViewports } from './responsive-layout';

const entryId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:entry:1';
const note = `[data-entry-id="${entryId}"]`;

test('reviewed journal entry stays linked across the C2 mock boundaries', async ({
  page, browserEvidence,
}, testInfo) => {
  await allure.step('Given the journal browser loads entries from the C2 Oxigraph mock', async () => {
    await expect.poll(async () => (await page.request.get('/health')).status()).toBe(200);
    await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Live Oxigraph', { exact: true })).toBeVisible();
    await expect(page.locator(`[role="listitem"]${note}`)).toBeVisible();
    await page.locator(`[role="listitem"]${note}`).getByRole('button').click();
    await expect(page.locator(`aside${note}`)).toContainText('Review the source turn');
  });

  await allure.step('When I correct that exact entry through the owner review form', async () => {
    const review = page.getByRole('region', { name: 'Review selected note' });
    await review.getByRole('button', { name: 'Correct note' }).click();
    await review.getByRole('textbox', { name: 'Corrected note' })
      .fill('Use reviewed source turns for learning.');
    await review.getByRole('combobox', { name: 'Note type' }).selectOption('learning');
    await review.getByRole('textbox', { name: /Topic tags/ }).fill('Learning, Evidence');
    await review.getByRole('button', { name: 'Save correction' }).click();
  });

  await allure.step('Then the corrected entry survives a fresh browser load', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(`[role="listitem"]${note}`).getByRole('button').click();
    await expect(page.locator(`aside${note}`).getByRole('heading', {
      name: 'Use reviewed source turns for learning.',
    })).toBeVisible();
    const evidence = await (await page.request.get('/__fixture/c2/evidence')).json();
    const saved = evidence.entries.find((entry: { id: string }) => entry.id === entryId);
    expect(saved).toMatchObject({
      id: entryId, kind: 'learning', text: 'Use reviewed source turns for learning.',
      topics: ['Learning', 'Evidence'],
    });
    expect(evidence.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ containerId: 'OXIGRAPH', status: 200 }),
      expect.objectContaining({ containerId: 'EDGE', entryId, status: 200 }),
    ]));
    await testInfo.attach('c2-journal-evidence', {
      body: Buffer.from(`${JSON.stringify({ entryId, saved, events: evidence.events }, null, 2)}\n`),
      contentType: 'application/json',
    });
  });

  await allure.step('And the browser reports no unexpected errors', async () => {
    await expectCleanBrowser(browserEvidence);
  });
});

test('journal and graph stay usable across mobile, tablet, and desktop', async ({ page, browserEvidence }, testInfo) => {
  for (const viewport of responsiveViewports) {
    await allure.step(`Given the journal opens at ${viewport.name} resolution`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.local-state')).toHaveText('Live Oxigraph');
      await expect(page.getByRole('region', { name: 'Journal controls' })).toBeVisible();
      await page.locator(`[role="listitem"]${note}`).getByRole('button').click();
      await expect(page.locator(`aside${note}`)).toBeVisible();
      await captureResponsiveLayout(page, testInfo, 'journal', viewport);
    });
    await allure.step(`When I switch to the knowledge map at ${viewport.name} resolution`, async () => {
      await page.getByRole('group', { name: 'Knowledge view' })
        .getByRole('button', { name: 'Map' }).click();
      await expect(page.locator('.knowledge-graph.map-panel')).toBeVisible();
      await expect(page.locator('.map-canvas canvas').first()).toBeVisible();
      await captureResponsiveLayout(page, testInfo, 'knowledge-map', viewport);
    });
  }
  await allure.step('Then the browser reports no unexpected errors', async () => {
    expectCleanBrowser(browserEvidence);
  });
});
