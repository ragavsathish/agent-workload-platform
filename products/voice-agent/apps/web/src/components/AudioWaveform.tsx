import { useRef, useState } from 'react';

import WavesurferPlayer from '@wavesurfer/react';
import type WaveSurfer from 'wavesurfer.js';
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';

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
};

export const AudioWaveform = ({ label, url, color, showSpectrogram = false }: AudioWaveformProps) => {
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
      <WavesurferPlayer
        url={url}
        height={72}
        waveColor={color}
        progressColor="#eef7f2"
        cursorColor="#56e39f"
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
      {showSpectrogram && <div className="audio-spectrogram" ref={spectrogramContainer} />}
      <div className="audio-waveform-controls">
        <button
          type="button"
          disabled={!ready || error}
          aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
          onClick={() => void wavesurfer?.playPause()}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span>{error ? 'Replay unavailable' : `${formatClock(currentTime)} / ${formatClock(duration)}`}</span>
      </div>
    </div>
  );
};
