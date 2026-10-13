import { usePipecatClientMediaTrack } from '@pipecat-ai/client-react';
import { memo, useEffect, useRef } from 'react';

import {
  createVisualizerAnalyser,
  createVoiceBands,
  readBand,
} from '../../visualizer';

type ParticipantType = Parameters<typeof usePipecatClientMediaTrack>[1];

type AudioVisualizerRadialProps = {
  participantType: ParticipantType;
  isConnecting?: boolean;
  isThinking?: boolean;
  radius?: number;
  barCount?: number;
  barMaxLength?: number;
  className?: string;
};

/**
 * Compact source-installed Pipecat UI radial visualizer. It follows the
 * official voice-tuned 200 Hz–8 kHz mel-band behaviour while inheriting this
 * application's existing visual language.
 */
export const AudioVisualizerRadial = memo(function AudioVisualizerRadial({
  participantType,
  isConnecting = false,
  isThinking = false,
  radius = 18,
  barCount = 24,
  barMaxLength = 9,
  className,
}: AudioVisualizerRadialProps) {
  const track = usePipecatClientMediaTrack('audio', participantType);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dotWidth = (radius * Math.PI) / barCount;
    const side = 2 * (radius + barMaxLength + dotWidth);
    const center = side / 2;
    const scale = window.devicePixelRatio || 1;
    canvas.width = side * scale;
    canvas.height = side * scale;
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(scale, scale);
    context.lineCap = 'round';

    let analyser: AnalyserNode | null = null;
    let frequencyData: Uint8Array<ArrayBuffer> | null = null;
    let dispose: (() => void) | undefined;
    if (track && !isConnecting && !isThinking) {
      const pipeline = createVisualizerAnalyser(track);
      analyser = pipeline.analyser;
      dispose = pipeline.dispose;
      frequencyData = new Uint8Array(pipeline.analyser.frequencyBinCount);
    }

    const bands = createVoiceBands(
      Math.floor(barCount / 2) + 1,
      analyser?.context.sampleRate ?? 48000,
      analyser?.frequencyBinCount ?? 512
    );
    const displayed = Array.from({ length: barCount }, () => 0);
    let animationFrame = 0;

    const draw = () => {
      const styles = getComputedStyle(canvas);
      const baseColor = styles.getPropertyValue('--visualizer-rest').trim() || '#426558';
      const activeColor = styles.getPropertyValue('--visualizer-active').trim() || '#72efb6';
      const now = performance.now() / 1000;
      context.clearRect(0, 0, side, side);

      if (analyser && frequencyData) analyser.getByteFrequencyData(frequencyData);

      for (let index = 0; index < barCount; index += 1) {
        const angle = (index / barCount) * Math.PI * 2 - Math.PI / 2;
        const band = bands[Math.min(index, barCount - index)];
        let target = band && frequencyData
          ? (readBand(frequencyData, band) / 255) * barMaxLength
          : 0;
        let alpha = track ? 0.42 : 0.2;

        if (isConnecting || isThinking) {
          const head = (now * (isConnecting ? 2.4 : 1.25)) % (Math.PI * 2);
          const distance = Math.abs(Math.atan2(Math.sin(angle - head), Math.cos(angle - head)));
          const glow = Math.max(0, 1 - distance / (isConnecting ? 0.55 : 1.4));
          target = glow * (isConnecting ? 3 : 6);
          alpha = 0.25 + glow * 0.75;
        }

        displayed[index] += (target - displayed[index]) * 0.38;
        const length = Math.max(0.1, displayed[index]);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        context.beginPath();
        context.moveTo(center + cosine * radius, center + sine * radius);
        context.lineTo(
          center + cosine * (radius + length),
          center + sine * (radius + length)
        );
        context.globalAlpha = alpha;
        context.strokeStyle = length > 1 || isConnecting || isThinking
          ? activeColor
          : baseColor;
        context.lineWidth = dotWidth;
        context.stroke();
      }
      context.globalAlpha = 1;
      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrame);
      dispose?.();
    };
  }, [barCount, barMaxLength, isConnecting, isThinking, radius, track]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-label={`Pi ${participantType} audio activity`}
      data-state={
        isConnecting ? 'connecting' : isThinking ? 'thinking' : track ? 'speaking' : 'silent'
      }
    />
  );
});
