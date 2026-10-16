const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const ok = (state, value) => deepFreeze({ type: 'Ok', state, value });
const err = (state, error) => deepFreeze({ type: 'Err', state, error });

export const createInitialFixtureState = () => deepFreeze({
  revision: 1,
  activeSessionId: 'fixture-live',
  sessionSequence: 1,
  taskSequence: 1,
  freshSession: false,
  context: {
    tokens: 1200,
    contextWindow: 8000,
    percent: 15,
    estimated: false,
    canCompact: true,
  },
  entries: [
    ...Array.from({ length: 198 }, (_, index) => ({
      id: `fixture-history-${index}`,
      timestamp: Date.parse('2026-10-15T08:00:00Z') + index,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `Earlier fixture turn ${index + 1}`,
      status: 'completed',
    })),
    {
      id: 'fixture-tool',
      timestamp: Date.parse('2026-10-16T07:59:59Z'),
      role: 'tool',
      text: 'read_workspace',
      status: 'completed',
    },
    {
      id: 'fixture-slides',
      timestamp: Date.parse('2026-10-16T07:59:59.500Z'),
      role: 'assistant',
      text: JSON.stringify({
        spoken: 'Requested slides ready.',
        presentation: {
          kind: 'slides',
          title: 'Voice slides',
          markdown: [
            '---',
            'marp: true',
            '---',
            '# Voice slides',
            '',
            'Rendered through the Flutter MCP App host.',
            '',
            '---',
            '',
            '# Voice path',
            '',
            '```mermaid',
            'flowchart LR',
            'Browser --> Pi',
            '```',
          ].join('\n'),
        },
      }),
    },
    {
      id: 'fixture-assistant',
      timestamp: Date.parse('2026-10-16T08:00:00Z'),
      role: 'assistant',
      text: JSON.stringify({
        spoken: 'Ready from the HTTP fixture.',
        presentation: {
          kind: 'flow', title: 'Voice path',
          nodes: [{ id: 'browser', label: 'Browser' }, { id: 'pi', label: 'Pi' }],
          edges: [{ from: 'browser', to: 'pi' }],
        },
      }),
    },
  ],
  tasks: [
    {
      id: 'fixture-task',
      instruction: 'Review the fixture deployment',
      workspace: '/workspace',
      plan_hash: 'fixture-plan',
      status: 'pending',
      created_at: '2026-10-16T08:00:00Z',
    },
  ],
  historicalSessions: {
    'fixture-history': {
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
    },
  },
  activeTurn: null,
});

export const contextUsage = (state) => state.freshSession
  ? deepFreeze({
      tokens: null,
      contextWindow: null,
      percent: null,
      estimated: false,
      canCompact: false,
    })
  : state.context;

export const compactContext = (state) => {
  const context = deepFreeze({
    tokens: 600,
    contextWindow: 8000,
    percent: 7.5,
    estimated: false,
    canCompact: false,
  });
  return ok(deepFreeze({ ...state, context }), context);
};

export const transcriptSnapshot = (state) => deepFreeze({
  revision: state.revision,
  entries: state.entries,
});

export const sessionSummaries = (state) => deepFreeze({
  sessions: [
    {
      id: state.activeSessionId,
      title: 'Voice orchestrator',
      updatedAt: '2026-10-16T08:00:00Z',
      messageCount: state.entries.length,
      active: true,
    },
    ...Object.entries(state.historicalSessions).map(([id, session]) => ({
      id,
      title: session.title,
      updatedAt: session.updatedAt,
      messageCount: session.entries.length,
      active: false,
    })),
  ],
});

export const historicalTranscript = (state, sessionId) => {
  const session = state.historicalSessions[sessionId];
  return session
    ? ok(state, deepFreeze({ revision: 1, entries: session.entries }))
    : err(state, deepFreeze({ type: 'SessionNotFound', sessionId }));
};

export const startNewSession = (state, { now }) => {
  const nextSequence = state.sessionSequence + 1;
  const activeSessionId = `fixture-live-${nextSequence}`;
  const historicalSessions = deepFreeze({
    ...state.historicalSessions,
    [state.activeSessionId]: {
      title: 'Previous voice session',
      updatedAt: now(),
      entries: state.entries,
    },
  });
  const next = deepFreeze({
    ...state,
    revision: state.revision + 1,
    activeSessionId,
    sessionSequence: nextSequence,
    freshSession: true,
    context: {
      tokens: null,
      contextWindow: null,
      percent: null,
      estimated: false,
      canCompact: false,
    },
    entries: [],
    historicalSessions,
    activeTurn: null,
  });
  return ok(next, deepFreeze({ id: activeSessionId }));
};

export const resumeSession = (state, sessionId, { now }) => {
  const resumed = state.historicalSessions[sessionId];
  if (!resumed) {
    return err(state, deepFreeze({ type: 'SessionNotFound', sessionId }));
  }
  const { [sessionId]: _, ...remainingSessions } = state.historicalSessions;
  const historicalSessions = deepFreeze({
    ...remainingSessions,
    [state.activeSessionId]: {
      title: 'Previous voice session',
      updatedAt: now(),
      entries: state.entries,
    },
  });
  const next = deepFreeze({
    ...state,
    revision: state.revision + 1,
    activeSessionId: sessionId,
    freshSession: false,
    context: {
      tokens: 1200,
      contextWindow: 8000,
      percent: 15,
      estimated: false,
      canCompact: true,
    },
    entries: resumed.entries,
    historicalSessions,
    activeTurn: null,
  });
  return ok(next, deepFreeze({ id: sessionId }));
};

export const beginTurn = (state, message, { now }) => {
  if (state.activeTurn) {
    return err(state, deepFreeze({
      type: 'TurnAlreadyActive',
      turnId: state.activeTurn.id,
    }));
  }
  const revision = state.revision + 1;
  const turnId = `fixture-turn-${revision}`;
  const assistantId = `fixture-assistant-${revision}`;
  const entries = deepFreeze([
    ...state.entries,
    {
      id: `fixture-user-${revision}`,
      timestamp: now(),
      role: 'user',
      text: message,
    },
    {
      id: assistantId,
      timestamp: now(),
      role: 'assistant',
      text: 'Inspecting the fixture…',
      status: 'running',
    },
  ]);
  const activeTurn = deepFreeze({ id: turnId, assistantId, message });
  const next = deepFreeze({
    ...state,
    revision,
    freshSession: false,
    entries,
    activeTurn,
  });
  return ok(next, activeTurn);
};

const replaceAssistant = (entries, assistantId, change) => deepFreeze(
  entries.map((entry) => entry.id === assistantId ? { ...entry, ...change } : entry),
);

export const completeTurn = (state, turnId) => {
  if (!state.activeTurn || state.activeTurn.id !== turnId) return state;
  const visual = deepFreeze({
    spoken: `Fixture response to: ${state.activeTurn.message}`,
    presentation: {
      kind: 'flow', title: 'Response',
      nodes: [{ id: 'request', label: 'Request' }, { id: 'response', label: 'Response' }],
      edges: [{ from: 'request', to: 'response' }],
    },
  });
  return deepFreeze({
    ...state,
    revision: state.revision + 1,
    entries: replaceAssistant(state.entries, state.activeTurn.assistantId, {
      text: JSON.stringify(visual),
      status: 'completed',
    }),
    activeTurn: null,
  });
};

export const abortActiveTurn = (state) => {
  if (!state.activeTurn) return ok(state, deepFreeze({ turnId: null }));
  const turnId = state.activeTurn.id;
  const next = deepFreeze({
    ...state,
    revision: state.revision + 1,
    entries: replaceAssistant(state.entries, state.activeTurn.assistantId, {
      status: 'completed',
    }),
    activeTurn: null,
  });
  return ok(next, deepFreeze({ turnId }));
};

export const completedTurnResponse = (message) => deepFreeze({
  spoken: `Fixture response to: ${message}`,
  presentation: {
    kind: 'flow', title: 'Response',
    nodes: [{ id: 'request', label: 'Request' }, { id: 'response', label: 'Response' }],
    edges: [{ from: 'request', to: 'response' }],
  },
});

export const interruptedTurnResponse = () => deepFreeze({
  spoken: 'Response stopped.',
  presentation: {
    kind: 'flow', title: 'Stopped',
    nodes: [{ id: 'request', label: 'Request' }, { id: 'stopped', label: 'Stopped' }],
    edges: [{ from: 'request', to: 'stopped' }],
  },
});

export const createTask = (state, instruction, { now }) => {
  const taskSequence = state.taskSequence + 1;
  const task = deepFreeze({
    id: `fixture-task-${taskSequence}`,
    instruction,
    workspace: '/workspace',
    plan_hash: `fixture-plan-${taskSequence}`,
    status: 'pending',
    created_at: now(),
  });
  const next = deepFreeze({
    ...state,
    taskSequence,
    tasks: [task, ...state.tasks],
  });
  return ok(next, task);
};

export const changeTaskStatus = (state, taskId, status) => {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return err(state, deepFreeze({ type: 'TaskNotFound', taskId }));
  const updated = deepFreeze({ ...task, status });
  const next = deepFreeze({
    ...state,
    tasks: state.tasks.map((candidate) =>
      candidate.id === taskId ? updated : candidate),
  });
  return ok(next, updated);
};
