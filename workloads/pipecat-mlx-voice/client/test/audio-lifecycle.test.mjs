import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('audio initialization is deferred until the user connects', async () => {
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
  assert.match(appSource, /className="conversation-dock"/);
  assert.match(appSource, /<TaskPanel[\s\S]*onClose=/);
  assert.doesNotMatch(appSource, /<ConversationPanel/);
});

test('completed task responses render Mermaid and use server-side speech', async () => {
  const taskSource = await readFile(
    new URL('../src/components/TaskPanel.tsx', import.meta.url),
    'utf8'
  );

  assert.match(taskSource, /<MermaidDiagram diagram=/);
  assert.match(taskSource, /\/api\/tasks\/\$\{encodeURIComponent\(task\.id\)\}\/speech/);
  assert.match(taskSource, /new Audio\(url\)/);
  assert.doesNotMatch(taskSource, /speechSynthesis/);
});

test('conversation dock uses the source-installed Pipecat UI visualizer', async () => {
  const appSource = await readFile(
    new URL('../src/components/App.tsx', import.meta.url),
    'utf8'
  );
  const visualizerSource = await readFile(
    new URL('../src/components/pipecat/AudioVisualizerRadial.tsx', import.meta.url),
    'utf8'
  );

  assert.match(appSource, /<AudioVisualizerRadial/);
  assert.match(appSource, /participantType="bot"/);
  assert.match(visualizerSource, /usePipecatClientMediaTrack/);
  assert.match(visualizerSource, /createVoiceBands/);
});
