import { useCallback, useEffect, useState } from 'react';

import { RTVIEvent } from '@pipecat-ai/client-js';
import type { PipecatBaseChildProps } from '@pipecat-ai/voice-ui-kit';
import {
  Button,
  EventsPanel,
  usePipecatConnectionState,
} from '@pipecat-ai/voice-ui-kit';

import type { TransportType } from '../config';
import { formatTokens } from '../context-usage';
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

type ContextUsage = {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  estimated: boolean;
  canCompact: boolean;
};

const isContextUsage = (value: unknown): value is ContextUsage => {
  if (typeof value !== 'object' || value === null) return false;
  const usage = value as Partial<ContextUsage>;
  return (
    (typeof usage.tokens === 'number' || usage.tokens === null) &&
    (typeof usage.contextWindow === 'number' || usage.contextWindow === null) &&
    (typeof usage.percent === 'number' || usage.percent === null) &&
    typeof usage.estimated === 'boolean' &&
    typeof usage.canCompact === 'boolean'
  );
};

const applyBrowserAudioProcessing = async (
  client: NonNullable<PipecatBaseChildProps['client']>
) => {
  const audioTrack = client.tracks().local.audio;
  if (!audioTrack) return;

  try {
    await audioTrack.applyConstraints({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      channelCount: 1,
    });
  } catch {
    // These are optional browser hints. Keep the session usable when a browser
    // or microphone driver rejects one of them; the edge still applies RNNoise.
  }
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
  const [isMuted, setIsMuted] = useState(false);
  const [voiceControlBusy, setVoiceControlBusy] = useState(false);
  const [voiceControlError, setVoiceControlError] = useState('');
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState('');
  const [diagram, setDiagram] = useState(INITIAL_DIAGRAM);
  const { isConnected, isConnecting } = usePipecatConnectionState();

  const refreshContext = useCallback(async () => {
    try {
      const response = await fetch('/api/pi-context', { cache: 'no-store' });
      const body: unknown = await response.json();
      if (!response.ok || !isContextUsage(body)) throw new Error('context request failed');
      setContextUsage(body);
      setContextError('');
    } catch {
      setContextError('Context unavailable');
    }
  }, []);

  const startConversation = async () => {
    if (!client || !handleConnect) return;
    setVoiceControlBusy(true);
    setVoiceControlError('');
    try {
      await handleConnect();
      await applyBrowserAudioProcessing(client);
      client.enableMic(true);
      setIsMuted(false);
    } catch {
      setVoiceControlError('Could not start the conversation.');
    } finally {
      setVoiceControlBusy(false);
    }
  };

  const toggleConversationMute = () => {
    if (!client || !isConnected) return;
    setVoiceControlError('');
    try {
      const nextMuted = !isMuted;
      client.enableMic(!nextMuted);
      setIsMuted(nextMuted);
    } catch {
      setVoiceControlError(
        isMuted ? 'Could not unmute the microphone.' : 'Could not mute the microphone.'
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
      setIsMuted(false);
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

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshContext(), 0);
    const timer = window.setInterval(() => void refreshContext(), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshContext]);

  useEffect(() => {
    if (!client) return;
    client.on(RTVIEvent.BotStoppedSpeaking, refreshContext);
    return () => {
      client.off(RTVIEvent.BotStoppedSpeaking, refreshContext);
    };
  }, [client, refreshContext]);

  const compactContext = async () => {
    setContextBusy(true);
    setContextError('');
    try {
      const response = await fetch('/api/pi-context/compact', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok || !isContextUsage(body)) throw new Error('context compaction failed');
      setContextUsage(body);
    } catch {
      setContextError('Could not compact context');
    } finally {
      setContextBusy(false);
    }
  };

  const showTransportSelector = availableTransports.length > 1;
  const stateLabel = isConnected
    ? isMuted
      ? 'Muted'
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
                  ? isMuted
                    ? 'muted'
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
                  ? isMuted
                    ? 'Microphone muted'
                    : 'Conversation active'
                  : 'Start when you are ready'}
              </strong>
              <span>
                {isConnected
                  ? isMuted
                    ? 'Pi remains connected and can still respond'
                    : 'Mute the microphone when privacy is needed'
                  : 'Audio stays on this machine'}
              </span>
            </div>
          </div>
          <div className="context-control" aria-live="polite">
            <div className="context-copy">
              <span>Context</span>
              <strong>
                {contextUsage?.tokens !== null && contextUsage?.tokens !== undefined
                  ? `${contextUsage.estimated ? '~' : ''}${formatTokens(contextUsage.tokens)}`
                  : '—'}
                {contextUsage?.contextWindow
                  ? ` / ${formatTokens(contextUsage.contextWindow)}`
                  : ''}
              </strong>
              {contextUsage?.percent !== null && contextUsage?.percent !== undefined && (
                <span>{Math.round(contextUsage.percent)}% used</span>
              )}
              {contextError && <span className="context-error">{contextError}</span>}
            </div>
            <Button
              className="context-compact"
              size="sm"
              variant="outline"
              disabled={contextBusy || contextUsage?.canCompact !== true}
              onClick={() => void compactContext()}>
              {contextBusy ? 'Compacting…' : 'Compact'}
            </Button>
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
                  className="voice-control-mute"
                  size="lg"
                  variant={isMuted ? 'default' : 'outline'}
                  disabled={voiceControlBusy}
                  aria-pressed={isMuted}
                  onClick={toggleConversationMute}>
                  {isMuted ? 'Unmute' : 'Mute'}
                </Button>
                <Button
                  className="voice-control-stop"
                  size="lg"
                  variant="destructive"
                  disabled={voiceControlBusy}
                  onClick={() => void stopConversation()}>
                  {voiceControlBusy ? 'Ending…' : 'End conversation'}
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
