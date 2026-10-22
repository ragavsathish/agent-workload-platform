import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectFirstPartyMcpApp } from '../design_system/mcp-app-runtime.js';

test('first-party Views follow initial and updated host themes', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { documentElement: { dataset: { piTheme: 'dark' } } };
  globalThis.window = { parent: { postMessage() {} } };
  try {
    const app = {
      connect: async () => {},
      getHostContext: () => ({ theme: 'light' }),
    };
    connectFirstPartyMcpApp(app, '[test-app]');
    await new Promise(setImmediate);
    assert.equal(document.documentElement.dataset.piTheme, 'light');
    app.onhostcontextchanged({ theme: 'dark' });
    assert.equal(document.documentElement.dataset.piTheme, 'dark');
    app.onhostcontextchanged({ theme: 'unknown' });
    assert.equal(document.documentElement.dataset.piTheme, 'dark');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
