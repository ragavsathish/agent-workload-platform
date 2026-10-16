import assert from 'node:assert/strict';
import test from 'node:test';

import { createPiWebMcpTools, installPiWebMcpTools } from './webmcp_tools.js';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return structuredClone(body); },
});

test('progressively opts out when WebMCP is unavailable', async () => {
  assert.deepEqual(
    await installPiWebMcpTools({ fetchImpl: async () => jsonResponse({}) }),
    { supported: false, registered: [] },
  );
});

test('registers the bounded workspace tools with safety annotations', async () => {
  const registered = [];
  const result = await installPiWebMcpTools({
    modelContext: {
      async registerTool(tool, options) { registered.push({ tool, options }); },
    },
    fetchImpl: async () => jsonResponse({}),
  });

  assert.deepEqual(result.registered, [
    'get_pi_workspace_state',
    'send_pi_message',
    'create_pending_task',
  ]);
  assert.equal(registered[0].tool.annotations.readOnlyHint, true);
  assert.equal(registered[1].tool.annotations.readOnlyHint, false);
  assert.equal(registered[2].tool.description.includes('not approved or executed'), true);
  assert.equal(registered.every(({ options }) => options.signal instanceof AbortSignal), true);
});

test('returns bounded state and uses only fixed same-origin API paths', async () => {
  const requested = [];
  const fetchImpl = async (path, options) => {
    requested.push({ path, options });
    if (path === '/api/pi-context') {
      return jsonResponse({ tokens: 1200, contextWindow: 8000, percent: 15, canCompact: true });
    }
    if (path === '/api/pi-transcript') {
      return jsonResponse({
        revision: 7,
        entries: Array.from({ length: 15 }, (_, index) => ({
          id: `entry-${index}`,
          role: 'assistant',
          text: index === 14 ? 'x'.repeat(2500) : `entry ${index}`,
        })),
      });
    }
    if (path === '/api/tasks') {
      return jsonResponse(Array.from({ length: 14 }, (_, index) => ({
        id: `task-${index}`,
        instruction: `task ${index}`,
        status: 'pending',
      })));
    }
    throw new Error(`Unexpected path ${path}`);
  };
  const [stateTool] = createPiWebMcpTools({ fetchImpl });

  const state = await stateTool.execute({});

  assert.deepEqual(requested.map(({ path }) => path).sort(), [
    '/api/pi-context',
    '/api/pi-transcript',
    '/api/tasks',
  ]);
  assert.equal(requested.every(({ options }) => options.credentials === 'same-origin'), true);
  assert.equal(state.transcript.entries.length, 12);
  assert.equal(state.transcript.entries.at(-1).text.length, 2001);
  assert.equal(state.tasks.length, 12);
});

test('validates mutations and forwards cancellation to fetch', async () => {
  const calls = [];
  const notifications = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return path === '/api/tasks'
      ? jsonResponse({ id: 'task-1', instruction: 'Inspect', status: 'pending' })
      : jsonResponse({ spoken: 'Done', mermaid: 'flowchart LR\nA --> B' });
  };
  const [, messageTool, taskTool] = createPiWebMcpTools({
    fetchImpl,
    notify: (event) => notifications.push(event),
  });
  await assert.rejects(() => messageTool.execute({ message: '  ' }), /non-empty/);

  const controller = new AbortController();
  assert.equal((await messageTool.execute(
    { message: 'Inspect the workspace' },
    { signal: controller.signal },
  )).spoken, 'Done');
  assert.equal((await taskTool.execute({ instruction: 'Inspect' })).status, 'pending');

  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: 'Inspect the workspace' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { instruction: 'Inspect' });
  assert.deepEqual(notifications.map(({ action }) => action), ['message', 'task-created']);
});
