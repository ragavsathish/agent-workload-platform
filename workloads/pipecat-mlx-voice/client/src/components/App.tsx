import { useEffect, useState } from 'react';

import { RTVIEvent } from '@pipecat-ai/client-js';
import type { PipecatBaseChildProps } from '@pipecat-ai/voice-ui-kit';
import {
  Button,
  ConversationPanel,
  EventsPanel,
  usePipecatConnectionState,
} from '@pipecat-ai/voice-ui-kit';

import { unlockBotAudio } from '../audio-unlock';
import type { TransportType } from '../config';
import { MermaidDiagram } from './MermaidDiagram';
import { TaskPanel } from './TaskPanel';
import { TransportSelect } from './TransportSelect';

interface AppProps extends PipecatBaseChildProps {
  transportType: TransportType;
  onTransportChange: (type: TransportType) => void;
  availableTransports: TransportType[];
}

const INITIAL_DIAGRAM = `flowchart TD
  voice["Voice"] --> pi["Pi"]
  pi --> waiting["Waiting for response"]`;

const readMermaidMessage = (value: unknown): string | undefined => {
  let payload = value;
  for (let depth = 0; depth < 2; depth += 1) {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'data' in payload
    ) {
      payload = (payload as { data: unknown }).data;
    }
  }
  if (typeof payload !== 'object' || payload === null) return undefined;
  const message = payload as { type?: unknown; diagram?: unknown };
  if (
    message.type !== 'mermaid' ||
    typeof message.diagram !== 'string' ||
    message.diagram.length === 0 ||
    message.diagram.length > 24_000
  ) {
    return undefined;
  }
  return message.diagram;
};

export const App = ({
  client,
  handleConnect,
  handleDisconnect,
  transportType,
  onTransportChange,
  availableTransports,
}: AppProps) => {
  const [tasksEnabled, setTasksEnabled] = useState(false);
  const [speakerEnrollmentAvailable, setSpeakerEnrollmentAvailable] =
    useState(false);
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [enrollmentSession, setEnrollmentSession] = useState<string>();
  const [enrollmentStatus, setEnrollmentStatus] = useState('');
  const [soundStatus, setSoundStatus] = useState<
    'idle' | 'running' | 'blocked'
  >('idle');
  const [isPaused, setIsPaused] = useState(false);
  const [voiceControlBusy, setVoiceControlBusy] = useState(false);
  const [voiceControlError, setVoiceControlError] = useState('');
  const [diagram, setDiagram] = useState(INITIAL_DIAGRAM);
  const { isConnected, isConnecting } = usePipecatConnectionState();

  const handleEnableSound = async () => {
    if (!client) return;
    const result = await unlockBotAudio(client);
    setSoundStatus(result === 'running' ? 'running' : 'blocked');
  };

  const startConversation = async () => {
    if (!client || !handleConnect) return;
    setVoiceControlBusy(true);
    setVoiceControlError('');
    try {
      await handleConnect();
      client.enableMic(true);
      setIsPaused(false);
    } catch {
      setVoiceControlError('Could not start the conversation.');
    } finally {
      setVoiceControlBusy(false);
    }
  };

  const toggleConversationPause = () => {
    if (!client || !isConnected) return;
    setVoiceControlError('');
    try {
      const nextPaused = !isPaused;
      client.enableMic(!nextPaused);
      setIsPaused(nextPaused);
    } catch {
      setVoiceControlError(
        isPaused ? 'Could not resume listening.' : 'Could not pause listening.'
      );
    }
  };

  const stopConversation = async () => {
    if (!client || !handleDisconnect) return;
    setVoiceControlBusy(true);
    setVoiceControlError('');
    try {
      client.enableMic(false);
      await handleDisconnect();
      setIsPaused(false);
    } catch {
      setVoiceControlError('Could not stop the conversation.');
    } finally {
      setVoiceControlBusy(false);
    }
  };

  useEffect(() => {
    if (!client) return;
    const handleServerMessage = (data: unknown) => {
      const nextDiagram = readMermaidMessage(data);
      if (nextDiagram) setDiagram(nextDiagram);
    };
    client.on(RTVIEvent.ServerMessage, handleServerMessage);
    return () => {
      client.off(RTVIEvent.ServerMessage, handleServerMessage);
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    void fetch('/api/features')
      .then((response) => response.json())
      .then((features: { tasks?: boolean; speakerEnrollment?: boolean }) => {
        if (active) {
          setTasksEnabled(features.tasks === true);
          setSpeakerEnrollmentAvailable(features.speakerEnrollment === true);
        }
      })
      .catch(() => {
        if (active) setTasksEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!enrollmentSession) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch('/api/speaker-enrollment/status', {
          headers: { 'X-Speaker-Enrollment-Session': enrollmentSession },
        });
        const result = (await response.json()) as {
          status?: string;
          samples?: number;
          requiredSamples?: number;
          message?: string | null;
        };
        if (!response.ok) throw new Error('Enrollment status unavailable');
        if (!active) return;
        const detail = result.message
          ? ` ${result.message}`
          : '';
        setEnrollmentStatus(
          `${result.status ?? 'unknown'}: ${result.samples ?? 0}/${result.requiredSamples ?? 3} samples.${detail}`
        );
        if (!['complete', 'failed', 'expired'].includes(result.status ?? '')) {
          window.setTimeout(() => void poll(), 1000);
        }
      } catch {
        if (active) setEnrollmentStatus('Enrollment status unavailable.');
      }
    };
    void poll();
    return () => {
      active = false;
    };
  }, [enrollmentSession]);

  const claimEnrollment = async () => {
    setEnrollmentStatus('Claiming enrollment…');
    const response = await fetch('/api/speaker-enrollment/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: enrollmentToken }),
    });
    const result = (await response.json()) as { session?: string };
    if (!response.ok || !result.session) {
      setEnrollmentStatus('Enrollment token was rejected.');
      return;
    }
    setEnrollmentToken('');
    setEnrollmentSession(result.session);
    setEnrollmentStatus('collecting: 0/3 samples. Speak three separate phrases.');
  };

  const showTransportSelector = availableTransports.length > 1;

  return (
    <div className={`app-shell ${tasksEnabled ? '' : 'voice-only'}`}>
      <main className="voice-panel">
        <div className="voice-toolbar flex items-center justify-between gap-4 p-4">
          {showTransportSelector ? (
            <TransportSelect
              transportType={transportType}
              onTransportChange={onTransportChange}
              availableTransports={availableTransports}
            />
          ) : (
            <div /> /* Spacer */
          )}
          <div className="voice-actions flex items-center gap-4">
            <span
              className={`voice-state ${
                isConnected
                  ? isPaused
                    ? 'paused'
                    : 'listening'
                  : isConnecting
                    ? 'starting'
                    : 'stopped'
              }`}
              role="status">
              {isConnected
                ? isPaused
                  ? 'Paused'
                  : 'Listening'
                : isConnecting
                  ? 'Starting…'
                  : 'Stopped'}
            </span>
            <Button
              className="transcript-launch"
              size="lg"
              variant="outline"
              onClick={() =>
                window.open('/?view=transcript', '_blank', 'noopener,noreferrer')
              }>
              Open Pi transcript
            </Button>
            {!isConnected && (
              <Button
                className="voice-control-start"
                size="lg"
                disabled={voiceControlBusy || isConnecting || !client}
                onClick={() => void startConversation()}>
                {isConnecting || voiceControlBusy ? 'Starting…' : 'Start'}
              </Button>
            )}
            {isConnected && (
              <>
                <Button
                  className="voice-control-pause"
                  size="lg"
                  variant="outline"
                  disabled={voiceControlBusy}
                  onClick={toggleConversationPause}>
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  className="voice-control-stop"
                  size="lg"
                  variant="destructive"
                  disabled={voiceControlBusy}
                  onClick={() => void stopConversation()}>
                  {voiceControlBusy ? 'Stopping…' : 'Stop'}
                </Button>
              </>
            )}
            {isConnected && (
              <Button
                className="sound-control"
                size="lg"
                variant={soundStatus === 'running' ? 'outline' : 'default'}
                onClick={() => void handleEnableSound()}>
                {soundStatus === 'running'
                  ? 'Sound enabled'
                  : soundStatus === 'blocked'
                    ? 'Retry sound'
                : 'Enable sound'}
              </Button>
            )}
          </div>
        </div>
        {voiceControlError && (
          <p className="voice-control-error" role="alert">
            {voiceControlError}
          </p>
        )}
        {speakerEnrollmentAvailable && isConnected && (
          <div className="flex items-center gap-3 px-4 pb-3">
            <input
              aria-label="Speaker enrollment token"
              type="password"
              autoComplete="off"
              value={enrollmentToken}
              placeholder="Host enrollment token"
              onChange={(event) => setEnrollmentToken(event.target.value)}
              className="min-w-64 rounded border px-3 py-2 text-sm"
            />
            <Button
              size="sm"
              disabled={enrollmentToken.length < 16 || Boolean(enrollmentSession)}
              onClick={() => void claimEnrollment()}>
              Enroll my voice
            </Button>
            {enrollmentStatus && (
              <span role="status" className="text-sm">
                {enrollmentStatus}
              </span>
            )}
          </div>
        )}
        <section className="diagram-panel" aria-label="Voice response diagram">
          <header>
            <p className="eyebrow">LIVE RESPONSE</p>
            <h1>Voice, made visual</h1>
          </header>
          <MermaidDiagram diagram={diagram} />
        </section>
        <div className="conversation-strip">
          <div className="h-full overflow-hidden">
            <ConversationPanel />
          </div>
        </div>
        <details className="event-details">
          <summary>Connection details</summary>
          <div className="event-panel">
            <EventsPanel />
          </div>
        </details>
      </main>
      {tasksEnabled && <TaskPanel />}
    </div>
  );
};
