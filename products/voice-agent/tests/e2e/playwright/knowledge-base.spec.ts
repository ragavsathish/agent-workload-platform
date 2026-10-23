import { test, expect, expectCleanBrowser } from './fixtures';

const emitMapNodeTap = async (page, nodeId: string) => page.locator('.map-canvas').evaluate((container, id) => {
  // Emit Cytoscape's event at the app integration boundary; don't assert its canvas hit testing.
  const graph = (container as HTMLDivElement & { _cyreg?: { cy?: { getElementById: (id: string) => { empty: () => boolean; emit: (event: string) => void } } } })._cyreg?.cy;
  if (!graph) throw new Error('Knowledge map Cytoscape instance is not mounted');
  const node = graph.getElementById(id);
  if (node.empty()) throw new Error(`Knowledge map is missing node ${id}`);
  node.emit('tap');
}, nodeId);

const journalFixture = [
  {
    id: 'note-memory-boundaries', kind: 'decision',
    text: 'Keep durable memory separate from accepted facts until the owner reviews it.',
    createdAt: '2026-10-22T15:42:00Z', sourceId: 'capture-voice-1022',
    sourceLabel: 'Voice session · 22 Oct', transcript: 'Keep durable memory separate until I have reviewed it.',
    topics: ['Knowledge review', 'Privacy'],
  },
  {
    id: 'note-graph-view', kind: 'idea',
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
  await page.route('**/oxigraph/query', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['content-type']).toContain('application/sparql-query');
    expect(request.postData()).toContain('GRAPH <urn:awp:digital-twin:graph:journal>');
    const bindings = journalFixture.flatMap((entry) => entry.topics.map((topic) => ({
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
};

test('browses, filters, and maps journal notes with synchronized details', async ({ page, browserEvidence }) => {
  await installOxigraphFixture(page);
  await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Journal & knowledge' })).toBeVisible();
  await expect(page.getByText('Live Oxigraph', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Keep durable memory separate/ })).toBeVisible();

  await page.getByRole('button', { name: /Knowledge review/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Knowledge review' })).toBeVisible();
  await expect(page.getByText('3 entries · newest first')).toBeVisible();

  await page.getByRole('button', { name: /Selecting a topic should keep the journal list/ }).click();
  await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
    .toContainText('Selecting a topic should keep the journal list, graph, and note details in sync.');
  await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
    .toContainText('Voice session · 12 Oct');

  await page.getByRole('button', { name: 'Map', exact: false }).click();
  await expect(page.getByRole('region', { name: 'Knowledge relationship map' })).toBeVisible();
  await expect(page.locator('.map-canvas canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in map' }).click();
  await page.getByRole('button', { name: 'Fit map' }).click();
  await page.getByRole('button', { name: /Selecting a topic should keep the journal list/ }).last().click();
  await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
    .toContainText('Selecting a topic should keep the journal list, graph, and note details in sync.');

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-pi-theme', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Journal & knowledge' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await expectCleanBrowser(browserEvidence);
});

test('maps Cytoscape node events to journal state', async ({ page, browserEvidence }) => {
  await installOxigraphFixture(page);
  await page.goto('/knowledge/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Map', exact: false }).click();
  await expect(page.locator('.map-canvas canvas').first()).toBeVisible();

  await emitMapNodeTap(page, 'note-graph-view');
  await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
    .toContainText('A graph view should help me discover connections without hiding the original journal note.');
  await expect(page.locator('.knowledge-status')).toContainText('Selected journal note');

  await emitMapNodeTap(page, 'topic:Privacy');
  await expect(page.getByRole('button', { name: 'Journal', exact: false })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByText('2 entries · newest first')).toBeVisible();

  await page.getByRole('button', { name: 'Map', exact: false }).click();
  await expect(page.locator('.map-canvas canvas').first()).toBeVisible();
  await emitMapNodeTap(page, 'capture-voice-1019');
  await expect(page.getByRole('button', { name: 'Journal', exact: false })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('input[placeholder^="Search notes"]')).toHaveValue('Voice session · 19 Oct');
  await expect(page.getByText('1 entries · newest first')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Selected journal note' }))
    .toContainText('Keep personal knowledge local and expose only bounded, read-only views to the browser.');
  await expectCleanBrowser(browserEvidence);
});
