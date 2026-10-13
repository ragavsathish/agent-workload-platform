import type { PipecatClient } from '@pipecat-ai/client-js';

type WebSocketAudioTransport = {
  _mediaManager?: {
    _wavStreamPlayer?: {
      context?: AudioContext;
    };
  };
};

export type AudioUnlockResult = 'running' | 'unavailable' | 'blocked';

/**
 * Resume the WebSocket transport's playback context from a user gesture.
 * Mobile Safari can leave this context suspended when bot audio arrives after
 * the original Connect tap. The confirmation tone uses the same destination
 * as bot audio, so hearing it proves the complete browser playback path.
 */
export const unlockBotAudio = async (
  client: PipecatClient
): Promise<AudioUnlockResult> => {
  const transport = client.transport as unknown as WebSocketAudioTransport;
  const context = transport._mediaManager?._wavStreamPlayer?.context;

  if (!context) return 'unavailable';
  if (context.state === 'suspended') await context.resume();
  if (context.state !== 'running') return 'blocked';

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime;

  oscillator.frequency.setValueAtTime(660, start);
  gain.gain.setValueAtTime(0.04, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.16);

  return 'running';
};
