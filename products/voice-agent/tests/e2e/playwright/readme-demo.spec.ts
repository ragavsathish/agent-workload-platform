import {
  test,
  expect,
  enableFlutterSemantics,
  expectCleanBrowser,
} from './fixtures';

const visualResponse = (spoken, presentation, resourceUri) => JSON.stringify({
  spoken,
  presentation,
  resourceUri,
});

const landingTranscript = {
  revision: 1,
  entries: [
    {
      id: 'demo-welcome',
      timestamp: Date.parse('2026-10-18T08:59:00Z'),
      role: 'assistant',
      text: 'Ready when you are. Start a voice conversation or open the shared transcript.',
      status: 'completed',
    },
  ],
};

const journalPresentation = {
  kind: 'journal-review',
  reviewId: 'readme-demo-review',
  title: 'Personal knowledge graph review',
  source: 'Synthetic README demo',
  transcript: 'Improve the prompt and annotate representative examples before considering model training. Keep the evidence linked to every extracted fact.',
  suggestion: {
    id: 'readme-demo-suggestion',
    type: 'decision',
    statement: 'Improve prompts and reviewed annotations before model training.',
    topics: ['evaluation', 'annotation', 'learning'],
    confidence: 0.92,
    evidence: {
      quote: 'Improve the prompt and annotate representative examples before considering model training.',
      start: 0,
      end: 85,
    },
  },
  progress: { current: 12, total: 40, reviewed: 11 },
};

const transcript = {
  revision: 7,
  entries: [
    {
      id: 'demo-user',
      timestamp: Date.parse('2026-10-18T09:00:00Z'),
      role: 'user',
      text: 'Review what we learned, then show me the evidence.',
      status: 'completed',
    },
    {
      id: 'demo-tool',
      timestamp: Date.parse('2026-10-18T09:00:01Z'),
      role: 'tool',
      text: 'query_personal_knowledge',
      status: 'completed',
    },
    {
      id: 'demo-journal',
      timestamp: Date.parse('2026-10-18T09:00:02Z'),
      role: 'assistant',
      status: 'completed',
      text: visualResponse(
        'I found a reviewable learning: improve prompts and annotations before considering training.',
        journalPresentation,
        'ui://journal-review/main.html',
      ),
    },
  ],
};

const completedTask = ({
  id,
  instruction,
  createdAt,
  album,
  artist,
  response,
  artifacts,
}) => ({
  id,
  instruction,
  workspace: '/workspace/agent-workload-platform',
  plan_hash: 'b7c7c826fd2cbefb00fc84f2ff0bbef34be797e8b3eda40ebebf29f6864d86b2',
  status: 'completed',
  created_at: createdAt,
  session_name: album,
  session_reference: {
    artist,
    spotify_url: `https://open.spotify.com/search/${encodeURIComponent(`${album} ${artist}`)}`,
  },
  result: {
    state: 'completed',
    result: { response, artifacts },
  },
});

const tasks = [completedTask({
  id: 'readme-demo-task',
  instruction: 'Trace the complete voice-to-durable-task journey and explain the isolation boundaries.',
  createdAt: '2026-10-18T09:02:00Z',
  album: 'Kind of Blue',
  artist: 'Miles Davis',
  response: {
    spoken: 'The durable task finished in its isolated session and returned a reviewable architecture map.',
    resourceUri: 'ui://mermaid/main',
    presentation: {
      kind: 'flow',
      title: 'Voice to durable work',
      nodes: [
        { id: 'voice', label: 'Voice conversation' },
        { id: 'gateway', label: 'Capability gateway' },
        { id: 'worker', label: 'Durable worker' },
        { id: 'vm', label: 'Isolated Gondolin VM' },
        { id: 'result', label: 'Reviewable result' },
      ],
      edges: [
        { from: 'voice', to: 'gateway', label: 'delegate' },
        { from: 'gateway', to: 'worker', label: 'queue' },
        { from: 'worker', to: 'vm', label: 'execute' },
        { from: 'vm', to: 'result', label: 'artifact' },
      ],
    },
  },
  artifacts: ['task-result.md', 'architecture.svg'],
}), completedTask({
  id: 'readme-demo-slides',
  instruction: 'Turn the platform architecture into a concise conference presentation.',
  createdAt: '2026-10-18T09:03:00Z',
  album: 'Blue Train',
  artist: 'John Coltrane',
  response: {
    spoken: 'The same MCP App contract can present an architecture story as a navigable Marp deck.',
    resourceUri: 'ui://slides/marp.html',
    presentation: {
      kind: 'slides',
      title: 'Voice agents with explicit boundaries',
      markdown: [
        '---',
        'marp: true',
        'theme: default',
        '---',
        '# Voice agents with explicit boundaries',
        '',
        '**Natural conversation. Durable execution. Reviewable evidence.**',
        '',
        '---',
        '',
        '# One protocol, many review surfaces',
        '',
        '- Voice and typed turns share one Pi session',
        '- Commands cross an explicit capability boundary',
        '- MCP Apps render structured, interactive results',
      ].join('\n'),
    },
  },
  artifacts: ['platform-talk.md'],
}), completedTask({
  id: 'readme-demo-canvas',
  instruction: 'Create an editable system map for the voice and durable execution path.',
  createdAt: '2026-10-18T09:04:00Z',
  album: 'Mingus Ah Um',
  artist: 'Charles Mingus',
  response: {
    spoken: 'Architecture output remains editable when the developer needs to challenge or revise the model.',
    resourceUri: 'ui://excalidraw/mcp-app.html',
    presentation: {
      kind: 'excalidraw',
      title: 'Editable workload boundary',
      elements: [
        { type: 'cameraUpdate', x: 0, y: 0, width: 900, height: 500 },
        {
          type: 'rectangle', id: 'conversation', x: 70, y: 160, width: 210, height: 90,
          backgroundColor: '#a5d8ff', fillStyle: 'solid', label: { text: 'Conversation', fontSize: 20 },
        },
        {
          type: 'arrow', id: 'delegate', x: 280, y: 205, width: 170, height: 0,
          points: [[0, 0], [170, 0]], endArrowhead: 'arrow', label: { text: 'delegate', fontSize: 16 },
        },
        {
          type: 'rectangle', id: 'sandbox', x: 450, y: 160, width: 210, height: 90,
          backgroundColor: '#b2f2bb', fillStyle: 'solid', label: { text: 'Durable sandbox', fontSize: 20 },
        },
        {
          type: 'arrow', id: 'evidence', x: 660, y: 205, width: 150, height: 0,
          points: [[0, 0], [150, 0]], endArrowhead: 'arrow', label: { text: 'evidence', fontSize: 16 },
        },
      ],
    },
  },
  artifacts: ['workload-boundary.excalidraw'],
}), completedTask({
  id: 'readme-demo-trace',
  instruction: 'Inspect the browser evidence for the README product tour.',
  createdAt: '2026-10-18T09:05:00Z',
  album: 'A Love Supreme',
  artist: 'John Coltrane',
  response: {
    spoken: 'The trace keeps browser actions, requests, screenshots, and failures available as inspectable evidence.',
    resourceUri: 'ui://playwright-trace-viewer/main.html',
    presentation: {
      kind: 'playwright-trace-viewer',
      title: 'README product tour',
      status: 'completed',
      summary: 'readme-demo · local reproducible journey',
      project: 'readme-demo',
      run: 'current',
      traceId: '0123456789abcdef0123456789abcdef',
      viewerUrl: 'http://127.0.0.1:9450/trace-viewer/index.html?trace=http%3A%2F%2F127.0.0.1%3A9450%2Fapi%2Fplaywright-traces%2F0123456789abcdef0123456789abcdef%2Ftrace.zip',
      previewUrl: 'http://127.0.0.1:9450/api/playwright-traces/0123456789abcdef0123456789abcdef/preview',
      durationMs: 10900,
      actionCount: 7,
      requestCount: 48,
      errorCount: 0,
      actions: [
        { label: 'Open the private voice workspace', durationMs: 900, status: 'completed' },
        { label: 'Review grounded journal evidence', durationMs: 1200, status: 'completed' },
        { label: 'Inspect durable task output', durationMs: 1200, status: 'completed' },
      ],
    },
  },
  artifacts: ['trace.zip', 'trace-explainer.mp4'],
}), completedTask({
  id: 'readme-demo-observability',
  instruction: 'Inspect the distributed trace for the voice-to-task request.',
  createdAt: '2026-10-18T09:06:00Z',
  album: 'Time Out',
  artist: 'The Dave Brubeck Quartet',
  response: {
    spoken: 'OpenTelemetry connects the user-visible journey to the services and tool calls that produced it.',
    resourceUri: 'ui://grafana/trace.html',
    presentation: {
      kind: 'grafana-trace',
      title: 'Voice to durable task trace',
      traceId: 'fedcba9876543210fedcba9876543210',
      datasourceUid: 'tempo',
      focusSpanId: '2222222222222222',
    },
  },
  artifacts: ['otel-trace.json'],
}), completedTask({
  id: 'readme-demo-onboarding',
  instruction: 'Turn the verified product trace into a narrated onboarding video.',
  createdAt: '2026-10-18T09:07:00Z',
  album: 'Speak No Evil',
  artist: 'Wayne Shorter',
  response: {
    spoken: 'The verified trace is now a narrated onboarding artifact that remains linked to its interactive evidence.',
    resourceUri: 'ui://playwright-trace-viewer/main.html',
    presentation: {
      kind: 'playwright-trace-viewer',
      title: 'New developer onboarding',
      status: 'completed',
      summary: 'README tour · narrated from Playwright evidence',
      project: 'readme-demo',
      run: 'current',
      traceId: '0123456789abcdef0123456789abcdef',
      viewerUrl: 'http://127.0.0.1:9450/trace-viewer/index.html?trace=http%3A%2F%2F127.0.0.1%3A9450%2Fapi%2Fplaywright-traces%2F0123456789abcdef0123456789abcdef%2Ftrace.zip',
      previewUrl: 'http://127.0.0.1:9450/api/playwright-traces/0123456789abcdef0123456789abcdef/preview',
      narratedVideoUrl: 'http://127.0.0.1:9450/api/trace-explainers/89abcdef0123456789abcdef01234567/video',
      narratedDurationSeconds: 148,
      narratedSceneCount: 9,
      durationMs: 10900,
      actionCount: 7,
      requestCount: 48,
      errorCount: 0,
      actions: [
        { label: 'Read the architecture map', durationMs: 1200, status: 'completed' },
        { label: 'Verify browser evidence', durationMs: 1600, status: 'completed' },
        { label: 'Follow the telemetry trace', durationMs: 1400, status: 'completed' },
      ],
    },
  },
  artifacts: ['trace.zip', 'new-developer-onboarding.mp4'],
})];

const json = (route, body) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const attachTourFrame = async (testInfo, page, title) => {
  await testInfo.attach(`tour-frame:${title}`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
};

const attachFullscreenAppFrame = async (
  testInfo,
  page,
  title,
  presentation,
  resourceUri,
  iframeTitle,
  logicalViewport,
) => {
  const elementId = 'readme-capture-host';
  const result = await page.evaluate(async ({ id, value, uri }) => {
    const host = document.getElementById(id) ?? document.createElement('div');
    host.id = id;
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      width: '100vw',
      height: '100vh',
      background: '#0b0f12',
      display: 'block',
    });
    if (!host.isConnected) document.body.append(host);
    return window.voiceBridge.mountMcpApp(id, value, uri);
  }, { id: elementId, value: presentation, uri: resourceUri });
  expect(JSON.parse(result)).toEqual({ ok: true });

  const iframe = page.locator(`#${elementId} iframe[title="${iframeTitle}"]`);
  await expect(iframe).toBeVisible();
  if (logicalViewport) {
    await iframe.evaluate((element, viewport) => {
      const scale = window.innerWidth / viewport.width;
      Object.assign(element.style, {
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      });
    }, logicalViewport);
  }
  await page.waitForTimeout(500);
  await testInfo.attach(`tour-frame:${title}`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate((id) => {
    const host = document.getElementById(id);
    if (host) host.style.display = 'none';
  }, elementId);
};

test('walks through the Voice Agent for the README', async ({
  page,
  browserEvidence,
}, testInfo) => {
  let activeTranscript = landingTranscript;
  let tracePreview;
  await page.route('**/api/pi-transcript', (route) => json(route, activeTranscript));
  await page.route('**/api/pi-context', (route) => json(route, {
    tokens: 2380,
    contextWindow: 32768,
    percent: 7.3,
    estimated: false,
    canCompact: true,
  }));
  await page.route('**/api/pi-sessions', (route) => json(route, {
    sessions: [
      {
        id: 'readme-demo-live',
        title: 'Voice orchestrator',
        updatedAt: '2026-10-18T09:02:00Z',
        messageCount: 3,
        active: true,
      },
      {
        id: 'readme-demo-history',
        title: 'Architecture review',
        updatedAt: '2026-10-17T16:30:00Z',
        messageCount: 18,
        active: false,
      },
    ],
  }));
  await page.route('**/api/tasks', (route) => json(route, tasks));
  await page.route('**/api/playwright-traces/**/preview', (route) => {
    if (!tracePreview) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'image/png', body: tracePreview });
  });
  await page.route('**/api/grafana-mcp/traces/**', (route) => json(route, {
    traceId: 'fedcba9876543210fedcba9876543210',
    datasourceUid: 'tempo',
    grafanaUrl: 'http://127.0.0.1:8080/metrics/',
    spans: [
      {
        id: '1111111111111111',
        name: 'POST /api/tasks',
        serviceName: 'voice-edge',
        startTimeMs: 1792314000000,
        durationMs: 842.4,
        status: 'ok',
        attributes: {
          'http.request.method': 'POST',
          'http.response.status_code': 202,
          'http.route': '/api/tasks',
        },
        events: [],
      },
      {
        id: '2222222222222222',
        parentId: '1111111111111111',
        name: 'durable.submit',
        serviceName: 'tasking-rpc',
        startTimeMs: 1792314000082,
        durationMs: 619.8,
        status: 'ok',
        attributes: {
          'rpc.system': 'connect_rpc',
          'task.session_name': 'Time Out',
        },
        events: [],
      },
      {
        id: '3333333333333333',
        parentId: '2222222222222222',
        name: 'gondolin.execute',
        serviceName: 'durable-worker',
        startTimeMs: 1792314000205,
        durationMs: 401.2,
        status: 'ok',
        attributes: {
          'task.runtime': 'gondolin',
          'task.result': 'completed',
        },
        events: [],
      },
    ],
  }));

  await test.step('Tour [Private workspace]: I am tired of reading endless agent conversations. This private workspace lets me speak to the agent, see its work, and decide what to explore. The local and tailnet entry points keep that experience inside an explicit access boundary.', async () => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
    await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
    await attachTourFrame(testInfo, page, 'Private workspace');
    await page.waitForTimeout(900);
  });

  await test.step('Tour [Shared Pi transcript]: Voice and typed turns share a resumable Pi session. I can listen first, then inspect the transcript only when I need exact words or evidence. This synthetic tour needs no microphone, private conversation, or Tailscale connection.', async () => {
    activeTranscript = transcript;
    await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
    await expect(page.getByRole('button', { name: 'Show diagram', exact: true })).toBeVisible();
    await attachTourFrame(testInfo, page, 'Shared Pi transcript');
    await page.waitForTimeout(900);
  });

  await test.step('Tour [Durable work]: When work takes longer, I can switch from the live conversation to its durable session without losing the thread. Status, artifacts, and a memorable name help me return to the right job and ask what happens next.', async () => {
    await page.getByRole('button', { name: /^Tasks 6 recent$/ }).click({ timeout: 10_000 });
    await expect(page.getByText('Kind of Blue', { exact: true })).toBeVisible();
    const task = page.getByRole('group', { name: /^Kind of Blue/ });
    await expect(task.getByRole('button', { name: 'Listen on Spotify' })).toBeVisible();
    await attachTourFrame(testInfo, page, 'Durable work');
    tracePreview = await page.screenshot();
    await page.waitForTimeout(900);
  });

  await test.step('Tour [Mermaid]: A Mermaid map lets me see the journey before reading implementation details. It shows how conversation hands work to the gateway and durable worker, then into an isolated Gondolin VM. The boundary is visible enough to question.', async () => {
    const task = page.getByRole('group', { name: /^Kind of Blue/ });
    await task.getByRole('button', { name: 'Show diagram', exact: true }).click();
    const diagram = page.frameLocator('iframe[title="Pi Mermaid diagram"]');
    await expect(diagram.getByRole('img', { name: 'Voice to durable work' })).toBeVisible();
    await attachFullscreenAppFrame(
      testInfo,
      page,
      'Mermaid',
      tasks[0].result.result.response.presentation,
      'ui://mermaid/main',
      'Pi Mermaid diagram',
    );
    await page.waitForTimeout(1200);
    await task.getByRole('button', { name: 'Hide diagram', exact: true }).click();
    await expect(page.locator('iframe[title="Pi Mermaid diagram"]:visible')).toHaveCount(0);
  });

  await test.step('Tour [Marp]: The same result becomes Marp slides. I can move from exploring a system to presenting what I found without rewriting the agent output. The slides are a way to discuss the work, not a replacement for its evidence.', async () => {
    const task = page.getByRole('group', { name: /^Blue Train/ });
    await task.scrollIntoViewIfNeeded();
    await task.getByRole('button', { name: 'Show diagram', exact: true }).click();
    const slides = page.frameLocator('iframe[title="Pi Marp slides"]');
    await expect(slides.getByText('Voice agents with explicit boundaries')).toBeVisible();
    await attachFullscreenAppFrame(
      testInfo,
      page,
      'Marp',
      tasks[1].result.result.response.presentation,
      'ui://slides/marp.html',
      'Pi Marp slides',
    );
    await page.waitForTimeout(1200);
    await task.getByRole('button', { name: 'Hide diagram', exact: true }).click();
    await expect(page.locator('iframe[title="Pi Marp slides"]:visible')).toHaveCount(0);
  });

  await test.step('Tour [Excalidraw]: Excalidraw makes the architecture editable. I can move a component, challenge a boundary, and bring the corrected picture back to the conversation. Seeing the model is useful; being able to change it is better.', async () => {
    const task = page.getByRole('group', { name: /^Mingus Ah Um/ });
    await task.scrollIntoViewIfNeeded();
    await task.getByRole('button', { name: 'Show diagram', exact: true }).click();
    const canvas = page.frameLocator('iframe[title="Editable Excalidraw diagram"]');
    await expect(canvas.locator('.excalidraw-container svg')).toBeVisible();
    await expect(canvas.getByText('Conversation')).toBeVisible();
    await attachFullscreenAppFrame(
      testInfo,
      page,
      'Excalidraw',
      tasks[2].result.result.response.presentation,
      'ui://excalidraw/mcp-app.html',
      'Editable Excalidraw diagram',
    );
    await page.waitForTimeout(1200);
    await task.getByRole('button', { name: 'Hide diagram', exact: true }).click();
    await expect(page.locator('iframe[title="Editable Excalidraw diagram"]:visible')).toHaveCount(0);
  });

  await test.step('Tour [Playwright Trace Viewer]: The Trace MCP App lets me explore what the browser actually did. Screenshots, actions, requests, and errors sit beside the agent story, so I can verify a claim and find the exact moment something worked or failed.', async () => {
    await page.mouse.move(1100, 760);
    await page.mouse.wheel(0, 900);
    const task = page.getByRole('group', { name: /^A Love Supreme/ });
    await task.scrollIntoViewIfNeeded();
    await task.getByRole('button', { name: 'Show diagram', exact: true }).click();
    const trace = page.frameLocator('iframe[title="Playwright Trace Viewer"]');
    await expect(trace.getByRole('heading', { name: 'README product tour' })).toBeVisible();
    await expect(trace.getByText('0', { exact: true })).toBeVisible();
    await expect(trace.locator('#preview img')).toBeVisible();
    await attachFullscreenAppFrame(
      testInfo,
      page,
      'Playwright Trace Viewer',
      tasks[3].result.result.response.presentation,
      'ui://playwright-trace-viewer/main.html',
      'Playwright Trace Viewer',
      { width: 1440, height: 810 },
    );
    await page.waitForTimeout(1200);
    await task.getByRole('button', { name: 'Hide diagram', exact: true }).click();
    await expect(page.locator('iframe[title="Playwright Trace Viewer"]:visible')).toHaveCount(0);
  });

  await test.step('Tour [Grafana Trace]: OpenTelemetry and Grafana connect that visible browser moment to the services behind it. I can follow a symptom into the responsible span and understand the path of a durable task without piecing together disconnected logs.', async () => {
    await page.mouse.move(1100, 760);
    await page.mouse.wheel(0, 700);
    const task = page.getByRole('group', { name: /^Time Out/ });
    await task.scrollIntoViewIfNeeded();
    await task.getByRole('button', { name: 'Show diagram', exact: true }).click();
    const grafana = page.frameLocator('iframe[title="Grafana trace"]');
    await expect(grafana.getByText('Loading trace...')).toBeHidden({ timeout: 15_000 });
    await expect(grafana.getByText('Span waterfall')).toBeVisible();
    await expect(grafana.locator('body')).toContainText('durable-worker');
    await attachFullscreenAppFrame(
      testInfo,
      page,
      'Grafana Trace',
      tasks[4].result.result.response.presentation,
      'ui://grafana/trace.html',
      'Grafana trace',
      { width: 1440, height: 810 },
    );
    await page.waitForTimeout(1400);
    await task.getByRole('button', { name: 'Hide diagram', exact: true }).click();
    await expect(page.locator('iframe[title="Grafana trace"]:visible')).toHaveCount(0);
  });

  await test.step('Tour [Trace video onboarding]: The verified trace can become this narrated onboarding video. A new developer can listen to the story, then return to the interactive evidence to explore a detail. The walkthrough comes from the tested product rather than a separate screen recording.', async () => {
    const task = page.getByRole('group', { name: /^Speak No Evil/ });
    await task.scrollIntoViewIfNeeded();
    await task.getByRole('button', { name: 'Show diagram', exact: true }).click();
    const trace = page.frameLocator('iframe[title="Playwright Trace Viewer"]');
    await expect(trace.getByRole('heading', { name: 'New developer onboarding' })).toBeVisible();
    await expect(trace.getByRole('button', { name: 'Open narrated video' })).toBeVisible();
    await expect(trace.locator('#preview img')).toBeVisible();
    await attachFullscreenAppFrame(
      testInfo,
      page,
      'Trace video onboarding',
      tasks[5].result.result.response.presentation,
      'ui://playwright-trace-viewer/main.html',
      'Playwright Trace Viewer',
      { width: 1440, height: 810 },
    );
    await page.waitForTimeout(1400);
  });

  await test.step('Tour [Personal knowledge graph]: Finally, Journal Review puts a proposed fact beside its source quote. I choose what enters my personal knowledge graph. Over time, reviewed learning can shape a digital professional twin; a confident extraction alone cannot speak for me.', async () => {
    await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
    await page.getByRole('button', { name: 'Show diagram', exact: true }).click();
    const journal = page.frameLocator('iframe[title="Journal Review"]');
    await expect(journal.getByText('Personal knowledge graph review')).toBeVisible();
    await expect(journal.getByText('Improve prompts and reviewed annotations before model training.')).toBeVisible();
    await attachFullscreenAppFrame(
      testInfo,
      page,
      'Personal knowledge graph',
      journalPresentation,
      'ui://journal-review/main.html',
      'Journal Review',
      { width: 1440, height: 810 },
    );
    await page.waitForTimeout(1400);
  });

  await testInfo.attach('readme-demo-final', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(async () => {
    if (typeof window.voiceBridge.unmountMcpApp === 'function') {
      await window.voiceBridge.unmountMcpApp('readme-capture-host');
    }
    document.getElementById('readme-capture-host')?.remove();
  });
  expectCleanBrowser(browserEvidence);
});
