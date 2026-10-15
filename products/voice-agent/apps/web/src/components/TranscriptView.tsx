import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { parseTranscriptResponse } from '../transcript-response';
import { MermaidDiagram } from './MermaidDiagram';

type TranscriptEntry = {
  id: string;
  timestamp: number;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  status?: 'running' | 'completed' | 'failed';
};

type TranscriptSnapshot = {
  revision: number;
  entries: TranscriptEntry[];
};

type TypedResponse = { spoken: string; mermaid: string };

type TaskResponse = { spoken: string; mermaid: string };

type Task = {
  id: string;
  instruction: string;
  workspace: string;
  plan_hash: string;
  status: 'pending' | 'approved' | 'cancelled';
  created_at: string;
  result: {
    state: 'pending' | 'running' | 'sleeping' | 'completed' | 'failed' | 'cancelled';
    result?: { response?: TaskResponse; artifacts?: string[] } | null;
    failure?: unknown;
  } | null;
};

type TimelineItem =
  | { kind: 'transcript'; timestamp: number; entry: TranscriptEntry }
  | { kind: 'task'; timestamp: number; task: Task };

const isSnapshot = (value: unknown): value is TranscriptSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<TranscriptSnapshot>;
  return typeof snapshot.revision === 'number' && Array.isArray(snapshot.entries);
};

const isTypedResponse = (value: unknown): value is TypedResponse => {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<TypedResponse>;
  return typeof response.spoken === 'string' && typeof response.mermaid === 'string';
};

const responseError = async (response: Response, fallback: string) => {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === 'string') return detail;
    }
  } catch {
    // Preserve the stable, non-sensitive fallback below.
  }
  return fallback;
};

export const TranscriptView = () => {
  const [snapshot, setSnapshot] = useState<TranscriptSnapshot>({ revision: 0, entries: [] });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<'live' | 'reconnecting'>('live');
  const [viewFilter, setViewFilter] = useState<'all' | 'chat' | 'tasks'>('all');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [taskError, setTaskError] = useState<string>();
  const [taskBusy, setTaskBusy] = useState<string>();
  const [playingEntryId, setPlayingEntryId] = useState<string>();
  const [expandedDiagrams, setExpandedDiagrams] = useState<Set<string>>(() => new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await fetch('/api/pi-transcript', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('transcript request failed');
        const body: unknown = await response.json();
        if (!isSnapshot(body)) throw new Error('invalid transcript');
        if (active) {
          setSnapshot((current) => (current.revision === body.revision ? current : body));
          setStatus('live');
        }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setStatus('reconnecting');
        }
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 750);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch('/api/tasks', { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response, 'Tasks are unavailable.'));
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error('Tasks returned an invalid response.');
      const next = body as Task[];
      setTasks((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next
      );
      setTaskError(undefined);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Tasks are unavailable.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (active) await refreshTasks();
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshTasks]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [snapshot.revision, tasks, viewFilter]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    []
  );

  const playSpeech = async (spoken: string, entryId: string) => {
    setPlayingEntryId(entryId);
    try {
      const response = await fetch('/api/pi-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spoken }),
      });
      if (!response.ok) throw new Error('speech request failed');
      const blob = await response.blob();
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.addEventListener('ended', () => setPlayingEntryId(undefined), { once: true });
      audio.addEventListener('error', () => setPlayingEntryId(undefined), { once: true });
      await audio.play();
    } catch {
      setPlayingEntryId(undefined);
    }
  };

  const playTaskSpeech = async (taskId: string) => {
    setPlayingEntryId(`task:${taskId}`);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/speech`);
      if (!response.ok) throw new Error('task speech request failed');
      const blob = await response.blob();
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.addEventListener('ended', () => setPlayingEntryId(undefined), { once: true });
      audio.addEventListener('error', () => setPlayingEntryId(undefined), { once: true });
      await audio.play();
    } catch {
      setPlayingEntryId(undefined);
      setTaskError('Could not play the task response.');
    }
  };

  const actOnTask = async (taskId: string, action: 'approve' | 'cancel') => {
    setTaskBusy(taskId);
    setTaskError(undefined);
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }
      );
      if (!response.ok) throw new Error(await responseError(response, 'Task action failed.'));
      await refreshTasks();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Task action failed.');
    } finally {
      setTaskBusy(undefined);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(undefined);
    try {
      const response = await fetch('/api/pi-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, 'Pi did not accept the message.'));
      }
      const body: unknown = await response.json();
      if (!isTypedResponse(body)) throw new Error('Pi returned an invalid response.');
      setMessage('');
      await playSpeech(body.spoken, 'typed-response');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Pi did not accept the message.');
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const toggleDiagram = (entryId: string) => {
    setExpandedDiagrams((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const visibleTasks = tasks.filter(
    (task, index) =>
      index < 10 ||
      task.status === 'pending' ||
      (task.status === 'approved' && task.result === null) ||
      task.result?.state === 'pending' ||
      task.result?.state === 'running' ||
      task.result?.state === 'sleeping'
  );
  const timeline: TimelineItem[] = [
    ...snapshot.entries.map(
      (entry): TimelineItem => ({ kind: 'transcript', timestamp: entry.timestamp, entry })
    ),
    ...visibleTasks.map(
      (task): TimelineItem => ({
        kind: 'task',
        timestamp: new Date(task.created_at).getTime(),
        task,
      })
    ),
  ].sort((left, right) => left.timestamp - right.timestamp);
  const displayedTimeline = timeline.filter(
    (item) =>
      viewFilter === 'all' ||
      (viewFilter === 'chat' && item.kind === 'transcript') ||
      (viewFilter === 'tasks' && item.kind === 'task')
  );

  return (
    <main className="transcript-page">
      <header className="transcript-header">
        <div>
          <p className="eyebrow">PI SESSION</p>
          <h1>Chat &amp; tasks</h1>
        </div>
        <nav className="transcript-filters" aria-label="Timeline filter">
          <button
            type="button"
            aria-pressed={viewFilter === 'all'}
            onClick={() => setViewFilter('all')}>
            All
          </button>
          <button
            type="button"
            aria-pressed={viewFilter === 'chat'}
            onClick={() => setViewFilter('chat')}>
            Chat
          </button>
          <button
            type="button"
            aria-pressed={viewFilter === 'tasks'}
            onClick={() => setViewFilter('tasks')}>
            Tasks <span>{visibleTasks.length}</span>
          </button>
        </nav>
        <span className={`transcript-connection ${status}`} role="status">
          {status === 'live' ? 'Live' : 'Reconnecting'}
        </span>
      </header>
      <section className="transcript-stream" aria-live="polite">
        {displayedTimeline.length === 0 && (
          <p className="transcript-empty">
            {viewFilter === 'tasks' ? 'No tasks yet.' : 'Ask Pi by voice or type below.'}
          </p>
        )}
        {displayedTimeline.map((item) => {
          if (item.kind === 'task') {
            const task = item.task;
            const taskState = task.result?.state || task.status;
            const response = task.result?.result?.response;
            const diagramId = `task:${task.id}`;
            const taskIsActive =
              task.status === 'pending' ||
              (task.status === 'approved' && task.result === null) ||
              task.result?.state === 'pending' ||
              task.result?.state === 'running' ||
              task.result?.state === 'sleeping';
            return (
              <article className="transcript-entry transcript-task" key={diagramId}>
                <div className="transcript-meta">
                  <strong>Task</strong>
                  <time dateTime={task.created_at}>
                    {new Date(task.created_at).toLocaleTimeString()}
                  </time>
                  <span className={`task-state task-state-${taskState}`}>{taskState}</span>
                </div>
                <p className="task-instruction">{task.instruction}</p>
                <code className="task-workspace">{task.workspace}</code>
                {response && (
                  <div className="transcript-task-response">
                    <p>{response.spoken}</p>
                    <div className="transcript-response-actions">
                      <button
                        className="transcript-secondary-action"
                        type="button"
                        aria-expanded={expandedDiagrams.has(diagramId)}
                        onClick={() => toggleDiagram(diagramId)}>
                        {expandedDiagrams.has(diagramId) ? 'Hide diagram' : 'Show diagram'}
                      </button>
                      <button
                        className="transcript-secondary-action"
                        type="button"
                        disabled={playingEntryId === diagramId}
                        onClick={() => void playTaskSpeech(task.id)}>
                        {playingEntryId === diagramId ? 'Playing…' : 'Listen again'}
                      </button>
                    </div>
                    {expandedDiagrams.has(diagramId) && (
                      <MermaidDiagram diagram={response.mermaid} />
                    )}
                  </div>
                )}
                <details className="transcript-task-details">
                  <summary>Integrity &amp; output</summary>
                  <p>Plan SHA-256: <code>{task.plan_hash}</code></p>
                  {task.result?.result?.artifacts?.length ? (
                    <p>Artifacts: {task.result.result.artifacts.join(', ')}</p>
                  ) : null}
                  {task.result?.failure != null && (
                    <pre>{JSON.stringify(task.result.failure, null, 2)}</pre>
                  )}
                </details>
                {taskIsActive && (
                  <div className="transcript-task-actions">
                    {task.status === 'pending' && (
                      <button
                        type="button"
                        disabled={taskBusy === task.id}
                        onClick={() => void actOnTask(task.id, 'approve')}>
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      className="cancel"
                      disabled={taskBusy === task.id}
                      onClick={() => void actOnTask(task.id, 'cancel')}>
                      Cancel
                    </button>
                  </div>
                )}
              </article>
            );
          }
          const entry = item.entry;
          const visual =
            entry.role === 'assistant' && entry.status !== 'running'
              ? parseTranscriptResponse(entry.text)
              : undefined;
          return (
            <article
              className={`transcript-entry transcript-${entry.role}`}
              key={`${entry.id}-${entry.timestamp}`}>
              <div className="transcript-meta">
                <strong>{entry.role === 'assistant' ? 'Pi' : entry.role}</strong>
                <time dateTime={new Date(entry.timestamp).toISOString()}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </time>
                {entry.status && <span>{entry.status}</span>}
              </div>
              {entry.role === 'tool' ? (
                <code>{entry.text}</code>
              ) : entry.role === 'assistant' && entry.status === 'running' ? (
                <p className="transcript-thinking">Pi is responding…</p>
              ) : visual ? (
                <div className="transcript-visual-response">
                  <p>{visual.spoken}</p>
                  <div className="transcript-response-actions">
                    <button
                      className="transcript-secondary-action"
                      type="button"
                      aria-expanded={expandedDiagrams.has(entry.id)}
                      onClick={() => toggleDiagram(entry.id)}>
                      {expandedDiagrams.has(entry.id) ? 'Hide diagram' : 'Show diagram'}
                    </button>
                    <button
                      className="transcript-secondary-action"
                      type="button"
                      disabled={playingEntryId === entry.id}
                      onClick={() => void playSpeech(visual.spoken, entry.id)}>
                      {playingEntryId === entry.id ? 'Playing…' : 'Listen again'}
                    </button>
                  </div>
                  {expandedDiagrams.has(entry.id) && (
                    <MermaidDiagram diagram={visual.mermaid} />
                  )}
                </div>
              ) : (
                <pre>{entry.text || '…'}</pre>
              )}
            </article>
          );
        })}
        <div ref={endRef} />
      </section>
      <div className="transcript-composer-wrap">
        {taskError && <p className="transcript-send-error">{taskError}</p>}
        {sendError && <p className="transcript-send-error">{sendError}</p>}
        <form className="transcript-composer" onSubmit={sendMessage}>
          <label className="sr-only" htmlFor="pi-message">
            Message Pi
          </label>
          <textarea
            id="pi-message"
            value={message}
            maxLength={8_000}
            rows={1}
            placeholder="Message Pi…"
            disabled={sending}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <button type="submit" disabled={sending || !message.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
        <p className="transcript-privacy">
          Tool arguments, credentials, and hidden reasoning are not displayed.
        </p>
      </div>
    </main>
  );
};
