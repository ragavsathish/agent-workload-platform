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

test('conversation controls explicitly start, pause, resume, and stop capture', async () => {
  const appSource = await readFile(
    new URL('../src/components/App.tsx', import.meta.url),
    'utf8'
  );

  assert.match(appSource, /await handleConnect\(\);[\s\S]*client\.enableMic\(true\)/);
  assert.match(appSource, /client\.enableMic\(!nextPaused\)/);
  assert.match(
    appSource,
    /client\.enableMic\(false\);[\s\S]*await handleDisconnect\(\)/,
    'Stop must mute capture before disconnecting the transport'
  );
  assert.match(appSource, /isPaused \? 'Resume' : 'Pause'/);
});
