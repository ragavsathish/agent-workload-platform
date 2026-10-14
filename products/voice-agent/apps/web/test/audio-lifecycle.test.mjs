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

test('conversation controls mute capture without ending the voice session', async () => {
  const appSource = await readFile(
    new URL('../src/components/App.tsx', import.meta.url),
    'utf8'
  );

  assert.match(appSource, /await handleConnect\(\);[\s\S]*client\.enableMic\(true\)/);
  assert.match(appSource, /client\.enableMic\(!nextMuted\)/);
  assert.match(appSource, /isMuted \? 'Unmute' : 'Mute'/);
  assert.match(appSource, /'Microphone muted'/);
  assert.match(
    appSource,
    /client\.enableMic\(false\);[\s\S]*await handleDisconnect\(\)/,
    'End conversation must mute capture before disconnecting the transport'
  );
  assert.match(appSource, /End conversation/);
  assert.match(appSource, /className="conversation-dock"/);
  assert.match(appSource, /<TaskPanel[\s\S]*onClose=/);
  assert.doesNotMatch(appSource, /<ConversationPanel/);
});

test('context usage is visible and can be compacted without redundant audio controls', async () => {
  const appSource = await readFile(
    new URL('../src/components/App.tsx', import.meta.url),
    'utf8'
  );

  assert.match(appSource, /fetch\('\/api\/pi-context'/);
  assert.match(appSource, /fetch\('\/api\/pi-context\/compact', \{ method: 'POST' \}\)/);
  assert.match(appSource, />Context</);
  assert.match(appSource, /contextUsage\.percent/);
  assert.match(appSource, /Compacting…/);
  assert.doesNotMatch(appSource, /Hands-free/);
  assert.doesNotMatch(appSource, /Enable sound/);
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
  const visualizerHelpers = await readFile(
    new URL('../src/visualizer.ts', import.meta.url),
    'utf8'
  );

  assert.match(appSource, /<AudioVisualizerRadial/);
  assert.match(appSource, /participantType="bot"/);
  assert.match(appSource, /RTVIEvent\.BotLlmStarted/);
  assert.match(appSource, /RTVIEvent\.BotLlmStopped/);
  assert.match(appSource, /RTVIEvent\.BotStartedSpeaking/);
  assert.match(appSource, /isThinking=\{agentActivity === 'thinking'\}/);
  assert.match(appSource, /'Pi is thinking'/);
  assert.match(visualizerSource, /usePipecatClientMediaTrack/);
  assert.match(visualizerSource, /createVoiceBands/);
  assert.match(visualizerHelpers, /export function createVisualizerAnalyser/);
  assert.match(visualizerHelpers, /export function createVoiceBands/);
  assert.match(visualizerHelpers, /export function readBand/);
});

test('the last five completed conversations expose comparable audio replays', async () => {
  const appSource = await readFile(
    new URL('../src/components/App.tsx', import.meta.url),
    'utf8'
  );
  const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const diagnosticsSource = await readFile(
    new URL('../src/components/AudioDiagnosticsView.tsx', import.meta.url),
    'utf8'
  );
  const waveformSource = await readFile(
    new URL('../src/components/AudioWaveform.tsx', import.meta.url),
    'utf8'
  );
  const chartsSource = await readFile(
    new URL('../src/components/AudioDiagnosticsCharts.tsx', import.meta.url),
    'utf8'
  );

  assert.match(appSource, /\?view=audio-diagnostics/);
  assert.match(mainSource, /<AudioDiagnosticsView/);
  assert.match(diagnosticsSource, /fetch\('\/api\/audio-diagnostics'/);
  assert.match(diagnosticsSource, /values\.slice\(0, 5\)/);
  assert.match(diagnosticsSource, /Raw microphone/);
  assert.match(diagnosticsSource, /VoxLock/);
  assert.match(diagnosticsSource, /RNNoise/);
  assert.match(diagnosticsSource, /<AudioWaveform/);
  assert.match(diagnosticsSource, /Load waveform comparison/);
  assert.match(waveformSource, /from '@wavesurfer\/react'/);
  assert.match(waveformSource, /spectrogram\.esm\.js/);
  assert.match(waveformSource, /normalize=\{false\}/);
  assert.match(chartsSource, /from 'recharts'/);
  assert.match(chartsSource, /audio-diagnostics\/live/);
  assert.match(chartsSource, /Input and output energy/);
  assert.match(chartsSource, /Suppression/);
  assert.match(chartsSource, /inference latency/);
  assert.match(chartsSource, /LSTM-state RMS activity/);
  assert.match(chartsSource, /predicted complex-mask magnitude/);
});
