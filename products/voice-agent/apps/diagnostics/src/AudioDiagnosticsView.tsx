import { useCallback, useEffect, useState } from 'react';

import { AudioDiagnosticsCharts, LiveAudioDiagnostics } from './AudioDiagnosticsCharts';
import type { SessionMetrics } from './AudioDiagnosticsCharts';
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
  raw: '--pi-color-text-muted',
  voxlock: '--pi-color-accent',
  rnnoise: '--pi-color-info',
};

export const AudioDiagnosticsView = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [sessions, setSessions] = useState<AudioDiagnosticSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics | null>(null);
  const [metricsError, setMetricsError] = useState('');
  const [micSettings, setMicSettings] = useState<Record<string, unknown> | null>(null);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.piTheme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content', getComputedStyle(document.documentElement).getPropertyValue('--pi-color-canvas').trim(),
    );
    setTheme(nextTheme);
  };

  useEffect(() => {
    const refreshMic = () => {
      try {
        const stored: unknown = JSON.parse(localStorage.getItem('voiceMicSettings') ?? 'null');
        setMicSettings(stored && typeof stored === 'object' ? stored as Record<string, unknown> : null);
      } catch { setMicSettings(null); }
    };
    refreshMic();
    const timer = window.setInterval(refreshMic, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedSession) return;
    let active = true;
    setSessionMetrics(null);
    setMetricsError('');
    void fetch(`/api/audio-diagnostics/${encodeURIComponent(selectedSession)}/metrics`, { cache: 'no-store' })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== 'object') throw new Error();
        const values = payload as Partial<SessionMetrics>;
        if (!Array.isArray(values.points)) throw new Error();
        if (active) setSessionMetrics({
          points: values.points,
          vadSamples: Array.isArray(values.vadSamples) ? values.vadSamples : [],
          events: Array.isArray(values.events) ? values.events : [],
        });
      })
      .catch(() => { if (active) setMetricsError('Diagnostic metrics are unavailable for this session.'); });
    return () => { active = false; };
  }, [selectedSession]);

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
      <header className="audio-diagnostics-header pi-app-header">
        <div className="audio-diagnostics-heading pi-app-header__identity">
          <p className="pi-kicker">INPUT DIAGNOSTICS</p>
          <h1>Replays</h1>
        </div>
        <div className="pi-app-header__actions">
          <nav className="pi-app-header__nav" aria-label="Primary navigation">
            <a href="/" aria-label="Voice assistant"><span className="pi-icon" data-pi-icon="mic" aria-hidden="true" />Voice</a>
            <a href="/knowledge/" aria-label="Journal and knowledge"><span className="pi-icon" data-pi-icon="knowledge" aria-hidden="true" />Journal &amp; Knowledge</a>
          </nav>
          <div className="header-actions">
            <button className="pi-button" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} aria-pressed={theme === 'light'} onClick={toggleTheme}>
              <span className="pi-icon" data-pi-icon={theme === 'dark' ? 'theme-light' : 'theme-dark'} aria-hidden="true" />{theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button className="pi-button" type="button" onClick={() => void refresh()}>Refresh</button>
          </div>
        </div>
      </header>

      <p className="audio-diagnostics-intro">Replay microphone input before and after the selected server-side filter.</p>

      {error && <p className="audio-diagnostics-error pi-notice" data-tone="danger" role="alert">{error}</p>}
      <LiveAudioDiagnostics />
      <section className="mic-settings pi-surface">
        <h2 className="pi-section-title">Browser microphone processing</h2>
        {micSettings ? <p>
          Echo cancellation: {String(micSettings.echoCancellation ?? 'unknown')} · Noise suppression: {String(micSettings.noiseSuppression ?? 'unknown')} · Automatic gain: {String(micSettings.autoGainControl ?? 'unknown')} · Sample rate: {String(micSettings.sampleRate ?? 'unknown')} Hz · Channels: {String(micSettings.channelCount ?? 'unknown')}
        </p> : <p>Start a conversation in this browser to capture the applied microphone settings.</p>}
        <p>These settings are held in this browser and may differ from a previous conversation or another device.</p>
      </section>
      <section className="audio-session-list" aria-live="polite">
        {loading && <p className="audio-diagnostics-empty pi-empty-state">Loading replays…</p>}
        {!loading && sessions.length === 0 && !error && (
          <p className="audio-diagnostics-empty pi-empty-state">
            No completed conversations yet. End a voice conversation to save its replay.
          </p>
        )}
        {sessions.map((session, index) => (
          <article className="audio-session-card pi-surface" key={session.id}>
            <header>
              <div>
                <span className="audio-session-number">Session {index + 1}</span>
                <time dateTime={session.completedAt}>{formatDate(session.completedAt)}</time>
              </div>
              <span className="audio-session-duration">{formatDuration(session.durationSeconds)}</span>
            </header>
            {selectedSession !== session.id ? (
              <button
                className="audio-session-load pi-button"
                type="button"
                onClick={() => setSelectedSession(session.id)}
              >
                Load session diagnostics
              </button>
            ) : (
              <div className="audio-variant-grid">
                {session.variants
                  .filter((variant) => variant === 'raw' || variant === session.selectedFilter)
                  .map((variant) => (
                  <section className="audio-variant pi-surface" key={variant}>
                    <div className="audio-variant-header">
                      <strong>{LABELS[variant] ?? variant}</strong>
                      {variant === session.selectedFilter && <span className="pi-badge" data-tone="success">Live path</span>}
                    </div>
                    <AudioWaveform
                      label={LABELS[variant] ?? variant}
                      color={COLORS[variant] ?? '--pi-color-text-muted'}
                      showSpectrogram={variant === 'raw' || variant === 'voxlock'}
                      events={sessionMetrics?.events}
                      url={`/api/audio-diagnostics/${encodeURIComponent(session.id)}/${encodeURIComponent(variant)}.wav`}
                    />
                  </section>
                ))}
              </div>
            )}
            {selectedSession === session.id && sessionMetrics && (
              <AudioDiagnosticsCharts
                metrics={sessionMetrics}
                selectedFilter={session.selectedFilter}
              />
            )}
            {selectedSession === session.id && metricsError && <p className="audio-session-warning pi-notice" data-tone="warning">{metricsError}</p>}
            {(session.droppedChunks > 0 || session.truncated) && (
              <p className="audio-session-warning pi-notice" data-tone="warning">
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
