// Synthetic MCP tool results for exercising the real Flutter host and iframe apps.
// Keep these free of host URLs, credentials, and production transcript content.
const scenes = Object.freeze([
  {
    name: 'mermaid',
    match: ['mermaid', 'diagram'],
    spoken: 'Here is the browser-to-agent path as a diagram.',
    presentation: {
      kind: 'flow', title: 'Browser to agent',
      nodes: [{ id: 'browser', label: 'Browser' }, { id: 'agent', label: 'Agent' }],
      edges: [{ from: 'browser', to: 'agent', label: 'MCP App' }],
    },
  },
  {
    name: 'slides',
    match: ['slides', 'marp'],
    spoken: 'These slides explain the local development path.',
    presentation: {
      kind: 'slides', title: 'Local development',
      markdown: [
        '---', 'marp: true', '---', '# Local development', '',
        'Flutter Web hosts the MCP App.', '', '---', '# No host dependency', '',
        'Synthetic responses exercise the real UI bridge.',
      ].join('\n'),
    },
  },
  {
    name: 'excalidraw',
    match: ['excalidraw', 'editable'],
    spoken: 'This diagram can be edited inside the MCP App.',
    presentation: {
      kind: 'excalidraw', title: 'Editable path',
      elements: [
        { type: 'cameraUpdate', x: 0, y: 0, width: 800, height: 600 },
        { type: 'rectangle', id: 'browser', x: 80, y: 120, width: 180, height: 80,
          backgroundColor: '#a5d8ff', fillStyle: 'solid', label: { text: 'Browser' } },
        { type: 'rectangle', id: 'agent', x: 440, y: 120, width: 180, height: 80,
          backgroundColor: '#b2f2bb', fillStyle: 'solid', label: { text: 'Agent' } },
      ],
    },
  },
  {
    name: 'trace',
    match: ['trace', 'playwright'],
    spoken: 'This trace card shows the recorded journey and its failing action.',
    presentation: {
      kind: 'playwright-trace-viewer', title: 'Local fixture journey',
      status: 'failed', summary: 'UI fixture · latest', project: 'voice', run: 'fixture',
      traceId: '0123456789abcdef0123456789abcdef', durationMs: 1240,
      actionCount: 2, requestCount: 4, errorCount: 1,
      actions: [
        { label: 'Open conversation', durationMs: 310, status: 'completed' },
        { label: 'Render trace', durationMs: 930, status: 'failed' },
      ],
    },
  },
  {
    name: 'journal',
    match: ['journal', 'annotation', 'review'],
    spoken: 'Review the suggested decision against its highlighted evidence.',
    presentation: {
      kind: 'journal-review', reviewId: 'local-fixture', title: 'Review journal extraction',
      source: 'Synthetic voice session',
      transcript: 'I want to improve the prompt and annotate examples before training.',
      suggestion: {
        id: 'decision-1', type: 'decision',
        statement: 'Improve the prompt and annotate examples before training.',
        topics: ['evaluation', 'annotation'], confidence: 0.91,
        evidence: { quote: 'improve the prompt and annotate examples before training', start: 10, end: 65 },
      },
      progress: { current: 1, total: 3, reviewed: 0 },
    },
  },
]);

export const fixtureSceneNames = () => scenes.map(({ name }) => name);

const localOrigin = (candidate) => {
  try {
    const origin = new URL(candidate);
    if (origin.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(origin.hostname)) return origin.origin;
  } catch {
    // The fixture is loopback-only; ignore malformed or non-local Origin values.
  }
  return 'http://127.0.0.1:8766';
};

const tracePresentation = (presentation, origin) => {
  const base = localOrigin(origin);
  const archive = new URL(`/api/playwright-traces/${presentation.traceId}/trace.zip`, base);
  const viewer = new URL('/trace-viewer/index.html', base);
  viewer.searchParams.set('trace', archive.toString());
  return {
    ...presentation,
    viewerUrl: viewer.toString(),
    narratedVideoUrl: new URL(
      '/api/trace-explainers/abcdef0123456789abcdef0123456789/video', base,
    ).toString(),
  };
};

export const responseForFixtureMessage = (message, origin) => {
  const normalized = String(message ?? '').toLowerCase();
  const scene = scenes.find(({ match }) => match.some((word) => normalized.includes(word)));
  return scene
    ? {
        spoken: scene.spoken,
        presentation: scene.name === 'trace'
          ? tracePresentation(scene.presentation, origin)
          : scene.presentation,
      }
    : {
        spoken: `Fixture response to: ${message}`,
        presentation: {
          kind: 'flow', title: 'Response',
          nodes: [{ id: 'request', label: 'Request' }, { id: 'response', label: 'Response' }],
          edges: [{ from: 'request', to: 'response' }],
        },
      };
};
