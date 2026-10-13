export type FrequencyBand = {
  firstBin: number;
  lastBin: number;
};

export type VisualizerAnalyser = {
  analyser: AnalyserNode;
  dispose: () => void;
};

const MIN_VOICE_HZ = 200;
const MAX_VOICE_HZ = 8_000;

const hzToMel = (frequency: number) =>
  2595 * Math.log10(1 + frequency / 700);

const melToHz = (mel: number) =>
  700 * (10 ** (mel / 2595) - 1);

/** Attach a short-lived Web Audio analyser to an existing Pipecat media track. */
export function createVisualizerAnalyser(track: MediaStreamTrack): VisualizerAnalyser {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -20;
  analyser.smoothingTimeConstant = 0.72;
  source.connect(analyser);

  return {
    analyser,
    dispose: () => {
      source.disconnect();
      analyser.disconnect();
      void context.close();
    },
  };
}

/** Build mel-spaced FFT bands over the frequencies that carry speech. */
export function createVoiceBands(
  count: number,
  sampleRate: number,
  frequencyBinCount: number
): FrequencyBand[] {
  if (count <= 0 || sampleRate <= 0 || frequencyBinCount <= 0) return [];

  const nyquist = sampleRate / 2;
  const minimum = Math.min(MIN_VOICE_HZ, nyquist);
  const maximum = Math.min(MAX_VOICE_HZ, nyquist);
  const minimumMel = hzToMel(minimum);
  const melRange = hzToMel(maximum) - minimumMel;

  return Array.from({ length: count }, (_, index) => {
    const firstHz = melToHz(minimumMel + melRange * (index / count));
    const lastHz = melToHz(minimumMel + melRange * ((index + 1) / count));
    const firstBin = Math.min(
      frequencyBinCount - 1,
      Math.floor((firstHz / nyquist) * frequencyBinCount)
    );
    const lastBin = Math.max(
      firstBin,
      Math.min(
        frequencyBinCount - 1,
        Math.ceil((lastHz / nyquist) * frequencyBinCount) - 1
      )
    );
    return { firstBin, lastBin };
  });
}

/** Return the RMS energy for one visualizer band. */
export function readBand(data: Uint8Array<ArrayBuffer>, band: FrequencyBand): number {
  let squaredTotal = 0;
  let samples = 0;
  for (let index = band.firstBin; index <= band.lastBin; index += 1) {
    const value = data[index] ?? 0;
    squaredTotal += value * value;
    samples += 1;
  }
  return samples ? Math.sqrt(squaredTotal / samples) : 0;
}
