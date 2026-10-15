import { PipecatClient, RTVIEvent } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import mermaid from 'mermaid';
import WaveSurfer from 'wavesurfer.js';
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';

const events = [];
const wavePlayers = new Map();
let client;
let currentAudio;
let renderSequence = 0;

const emit = (type, detail = {}) => events.push({ type, ...detail, at: Date.now() });
const messageDiagram = (value) => {
  let payload = value;
  for (let depth = 0; depth < 2; depth += 1) {
    if (payload && typeof payload === 'object' && 'data' in payload) payload = payload.data;
  }
  return payload?.type === 'mermaid' && typeof payload.diagram === 'string'
    ? payload.diagram
    : undefined;
};

const ensureClient = () => {
  if (client) return client;
  client = new PipecatClient({
    transport: new SmallWebRTCTransport(),
    enableMic: true,
    enableCam: false,
    callbacks: {
      onConnected: () => emit('connected'),
      onDisconnected: () => emit('disconnected'),
      onTransportStateChanged: (state) => emit('transport', { state }),
      onBotReady: () => emit('ready'),
    },
  });
  client.on(RTVIEvent.BotLlmStarted, () => emit('thinking', { active: true }));
  client.on(RTVIEvent.BotLlmStopped, () => emit('thinking', { active: false }));
  client.on(RTVIEvent.BotStartedSpeaking, () => emit('speaking', { active: true }));
  client.on(RTVIEvent.BotStoppedSpeaking, () => emit('speaking', { active: false }));
  client.on(RTVIEvent.ServerMessage, (value) => {
    const diagram = messageDiagram(value);
    if (diagram && diagram.length <= 24000) emit('mermaid', { diagram });
  });
  return client;
};

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'dark',
  flowchart: { curve: 'basis', htmlLabels: false, useMaxWidth: true },
  themeVariables: {
    primaryColor: '#111a18', primaryTextColor: '#eef7f2', primaryBorderColor: '#56e39f',
    lineColor: '#94a39c', secondaryColor: '#17221f', tertiaryColor: '#07100e',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
});

window.voiceBridge = {
  async start() {
    const pc = ensureClient();
    await pc.startBotAndConnect({
      endpoint: '/start',
      requestData: { createDailyRoom: false, enableDefaultIceServers: true, transport: 'webrtc' },
    });
    pc.enableMic(true);
  },
  async stop() {
    if (!client) return;
    client.enableMic(false);
    await client.disconnect();
  },
  setMuted(muted) {
    if (client?.connected) client.enableMic(!muted);
  },
  consumeEvents() {
    return JSON.stringify(events.splice(0));
  },
  async renderMermaid(elementId, source) {
    const target = document.getElementById(elementId);
    if (!target) return JSON.stringify({ ok: false, error: 'Diagram host unavailable' });
    try {
      const result = await mermaid.render(`pi-mermaid-${++renderSequence}`, source);
      target.innerHTML = result.svg;
      const svg = target.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.maxWidth = '100%';
      }
      return JSON.stringify({ ok: true });
    } catch (error) {
      target.textContent = 'Diagram unavailable';
      return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
  openView(view) {
    window.open(`/?view=${encodeURIComponent(view)}`, '_blank', 'noopener,noreferrer');
  },
  async playSpeech(spoken) {
    const response = await fetch('/api/pi-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spoken }),
    });
    if (!response.ok) throw new Error('Speech request failed');
    const url = URL.createObjectURL(await response.blob());
    currentAudio?.pause();
    currentAudio = new Audio(url);
    currentAudio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
    await currentAudio.play();
  },
  async playUrl(url) {
    currentAudio?.pause();
    currentAudio = new Audio(url);
    await currentAudio.play();
  },
  mountWaveform(elementId, url, color, spectrogram) {
    const target = document.getElementById(elementId);
    if (!target || wavePlayers.has(elementId)) return;
    const player = WaveSurfer.create({
      container: target, url, height: 72, waveColor: color, progressColor: '#eef7f2',
      cursorColor: '#56e39f', barWidth: 2, barGap: 2, barRadius: 2,
    });
    if (spectrogram) player.registerPlugin(Spectrogram.create({
      container: target, colorMap: 'roseus', fftSamples: 512, frequencyMax: 8000,
      height: 112, labels: true, scale: 'mel', useWebWorker: true,
    }));
    target.addEventListener('click', () => player.playPause());
    wavePlayers.set(elementId, player);
  },
  disposeWaveform(elementId) {
    wavePlayers.get(elementId)?.destroy();
    wavePlayers.delete(elementId);
  },
};
