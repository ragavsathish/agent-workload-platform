import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const indexHtml = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const viewportSync = indexHtml.match(
  /<script id="pi-mobile-viewport-sync">([\s\S]*?)<\/script>/u,
);

const runViewportSync = ({ hostHeight, visualHeight }) => {
  assert.ok(viewportSync, 'index.html must recheck mobile viewport after Flutter starts');
  const scheduled = [];
  const listeners = new Map();
  let resizeEvents = 0;
  const view = { style: { height: `${hostHeight}px` } };
  const visualViewport = {
    height: visualHeight,
    dispatchEvent() {
      resizeEvents += 1;
      view.style.height = `${visualHeight}px`;
      return true;
    },
  };
  const document = {
    querySelector: (selector) => selector === 'flutter-view' ? view : null,
  };

  vm.runInNewContext(viewportSync[1], {
    window: {
      visualViewport,
      document,
      addEventListener: (name, callback) => listeners.set(name, callback),
    },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
    Event: class Event {},
    Math,
    Number,
  });
  listeners.get('flutter-first-frame')?.();
  for (const item of scheduled.sort((a, b) => a.delay - b.delay)) item.callback();
  return { resizeEvents, delays: scheduled.map(({ delay }) => delay) };
};

test('corrects a stale Flutter mobile viewport after its first frame', () => {
  assert.equal(runViewportSync({ hostHeight: 852, visualHeight: 690 }).resizeEvents, 1);
});

test('leaves a Flutter view alone when its viewport already matches', () => {
  assert.equal(runViewportSync({ hostHeight: 690, visualHeight: 690 }).resizeEvents, 0);
});
