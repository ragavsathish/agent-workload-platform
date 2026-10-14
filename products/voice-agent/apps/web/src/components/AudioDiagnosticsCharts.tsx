import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type MetricPoint = {
  timeSeconds?: number;
  rawDbfs?: number | null;
  voxlockDbfs?: number | null;
  rnnoiseDbfs?: number | null;
  voxlockSuppressionDb?: number | null;
  rnnoiseSuppressionDb?: number | null;
  voxlockLatencyMs?: number;
  rnnoiseLatencyMs?: number;
  lstmHiddenRms?: number[];
  lstmCellRms?: number[];
  maskMagnitude?: number[];
};

type WaveformPoint = { index: number; min: number; max: number };

const average = (values: number[] | undefined): number | null =>
  values?.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const ChartFrame = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="diagnostic-chart">
    <h3>{title}</h3>
    <div className="diagnostic-chart-canvas">{children}</div>
  </section>
);

export const LiveAudioDiagnostics = () => {
  const [waveform, setWaveform] = useState<WaveformPoint[]>([]);
  const [active, setActive] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/audio-diagnostics/live', { cache: 'no-store' });
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== 'object' || payload === null) return;
      const live = payload as { active?: unknown; waveform?: unknown; point?: unknown };
      setActive(live.active === true);
      if (Array.isArray(live.waveform)) setWaveform(live.waveform as WaveformPoint[]);
      if (typeof live.point === 'object' && live.point !== null) {
        const value = (live.point as MetricPoint).voxlockLatencyMs;
        setLatency(typeof value === 'number' ? value : null);
      }
    } catch {
      setActive(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 250);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <section className="live-diagnostic" aria-live="polite">
      <header>
        <div>
          <p className="eyebrow">LIVE INPUT</p>
          <h2>{active ? 'Microphone envelope' : 'Waiting for a conversation'}</h2>
        </div>
        {latency !== null && <span>{latency.toFixed(1)} ms VoxLock</span>}
      </header>
      <div className="live-waveform" aria-label="Live microphone waveform envelope">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={waveform} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <YAxis domain={[-1, 1]} hide />
            <XAxis dataKey="index" hide />
            <Line dataKey="max" stroke="#56e39f" dot={false} isAnimationActive={false} />
            <Line dataKey="min" stroke="#56e39f" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

export const AudioDiagnosticsCharts = ({ sessionId }: { sessionId: string }) => {
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch(`/api/audio-diagnostics/${encodeURIComponent(sessionId)}/metrics`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok || typeof payload !== 'object' || payload === null) throw new Error();
        const values = (payload as { points?: unknown }).points;
        if (!Array.isArray(values)) throw new Error();
        if (active) setPoints(values as MetricPoint[]);
      })
      .catch(() => {
        if (active) setError('Diagnostic metrics are unavailable for this session.');
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const chartPoints = useMemo(
    () => points.map((point) => ({
      ...point,
      lstmHiddenActivity: average(point.lstmHiddenRms),
      lstmCellActivity: average(point.lstmCellRms),
    })),
    [points]
  );
  const maskProfile = useMemo(() => {
    const masks = points
      .map((point) => point.maskMagnitude)
      .filter((value): value is number[] => Array.isArray(value) && value.length === 32);
    return Array.from({ length: 32 }, (_, index) => ({
      band: index + 1,
      magnitude: masks.length
        ? masks.reduce((sum, mask) => sum + mask[index], 0) / masks.length
        : 0,
    }));
  }, [points]);

  if (error) return <p className="audio-session-warning">{error}</p>;
  if (!points.length) return <p className="audio-diagnostics-empty">Loading diagnostics…</p>;

  return (
    <div className="diagnostic-chart-grid">
      <ChartFrame title="Input and output energy · dBFS">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartPoints}>
            <CartesianGrid stroke="#273039" vertical={false} />
            <XAxis dataKey="timeSeconds" tick={{ fill: '#89949f', fontSize: 11 }} unit="s" />
            <YAxis tick={{ fill: '#89949f', fontSize: 11 }} width={48} />
            <Tooltip />
            <Legend />
            <Line name="Raw" dataKey="rawDbfs" stroke="#89949f" dot={false} isAnimationActive={false} />
            <Line name="VoxLock" dataKey="voxlockDbfs" stroke="#56e39f" dot={false} isAnimationActive={false} />
            <Line name="RNNoise" dataKey="rnnoiseDbfs" stroke="#72b7ef" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartFrame title="Suppression · dB">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartPoints}>
            <CartesianGrid stroke="#273039" vertical={false} />
            <XAxis dataKey="timeSeconds" tick={{ fill: '#89949f', fontSize: 11 }} unit="s" />
            <YAxis tick={{ fill: '#89949f', fontSize: 11 }} width={48} />
            <Tooltip />
            <Legend />
            <Line name="VoxLock" dataKey="voxlockSuppressionDb" stroke="#56e39f" dot={false} isAnimationActive={false} />
            <Line name="RNNoise" dataKey="rnnoiseSuppressionDb" stroke="#72b7ef" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartFrame title="Filter inference latency · ms">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartPoints}>
            <CartesianGrid stroke="#273039" vertical={false} />
            <XAxis dataKey="timeSeconds" tick={{ fill: '#89949f', fontSize: 11 }} unit="s" />
            <YAxis tick={{ fill: '#89949f', fontSize: 11 }} width={48} />
            <Tooltip />
            <Legend />
            <Line name="VoxLock" dataKey="voxlockLatencyMs" stroke="#56e39f" dot={false} isAnimationActive={false} />
            <Line name="RNNoise" dataKey="rnnoiseLatencyMs" stroke="#72b7ef" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartFrame title="LSTM-state RMS activity">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartPoints}>
            <CartesianGrid stroke="#273039" vertical={false} />
            <XAxis dataKey="timeSeconds" tick={{ fill: '#89949f', fontSize: 11 }} unit="s" />
            <YAxis tick={{ fill: '#89949f', fontSize: 11 }} width={48} />
            <Tooltip />
            <Legend />
            <Line name="Hidden state" dataKey="lstmHiddenActivity" stroke="#c792ea" dot={false} isAnimationActive={false} />
            <Line name="Cell state" dataKey="lstmCellActivity" stroke="#ffb86c" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartFrame title="Mean predicted complex-mask magnitude · model band">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={maskProfile}>
            <CartesianGrid stroke="#273039" vertical={false} />
            <XAxis dataKey="band" tick={{ fill: '#89949f', fontSize: 11 }} />
            <YAxis tick={{ fill: '#89949f', fontSize: 11 }} width={48} />
            <Tooltip />
            <Bar dataKey="magnitude" name="Mask magnitude" fill="#56e39f" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
};
