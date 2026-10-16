import { installPiWebMcpTools } from './webmcp_tools.js';

const events = [];
const mermaidViewports = new WeakMap();
let client;
let clientPromise;
let currentAudio;
let currentAudioUrl;
let currentSpeech;
let botAudio;
let mermaidPromise;
let renderSequence = 0;
let webMcpRegistration;

const ensureWebMcp = () => {
  if (webMcpRegistration) return webMcpRegistration;
  webMcpRegistration = installPiWebMcpTools({
    modelContext: document.modelContext,
    fetchImpl: window.fetch.bind(window),
    notify: (detail) => emit('webmcp', detail),
  }).then((result) => {
    if (!result.supported) webMcpRegistration = undefined;
    return result;
  }).catch((error) => {
    webMcpRegistration = undefined;
    return {
      supported: true,
      registered: [],
      error: error instanceof Error ? error.name : 'RegistrationError',
    };
  });
  return webMcpRegistration;
};

const waitForElement = async (elementId) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const target = document.getElementById(elementId);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return null;
};

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

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const installMermaidViewport = (target) => {
  const existing = mermaidViewports.get(target);
  if (existing) return existing;

  const state = {
    baseWidth: 0,
    baseHeight: 0,
    pointers: new Map(),
    stage: null,
    svg: null,
    zoom: 1,
  };

  const applyZoom = (nextZoom, clientX, clientY) => {
    if (!state.stage || !state.svg || state.baseWidth <= 0 || state.baseHeight <= 0) return;
    const zoom = clamp(nextZoom, 0.5, 4);
    const bounds = target.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const contentX = (target.scrollLeft + localX) / state.zoom;
    const contentY = (target.scrollTop + localY) / state.zoom;

    state.zoom = zoom;
    state.stage.style.width = `${state.baseWidth * zoom}px`;
    state.stage.style.height = `${state.baseHeight * zoom}px`;
    state.stage.style.margin = state.baseWidth * zoom <= target.clientWidth ? '0 auto' : '0';
    state.svg.style.transform = `scale(${zoom})`;
    target.dataset.zoom = zoom.toFixed(3);
    target.scrollLeft = contentX * zoom - localX;
    target.scrollTop = contentY * zoom - localY;
  };

  const pointerDistance = () => {
    const values = [...state.pointers.values()];
    return values.length < 2 ? 0 : Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
  };

  const pointerCenter = () => {
    const values = [...state.pointers.values()];
    return values.length < 2
      ? { x: 0, y: 0 }
      : { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
  };

  target.addEventListener('pointerdown', (event) => {
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic test events are not registered as active browser pointers.
    }
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size === 2) {
      state.pinchDistance = pointerDistance();
      state.pinchZoom = state.zoom;
    }
  });
  target.addEventListener('pointermove', (event) => {
    const previous = state.pointers.get(event.pointerId);
    if (!previous) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size === 2) {
      const distance = pointerDistance();
      const center = pointerCenter();
      if (state.pinchDistance > 0) {
        applyZoom(state.pinchZoom * distance / state.pinchDistance, center.x, center.y);
      }
    } else {
      target.scrollLeft -= event.clientX - previous.x;
      target.scrollTop -= event.clientY - previous.y;
    }
    event.preventDefault();
  });
  const releasePointer = (event) => {
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) {
      state.pinchDistance = 0;
      state.pinchZoom = state.zoom;
    }
  };
  target.addEventListener('pointerup', releasePointer);
  target.addEventListener('pointercancel', releasePointer);
  target.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    applyZoom(state.zoom * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
  }, { passive: false });
  target.addEventListener('dblclick', (event) => {
    applyZoom(1, event.clientX, event.clientY);
  });

  state.applyZoom = applyZoom;
  mermaidViewports.set(target, state);
  return state;
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
      const diagram = messageDiagram(value);
      if (diagram && diagram.length <= 24000) emit('mermaid', { diagram });
    });
    return client;
  });
  return clientPromise;
};

const ensureMermaid = () => {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
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
    return mermaid;
  });
  return mermaidPromise;
};

window.voiceBridge = {
  async installWebMcp() {
    return JSON.stringify(await ensureWebMcp());
  },
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
  async renderMermaid(elementId, source) {
    const target = await waitForElement(elementId);
    if (!target) return JSON.stringify({ ok: false, error: 'Diagram host unavailable' });
    try {
      const mermaid = await ensureMermaid();
      const result = await mermaid.render(`pi-mermaid-${++renderSequence}`, source);
      target.innerHTML = result.svg;
      const svg = target.querySelector('svg');
      if (svg) {
        const viewport = installMermaidViewport(target);
        const viewBox = svg.viewBox?.baseVal;
        const sourceWidth = viewBox?.width || Number.parseFloat(svg.getAttribute('width')) || target.clientWidth;
        const sourceHeight = viewBox?.height || Number.parseFloat(svg.getAttribute('height')) || target.clientHeight;
        const fitsNaturally = sourceWidth <= target.clientWidth && sourceHeight <= target.clientHeight;
        const nearlyFits = sourceWidth <= target.clientWidth * 1.4 && sourceHeight <= target.clientHeight * 1.4;
        const scale = fitsNaturally
          ? Math.min(target.clientWidth / sourceWidth, target.clientHeight / sourceHeight, 2.4)
          : nearlyFits
            ? Math.min(target.clientWidth / sourceWidth, target.clientHeight / sourceHeight)
            : 1;
        const width = Math.min(sourceWidth * scale, 2400);
        const height = Math.min(sourceHeight * scale, 2400);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.display = 'block';
        svg.style.flex = '0 0 auto';
        svg.style.width = `${width}px`;
        svg.style.height = `${height}px`;
        svg.style.maxWidth = 'none';
        svg.style.maxHeight = 'none';
        svg.style.position = 'absolute';
        svg.style.inset = '0 auto auto 0';
        svg.style.transformOrigin = '0 0';
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const stage = document.createElement('div');
        stage.style.position = 'relative';
        stage.style.flex = '0 0 auto';
        stage.append(svg);
        target.replaceChildren(stage);
        viewport.baseWidth = width;
        viewport.baseHeight = height;
        viewport.stage = stage;
        viewport.svg = svg;
        viewport.zoom = 1;
        viewport.applyZoom(1, target.clientWidth / 2, target.clientHeight / 2);
      }
      return JSON.stringify({ ok: true });
    } catch (error) {
      target.textContent = 'Diagram unavailable';
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

void ensureWebMcp();
