import { useEffect, useRef, useState } from 'react';

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

const isSnapshot = (value: unknown): value is TranscriptSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<TranscriptSnapshot>;
  return typeof snapshot.revision === 'number' && Array.isArray(snapshot.entries);
};

export const TranscriptView = () => {
  const [snapshot, setSnapshot] = useState<TranscriptSnapshot>({
    revision: 0,
    entries: [],
  });
  const [status, setStatus] = useState<'live' | 'reconnecting'>('live');
  const endRef = useRef<HTMLDivElement>(null);

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
          setSnapshot((current) =>
            current.revision === body.revision ? current : body
          );
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [snapshot.revision]);

  return (
    <main className="transcript-page">
      <header className="transcript-header">
        <div>
          <p className="eyebrow">PI SESSION</p>
          <h1>Live transcript</h1>
        </div>
        <span className={`transcript-connection ${status}`} role="status">
          {status === 'live' ? 'Live' : 'Reconnecting'}
        </span>
      </header>
      <section className="transcript-stream" aria-live="polite">
        {snapshot.entries.length === 0 && (
          <p className="transcript-empty">Waiting for the next Pi turn…</p>
        )}
        {snapshot.entries.map((entry) => (
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
            ) : (
              <pre>{entry.text || '…'}</pre>
            )}
          </article>
        ))}
        <div ref={endRef} />
      </section>
      <footer className="transcript-footer">
        Tool arguments, results, credentials, and hidden reasoning are not displayed.
      </footer>
    </main>
  );
};
