import { useEffect, useState } from 'react';

import { RTVIEvent } from '@pipecat-ai/client-js';
import type { PipecatBaseChildProps } from '@pipecat-ai/voice-ui-kit';
import {
  Button,
  EventsPanel,
  usePipecatConnectionState,
} from '@pipecat-ai/voice-ui-kit';

import { unlockBotAudio } from '../audio-unlock';
import type { TransportType } from '../config';
import { MermaidDiagram } from './MermaidDiagram';
import { AudioVisualizerRadial } from './pipecat/AudioVisualizerRadial';
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
    if (typeof payload === 'object' && payload !== null && 'data' in payload) {
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
  const [defaultWorkspace, setDefaultWorkspace] = useState('');
  const [tasksOpen, setTasksOpen] = useState(false);
  const [soundStatus, setSoundStatus] = useState<'idle' | 'running' | 'blocked'>('idle');
  const [isPaused, setIsPaused] = useState(false);
  const [handsFree, setHandsFree] = useState(() => {
    try {
      return window.localStorage.getItem('pipecat.hands-free') === 'true';
    } catch {
      return false;
    }
  });
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

  const toggleHandsFree = () => {
    if (!client || !isConnected) return;
    setVoiceControlError('');
    const nextHandsFree = !handsFree;
    try {
      client.enableMic(nextHandsFree);
      setHandsFree(nextHandsFree);
      setIsPaused(!nextHandsFree);
      window.localStorage.setItem('pipecat.hands-free', String(nextHandsFree));
    } catch {
      setVoiceControlError(
        nextHandsFree
          ? 'Could not enable hands-free listening.'
          : 'Could not disable hands-free listening.'
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
    if (!client || !isConnected || !handsFree) return;
    let wakeLock: WakeLockSentinel | undefined;
    let active = true;
    const restoreHandsFree = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      try {
        client.enableMic(true);
        wakeLock = await navigator.wakeLock?.request('screen');
      } catch {
        // Best effort: mobile browsers release wake locks when the screen is locked.
      }
    };
    const handleVisibilityChange = () => void restoreHandsFree();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void restoreHandsFree();
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void wakeLock?.release();
    };
  }, [client, handsFree, isConnected]);

  useEffect(() => {
    let active = true;
    void fetch('/api/features')
      .then((response) => response.json())
      .then((features: { tasks?: boolean; defaultWorkspace?: string }) => {
        if (active) {
          setTasksEnabled(features.tasks === true);
          setDefaultWorkspace(features.defaultWorkspace || '');
        }
      })
      .catch(() => {
        if (active) setTasksEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const showTransportSelector = availableTransports.length > 1;
  const stateLabel = isConnected
    ? isPaused
      ? 'Paused'
      : 'Listening'
    : isConnecting
      ? 'Starting…'
      : 'Ready';

  return (
    <div className="app-shell">
      <main className="voice-panel">
        <header className="app-header">
          <div className="brand-block">
            <span className="brand-mark" aria-hidden="true">P</span>
            <div>
              <p className="brand-name">Pi Voice</p>
              <p className="brand-detail">Private coding workspace</p>
            </div>
          </div>
          <div className="header-actions">
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
              <span className="voice-state-label">{stateLabel}</span>
            </span>
            <Button
              className="transcript-launch"
              size="sm"
              variant="outline"
              onClick={() => window.open('/?view=transcript', '_blank', 'noopener,noreferrer')}>
              Transcript
            </Button>
            {tasksEnabled && (
              <Button
                className="tasks-launch"
                size="sm"
                variant="outline"
                aria-expanded={tasksOpen}
                onClick={() => setTasksOpen(true)}>
                Tasks
              </Button>
            )}
          </div>
        </header>

        {voiceControlError && (
          <p className="voice-control-error" role="alert">{voiceControlError}</p>
        )}

        <section className="diagram-panel" aria-label="Voice response diagram">
          <header>
            <div>
              <p className="eyebrow">LIVE RESPONSE</p>
              <h1>Conversation map</h1>
            </div>
            {showTransportSelector && (
              <TransportSelect
                transportType={transportType}
                onTransportChange={onTransportChange}
                availableTransports={availableTransports}
              />
            )}
          </header>
          <MermaidDiagram diagram={diagram} />
        </section>

        <section className="conversation-dock" aria-label="Conversation controls">
          <div className="dock-status">
            <div className="pi-activity" aria-hidden="true">
              <AudioVisualizerRadial
                participantType="bot"
                isConnecting={isConnecting}
              />
              <span className="pi-activity-core">P</span>
            </div>
            <div className="dock-copy">
              <strong>
                {isConnected
                  ? isPaused
                    ? 'Microphone paused'
                    : 'Conversation active'
                  : 'Start when you are ready'}
              </strong>
              <span>
                {isConnected
                  ? handsFree
                    ? 'Hands-free listening is on'
                    : 'Pause between turns when needed'
                  : 'Audio stays on this machine'}
              </span>
            </div>
          </div>
          <div className="dock-actions">
            {!isConnected && (
              <Button
                className="voice-control-start"
                size="lg"
                disabled={voiceControlBusy || isConnecting || !client}
                onClick={() => void startConversation()}>
                {isConnecting || voiceControlBusy ? 'Starting…' : 'Start conversation'}
              </Button>
            )}
            {isConnected && (
              <>
                <Button
                  className="voice-control-hands-free"
                  size="lg"
                  variant={handsFree ? 'default' : 'outline'}
                  disabled={voiceControlBusy}
                  aria-pressed={handsFree}
                  onClick={toggleHandsFree}>
                  {handsFree ? 'Hands-free on' : 'Hands-free off'}
                </Button>
                <Button
                  className="voice-control-pause"
                  size="lg"
                  variant="outline"
                  disabled={voiceControlBusy}
                  onClick={toggleConversationPause}>
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  className="sound-control"
                  size="lg"
                  variant="outline"
                  onClick={() => void handleEnableSound()}>
                  {soundStatus === 'running'
                    ? 'Sound on'
                    : soundStatus === 'blocked'
                      ? 'Retry sound'
                      : 'Enable sound'}
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
          </div>
        </section>

        <details className="event-details">
          <summary>Diagnostics</summary>
          <div className="event-panel"><EventsPanel /></div>
        </details>
      </main>

      {tasksEnabled && tasksOpen && (
        <>
          <button
            className="task-backdrop"
            aria-label="Close tasks"
            onClick={() => setTasksOpen(false)}
          />
          <TaskPanel
            defaultWorkspace={defaultWorkspace}
            onClose={() => setTasksOpen(false)}
            onDiagram={setDiagram}
          />
        </>
      )}
    </div>
  );
};
