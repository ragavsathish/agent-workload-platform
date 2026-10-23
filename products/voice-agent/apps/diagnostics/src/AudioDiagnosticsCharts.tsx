import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type MetricPoint = {
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

export type VadSample = { timeSeconds: number; confidence: number; volume: number };
export type DiagnosticEvent = { timeSeconds: number; kind: string };

export type SessionMetrics = {
  points: MetricPoint[];
  vadSamples: VadSample[];
  events: DiagnosticEvent[];
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
  const [filterLabel, setFilterLabel] = useState('Filter');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/audio-diagnostics/live', { cache: 'no-store' });
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== 'object' || payload === null) return;
      const live = payload as {
        active?: unknown;
        waveform?: unknown;
        point?: unknown;
        selectedFilter?: unknown;
      };
      setActive(live.active === true);
      if (Array.isArray(live.waveform)) setWaveform(live.waveform as WaveformPoint[]);
      if (typeof live.point === 'object' && live.point !== null) {
        const filter = typeof live.selectedFilter === 'string' ? live.selectedFilter : '';
        const value = (live.point as Record<string, unknown>)[`${filter}LatencyMs`];
        setFilterLabel(filter === 'rnnoise' ? 'RNNoise' : filter === 'voxlock' ? 'VoxLock' : 'Filter');
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
        {latency !== null && <span>{latency.toFixed(1)} ms {filterLabel}</span>}
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

export const AudioDiagnosticsCharts = ({
  metrics,
  selectedFilter,
}: {
  metrics: SessionMetrics;
  selectedFilter: string;
}) => {
  const { points, vadSamples, events } = metrics;
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const inFocus = (seconds: number) => focusedAt === null
    || (seconds >= Math.max(0, focusedAt - 3) && seconds <= focusedAt + 3);

  const chartPoints = useMemo(() => points.filter((point) =>
    typeof point.timeSeconds === 'number' && inFocus(point.timeSeconds)).map((point) => ({
    ...point,
    lstmHiddenActivity: average(point.lstmHiddenRms),
    lstmCellActivity: average(point.lstmCellRms),
  })), [points, focusedAt]);
  const chartVadSamples = useMemo(() => vadSamples.filter((sample) => inFocus(sample.timeSeconds)),
    [vadSamples, focusedAt]);
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

  if (!points.length) return <p className="audio-diagnostics-empty">Loading diagnostics…</p>;

  const filterLabel = selectedFilter === 'rnnoise' ? 'RNNoise' : 'VoxLock';
  const filterColor = selectedFilter === 'rnnoise' ? '#72b7ef' : '#56e39f';
  const energyKey = `${selectedFilter}Dbfs`;
  const suppressionKey = `${selectedFilter}SuppressionDb`;
  const latencyKey = `${selectedFilter}LatencyMs`;
  const markers = events.filter((event) => inFocus(event.timeSeconds)
    && ['vad_speech_started', 'interruption', 'empty_user_turn', 'transcript_emitted',
      'bot_speech_started', 'bot_speech_stopped'].includes(event.kind));
  const eventColor = (kind: string) => kind === 'interruption' || kind === 'empty_user_turn'
    ? '#ff8e7c' : kind === 'transcript_emitted' ? '#72b7ef'
      : kind.startsWith('bot_speech') ? '#c792ea' : '#ffbd76';

  const lineChart = (lines: ReactNode) => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartPoints}>
        <CartesianGrid stroke="#273039" vertical={false} />
        <XAxis dataKey="timeSeconds" type="number" domain={['dataMin', 'dataMax']}
          tick={{ fill: '#89949f', fontSize: 11 }} unit="s" />
        <YAxis tick={{ fill: '#89949f', fontSize: 11 }} width={48} />
        <Tooltip />
        <Legend />
        {markers.map((event, index) => (
          <ReferenceLine key={`${event.kind}-${index}`} x={event.timeSeconds}
            stroke={eventColor(event.kind)} strokeDasharray="3 3" />
        ))}
        {lines}
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <div className="diagnostic-chart-grid">
      <ChartFrame title="Input and output energy · dBFS">
        {lineChart(<>
          <Line name="Raw" dataKey="rawDbfs" stroke="#89949f" dot={false} isAnimationActive={false} />
          <Line name={filterLabel} dataKey={energyKey} stroke={filterColor} dot={false} isAnimationActive={false} />
        </>)}
      </ChartFrame>
      {vadSamples.length > 0 && <ChartFrame title="Silero decision · confidence and volume">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartVadSamples}>
            <CartesianGrid stroke="#273039" vertical={false} />
            <XAxis dataKey="timeSeconds" type="number" domain={['dataMin', 'dataMax']}
              tick={{ fill: '#89949f', fontSize: 11 }} unit="s" />
            <YAxis domain={[0, 1]} tick={{ fill: '#89949f', fontSize: 11 }} width={48} />
            <Tooltip /><Legend />
            <ReferenceLine y={0.7} stroke="#c792ea" strokeDasharray="4 4" />
            <ReferenceLine y={0.6} stroke="#56e39f" strokeDasharray="4 4" />
            {markers.map((event, index) => (
              <ReferenceLine key={`${event.kind}-${index}`} x={event.timeSeconds}
                stroke={eventColor(event.kind)} strokeDasharray="3 3" />
            ))}
            <Line name="Confidence" dataKey="confidence" stroke="#c792ea" dot={false} isAnimationActive={false} />
            <Line name="Smoothed volume" dataKey="volume" stroke="#56e39f" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>}
      <ChartFrame title="Suppression · dB">
        {lineChart(<>
          <Line name={filterLabel} dataKey={suppressionKey} stroke={filterColor} dot={false} isAnimationActive={false} />
        </>)}
      </ChartFrame>
      <ChartFrame title="Filter inference latency · ms">
        {lineChart(<>
          <Line name={filterLabel} dataKey={latencyKey} stroke={filterColor} dot={false} isAnimationActive={false} />
        </>)}
      </ChartFrame>
      {selectedFilter === 'voxlock' && <>
        <ChartFrame title="LSTM-state RMS activity">
          {lineChart(<>
            <Line name="Hidden state" dataKey="lstmHiddenActivity" stroke="#c792ea" dot={false} isAnimationActive={false} />
            <Line name="Cell state" dataKey="lstmCellActivity" stroke="#ffb86c" dot={false} isAnimationActive={false} />
          </>)}
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
      </>}
      {events.length > 0 && <section className="diagnostic-events">
        <h3>Turn events</h3>
        <p>Choose an event to inspect a six-second window. Dashed markers align with the audio clock. Confidence and volume thresholds are 0.7 and 0.6.</p>
        {focusedAt !== null && <button type="button" onClick={() => setFocusedAt(null)}>Show full session</button>}
        <ol>{events.map((event, index) => (
          <li key={`${event.kind}-${index}`}>
            <button type="button" onClick={() => setFocusedAt(event.timeSeconds)}>
              <time>{event.timeSeconds.toFixed(2)}s</time> {event.kind.replaceAll('_', ' ')}
            </button>
          </li>
        ))}</ol>
      </section>}
    </div>
  );
};
