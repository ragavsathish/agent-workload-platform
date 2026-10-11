import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type TaskResult = {
  state: 'pending' | 'running' | 'sleeping' | 'completed' | 'failed' | 'cancelled';
  result?: { stdout?: string; stderr?: string; exit_code?: number } | null;
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
  approval_token: string | null;
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

export const TaskPanel = () => {
  const [tasks, setTasks] = useState<Proposal[]>([]);
  const [instruction, setInstruction] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    try {
      setTasks(await request<Proposal[]>('/api/tasks'));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

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
        body: JSON.stringify({ instruction, workspace }),
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
    if (action === 'approve' && !task.approval_token) return;
    setBusy(task.id);
    try {
      await request<Proposal>(`/api/tasks/${task.id}/${action}`, {
        method: 'POST',
        body: action === 'approve' ? JSON.stringify({ approval_token: task.approval_token }) : '{}',
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
        <p className="eyebrow">PI AGENT</p>
        <h2>Review & dispatch</h2>
        <p>Voice can submit work directly. Review, approve drafts, or cancel here.</p>
      </header>

      <form onSubmit={propose} className="task-form">
        <label>
          Workspace
          <input
            value={workspace}
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
              <details>
                <summary>Integrity & output</summary>
                <p>Plan SHA-256: <code>{task.plan_hash}</code></p>
                {task.result?.result?.stdout && <pre>{task.result.result.stdout}</pre>}
                {task.result?.failure != null && <pre>{JSON.stringify(task.result.failure, null, 2)}</pre>}
              </details>
              {(task.status === 'pending' || task.status === 'approved') && (
                <div className="task-actions">
                  {task.status === 'pending' && (
                    <button
                      className="approve"
                      disabled={busy === task.id || !task.approval_token}
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
