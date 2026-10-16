import http from 'node:http';
const port = Number(process.env.PATROL_FIXTURE_PORT ?? 54321);
let revision = 1;
let activeTurn = null;
let activeSessionId = 'fixture-live';
let freshSession = false;
const entries = [
  {
    id: 'fixture-tool',
    timestamp: Date.parse('2026-10-16T07:59:59Z'),
    role: 'tool',
    text: 'read_workspace',
    status: 'completed',
  },
  {
    id: 'fixture-assistant',
    timestamp: Date.parse('2026-10-16T08:00:00Z'),
    role: 'assistant',
    text: JSON.stringify({
      spoken: 'Ready from the HTTP fixture.',
      mermaid: 'flowchart LR\nBrowser --> Pi',
    }),
  },
];
const tasks = [
  {
    id: 'fixture-task',
    instruction: 'Review the fixture deployment',
    workspace: '/workspace',
    plan_hash: 'fixture-plan',
    status: 'pending',
    created_at: '2026-10-16T08:00:00Z',
  },
];
const historicalSessions = new Map([
  ['fixture-history', {
    title: 'Release review',
    updatedAt: '2026-10-15T18:30:00Z',
    entries: [
      {
        id: 'history-user',
        timestamp: Date.parse('2026-10-15T18:29:00Z'),
        role: 'user',
        text: 'How did the release go?',
      },
      {
        id: 'history-assistant',
        timestamp: Date.parse('2026-10-15T18:30:00Z'),
        role: 'assistant',
        text: 'The release completed successfully.',
        status: 'completed',
      },
    ],
  }],
]);

const headers = {
  'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

function json(response, status, body) {
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function silentWav() {
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-speech') {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const audio = silentWav();
    response.writeHead(200, {
      ...headers,
      'Content-Length': audio.length,
      'Content-Type': 'audio/wav',
    });
    response.end(audio);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/pi-context') {
    json(response, 200, {
      tokens: freshSession ? null : 1200,
      contextWindow: freshSession ? null : 8000,
      percent: freshSession ? null : 15,
      estimated: false,
      canCompact: !freshSession,
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-context/compact') {
    json(response, 200, {
      tokens: 600,
      contextWindow: 8000,
      percent: 7.5,
      estimated: false,
      canCompact: false,
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/pi-transcript') {
    json(response, 200, { revision, entries });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/pi-sessions') {
    json(response, 200, {
      sessions: [
        {
          id: activeSessionId,
          title: 'Voice orchestrator',
          updatedAt: '2026-10-16T08:00:00Z',
          messageCount: entries.length,
          active: true,
        },
        ...[...historicalSessions].map(([id, session]) => ({
          id,
          title: session.title,
          updatedAt: session.updatedAt,
          messageCount: session.entries.length,
          active: false,
        })),
      ],
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-sessions/new') {
    historicalSessions.set(activeSessionId, {
      title: 'Previous voice session',
      updatedAt: new Date().toISOString(),
      entries: structuredClone(entries),
    });
    activeSessionId = 'fixture-live-2';
    freshSession = true;
    entries.splice(0, entries.length);
    revision += 1;
    json(response, 201, { id: activeSessionId });
    return;
  }
  const resumeMatch = url.pathname.match(/^\/api\/pi-sessions\/([^/]+)\/resume$/);
  if (request.method === 'POST' && resumeMatch && historicalSessions.has(resumeMatch[1])) {
    const next = historicalSessions.get(resumeMatch[1]);
    historicalSessions.set(activeSessionId, {
      title: 'Previous voice session',
      updatedAt: new Date().toISOString(),
      entries: structuredClone(entries),
    });
    historicalSessions.delete(resumeMatch[1]);
    activeSessionId = resumeMatch[1];
    freshSession = false;
    entries.splice(0, entries.length, ...structuredClone(next.entries));
    revision += 1;
    json(response, 200, { id: activeSessionId });
    return;
  }
  const sessionMatch = url.pathname.match(/^\/api\/pi-sessions\/([^/]+)$/);
  if (request.method === 'GET' && sessionMatch && historicalSessions.has(sessionMatch[1])) {
    const session = historicalSessions.get(sessionMatch[1]);
    json(response, 200, {
      revision: 1,
      entries: session.entries,
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-message') {
    const body = await bodyOf(request);
    const visual = {
      spoken: `Fixture response to: ${body.message}`,
      mermaid: 'flowchart LR\nRequest --> Response',
    };
    freshSession = false;
    revision += 1;
    const assistant = {
      id: `fixture-assistant-${revision}`,
      timestamp: Date.now(),
      role: 'assistant',
      text: 'Inspecting the fixture…',
      status: 'running',
    };
    entries.push(
      {
        id: `fixture-user-${revision}`,
        timestamp: Date.now(),
        role: 'user',
        text: body.message,
      },
      assistant,
    );
    let release;
    const interrupted = new Promise((resolve) => {
      release = resolve;
    });
    const timer = setTimeout(release, 1800);
    const turn = { assistant, aborted: false, release };
    activeTurn = turn;
    await interrupted;
    clearTimeout(timer);
    if (!turn.aborted) {
      assistant.text = JSON.stringify(visual);
      assistant.status = 'completed';
      revision += 1;
    }
    if (activeTurn === turn) activeTurn = null;
    json(response, 200, turn.aborted ? {
      spoken: 'Response stopped.',
      mermaid: 'flowchart LR\nRequest --> Stopped',
    } : visual);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-turn/abort') {
    if (activeTurn) {
      activeTurn.aborted = true;
      activeTurn.assistant.status = 'completed';
      revision += 1;
      activeTurn.release();
    }
    json(response, 200, { status: 'stopped' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    json(response, 200, tasks);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await bodyOf(request);
    const task = {
      id: `fixture-task-${tasks.length + 1}`,
      instruction: body.instruction,
      workspace: '/workspace',
      plan_hash: `fixture-plan-${tasks.length + 1}`,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    tasks.unshift(task);
    json(response, 201, task);
    return;
  }
  const action = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(approve|cancel)$/);
  if (request.method === 'POST' && action) {
    const task = tasks.find((candidate) => candidate.id === action[1]);
    if (!task) {
      json(response, 404, { detail: 'task not found' });
      return;
    }
    task.status = action[2] === 'approve' ? 'approved' : 'cancelled';
    json(response, 200, task);
    return;
  }
  json(response, 404, { detail: 'fixture route not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Patrol fixture listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
