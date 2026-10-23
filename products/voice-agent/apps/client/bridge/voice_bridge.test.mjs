import assert from 'node:assert/strict';
import test from 'node:test';

test('speech promise waits for playback and stop releases it', async () => {
  const originalFetch = globalThis.fetch;
  const originalAudio = globalThis.Audio;
  const originalWindow = globalThis.window;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const audios = [];

  class FakeAudio extends EventTarget {
    constructor() {
      super();
      this.paused = false;
      audios.push(this);
    }

    async play() {}

    pause() { this.paused = true; }
  }

  globalThis.window = {};
  globalThis.Audio = FakeAudio;
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['audio']) });
  URL.createObjectURL = () => 'blob:test-audio';
  URL.revokeObjectURL = () => {};
  try {
    await import('./voice_bridge.js');
    let settled = false;
    const first = window.voiceBridge.playSpeech('Reading a source file.').then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    audios[0].dispatchEvent(new Event('ended'));
    await first;
    assert.equal(settled, true);

    settled = false;
    const second = window.voiceBridge.playSpeech('Running tests.').then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    window.voiceBridge.stopSpeech();
    await second;
    assert.equal(settled, true);
    assert.equal(audios[1].paused, true);

    const opened = [];
    window.open = (...args) => opened.push(args);
    window.voiceBridge.openView('knowledge-base');
    assert.equal(opened.at(-1)[0], '/knowledge/');
    assert.equal(opened.at(-1)[2], 'noopener,noreferrer');
    window.voiceBridge.openTaskArtifactUrl(
      'https://pipecat-edge.tailf6d713.ts.net/api/tasks/11111111-1111-4111-8111-111111111111/artifacts/workspace',
    );
    assert.equal(opened.length, 2);
    assert.match(opened.at(-1)[0], /\/api\/tasks\/11111111-1111-4111-8111-111111111111\/artifacts\/workspace$/u);
    assert.throws(() => window.voiceBridge.openTaskArtifactUrl(
      'http://pipecat-edge.tailf6d713.ts.net/api/tasks/11111111-1111-4111-8111-111111111111/artifacts/workspace',
    ));
    assert.throws(() => window.voiceBridge.openTaskArtifactUrl(
      'https://pipecat-edge.tailf6d713.ts.net/api/tasks/11111111-1111-4111-8111-111111111111/artifacts/execution',
    ));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Audio = originalAudio;
    globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
