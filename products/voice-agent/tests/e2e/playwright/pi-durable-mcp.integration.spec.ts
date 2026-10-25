import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as allure from 'allure-js-commons';
import { test } from '@playwright/test';

test('Pi agent calls an allowlisted product MCP tool', async ({}, testInfo) => {
  await allure.epic('Durable work');
  await allure.feature('Pi Durable tool registration');
  await allure.story('Agent uses an MCP product tool');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  const { fauxAssistantMessage, fauxProvider, fauxToolCall } =
    await import('@earendil-works/pi-ai/providers/faux');
  const { McpClient } = await import('@earendil-works/pi-mcp');
  const { createInMemoryTransportPair } = await import('@earendil-works/pi-mcp/testing');
  const { DurableTaskSession } =
    await import('../../../../../platform/agent-execution/pi-durable-task/dist/runtime.js');
  const directory = await mkdtemp(join(tmpdir(), 'pi-durable-mcp-journey-'));
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('mcp__journal__read_entry', { id: 'entry-1' }),
      { stopReason: 'toolUse' }),
    fauxAssistantMessage('Journal entry reviewed.'),
  ]);
  const config = { name: 'journal', allowedTools: ['read_entry'] };
  const connectMockMcp = async () => {
    const transport = createInMemoryTransportPair();
    await transport.server.start();
    transport.server.onMessage((message) => {
      if (!('id' in message) || !('method' in message)) return;
      const params = message.params as Record<string, unknown> | undefined;
      let result: unknown;
      if (message.method === 'initialize') {
        result = { protocolVersion: '2025-11-25', capabilities: { tools: {} },
          serverInfo: { name: 'journal-mock', version: '1.0.0' } };
      } else if (message.method === 'tools/list') {
        result = { tools: [{ name: 'read_entry', description: 'Read one journal entry',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }] };
      } else if (message.method === 'tools/call') {
        calls.push({ name: String(params?.name),
          args: (params?.arguments as Record<string, unknown>) ?? {} });
        result = { content: [{ type: 'text', text: 'Reviewed content' }] };
      } else return;
      void transport.server.send({ jsonrpc: '2.0', id: message.id, result });
    });
    const client = new McpClient({ name: 'pi-durable-test', version: '1.0.0' });
    await client.connect(transport.client);
    return client;
  };
  const baseOptions = {
    storagePath: join(directory, 'session.sqlite'), workspace: directory,
    model: { provider: faux.provider.id, modelId: faux.models[0].id }, models,
  };
  try {
    await allure.step('Given a Pi Durable agent connects to one allowlisted journal MCP server', async () => {
      assert.deepEqual(config.allowedTools, ['read_entry']);
    });
    const first = await allure.step('When the agent receives a journal review request', async () => {
      const session = await DurableTaskSession.open({ ...baseOptions,
        mcpClients: [{ config, client: await connectMockMcp() }] });
      try { return await session.submit('Review entry-1', 'journal-review-1'); }
      finally { await session.close(); }
    });
    await allure.step('Then Pi calls the MCP tool and returns the agent answer', async () => {
      assert.deepEqual(calls, [{ name: 'read_entry', args: { id: 'entry-1' } }]);
      assert.equal(first.text, 'Journal entry reviewed.');
    });
    await testInfo.attach('pi-durable-mcp-evidence', {
      body: Buffer.from(JSON.stringify({ requestId: 'journal-review-1', toolCalls: calls,
        answer: first.text }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Pi Durable session selects host or Gondolin tools without changing the answer', async ({}, testInfo) => {
  await allure.epic('Durable work');
  await allure.feature('Pi session execution mode');
  await allure.story('Agent session runs on host or in Gondolin');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  const { fauxAssistantMessage, fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
  const { runPiSession } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/session-execution.js');
  const directory = await mkdtemp(join(tmpdir(), 'pi-durable-mode-'));
  const previous = {
    mode: process.env.WORKER_PI_EXECUTION_MODE,
    sessionDir: process.env.PI_SESSION_DIR,
    model: process.env.PI_MODEL,
    socketDir: process.env.PI_TASK_SESSION_SOCKET_DIR,
  };
  const calls: Array<{ mode: string; imagePath?: string; mounts?: Record<string, unknown> }> = [];
  try {
    process.env.PI_SESSION_DIR = directory;
    process.env.PI_TASK_SESSION_SOCKET_DIR = join('/tmp', `pi-task-${process.pid}`);
    for (const mode of ['host', 'gondolin']) {
      const faux = fauxProvider();
      const models = createModels();
      models.setProvider(faux.provider);
      faux.setResponses([fauxAssistantMessage('Workspace ready.')]);
      process.env.WORKER_PI_EXECUTION_MODE = mode;
      process.env.PI_MODEL = `${faux.provider.id}/${faux.models[0].id}`;
      const input = { taskId: mode === 'host' ? '00000000-0000-4000-8000-000000000001'
        : '00000000-0000-4000-8000-000000000002', workspace: directory,
        instruction: 'Prepare the workspace.', imageRef: '/images/task.ext4' };
      await allure.step(`Given deployment mode ${mode} and a task workspace`, async () => {
        assert.equal(process.env.WORKER_PI_EXECUTION_MODE, mode);
      });
      const answer = await allure.step('When the owner starts the native Pi session', async () => {
        return runPiSession(input, { models, createGondolinSession: (options) => {
          calls.push({ mode, imagePath: options.imagePath, mounts: options.mounts });
          return { start: async () => {}, close: async () => {} } as any;
        } });
      });
      await allure.step('Then the answer is returned through the same task contract', async () => {
        assert.equal(answer, 'Workspace ready.');
      });
    }
    assert.deepEqual(calls.map((call) => call.mode), ['gondolin']);
    assert.equal(calls[0].imagePath, '/images/task.ext4');
    assert.equal(calls[0].mounts?.['/workspace'], directory);
    await testInfo.attach('pi-session-mode-evidence', {
      body: Buffer.from(JSON.stringify({ modes: ['host', 'gondolin'], calls }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    const { closeTaskSessions } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/remote-session.js');
    await closeTaskSessions();
    await rm(join('/tmp', `pi-task-${process.pid}`), { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      const name = key === 'sessionDir' ? 'PI_SESSION_DIR' : key === 'socketDir' ? 'PI_TASK_SESSION_SOCKET_DIR'
        : key === 'mode' ? 'WORKER_PI_EXECUTION_MODE' : 'PI_MODEL';
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('Repository task VM receives only its repository writer', async ({}, testInfo) => {
  await allure.epic('Durable work');
  await allure.feature('Repository VM access');
  await allure.story('Task VM can address its own Gitea repository');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  const { fauxAssistantMessage, fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
  const { runPiSession } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/session-execution.js');
  const directory = await mkdtemp(join(tmpdir(), 'pi-repo-vm-'));
  const socketDirectory = join('/tmp', `pi-repo-vm-${process.pid}`);
  const previous = Object.fromEntries(['WORKER_PI_EXECUTION_MODE', 'GITEA_TASK_TOKEN_DIR',
    'GITEA_ENDPOINT_URL', 'GITEA_OWNER', 'PI_SESSION_DIR', 'PI_TASK_SESSION_SOCKET_DIR', 'PI_MODEL']
    .map((key) => [key, process.env[key]]));
  const token = 'fixture-repository-writer-token';
  try {
    await mkdir(join(directory, '.pi'));
    await mkdir(join(directory, '.pi', 'hooks'));
    await writeFile(join(directory, '.pi', 'hooks', 'configure-gitea.clj'), '(println "ready")\n');
    await writeFile(join(directory, '.pi', 'hooks', 'push-non-main.clj'), '(println "pushed")\n');
    await writeFile(join(directory, '.pi', 'gondolin.json'), JSON.stringify({
      gitea: { repository: 'agent-workload-platform', access: 'write' },
      hooks: { sessionStart: '.pi/hooks/configure-gitea.clj', sessionStop: '.pi/hooks/push-non-main.clj' },
    }));
    await writeFile(join(directory, 'gitea-task-agent-workload-platform-token'), token);
    process.env.WORKER_PI_EXECUTION_MODE = 'gondolin';
    process.env.GITEA_TASK_TOKEN_DIR = directory;
    process.env.GITEA_ENDPOINT_URL = 'http://127.0.0.1:3001';
    process.env.GITEA_OWNER = 'source-publisher';
    process.env.PI_SESSION_DIR = directory;
    process.env.PI_TASK_SESSION_SOCKET_DIR = socketDirectory;
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage('Repository ready.')]);
    process.env.PI_MODEL = `${faux.provider.id}/${faux.models[0].id}`;
    let vmOptions: any;
    let stopCommand: string[] | undefined;
    await allure.step('Given Pi JSON declares this repository and its writer credential exists', async () => {
      assert.equal((await readFile(join(directory, 'gitea-task-agent-workload-platform-token'), 'utf8')), token);
    });
    await allure.step('And a task for another repository cannot use that declaration', async () => {
      await assert.rejects(runPiSession({ taskId: '00000000-0000-4000-8000-000000000080',
        workspace: directory, instruction: 'Inspect this repository.',
        giteaRepository: 'sdft-confsft-methods-paper', imageRef: '/images/task.ext4' },
      { models }), /does not match the task workspace/);
    });
    const answer = await allure.step('When the native Pi task starts its VM', async () => {
      return runPiSession({ taskId: '00000000-0000-4000-8000-000000000081',
        workspace: directory, instruction: 'Inspect this repository.',
        giteaRepository: 'agent-workload-platform', imageRef: '/images/task.ext4' },
      { models, createGondolinSession: (options) => {
        vmOptions = options;
        return { start: async () => {}, close: async () => {},
          run: async (command: string[]) => {
            stopCommand = command;
            return { ok: true, stdout: '', stderr: '', exitCode: 0 };
          } } as any;
      } });
    });
    await allure.step('Then Pi runs the repository Clojure hooks with only its writer credential', async () => {
      assert.equal(answer, 'Repository ready.');
      assert.equal(vmOptions.environment.GITEA_REPOSITORY, 'agent-workload-platform');
      assert.ok(vmOptions.network.allowedHosts.includes('gitea.local'));
      assert.match(vmOptions.environment.GITEA_USERNAME, /^vm-[a-f0-9]{20}$/);
      assert.equal(vmOptions.environment.GITEA_TOKEN, undefined);
      assert.equal(vmOptions.network.secrets.GITEA_TOKEN.value, token);
      assert.deepEqual(vmOptions.network.secrets.GITEA_TOKEN.hosts, ['127.0.0.1']);
      assert.deepEqual(vmOptions.startupCommands.at(-1),
        ['/usr/local/bin/bb', '/workspace/.pi/hooks/configure-gitea.clj']);
      assert.deepEqual(stopCommand, ['/usr/local/bin/bb', '/workspace/.pi/hooks/push-non-main.clj',
        'pi/task-00000000-0000-4000-8000-000000000081',
        'http://gitea.local:3001/source-publisher/agent-workload-platform.git']);
    });
    await testInfo.attach('repository-vm-routing', { body: Buffer.from(JSON.stringify({
      repository: vmOptions.environment.GITEA_REPOSITORY,
      guestHost: 'gitea.local',
      remote: 'source-publisher/agent-workload-platform',
      stopHook: stopCommand?.[1],
      answer,
    })), contentType: 'application/json' });
  } finally {
    const { closeTaskSessions } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/remote-session.js');
    await closeTaskSessions();
    await rm(socketDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Pi Durable writes through a real Gondolin task VM', async ({}, testInfo) => {
  await allure.epic('Durable work');
  await allure.feature('Gondolin task environment');
  await allure.story('Agent writes an artifact inside the VM workspace');
  const imagePath = join(process.cwd(), '../../../../artifacts/gondolin-browser/aarch64');
  const imageAvailable = await stat(join(imagePath, 'manifest.json')).then(() => true, () => false);
  test.skip(!imageAvailable, 'local Gondolin image is unavailable');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  const { fauxAssistantMessage, fauxProvider, fauxToolCall } =
    await import('@earendil-works/pi-ai/providers/faux');
  const { runPiSession } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/session-execution.js');
  const directory = await mkdtemp(join(tmpdir(), 'pi-gondolin-evidence-'));
  const previous = {
    mode: process.env.WORKER_PI_EXECUTION_MODE,
    sessionDir: process.env.PI_SESSION_DIR,
    model: process.env.PI_MODEL,
    socketDir: process.env.PI_TASK_SESSION_SOCKET_DIR,
  };
  try {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('write', { path: 'evidence.txt', content: 'vm-tool-proof' }),
        { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('bash', { command: 'cat evidence.txt' }),
        { stopReason: 'toolUse' }),
      fauxAssistantMessage('Artifact ready.'),
    ]);
    process.env.WORKER_PI_EXECUTION_MODE = 'gondolin';
    process.env.PI_SESSION_DIR = directory;
    process.env.PI_TASK_SESSION_SOCKET_DIR = join('/tmp', `pi-task-${process.pid}`);
    process.env.PI_MODEL = `${faux.provider.id}/${faux.models[0].id}`;
    await allure.step('Given a task workspace mounted in a Gondolin VM', async () => {
      assert.equal(imageAvailable, true);
    });
    const answer = await allure.step('When Pi Durable calls its write tool', async () => {
      return runPiSession({ taskId: '00000000-0000-4000-8000-000000000003',
        workspace: directory, imageRef: imagePath, instruction: 'Create the evidence file.' }, { models });
    });
    const artifact = await allure.step('Then the VM write appears in the mounted workspace', async () => {
      assert.equal(answer, 'Artifact ready.');
      const content = await readFile(join(directory, 'evidence.txt'), 'utf8');
      assert.equal(content, 'vm-tool-proof');
      return content;
    });
    await testInfo.attach('gondolin-task-artifact', { body: Buffer.from(artifact), contentType: 'text/plain' });
  } finally {
    const { closeTaskSessions } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/remote-session.js');
    await closeTaskSessions();
    await rm(join('/tmp', `pi-task-${process.pid}`), { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      const name = key === 'sessionDir' ? 'PI_SESSION_DIR' : key === 'socketDir' ? 'PI_TASK_SESSION_SOCKET_DIR'
        : key === 'mode' ? 'WORKER_PI_EXECUTION_MODE' : 'PI_MODEL';
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('A completed Pi Durable task accepts a follow-up through its session socket', async ({}, testInfo) => {
  await allure.epic('Durable work');
  await allure.feature('Task conversation attachment');
  await allure.story('Voice agent follows up with a completed task');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  const { fauxAssistantMessage, fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
  const { runPiSession } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/session-execution.js');
  const { closeTaskSessions } = await import('../../../../../platform/agent-execution/pi-durable-task/dist/remote-session.js');
  const { RemoteTaskSession } = await import('../../../apps/pi-agent/voice-agent/remote-task-session.ts');
  const directory = await mkdtemp(join(tmpdir(), 'pi-follow-up-'));
  const socketDirectory = join('/tmp', `pi-task-${process.pid}`);
  const previous = {
    mode: process.env.WORKER_PI_EXECUTION_MODE,
    sessionDir: process.env.PI_SESSION_DIR,
    model: process.env.PI_MODEL,
    socketDir: process.env.PI_TASK_SESSION_SOCKET_DIR,
  };
  const remote = new RemoteTaskSession(socketDirectory, 10_000);
  try {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage('Initial answer.'), fauxAssistantMessage('Follow-up answer.')]);
    process.env.WORKER_PI_EXECUTION_MODE = 'host';
    process.env.PI_SESSION_DIR = directory;
    process.env.PI_TASK_SESSION_SOCKET_DIR = socketDirectory;
    process.env.PI_MODEL = `${faux.provider.id}/${faux.models[0].id}`;
    const taskId = '00000000-0000-4000-8000-000000000004';
    await allure.step('Given a completed native task conversation', async () => {
      const text = await runPiSession({ taskId, workspace: directory, instruction: 'Initial task.' }, { models });
      assert.equal(text, 'Initial answer.');
    });
    const answer = await allure.step('When the voice agent attaches and asks a follow-up', async () => {
      const state = await remote.attach(taskId);
      assert.equal(state.taskId, taskId);
      return remote.send('What happened next?');
    });
    await allure.step('Then the same conversation returns the follow-up answer', async () => {
      assert.equal(answer, 'Follow-up answer.');
    });
    await testInfo.attach('task-follow-up-evidence', {
      body: Buffer.from(JSON.stringify({ taskId, answer }, null, 2)), contentType: 'application/json',
    });
  } finally {
    await remote.detach();
    await closeTaskSessions();
    await rm(socketDirectory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      const name = key === 'sessionDir' ? 'PI_SESSION_DIR' : key === 'socketDir' ? 'PI_TASK_SESSION_SOCKET_DIR'
        : key === 'mode' ? 'WORKER_PI_EXECUTION_MODE' : 'PI_MODEL';
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
