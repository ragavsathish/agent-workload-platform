import fs from 'node:fs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

import {
  abortActiveTurn,
  beginTurn,
  changeTaskStatus,
  compactContext,
  completeTurn,
  completedTurnResponse,
  contextUsage,
  createInitialFixtureState,
  createTask,
  historicalTranscript,
  interruptedTurnResponse,
  resumeSession,
  sessionSummaries,
  startNewSession,
  transcriptSnapshot,
} from './patrol-fixture-domain.mjs';

const requestedPort = Number(process.env.PATROL_FIXTURE_PORT ?? 54321);
const readyFile = process.env.PATROL_FIXTURE_READY_FILE;
const fixtureNonce = process.env.PATROL_FIXTURE_NONCE ?? randomUUID();
const clock = Object.freeze({
  now: () => new Date().toISOString(),
  timestamp: () => Date.now(),
});
let state = createInitialFixtureState();
const pendingTurns = new Map();

const headers = {
  'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

const json = (response, status, body) => {
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
};

const apply = (transition) => {
  state = transition.state;
  return transition;
};

const statusFor = (error) => switchError(error, {
  SessionNotFound: 404,
  TaskNotFound: 404,
  TurnAlreadyActive: 409,
});

const switchError = (error, statuses) => statuses[error.type] ?? 400;

const sendTransition = (response, transition, successStatus = 200) => {
  if (transition.type === 'Err') {
    json(response, statusFor(transition.error), {
      detail: transition.error.type,
    });
    return false;
  }
  json(response, successStatus, transition.value);
  return true;
};

const silentWav = () => {
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
};

const bodyOf = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const completeActiveTurn = async (message) => {
  const started = apply(beginTurn(state, message, { now: clock.timestamp }));
  if (started.type === 'Err') return started;
  const turn = started.value;
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('completed'), 1800);
    pendingTurns.set(turn.id, {
      release: () => {
        clearTimeout(timer);
        resolve('interrupted');
      },
    });
  });
  pendingTurns.delete(turn.id);
  if (outcome === 'completed') state = completeTurn(state, turn.id);
  return {
    type: 'Ok',
    state,
    value: outcome === 'completed'
      ? completedTurnResponse(message)
      : interruptedTurnResponse(),
  };
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, {
      ok: true,
      fixture: 'voice-agent-patrol',
      nonce: fixtureNonce,
    });
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
    json(response, 200, contextUsage(state));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-context/compact') {
    sendTransition(response, apply(compactContext(state)));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/pi-transcript') {
    json(response, 200, transcriptSnapshot(state));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/pi-sessions') {
    json(response, 200, sessionSummaries(state));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-sessions/new') {
    sendTransition(response, apply(startNewSession(state, clock)), 201);
    return;
  }
  const resumeMatch = url.pathname.match(/^\/api\/pi-sessions\/([^/]+)\/resume$/);
  if (request.method === 'POST' && resumeMatch) {
    sendTransition(response, apply(resumeSession(state, resumeMatch[1], clock)));
    return;
  }
  const sessionMatch = url.pathname.match(/^\/api\/pi-sessions\/([^/]+)$/);
  if (request.method === 'GET' && sessionMatch) {
    sendTransition(response, historicalTranscript(state, sessionMatch[1]));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-message') {
    const body = await bodyOf(request);
    sendTransition(response, await completeActiveTurn(body.message));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/pi-turn/abort') {
    const transition = apply(abortActiveTurn(state));
    const pending = pendingTurns.get(transition.value.turnId);
    pending?.release();
    json(response, 200, { status: 'stopped' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    json(response, 200, state.tasks);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await bodyOf(request);
    sendTransition(response, apply(createTask(state, body.instruction, clock)), 201);
    return;
  }
  const action = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(approve|cancel)$/);
  if (request.method === 'POST' && action) {
    const status = action[2] === 'approve' ? 'approved' : 'cancelled';
    sendTransition(response, apply(changeTaskStatus(state, action[1], status)));
    return;
  }
  json(response, 404, { detail: 'fixture route not found' });
});

server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Patrol fixture did not bind a TCP address.');
  }
  const ready = {
    fixture: 'voice-agent-patrol',
    nonce: fixtureNonce,
    port: address.port,
  };
  if (readyFile) fs.writeFileSync(readyFile, `${JSON.stringify(ready)}\n`);
  console.log(`Patrol fixture listening on http://127.0.0.1:${address.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
