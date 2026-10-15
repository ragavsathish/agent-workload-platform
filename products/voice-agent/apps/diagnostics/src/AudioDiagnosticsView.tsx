import { useCallback, useEffect, useState } from 'react';

import { AudioDiagnosticsCharts, LiveAudioDiagnostics } from './AudioDiagnosticsCharts';
import { AudioWaveform } from './AudioWaveform';

type AudioDiagnosticSession = {
  id: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  sampleRate: number;
  selectedFilter: string;
  droppedChunks: number;
  truncated: boolean;
  variants: string[];
};

const isSession = (value: unknown): value is AudioDiagnosticSession => {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<AudioDiagnosticSession>;
  return typeof session.id === 'string'
    && typeof session.startedAt === 'string'
    && typeof session.completedAt === 'string'
    && typeof session.durationSeconds === 'number'
    && typeof session.sampleRate === 'number'
    && typeof session.selectedFilter === 'string'
    && typeof session.droppedChunks === 'number'
    && typeof session.truncated === 'boolean'
    && Array.isArray(session.variants);
};

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
};

const LABELS: Record<string, string> = {
  raw: 'Raw microphone',
  voxlock: 'VoxLock',
  rnnoise: 'RNNoise',
};

const COLORS: Record<string, string> = {
  raw: '#73808a',
  voxlock: '#56e39f',
  rnnoise: '#72b7ef',
};

export const AudioDiagnosticsView = () => {
  const [sessions, setSessions] = useState<AudioDiagnosticSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/audio-diagnostics', { cache: 'no-store' });
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== 'object' || payload === null) throw new Error();
      const values = (payload as { sessions?: unknown }).sessions;
      if (!Array.isArray(values) || !values.every(isSession)) throw new Error();
      setSessions(values.slice(0, 5));
      setError('');
    } catch {
      setError('Audio replays are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <main className="audio-diagnostics-page">
      <header className="audio-diagnostics-header">
        <div>
          <p className="eyebrow">INPUT DIAGNOSTICS</p>
          <h1>Last five conversations</h1>
          <p>Replay the same microphone input before and after each server-side filter.</p>
        </div>
        <div className="header-actions">
          <a href="/">Voice</a>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      {error && <p className="audio-diagnostics-error" role="alert">{error}</p>}
      <LiveAudioDiagnostics />
      <section className="audio-session-list" aria-live="polite">
        {loading && <p className="audio-diagnostics-empty">Loading replays…</p>}
        {!loading && sessions.length === 0 && !error && (
          <p className="audio-diagnostics-empty">
            No completed conversations yet. End a voice conversation to save its replay.
          </p>
        )}
        {sessions.map((session, index) => (
          <article className="audio-session-card" key={session.id}>
            <header>
              <div>
                <span className="audio-session-number">Session {index + 1}</span>
                <time dateTime={session.completedAt}>{formatDate(session.completedAt)}</time>
              </div>
              <span className="audio-session-duration">{formatDuration(session.durationSeconds)}</span>
            </header>
            {selectedSession !== session.id ? (
              <button
                className="audio-comparison-load"
                type="button"
                onClick={() => setSelectedSession(session.id)}
              >
                Load waveform comparison
              </button>
            ) : (
              <div className="audio-variant-grid">
                {session.variants.map((variant) => (
                  <section className="audio-variant" key={variant}>
                    <div className="audio-variant-header">
                      <strong>{LABELS[variant] ?? variant}</strong>
                      {variant === session.selectedFilter && <span>Live path</span>}
                    </div>
                    <AudioWaveform
                      label={LABELS[variant] ?? variant}
                      color={COLORS[variant] ?? '#73808a'}
                      showSpectrogram={variant === 'raw' || variant === 'voxlock'}
                      url={`/api/audio-diagnostics/${encodeURIComponent(session.id)}/${encodeURIComponent(variant)}.wav`}
                    />
                  </section>
                ))}
              </div>
            )}
            {selectedSession === session.id && <AudioDiagnosticsCharts sessionId={session.id} />}
            {(session.droppedChunks > 0 || session.truncated) && (
              <p className="audio-session-warning">
                {session.droppedChunks > 0 && `${session.droppedChunks} chunks were not recorded. `}
                {session.truncated && 'Recording reached the configured duration limit.'}
              </p>
            )}
          </article>
        ))}
      </section>
      <footer className="audio-diagnostics-footer">
        Stored locally in the private voice-service volume. Starting a sixth completed session removes the oldest.
      </footer>
    </main>
  );
};
