import * as allure from 'allure-js-commons';
import { test, expect, expectCleanBrowser } from './fixtures';

const emitMapNodeTap = async (page, nodeId: string) => page.locator('.map-canvas').evaluate((container, id) => {
  // Emit Cytoscape's event at the app integration boundary; don't assert its canvas hit testing.
  const graph = (container as HTMLDivElement & { _cyreg?: { cy?: { getElementById: (id: string) => { empty: () => boolean; emit: (event: string) => void } } } })._cyreg?.cy;
  if (!graph) throw new Error('Knowledge map Cytoscape instance is not mounted');
  const node = graph.getElementById(id);
  if (node.empty()) throw new Error(`Knowledge map is missing node ${id}`);
  node.emit('tap');
}, nodeId);

const firstId = `${'a'.repeat(32)}:entry:1`;
const graphId = `${'a'.repeat(32)}:entry:2`;

const journalFixture = [
  {
    id: firstId, kind: 'decision',
    text: 'Keep durable memory separate from accepted facts until the owner reviews it.',
    createdAt: '2026-10-22T15:42:00Z', sourceId: 'capture-voice-1022',
    sourceLabel: 'Voice session · 22 Oct', transcript: 'Keep durable memory separate until I have reviewed it.',
    topics: ['Knowledge review', 'Privacy'],
  },
  {
    id: graphId, kind: 'idea',
    text: 'A graph view should help me discover connections without hiding the original journal note.',
    createdAt: '2026-10-22T15:35:00Z', sourceId: 'capture-voice-1022',
    sourceLabel: 'Voice session · 22 Oct', transcript: 'A graph could show relationships between notes.',
    topics: ['Knowledge review', 'User experience'],
  },
  {
    id: 'note-linked-views', kind: 'idea',
    text: 'Selecting a topic should keep the journal list, graph, and note details in sync.',
    createdAt: '2026-10-12T10:30:00Z', sourceId: 'capture-voice-1012',
    sourceLabel: 'Voice session · 12 Oct', transcript: 'The topic list and graph and actual notes should stay connected.',
    topics: ['Knowledge review', 'User experience'],
  },
  {
    id: 'note-local-first', kind: 'decision',
    text: 'Keep personal knowledge local and expose only bounded, read-only views to the browser.',
    createdAt: '2026-10-19T09:18:00Z', sourceId: 'capture-voice-1019',
    sourceLabel: 'Voice session · 19 Oct', transcript: 'The digital twin is personal data. It should stay local.',
    topics: ['Digital twin', 'Privacy'],
  },
];

const bind = (value: string) => ({ type: 'literal', value });
const installOxigraphFixture = async (page) => {
  const state = { entries: structuredClone(journalFixture), review: null as null | Record<string, string> };
  await page.route('**/oxigraph/query', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['content-type']).toContain('application/sparql-query');
    expect(request.postData()).toContain('GRAPH <urn:awp:digital-twin:graph:journal>');
    const bindings = state.entries.flatMap((entry) => entry.topics.map((topic) => ({
      id: bind(entry.id), kind: bind(entry.kind), text: bind(entry.text), createdAt: bind(entry.createdAt),
      sourceId: bind(entry.sourceId), sourceLabel: bind(entry.sourceLabel),
      transcript: bind(entry.transcript), topic: bind(topic),
    })));
    await route.fulfill({
      status: 200,
      contentType: 'application/sparql-results+json',
      body: JSON.stringify({ head: { vars: ['id', 'kind', 'text', 'createdAt', 'sourceId', 'sourceLabel', 'transcript', 'topic'] }, results: { bindings } }),
    });
  });
  await page.route('**/api/knowledge/journal/*/assertion-review', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, string>;
      state.review = { ownerAuthored: String(body.ownerAuthored), expectedKind: body.expectedKind, expectedProfileField: body.expectedProfileField, reason: body.reason };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviewId: 'saved' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ review: state.review }) });
    }
  });
  await page.route('**/api/knowledge/journal/*/feedback', async (route) => {
    const body = route.request().postDataJSON() as { action: string; correctedText?: string; correctedType?: string; correctedTopics?: string[] };
    if (body.action === 'delete') state.entries = state.entries.filter(({ id }) => !route.request().url().includes(encodeURIComponent(id)));
    else {
      const entry = state.entries.find(({ id }) => route.request().url().includes(encodeURIComponent(id)));
      if (entry) {
        entry.text = body.correctedText!;
        entry.kind = body.correctedType!;
        entry.topics = body.correctedTopics!;
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ feedbackId: 'saved' }) });
  });
  return state;
};

test('browses, filters, and maps journal notes with synchronized details', async ({ page, browserEvidence }) => {
  await allure.step('Given journal knowledge is loaded from Oxigraph', async () => {
    await installOxigraphFixture(page);
    await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Journal & knowledge' })).toBeVisible();
    await expect(page.getByText('Live Oxigraph', { exact: true })).toBeVisible();
    await expect(page.locator('#date-2026-10-22')).toBeVisible();
    await expect(page.getByRole('button', { name: /Keep durable memory separate/ })).toBeVisible();
  });
  await allure.step('When I filter notes by topic', async () => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('checkbox', { name: /Knowledge review/ }).check();
  });
  await allure.step('Then the active filter and matching notes are visible', async () => {
    await expect(page.getByRole('region', { name: 'Active filters' }))
      .toContainText('Topic: Knowledge review');
    await expect(page.getByRole('heading', { name: 'Knowledge review' })).toBeVisible();
    await expect(page.getByText('3 notes · newest first')).toBeVisible();
  });
  await allure.step('When I clear the filter and select a note', async () => {
    await page.getByRole('button', { name: 'Remove Topic: Knowledge review filter' }).click();
    await expect(page.getByText('4 notes · newest first')).toBeVisible();
    await page.getByRole('button', { name: /Selecting a topic should keep the journal list/ }).click();
  });
  await allure.step('Then the selected note details match the journal', async () => {
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
      .toContainText('Selecting a topic should keep the journal list, graph, and note details in sync.');
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
      .toContainText('Voice session · 12 Oct');
  });
  await allure.step('When I open and navigate the relationship map', async () => {
    await page.getByRole('button', { name: 'Map', exact: false }).click();
    await expect(page.getByRole('region', { name: 'Knowledge relationship map' })).toBeVisible();
    await expect(page.locator('.map-canvas canvas').first()).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in map' }).click();
    await page.getByRole('button', { name: 'Fit map' }).click();
    await page.getByRole('button', { name: /Selecting a topic should keep the journal list/ }).last().click();
  });
  await allure.step('Then the map and journal stay synchronized', async () => {
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
      .toContainText('Selecting a topic should keep the journal list, graph, and note details in sync.');
  });
  await allure.step('When I switch theme and use a phone viewport', async () => {
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await allure.step('Then the knowledge page remains readable without overflow', async () => {
    await expect(page.locator('html')).toHaveAttribute('data-pi-theme', 'light');
    await expect(page.getByRole('heading', { name: 'Journal & knowledge' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
  });
  await allure.step('And the browser reports no unexpected errors', async () => {
    await expectCleanBrowser(browserEvidence);
  });
});

test('combines type and date filters and removes them independently', async ({ page, browserEvidence }) => {
  await allure.step('Given journal knowledge is open', async () => {
    await installOxigraphFixture(page);
    await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
  });
  await allure.step('When I combine type and date filters', async () => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('radio', { name: 'Decision' }).check();
    await page.getByRole('radio', { name: 'Last 7 days' }).check();
  });
  await allure.step('Then only matching notes remain', async () => {
    await expect(page.getByText('2 notes · newest first')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Active filters' }).getByRole('button'))
      .toHaveCount(3);
  });
  await allure.step('When I remove each filter independently', async () => {
    await page.getByRole('button', { name: 'Remove Type: Decision filter' }).click();
    await expect(page.getByText('3 notes · newest first')).toBeVisible();
    await page.getByRole('button', { name: 'Remove Date: Last 7 days filter' }).click();
  });
  await allure.step('Then the full journal list returns', async () => {
    await expect(page.getByText('4 notes · newest first')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Active filters' })).toHaveCount(0);
  });
  await allure.step('And the browser reports no unexpected errors', async () => {
    await expectCleanBrowser(browserEvidence);
  });
});

test('maps Cytoscape node events to journal state', async ({ page, browserEvidence }) => {
  await allure.step('Given the knowledge relationship map is open', async () => {
    await installOxigraphFixture(page);
    await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Map', exact: false }).click();
    await expect(page.locator('.map-canvas canvas').first()).toBeVisible();
  });
  await allure.step('When I select a note node', async () => {
    await emitMapNodeTap(page, graphId);
  });
  await allure.step('Then the original journal note remains visible', async () => {
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
      .toContainText('A graph view should help me discover connections without hiding the original journal note.');
    await expect(page.locator('.knowledge-status')).toContainText('Selected journal note');
  });
  await allure.step('When I select a topic node', async () => {
    await emitMapNodeTap(page, 'topic:Privacy');
  });
  await allure.step('Then the journal filters to that topic', async () => {
    await expect(page.getByRole('button', { name: 'Journal', exact: false })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    await expect(page.getByText('2 notes · newest first')).toBeVisible();
  });
  await allure.step('When I select a capture node', async () => {
    await page.getByRole('button', { name: 'Map', exact: false }).click();
    await expect(page.locator('.map-canvas canvas').first()).toBeVisible();
    await emitMapNodeTap(page, 'capture-voice-1019');
  });
  await allure.step('Then the journal shows the linked capture', async () => {
    await expect(page.getByRole('button', { name: 'Journal', exact: false })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('input[placeholder^="Search notes"]')).toHaveValue('Voice session · 19 Oct');
    await expect(page.getByText('1 note · newest first')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
      .toContainText('Keep personal knowledge local and expose only bounded, read-only views to the browser.');
  });
  await allure.step('And the browser reports no unexpected errors', async () => {
    await expectCleanBrowser(browserEvidence);
  });
});

test('saves a note correction, assertion review, and removal through the owner route', async ({ page, browserEvidence }) => {
  const state = await allure.step('Given an owner journal note is open', async () => {
    const fixture = await installOxigraphFixture(page);
    await page.goto('/knowledge/', { waitUntil: 'networkidle' });
    await expect(page.getByText('Live Oxigraph', { exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
      .toContainText('Keep durable memory separate until I have reviewed it.');
    return fixture;
  });
  const detail = page.getByRole('complementary', { name: 'Selected journal note' });
  const review = page.getByRole('region', { name: 'Review selected note' });
  await allure.step('When I save a corrected note and topics', async () => {
    await review.getByRole('button', { name: 'Correct note' }).click();
    await review.getByRole('textbox', { name: 'Corrected note' }).fill('Memory stays under owner review.');
    await review.getByRole('combobox', { name: 'Note type' }).selectOption('idea');
    await review.getByRole('textbox', { name: /Topic tags/ }).fill('Privacy, Learning');
    await review.getByRole('button', { name: 'Save correction' }).click();
  });
  await allure.step('Then the corrected note appears in details and map', async () => {
    await expect(detail.getByRole('heading', { name: 'Memory stays under owner review.' })).toBeVisible();
    expect(state.entries[0]?.topics).toEqual(['Privacy', 'Learning']);
    await expect(detail).toContainText('Keep durable memory separate until I have reviewed it.');
    await page.getByRole('button', { name: 'Map', exact: false }).click();
    await expect(page.getByRole('button', { name: 'Memory stays under owner review.' })).toBeVisible();
  });

  const assertion = page.getByRole('region', { name: 'Review source assertion' });
  await allure.step('When I reject an unverified source assertion', async () => {
    await assertion.getByRole('button', { name: 'Review source' }).click();
    await expect(assertion.getByRole('button', { name: 'Save review' })).toBeDisabled();
    await assertion.getByRole('radio', { name: 'No' }).check();
    await assertion.getByRole('textbox', { name: 'Review reason' }).fill('This capture is not a verified owner turn.');
    await assertion.getByRole('button', { name: 'Save review' }).click();
  });
  await allure.step('Then the assertion is excluded after reload', async () => {
    await expect(assertion).toContainText('Excluded from owner assertion examples');
    await page.reload();
    await expect(detail.getByRole('heading', { name: 'Memory stays under owner review.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Review source assertion' })).toContainText('Excluded from owner assertion examples');
  });
  await allure.step('When I remove the reviewed note', async () => {
    await review.getByRole('button', { name: 'Remove node' }).click();
    await review.getByRole('button', { name: 'Remove note' }).click();
  });
  await allure.step('Then the note no longer appears in the graph or journal', async () => {
    await expect(page.getByRole('button', { name: 'Memory stays under owner review.' })).toHaveCount(0);
    expect(state.entries.some(({ id }) => id === firstId)).toBe(false);
  });
  await allure.step('And the browser reports no unexpected errors', async () => {
    await expectCleanBrowser(browserEvidence);
  });
});
