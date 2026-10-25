import * as allure from 'allure-js-commons';
import { test, expect, expectCleanBrowser } from './fixtures';

const entryId = process.env.KNOWLEDGE_E2E_ENTRY_ID;
if (!entryId || !/^[a-f0-9]{32}:entry:1$/.test(entryId)) {
  throw new Error('KNOWLEDGE_E2E_ENTRY_ID must name the test-owned journal entry');
}
const noteButton = `Review test-owned note ${entryId.slice(0, 8)}.`;

test('corrects one test-owned journal entry through the deployed knowledge browser', async ({
  page, browserEvidence,
}, testInfo) => {
  await allure.step('Given the deployed browser shows the isolated source turn', async () => {
    await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Live Oxigraph', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(noteButton) })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(noteButton) }).click();
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
      .toContainText('Original owner turn');
  });

  await allure.step('When I correct its note and type through the owner route', async () => {
    const review = page.getByRole('region', { name: 'Review selected note' });
    await review.getByRole('button', { name: 'Correct note' }).click();
    await review.getByRole('textbox', { name: 'Corrected note' })
      .fill('Use reviewed source turns for learning.');
    await review.getByRole('combobox', { name: 'Note type' }).selectOption('learning');
    await review.getByRole('textbox', { name: /Topic tags/ }).fill('Learning, Evidence');
    const [saved] = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/knowledge/journal/')
        && response.url().endsWith('/feedback') && response.request().method() === 'POST'),
      review.getByRole('button', { name: 'Save correction' }).click(),
    ]);
    expect(saved.status()).toBe(200);
  });

  await allure.step('Then the deployed graph retains the correction after reload', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Use reviewed source turns for learning\./ }).click();
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }).getByRole('heading', {
      name: 'Use reviewed source turns for learning.',
    })).toBeVisible();
    const sparql = `PREFIX schema: <https://schema.org/>
      SELECT ?kind ?text WHERE { GRAPH <urn:awp:digital-twin:graph:journal> {
        <urn:awp:digital-twin:journal:${entryId}> schema:additionalType ?kind ; schema:text ?text .
      } }`;
    const result = await page.request.post('/oxigraph/query', {
      data: sparql, headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    });
    expect(result.ok()).toBeTruthy();
    const rows = (await result.json()).results.bindings;
    expect(rows.map((row: { kind: { value: string }, text: { value: string } }) =>
      ({ kind: row.kind.value, text: row.text.value })))
      .toEqual([{ kind: 'learning', text: 'Use reviewed source turns for learning.' }]);
    await testInfo.attach('deployed-knowledge-review', {
      body: Buffer.from(`${JSON.stringify({ entryId, rows }, null, 2)}\n`), contentType: 'application/json',
    });
  });

  await allure.step('And the browser reports no unexpected errors', async () => {
    await expectCleanBrowser(browserEvidence);
  });
});
