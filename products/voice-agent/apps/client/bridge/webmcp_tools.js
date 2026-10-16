const maximumInputLength = 4000;
const maximumReturnedTextLength = 2000;
const maximumReturnedItems = 12;

const boundedText = (value, maximum = maximumReturnedTextLength) => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…`;
};

const requiredText = (input, field) => {
  const value = typeof input?.[field] === 'string' ? input[field].trim() : '';
  if (!value) throw new TypeError(`${field} must be a non-empty string.`);
  if (value.length > maximumInputLength) {
    throw new RangeError(`${field} must be at most ${maximumInputLength} characters.`);
  }
  return value;
};

const requestJson = async (fetchImpl, path, { body, signal } = {}) => {
  const response = await fetchImpl(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Pi workspace request failed (${response.status}).`);
  return response.json();
};

const summarizeTranscript = (snapshot) => ({
  revision: Number(snapshot?.revision) || 0,
  entries: Array.isArray(snapshot?.entries)
    ? snapshot.entries.slice(-maximumReturnedItems).map((entry) => ({
        id: boundedText(entry?.id, 160),
        role: boundedText(entry?.role, 40),
        status: entry?.status == null ? null : boundedText(entry.status, 40),
        text: boundedText(entry?.text),
      }))
    : [],
});

const summarizeTasks = (tasks) => Array.isArray(tasks)
  ? tasks.slice(0, maximumReturnedItems).map((task) => ({
      id: boundedText(task?.id, 160),
      instruction: boundedText(task?.instruction),
      status: boundedText(task?.status, 40),
      state: task?.result?.state == null
        ? boundedText(task?.status, 40)
        : boundedText(task.result.state, 40),
    }))
  : [];

export const createPiWebMcpTools = ({ fetchImpl, notify = () => {} }) => [
  {
    name: 'get_pi_workspace_state',
    title: 'Read Pi workspace state',
    description:
      'Returns bounded context usage, the latest visible Pi conversation entries, and recent durable tasks for the active authenticated workspace.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      consequentialHint: false,
      untrustedContentHint: true,
      debugging: false,
    },
    async execute(_input, { signal } = {}) {
      const [context, transcript, tasks] = await Promise.all([
        requestJson(fetchImpl, '/api/pi-context', { signal }),
        requestJson(fetchImpl, '/api/pi-transcript', { signal }),
        requestJson(fetchImpl, '/api/tasks', { signal }),
      ]);
      return {
        context: {
          tokens: Number.isFinite(context?.tokens) ? context.tokens : null,
          contextWindow: Number.isFinite(context?.contextWindow)
            ? context.contextWindow
            : null,
          percent: Number.isFinite(context?.percent) ? context.percent : null,
          canCompact: context?.canCompact === true,
        },
        transcript: summarizeTranscript(transcript),
        tasks: summarizeTasks(tasks),
      };
    },
  },
  {
    name: 'send_pi_message',
    title: 'Send a typed message to Pi',
    description:
      'Sends one typed user message to the active Pi session and returns its spoken response and Mermaid diagram. This advances the conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: `The user message to send, up to ${maximumInputLength} characters.`,
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
      untrustedContentHint: true,
      debugging: false,
    },
    async execute(input, { signal } = {}) {
      const message = requiredText(input, 'message');
      const response = await requestJson(fetchImpl, '/api/pi-message', {
        body: { message },
        signal,
      });
      notify({ action: 'message', revisionChanged: true });
      return {
        spoken: boundedText(response?.spoken, maximumInputLength),
        mermaid: boundedText(response?.mermaid, 24000),
      };
    },
  },
  {
    name: 'create_pending_task',
    title: 'Create a pending Pi task',
    description:
      'Creates a durable task proposal from an instruction. The task remains pending and is not approved or executed by this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: `The task instruction, up to ${maximumInputLength} characters.`,
        },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
      untrustedContentHint: true,
      debugging: false,
    },
    async execute(input, { signal } = {}) {
      const instruction = requiredText(input, 'instruction');
      const task = await requestJson(fetchImpl, '/api/tasks', {
        body: { instruction },
        signal,
      });
      notify({ action: 'task-created', revisionChanged: true });
      return {
        id: boundedText(task?.id, 160),
        instruction: boundedText(task?.instruction),
        status: boundedText(task?.status, 40),
      };
    },
  },
];

export const installPiWebMcpTools = async ({
  modelContext,
  fetchImpl,
  notify,
} = {}) => {
  if (!modelContext?.registerTool || typeof fetchImpl !== 'function') {
    return { supported: false, registered: [] };
  }

  const controller = new AbortController();
  const tools = createPiWebMcpTools({ fetchImpl, notify });
  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort();
    throw error;
  }
  return {
    supported: true,
    registered: tools.map((tool) => tool.name),
    dispose: () => controller.abort(),
  };
};
