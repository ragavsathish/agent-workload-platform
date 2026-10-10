import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('speaker initialization is deferred until the user connects', async () => {
  const appSource = await readFile(
    new URL('../src/components/App.tsx', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    appSource,
    /\.initDevices\s*\(/,
    'eager device initialization suspends Web Audio on iOS Safari'
  );
});
