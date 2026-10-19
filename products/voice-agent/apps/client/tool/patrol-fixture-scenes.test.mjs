import assert from 'node:assert/strict';
import { test } from 'node:test';

import { completedTurnResponse, createInitialFixtureState, beginTurn, completeTurn } from './patrol-fixture-domain.mjs';
import { fixtureSceneNames, responseForFixtureMessage } from './patrol-fixture-scenes.mjs';
import { staticPath } from './patrol-fixture-static.mjs';

test('each local MCP App can be selected by a typed voice-fixture turn', () => {
  const expected = new Map([
    ['Show a Mermaid diagram', 'flow'],
    ['Show Marp slides', 'slides'],
    ['Show editable Excalidraw', 'excalidraw'],
    ['Show the Playwright trace', 'playwright-trace-viewer'],
    ['Review the journal annotation', 'journal-review'],
  ]);
  assert.deepEqual(fixtureSceneNames(), ['mermaid', 'slides', 'excalidraw', 'trace', 'journal']);
  for (const [prompt, kind] of expected) {
    const response = responseForFixtureMessage(prompt);
    assert.equal(response.presentation.kind, kind);
    assert.ok(response.spoken.length > 15);
    assert.deepEqual(completedTurnResponse(prompt), response);
    const started = beginTurn(createInitialFixtureState(), prompt, { now: () => 1 });
    assert.equal(started.type, 'Ok');
    const completed = completeTurn(started.state, started.value.id);
    const latest = completed.entries.at(-1);
    assert.equal(JSON.parse(latest.text).presentation.kind, kind);
  }
});

test('static files stay within the built Flutter web root', () => {
  const root = '/tmp/voice-client-build';
  assert.equal(staticPath(root, '/'), `${root}/index.html`);
  assert.equal(staticPath(root, '/marp/marp.html'), `${root}/marp/marp.html`);
  assert.equal(staticPath(root, '/../private'), null);
  assert.equal(staticPath(root, '/%2e%2e/private'), null);
  assert.equal(staticPath(root, '/bad%00name'), null);
});

test('trace scene emits bounded same-origin artifact links', () => {
  const trace = responseForFixtureMessage('show trace', 'http://localhost:5000');
  const viewer = new URL(trace.presentation.viewerUrl);
  assert.equal(viewer.origin, 'http://localhost:5000');
  assert.equal(new URL(viewer.searchParams.get('trace')).origin, viewer.origin);
  assert.equal(new URL(trace.presentation.narratedVideoUrl).origin, viewer.origin);
  const rejected = responseForFixtureMessage('show trace', 'https://example.com');
  assert.equal(new URL(rejected.presentation.viewerUrl).origin, 'http://127.0.0.1:8766');
});
