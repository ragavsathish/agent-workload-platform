import { useEffect, useState } from 'react';

import type { PipecatBaseChildProps } from '@pipecat-ai/voice-ui-kit';
import {
  Button,
  ConnectButton,
  ConversationPanel,
  EventsPanel,
  UserAudioControl,
  usePipecatConnectionState,
} from '@pipecat-ai/voice-ui-kit';

import { unlockBotAudio } from '../audio-unlock';
import type { TransportType } from '../config';
import { TaskPanel } from './TaskPanel';
import { TransportSelect } from './TransportSelect';

interface AppProps extends PipecatBaseChildProps {
  transportType: TransportType;
  onTransportChange: (type: TransportType) => void;
  availableTransports: TransportType[];
}

export const App = ({
  client,
  handleConnect,
  handleDisconnect,
  transportType,
  onTransportChange,
  availableTransports,
}: AppProps) => {
  const [tasksEnabled, setTasksEnabled] = useState(false);
  const [soundStatus, setSoundStatus] = useState<
    'idle' | 'running' | 'blocked'
  >('idle');
  const { isConnected } = usePipecatConnectionState();

  const handleEnableSound = async () => {
    if (!client) return;
    const result = await unlockBotAudio(client);
    setSoundStatus(result === 'running' ? 'running' : 'blocked');
  };

  useEffect(() => {
    let active = true;
    void fetch('/api/features')
      .then((response) => response.json())
      .then((features: { tasks?: boolean }) => {
        if (active) setTasksEnabled(features.tasks === true);
      })
      .catch(() => {
        if (active) setTasksEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const showTransportSelector = availableTransports.length > 1;

  return (
    <div className={`app-shell ${tasksEnabled ? '' : 'voice-only'}`}>
      <main className="voice-panel">
        <div className="flex items-center justify-between gap-4 p-4">
          {showTransportSelector ? (
            <TransportSelect
              transportType={transportType}
              onTransportChange={onTransportChange}
              availableTransports={availableTransports}
            />
          ) : (
            <div /> /* Spacer */
          )}
          <div className="flex items-center gap-4">
            <UserAudioControl size="lg" />
            {isConnected && (
              <Button
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
            <ConnectButton
              size="lg"
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-4">
          <div className="h-full overflow-hidden">
            <ConversationPanel />
          </div>
        </div>
        <div className="h-72 overflow-hidden px-4 pb-4">
          <EventsPanel />
        </div>
      </main>
      {tasksEnabled && <TaskPanel />}
    </div>
  );
};
