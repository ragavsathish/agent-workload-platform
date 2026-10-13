import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { MermaidDiagram } from './MermaidDiagram';

type TaskResponse = {
  text: string;
  spoken: string;
  mermaid: string;
};

type TaskResult = {
  state: 'pending' | 'running' | 'sleeping' | 'completed' | 'failed' | 'cancelled';
  result?: {
    response?: TaskResponse;
    artifacts?: string[];
    exit_code?: number;
  } | null;
  failure?: unknown;
};

type Proposal = {
  id: string;
  instruction: string;
  workspace: string;
  plan_hash: string;
  status: 'pending' | 'approved' | 'cancelled';
  task_id: string | null;
  created_at: string;
  expires_at: string;
  approval_token?: string | null;
  result: TaskResult | null;
};

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
  return body as T;
};

type TaskPanelProps = {
  defaultWorkspace: string;
  onClose: () => void;
  onDiagram: (diagram: string) => void;
};

export const TaskPanel = ({ defaultWorkspace, onClose, onDiagram }: TaskPanelProps) => {
  const [tasks, setTasks] = useState<Proposal[]>([]);
  const [instruction, setInstruction] = useState('');
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [audioBusy, setAudioBusy] = useState('');
  const [audioNotice, setAudioNotice] = useState('');
  const knownStates = useRef<Map<string, string> | undefined>(undefined);
  const activeAudio = useRef<HTMLAudioElement | undefined>(undefined);

  const playResponse = useCallback(async (task: Proposal, automatic = false) => {
    if (!task.result?.result?.response?.spoken) return;
    setAudioBusy(task.id);
    if (!automatic) setAudioNotice('');
    try {
      activeAudio.current?.pause();
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/speech`);
      if (!response.ok) throw new Error('Speech is unavailable.');
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      activeAudio.current = audio;
      const release = () => URL.revokeObjectURL(url);
      audio.addEventListener('ended', release, { once: true });
      audio.addEventListener('error', release, { once: true });
      await audio.play();
    } catch {
      if (!automatic) setAudioNotice('Could not play the task response.');
    } finally {
      setAudioBusy('');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const nextTasks = await request<Proposal[]>('/api/tasks');
      const nextStates = new Map(
        nextTasks.map((task) => [task.id, task.result?.state || task.status])
      );
      const latestCompleted = nextTasks.find(
        (task) => task.result?.state === 'completed' && task.result.result?.response
      );
      if (latestCompleted?.result?.result?.response) {
        onDiagram(latestCompleted.result.result.response.mermaid);
      }
      if (knownStates.current) {
        const newlyCompleted = nextTasks.find(
          (task) =>
            task.result?.state === 'completed' &&
            knownStates.current?.get(task.id) !== 'completed' &&
            task.result.result?.response
        );
        if (newlyCompleted) void playResponse(newlyCompleted, true);
      }
      knownStates.current = nextStates;
      setTasks(nextTasks);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [onDiagram, playResponse]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const propose = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('new');
    try {
      await request<Proposal>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ instruction, workspace: workspace || defaultWorkspace }),
      });
      setInstruction('');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  };

  const act = async (task: Proposal, action: 'approve' | 'cancel') => {
    setBusy(task.id);
    try {
      await request<Proposal>(`/api/tasks/${task.id}/${action}`, {
        method: 'POST',
        body: '{}',
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  };

  return (
    <aside className="task-panel" aria-label="Agent tasks">
      <header>
        <div>
          <p className="eyebrow">PI AGENT</p>
          <h2>Tasks</h2>
        </div>
        <button className="task-close" onClick={onClose} aria-label="Close tasks">Close</button>
      </header>
      <p className="task-intro">Review voice requests or create a precise task.</p>

      <form onSubmit={propose} className="task-form">
        <label>
          Workspace
          <input
            value={workspace || defaultWorkspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="/Users/you/Documents/git/project"
            required
          />
        </label>
        <label>
          Exact task
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Describe the change and its acceptance criteria"
            rows={4}
            required
          />
        </label>
        <button type="submit" disabled={busy === 'new'}>
          {busy === 'new' ? 'Drafting…' : 'Create proposal'}
        </button>
      </form>

      {error && <p className="task-error" role="alert">{error}</p>}
      {audioNotice && <p className="task-error" role="status">{audioNotice}</p>}

      <div className="task-list">
        {tasks.map((task) => {
          const state = task.result?.state || task.status;
          return (
            <article className="task-card" key={task.id}>
              <div className="task-card-heading">
                <span className={`task-state task-state-${state}`}>{state}</span>
                <time>{new Date(task.created_at).toLocaleString()}</time>
              </div>
              <p className="task-instruction">{task.instruction}</p>
              <code className="task-workspace">{task.workspace}</code>
              {task.result?.result?.response && (
                <section className="task-response" aria-label="Task response">
                  <MermaidDiagram diagram={task.result.result.response.mermaid} />
                  <p>{task.result.result.response.spoken}</p>
                  <button
                    type="button"
                    className="task-play-response"
                    disabled={audioBusy === task.id}
                    onClick={() => void playResponse(task)}>
                    {audioBusy === task.id ? 'Preparing audio…' : 'Play response'}
                  </button>
                </section>
              )}
              <details>
                <summary>Integrity & output</summary>
                <p>Plan SHA-256: <code>{task.plan_hash}</code></p>
                {task.result?.result?.artifacts?.length ? (
                  <p>Artifacts: {task.result.result.artifacts.join(', ')}</p>
                ) : null}
                {task.result?.failure != null && <pre>{JSON.stringify(task.result.failure, null, 2)}</pre>}
              </details>
              {(task.status === 'pending' || task.status === 'approved') && (
                <div className="task-actions">
                  {task.status === 'pending' && (
                    <button
                      className="approve"
                      disabled={busy === task.id}
                      onClick={() => void act(task, 'approve')}>
                      Approve exact plan
                    </button>
                  )}
                  <button
                    className="cancel"
                    disabled={busy === task.id}
                    onClick={() => void act(task, 'cancel')}>
                    Cancel
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {!tasks.length && !error && <p className="empty-tasks">No task proposals yet.</p>}
      </div>
    </aside>
  );
};
