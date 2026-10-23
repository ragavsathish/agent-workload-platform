import { useRef, useState } from 'react';

import WavesurferPlayer from '@wavesurfer/react';
import type WaveSurfer from 'wavesurfer.js';
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
import type { DiagnosticEvent } from './AudioDiagnosticsCharts';

const formatClock = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

type AudioWaveformProps = {
  label: string;
  url: string;
  color: string;
  showSpectrogram?: boolean;
  events?: DiagnosticEvent[];
};

export const AudioWaveform = ({ label, url, color, showSpectrogram = false, events = [] }: AudioWaveformProps) => {
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);
  const spectrogramContainer = useRef<HTMLDivElement>(null);
  const spectrogramRegistered = useRef(false);

  return (
    <div className="audio-waveform">
      <div className="audio-waveform-track">
      <WavesurferPlayer
        url={url}
        height={72}
        waveColor={getComputedStyle(document.documentElement).getPropertyValue(color).trim()}
        progressColor={getComputedStyle(document.documentElement).getPropertyValue('--pi-color-text').trim()}
        cursorColor={getComputedStyle(document.documentElement).getPropertyValue('--pi-color-accent').trim()}
        cursorWidth={1}
        barWidth={2}
        barGap={2}
        barRadius={2}
        normalize={false}
        onReady={(instance, seconds) => {
          if (showSpectrogram && spectrogramContainer.current && !spectrogramRegistered.current) {
            instance.registerPlugin(Spectrogram.create({
              colorMap: 'roseus',
              container: spectrogramContainer.current,
              fftSamples: 512,
              frequencyMax: 8_000,
              gainDB: 0,
              height: 112,
              labels: true,
              rendering: seconds <= 300 ? 'full' : 'windowed',
              scale: 'mel',
              useWebWorker: true,
            }));
            spectrogramRegistered.current = true;
          }
          setWavesurfer(instance);
          setDuration(seconds);
          setReady(true);
          setError(false);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onFinish={() => setPlaying(false)}
        onTimeupdate={(_instance, seconds) => setCurrentTime(seconds)}
        onError={() => setError(true)}
      />
      {duration > 0 && events
        .filter((event) => ['vad_speech_started', 'interruption', 'empty_user_turn'].includes(event.kind))
        .map((event, index) => (
          <button className={`audio-event-marker audio-event-${event.kind}`} type="button"
            key={`${event.kind}-${index}`}
            style={{ left: `${Math.min(100, Math.max(0, event.timeSeconds / duration * 100))}%` }}
            title={`${event.kind.replaceAll('_', ' ')} at ${event.timeSeconds.toFixed(2)}s`}
            aria-label={`Seek to ${event.kind.replaceAll('_', ' ')} at ${event.timeSeconds.toFixed(2)} seconds`}
            onClick={() => void wavesurfer?.setTime(event.timeSeconds)} />
        ))}
      </div>
      {showSpectrogram && <div className="audio-spectrogram" ref={spectrogramContainer} />}
      <div className="audio-waveform-controls">
        <button
          className="pi-button"
          type="button"
          disabled={!ready || error}
          aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
          onClick={() => void wavesurfer?.playPause()}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <span>{error ? 'Replay unavailable' : `${formatClock(currentTime)} / ${formatClock(duration)}`}</span>
      </div>
    </div>
  );
};
