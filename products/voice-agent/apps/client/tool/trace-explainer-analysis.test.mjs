import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyNarrationBrief,
  applyNarrationPlan,
  assertSafeOutputDirectory,
  buildTraceScenes,
} from './trace-explainer-analysis.mjs';

test('accepts a render below the configured output root and rejects siblings', () => {
  const root = '/tmp/playwright-trace-renders';
  assert.doesNotThrow(() => assertSafeOutputDirectory(join(root, 'render-1'), [root]));
  assert.throws(
    () => assertSafeOutputDirectory('/tmp/playwright-trace-renders-other/render-1', [root]),
    /approved output root/u,
  );
});

test('desktop-only traces never invent a phone viewport or a failed result', () => {
  const frames = [
    { width: 1440, height: 1000, timestamp: 100, pageId: 'page@1', sha1: 'first.jpeg' },
    { width: 1440, height: 1000, timestamp: 2100, pageId: 'page@1', sha1: 'last.jpeg' },
  ];
  const scenes = buildTraceScenes({
    pageId: 'page@1',
    pageFrames: frames,
    calls: [{ callId: 'call@1' }],
    actionErrors: [],
    sourceDuration: 2,
    framePath: (frame) => `resources/${frame.sha1}`,
  });
  const narration = scenes.map(({ spoken }) => spoken).join(' ');
  assert.doesNotMatch(narration, /phone|mobile|failed|did not report success/iu);
  assert.match(narration, /no recorded Playwright action errors/iu);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[1].id, 'desktop');
});

test('responsive traces describe only viewports that were actually captured', () => {
  const frames = [
    { width: 390, height: 844, timestamp: 100, pageId: 'page@1', sha1: 'mobile.jpeg' },
    { width: 1280, height: 720, timestamp: 2100, pageId: 'page@1', sha1: 'desktop.jpeg' },
  ];
  const scenes = buildTraceScenes({
    pageId: 'page@1',
    pageFrames: frames,
    calls: [],
    actionErrors: [{ callId: 'call@9', error: 'boom' }],
    sourceDuration: 2,
    framePath: (frame) => `resources/${frame.sha1}`,
  });
  assert.deepEqual(scenes.map(({ id }) => id), ['summary', 'mobile', 'desktop']);
  assert.match(scenes[1].spoken, /390 by 844/iu);
  assert.match(scenes[2].spoken, /1280 by 720/iu);
  assert.match(scenes[0].spoken, /1 recorded Playwright action error/iu);
});

test('explains user-visible behavior and drops protocol noise', () => {
  const frames = [
    { width: 1440, height: 1000, timestamp: 100, pageId: 'page@1', sha1: 'start.jpeg' },
    { width: 1440, height: 1000, timestamp: 500, pageId: 'page@1', sha1: 'repo.jpeg' },
    { width: 1440, height: 1000, timestamp: 900, pageId: 'page@1', sha1: 'commits.jpeg' },
  ];
  const calls = [
    {
      callId: 'call@1', class: 'Frame', method: 'goto', startTime: 200, pageId: 'page@1',
      params: { url: 'https://gitea.example/owner/project' },
    },
    {
      callId: 'call@2', class: 'Route', method: 'continue', startTime: 300, pageId: 'page@1',
      params: { url: 'https://gitea.example/private-token' },
    },
    {
      callId: 'call@3', class: 'Frame', method: 'click', startTime: 600, pageId: 'page@1',
      params: { selector: 'internal:role=link[name=/39 Commits/i] >> nth=0' },
    },
    {
      callId: 'call@4', class: 'Frame', method: 'waitForSelector', startTime: 700, pageId: 'page@1',
      params: { selector: 'internal:text=/Commits/i >> nth=0' },
    },
    {
      callId: 'call@5', class: 'Frame', method: 'fill', startTime: 800, pageId: 'page@1',
      params: { selector: 'internal:label="Search"i', value: 'secret query' },
    },
  ];

  const scenes = buildTraceScenes({
    pageId: 'page@1',
    pageFrames: frames,
    calls,
    actionErrors: [],
    sourceDuration: 0.8,
    framePath: (frame) => `resources/${frame.sha1}`,
  });
  const actionScenes = scenes.filter(({ id }) => id.startsWith('action-'));
  const narration = actionScenes.map(({ spoken }) => spoken).join(' ');

  assert.deepEqual(actionScenes.map(({ id }) => id), [
    'action-call-1',
    'action-call-3',
    'action-call-5',
  ]);
  assert.deepEqual(actionScenes.map(({ evidence }) => evidence.eventIds), [
    ['call@1'],
    ['call@3', 'call@4'],
    ['call@5'],
  ]);
  assert.match(narration, /project/iu);
  assert.match(narration, /39 Commits/iu);
  assert.match(narration, /Search/iu);
  assert.doesNotMatch(narration, /private-token|secret query|Route\.continue/iu);
  assert.ok(actionScenes.every(({ frame }) => frame));
});

test('accepts only a complete bounded narration plan', () => {
  const scenes = [
    { id: 'summary', spoken: 'Fallback summary.', evidence: { eventIds: [] } },
    { id: 'action-call-1', spoken: 'Fallback action.', evidence: { eventIds: ['call@1'] } },
  ];
  const rewritten = applyNarrationPlan(scenes, {
    scenes: [
      { id: 'summary', spoken: 'This walkthrough follows one visible interaction.' },
      { id: 'action-call-1', spoken: 'The test opens the project page and establishes its starting state.' },
    ],
  });

  assert.equal(rewritten[1].spoken, 'The test opens the project page and establishes its starting state.');
  assert.deepEqual(rewritten[1].evidence, { eventIds: ['call@1'] });
  assert.throws(
    () => applyNarrationPlan(scenes, {
      scenes: [{ id: 'summary', spoken: 'Incomplete.' }],
    }),
    /one entry for every evidence scene/iu,
  );
  assert.throws(
    () => applyNarrationPlan(scenes, {
      scenes: [
        { id: 'summary', spoken: 'Summary.' },
        { id: 'invented', spoken: 'An invented scene.' },
      ],
    }),
    /scene IDs/iu,
  );
});

test('keeps conversational intent in the grounded fallback without leaking URLs', () => {
  const scenes = [
    { id: 'summary', spoken: 'The trace contains one visible action.', evidence: { eventIds: [] } },
    { id: 'action-call-1', spoken: 'The test opens the project.', evidence: { eventIds: ['call@1'] } },
  ];
  const contextualized = applyNarrationBrief(
    scenes,
    'Explain why https://private.example/repository navigation matters to a backend reviewer.',
  );

  assert.match(contextualized[0].spoken, /backend reviewer/iu);
  assert.doesNotMatch(contextualized[0].spoken, /https?:|private\.example/iu);
  assert.ok(contextualized[0].spoken.length <= 320);
  assert.match(contextualized[0].spoken, /\.$/u);
  assert.equal(contextualized[1].spoken, scenes[1].spoken);
  assert.deepEqual(contextualized[0].evidence, scenes[0].evidence);
});
