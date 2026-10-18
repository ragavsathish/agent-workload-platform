import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
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
