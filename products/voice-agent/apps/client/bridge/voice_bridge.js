import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

const events = [];
const mcpAppHosts = new WeakMap();
const mcpApps = Object.freeze({
  'ui://voice-canvas/main': {
    src: '/voice-canvas/index.html',
    title: 'Interactive Pi Voice Canvas',
    toolInput: (presentation) => ({ presentation }),
    toolResult: (presentation) => ({ presentation }),
  },
  'ui://excalidraw/mcp-app.html': {
    src: '/excalidraw/mcp-app.html',
    title: 'Editable Excalidraw diagram',
    toolInput: (presentation) => ({ elements: JSON.stringify(presentation.elements ?? []) }),
    toolResult: () => ({}),
  },
});
let client;
let clientPromise;
let currentAudio;
let currentAudioUrl;
let currentSpeech;
let botAudio;

const waitForElement = async (elementId) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const target = document.getElementById(elementId);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return null;
};

const settleWithin = (promise, milliseconds = 250) => Promise.race([
  promise.catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, milliseconds)),
]);

const emit = (type, detail = {}) => events.push({ type, ...detail, at: Date.now() });
const messagePresentation = (value) => {
  let payload = value;
  for (let depth = 0; depth < 2; depth += 1) {
    if (payload && typeof payload === 'object' && 'data' in payload) payload = payload.data;
  }
  if (payload?.type !== 'mcp-app' || !payload.presentation || typeof payload.presentation !== 'object') {
    return undefined;
  }
  return {
    presentation: payload.presentation,
    resourceUri: typeof payload.resourceUri === 'string'
      ? payload.resourceUri
      : 'ui://voice-canvas/main',
  };
};

const ensureBotAudio = () => {
  if (botAudio) return botAudio;
  botAudio = document.createElement('audio');
  botAudio.autoplay = true;
  botAudio.playsInline = true;
  botAudio.muted = false;
  botAudio.volume = 1;
  botAudio.dataset.pipecatOutput = 'true';
  botAudio.setAttribute('aria-hidden', 'true');
  botAudio.style.display = 'none';
  document.body.append(botAudio);
  return botAudio;
};

const playBotTrack = (track, participant) => {
  if (track.kind !== 'audio' || participant?.local === true) return;
  const output = ensureBotAudio();
  output.srcObject = new MediaStream([track]);
  output.play()
    .then(() => emit('audio-output', { active: true }))
    .catch((error) => emit('audio-error', {
      message: error instanceof Error ? error.message : String(error),
    }));
};

const stopBotTrack = (track, participant) => {
  if (track.kind !== 'audio' || participant?.local === true || !botAudio) return;
  const tracks = botAudio.srcObject instanceof MediaStream
    ? botAudio.srcObject.getAudioTracks()
    : [];
  if (!tracks.some((value) => value.id === track.id)) return;
  botAudio.pause();
  botAudio.srcObject = null;
  emit('audio-output', { active: false });
};

const replaceCurrentAudio = (audio, { objectUrl, spoken } = {}) => {
  currentAudio?.pause();
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudio = audio;
  currentAudioUrl = objectUrl;
  currentSpeech = spoken;
};

const ensureClient = async () => {
  if (client) return client;
  if (clientPromise) return clientPromise;
  clientPromise = Promise.all([
    import('@pipecat-ai/client-js'),
    import('@pipecat-ai/small-webrtc-transport'),
  ]).then(([{ PipecatClient, RTVIEvent }, { SmallWebRTCTransport }]) => {
    client = new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onConnected: () => emit('connected'),
        onDisconnected: () => emit('disconnected'),
        onTransportStateChanged: (state) => emit('transport', { state }),
        onBotReady: () => emit('ready'),
        onTrackStarted: playBotTrack,
        onTrackStopped: stopBotTrack,
      },
    });
    client.on(RTVIEvent.BotLlmStarted, () => emit('thinking', { active: true }));
    client.on(RTVIEvent.BotLlmStopped, () => emit('thinking', { active: false }));
    client.on(RTVIEvent.BotStartedSpeaking, () => emit('speaking', { active: true }));
    client.on(RTVIEvent.BotStoppedSpeaking, () => emit('speaking', { active: false }));
    client.on(RTVIEvent.ServerMessage, (value) => {
      const app = messagePresentation(value);
      if (app) emit('mcp-app', app);
    });
    return client;
  });
  return clientPromise;
};

window.voiceBridge = {
  async start() {
    ensureBotAudio();
    const pc = await ensureClient();
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
    if (botAudio) {
      botAudio.pause();
      botAudio.srcObject = null;
    }
  },
  setMuted(muted) {
    if (client?.connected) client.enableMic(!muted);
    emit('muted', { active: muted });
  },
  consumeEvents() {
    return JSON.stringify(events.splice(0));
  },
  async mountMcpApp(elementId, rawPresentation, resourceUri = 'ui://voice-canvas/main') {
    const target = await waitForElement(elementId);
    if (!target) return JSON.stringify({ ok: false, error: 'MCP App host unavailable' });
    try {
      const appDefinition = mcpApps[resourceUri];
      if (!appDefinition) throw new Error('Unsupported MCP App resource');
      const presentation = typeof rawPresentation === 'string'
        ? JSON.parse(rawPresentation)
        : rawPresentation;
      if (!presentation || typeof presentation !== 'object') throw new Error('Invalid presentation');

      const previous = mcpAppHosts.get(target);
      if (previous) {
        await settleWithin(previous.bridge.teardownResource({}));
        await settleWithin(previous.bridge.close());
      }

      const iframe = document.createElement('iframe');
      iframe.title = appDefinition.title;
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute(
        'allow',
        resourceUri === 'ui://excalidraw/mcp-app.html'
          ? 'fullscreen; clipboard-write'
          : 'fullscreen',
      );
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      iframe.style.display = 'block';
      target.replaceChildren(iframe);

      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      const bridge = new AppBridge(
        null,
        { name: 'Pi Voice', version: '0.1.0' },
        {
          updateModelContext: { text: {}, structuredContent: {} },
          logging: {},
          sandbox: {
            permissions: resourceUri === 'ui://excalidraw/mcp-app.html'
              ? { clipboardWrite: {} }
              : {},
          },
        },
        {
          hostContext: {
            displayMode: 'inline',
            availableDisplayModes: resourceUri === 'ui://excalidraw/mcp-app.html'
              ? ['inline', 'fullscreen']
              : ['inline'],
            containerDimensions: {
              width: target.clientWidth,
              height: target.clientHeight,
            },
            platform: coarsePointer ? 'mobile' : 'web',
            deviceCapabilities: {
              touch: coarsePointer,
              hover: window.matchMedia('(hover: hover)').matches,
            },
          },
        },
      );
      bridge.onupdatemodelcontext = async (context) => {
        emit('mcp-app-context', { context });
        return {};
      };
      bridge.onloggingmessage = () => {};
      bridge.onrequestdisplaymode = async ({ mode }) => {
        const fullscreen = resourceUri === 'ui://excalidraw/mcp-app.html' && mode === 'fullscreen';
        iframe.style.position = fullscreen ? 'fixed' : '';
        iframe.style.inset = fullscreen ? '0' : '';
        iframe.style.zIndex = fullscreen ? '2147483647' : '';
        iframe.style.background = fullscreen ? '#ffffff' : '';
        const actualMode = fullscreen ? 'fullscreen' : 'inline';
        bridge.setHostContext({
          displayMode: actualMode,
          containerDimensions: {
            width: fullscreen ? window.innerWidth : target.clientWidth,
            height: fullscreen ? window.innerHeight : target.clientHeight,
          },
        });
        return { mode: actualMode };
      };
      bridge.oninitialized = async () => {
        // React-based MCP Apps install notification handlers immediately after
        // the protocol handshake updates their component state. Allow that
        // render/effect cycle to finish before publishing the first tool data.
        await new Promise((resolve) => requestAnimationFrame(
          () => requestAnimationFrame(resolve),
        ));
        await bridge.sendToolInput({ arguments: appDefinition.toolInput(presentation) });
        await bridge.sendToolResult({
          content: [],
          structuredContent: appDefinition.toolResult(presentation),
        });
      };

      const connection = bridge.connect(
        new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
      );
      iframe.src = appDefinition.src;
      await connection;
      mcpAppHosts.set(target, { bridge, iframe });
      return JSON.stringify({ ok: true });
    } catch (error) {
      target.textContent = 'Visual unavailable';
      return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
  openView(view) {
    const url = view === 'audio-diagnostics'
      ? '/diagnostics/'
      : view === 'system-health'
        ? '/metrics/d/voice-c4-heatmap/c4-operational-heat-map'
      : `/?view=${encodeURIComponent(view)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  async playSpeech(spoken, endpoint = '/api/pi-speech') {
    if (currentAudio && currentAudioUrl && currentSpeech === spoken) {
      currentAudio.currentTime = 0;
      await currentAudio.play();
      return;
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spoken }),
    });
    if (!response.ok) throw new Error('Speech request failed');
    const url = URL.createObjectURL(await response.blob());
    replaceCurrentAudio(new Audio(url), { objectUrl: url, spoken });
    await currentAudio.play();
  },
  async playUrl(url) {
    replaceCurrentAudio(new Audio(url));
    await currentAudio.play();
  },
};
