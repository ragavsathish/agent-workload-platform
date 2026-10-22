import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

const events = [];
const mcpAppHosts = new WeakMap();
const mcpAppMountQueues = new WeakMap();
const excalidrawCameraSizes = [
  { width: 400, height: 300 },
  { width: 600, height: 450 },
  { width: 800, height: 600 },
  { width: 1200, height: 900 },
  { width: 1600, height: 1200 },
];

const validExcalidrawCamera = (element) => (
  element?.type === 'cameraUpdate'
  && [element.x, element.y, element.width, element.height]
    .every((value) => typeof value === 'number' && Number.isFinite(value))
  && element.width > 0
  && element.height > 0
);

const excalidrawCameraFor = (elements) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    if (element?.type === 'cameraUpdate'
      || typeof element?.x !== 'number'
      || typeof element?.y !== 'number') continue;
    const width = typeof element.width === 'number' ? element.width : 0;
    const height = typeof element.height === 'number' ? element.height : 0;
    minX = Math.min(minX, element.x, element.x + width);
    minY = Math.min(minY, element.y, element.y + height);
    maxX = Math.max(maxX, element.x, element.x + width);
    maxY = Math.max(maxY, element.y, element.y + height);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return { type: 'cameraUpdate', x: 0, y: 0, width: 800, height: 600 };
  }
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const size = excalidrawCameraSizes.find(
    (candidate) => candidate.width >= contentWidth + 80 && candidate.height >= contentHeight + 80,
  ) ?? excalidrawCameraSizes.at(-1);
  return {
    type: 'cameraUpdate',
    x: minX - (size.width - contentWidth) / 2,
    y: minY - (size.height - contentHeight) / 2,
    ...size,
  };
};

const normalizeExcalidrawPresentation = (presentation) => {
  const source = Array.isArray(presentation.elements) ? presentation.elements : [];
  const elements = source.map((element) => {
    if (!element || typeof element !== 'object') return element;
    if (element.type === 'cameraUpdate') return element;
    if (typeof element.label === 'string') {
      return { ...element, label: { text: element.label } };
    }
    return element;
  });
  const camera = [...elements].reverse().find(validExcalidrawCamera)
    ?? excalidrawCameraFor(elements);
  return {
    ...presentation,
    elements: [camera, ...elements.filter((element) => element?.type !== 'cameraUpdate')],
  };
};

const mcpApps = Object.freeze({
  'ui://mermaid/main': {
    src: '/mermaid/index.html',
    title: 'Pi Mermaid diagram',
    toolInput: (presentation) => ({ presentation }),
    toolResult: (presentation) => ({ presentation }),
  },
  'ui://slides/marp.html': {
    src: '/marp/marp.html',
    title: 'Pi Marp slides',
    toolInput: (presentation) => ({ presentation }),
    toolResult: (presentation) => ({ presentation }),
  },
  'ui://playwright-trace-viewer/main.html': {
    src: '/trace-explainer/main.html',
    title: 'Playwright Trace Viewer',
    toolInput: (presentation) => ({ presentation }),
    toolResult: (presentation) => ({ presentation }),
  },
  'ui://journal-review/main.html': {
    src: '/journal-review/main.html',
    title: 'Journal Review',
    toolInput: (presentation) => ({ presentation }),
    toolResult: (presentation) => ({ presentation }),
  },
  'ui://excalidraw/mcp-app.html': {
    src: '/excalidraw/mcp-app.html',
    title: 'Editable Excalidraw diagram',
    toolInput: (presentation) => ({ elements: JSON.stringify(presentation.elements ?? []) }),
    toolResult: () => ({}),
  },
  'ui://grafana/trace.html': {
    src: '/api/grafana-mcp/apps/trace',
    title: 'Grafana trace',
    toolInput: (presentation) => ({
      datasourceUid: presentation.datasourceUid,
      trace_id: presentation.traceId,
      ...(presentation.focusSpanId ? { focus_span_id: presentation.focusSpanId } : {}),
    }),
    toolResult: async (presentation) => {
      const query = new URLSearchParams({ datasourceUid: presentation.datasourceUid });
      if (presentation.focusSpanId) query.set('focusSpanId', presentation.focusSpanId);
      const response = await fetch(
        `/api/grafana-mcp/traces/${encodeURIComponent(presentation.traceId)}?${query}`,
        { credentials: 'same-origin' },
      );
      if (!response.ok) throw new Error('Grafana trace data is unavailable');
      return response.json();
    },
  },
});
let client;
let clientPromise;
let currentAudio;
let currentAudioUrl;
let currentSpeech;
let completeCurrentSpeech;
let speechGeneration = 0;
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

const textContent = (content) => Array.isArray(content)
  ? content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .slice(0, 8_000)
  : '';

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
      : payload.presentation.kind === 'excalidraw'
        ? 'ui://excalidraw/mcp-app.html'
        : payload.presentation.kind === 'slides'
          ? 'ui://slides/marp.html'
          : payload.presentation.kind === 'playwright-trace-viewer'
            ? 'ui://playwright-trace-viewer/main.html'
            : payload.presentation.kind === 'journal-review'
              ? 'ui://journal-review/main.html'
              : payload.presentation.kind === 'grafana-trace'
                ? 'ui://grafana/trace.html'
                : 'ui://mermaid/main',
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
  completeCurrentSpeech?.();
  currentAudio?.pause();
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudio = audio;
  currentAudioUrl = objectUrl;
  currentSpeech = spoken;
};

const playCurrentSpeech = async (audio) => {
  completeCurrentSpeech?.();
  const finished = new Promise((resolve, reject) => {
    const complete = (error) => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (completeCurrentSpeech === complete) completeCurrentSpeech = undefined;
      if (error) reject(error);
      else resolve();
    };
    const onEnded = () => complete();
    const onError = () => complete(new Error('Audio playback failed'));
    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onError, { once: true });
    completeCurrentSpeech = complete;
  });
  try {
    await audio.play();
    await finished;
  } catch (error) {
    completeCurrentSpeech?.();
    throw error;
  }
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
  async mountMcpApp(elementId, rawPresentation, resourceUri = 'ui://mermaid/main') {
    const target = await waitForElement(elementId);
    if (!target) return JSON.stringify({ ok: false, error: 'MCP App host unavailable' });
    const precedingMount = mcpAppMountQueues.get(target) ?? Promise.resolve();
    let releaseMount;
    const mountSlot = new Promise((resolve) => { releaseMount = resolve; });
    mcpAppMountQueues.set(target, mountSlot);
    await precedingMount.catch(() => undefined);
    try {
      const appDefinition = mcpApps[resourceUri];
      if (!appDefinition) throw new Error('Unsupported MCP App resource');
      const rawValue = typeof rawPresentation === 'string'
        ? JSON.parse(rawPresentation)
        : rawPresentation;
      if (!rawValue || typeof rawValue !== 'object') throw new Error('Invalid presentation');
      const presentation = resourceUri === 'ui://excalidraw/mcp-app.html'
        ? normalizeExcalidrawPresentation(rawValue)
        : rawValue;

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
          || resourceUri === 'ui://grafana/trace.html'
          ? 'fullscreen; clipboard-write'
          : 'fullscreen',
      );
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      iframe.style.display = 'block';
      target.replaceChildren(iframe);

      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      const hostTheme = new URLSearchParams(window.location.search).get('theme') === 'light' ? 'light' : 'dark';
      const bridge = new AppBridge(
        null,
        { name: 'Pi Voice', version: '0.1.0' },
        {
          openLinks: {},
          updateModelContext: { text: {}, structuredContent: {} },
          message: { text: {} },
          logging: {},
          sandbox: {
            permissions: resourceUri === 'ui://excalidraw/mcp-app.html'
              || resourceUri === 'ui://grafana/trace.html'
              ? { clipboardWrite: {} }
              : {},
          },
        },
        {
          hostContext: {
            theme: hostTheme,
            displayMode: 'inline',
            availableDisplayModes: resourceUri === 'ui://excalidraw/mcp-app.html'
              || resourceUri === 'ui://playwright-trace-viewer/main.html'
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
      let modelContext = '';
      bridge.onupdatemodelcontext = async (context) => {
        const visibleContext = textContent(context.content);
        const structuredContext = context.structuredContent
          ? JSON.stringify(context.structuredContent).slice(0, 12_000)
          : '';
        modelContext = [visibleContext, structuredContext].filter(Boolean).join('\n');
        emit('mcp-app-context', { context });
        return {};
      };
      bridge.onmessage = async ({ content }) => {
        const question = textContent(content);
        if (!question || !client?.connected) return { isError: true };
        const prompt = modelContext
          ? `MCP App context:\n${modelContext}\n\nUser question:\n${question}`
          : question;
        await client.sendText(prompt, { run_immediately: true, audio_response: true });
        emit('mcp-app-message', { message: question });
        return {};
      };
      bridge.onloggingmessage = () => {};
      bridge.onopenlink = async ({ url }) => {
        const targetUrl = new URL(url, window.location.origin);
        const narratedVideo = targetUrl.origin === window.location.origin
          && /^\/api\/trace-explainers\/[a-f0-9]{32}\/video$/u.test(targetUrl.pathname)
          && !targetUrl.search;
        const trace = new URL(targetUrl.searchParams.get('trace') ?? 'invalid:', targetUrl);
        const traceViewer = targetUrl.origin === window.location.origin
          && targetUrl.pathname === '/trace-viewer/index.html'
          && trace.origin === targetUrl.origin
          && /^\/api\/playwright-traces\/[a-f0-9]{32}\/trace\.zip$/u.test(trace.pathname);
        if (!traceViewer && !narratedVideo) {
          throw new Error('MCP App requested an invalid Playwright artifact URL');
        }
        window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer');
        emit('mcp-app-open-link', { url: targetUrl.toString() });
        return {};
      };
      bridge.onrequestdisplaymode = async ({ mode }) => {
        const fullscreen = (
          resourceUri === 'ui://excalidraw/mcp-app.html'
          || resourceUri === 'ui://playwright-trace-viewer/main.html'
        ) && mode === 'fullscreen';
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
          structuredContent: await appDefinition.toolResult(presentation),
        });
      };

      const connection = bridge.connect(
        new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
      );
      const iframeSource = new URL(appDefinition.src, window.location.origin);
      if (
        resourceUri === 'ui://journal-review/main.html'
        && new URLSearchParams(window.location.search).get('prototype') === 'journal-review'
      ) {
        iframeSource.searchParams.set('prototype', '1');
        const selectedVariant = new URLSearchParams(window.location.search).get('variant');
        if (selectedVariant) iframeSource.searchParams.set('variant', selectedVariant);
      }
      if (resourceUri !== 'ui://excalidraw/mcp-app.html' && resourceUri !== 'ui://grafana/trace.html') {
        iframeSource.searchParams.set('theme', hostTheme);
      }
      iframe.src = `${iframeSource.pathname}${iframeSource.search}`;
      await connection;
      mcpAppHosts.set(target, { bridge, iframe });
      return JSON.stringify({ ok: true });
    } catch (error) {
      target.textContent = 'Visual unavailable';
      return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      releaseMount();
      if (mcpAppMountQueues.get(target) === mountSlot) mcpAppMountQueues.delete(target);
    }
  },
  async unmountMcpApp(elementId) {
    const target = document.getElementById(elementId);
    if (!target) return JSON.stringify({ ok: true });
    const host = mcpAppHosts.get(target);
    if (host) {
      await settleWithin(host.bridge.teardownResource({}));
      await settleWithin(host.bridge.close());
      mcpAppHosts.delete(target);
    }
    target.replaceChildren();
    return JSON.stringify({ ok: true });
  },
  openView(view) {
    const url = view === 'audio-diagnostics'
      ? '/diagnostics/'
      : view === 'system-health'
        ? '/metrics/d/voice-c4-heatmap/c4-operational-heat-map'
      : `/?view=${encodeURIComponent(view)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  openExternalUrl(url) {
    const target = new URL(url);
    if (target.origin !== 'https://open.spotify.com' || !/^\/album\/[A-Za-z0-9]+$/u.test(target.pathname)) {
      throw new Error('Only Spotify album links are allowed');
    }
    window.open(target.toString(), '_blank', 'noopener,noreferrer');
  },
  openTaskArtifactUrl(url) {
    const target = new URL(url);
    if (target.protocol !== 'https:'
      || !target.hostname.endsWith('.ts.net')
      || target.username || target.password || target.search || target.hash
      || !/^\/api\/tasks\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/artifacts\/(workspace|patch)$/u.test(target.pathname)) {
      throw new Error('Only Tailscale HTTPS task artifact downloads are allowed');
    }
    window.open(target.toString(), '_blank', 'noopener,noreferrer');
  },
  async playSpeech(spoken, endpoint = '/api/pi-speech') {
    const generation = ++speechGeneration;
    if (currentAudio && currentAudioUrl && currentSpeech === spoken) {
      currentAudio.currentTime = 0;
      await playCurrentSpeech(currentAudio);
      return;
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spoken }),
    });
    if (!response.ok) throw new Error('Speech request failed');
    if (generation !== speechGeneration) return;
    const url = URL.createObjectURL(await response.blob());
    if (generation !== speechGeneration) {
      URL.revokeObjectURL(url);
      return;
    }
    replaceCurrentAudio(new Audio(url), { objectUrl: url, spoken });
    await playCurrentSpeech(currentAudio);
  },
  async playUrl(url) {
    speechGeneration += 1;
    replaceCurrentAudio(new Audio(url));
    await currentAudio.play();
  },
  stopSpeech() {
    speechGeneration += 1;
    replaceCurrentAudio(undefined);
  },
};
