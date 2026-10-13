import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@pipecat-ai/voice-ui-kit';

import type { PipecatBaseChildProps } from '@pipecat-ai/voice-ui-kit';
import {
  ErrorCard,
  FullScreenContainer,
  PipecatAppBase,
  SpinLoader,
} from '@pipecat-ai/voice-ui-kit';

import { App } from './components/App';
import { TranscriptView } from './components/TranscriptView';
import {
  AVAILABLE_TRANSPORTS,
  DEFAULT_TRANSPORT,
  TRANSPORT_PROPS,
} from './config';
import type { TransportType } from './config';
import './index.css';

export const Main = () => {
  const [transportType, setTransportType] =
    useState<TransportType>(DEFAULT_TRANSPORT);

  const transportProps = TRANSPORT_PROPS[transportType];

  return (
    <ThemeProvider defaultTheme="terminal" disableStorage>
      <FullScreenContainer>
        <PipecatAppBase
          {...transportProps}
          transportType={transportType}>
          {({
            client,
            handleConnect,
            handleDisconnect,
            error,
          }: PipecatBaseChildProps) =>
            !client ? (
              <SpinLoader />
            ) : error ? (
              <ErrorCard>{error}</ErrorCard>
            ) : (
              <App
                client={client}
                handleConnect={handleConnect}
                handleDisconnect={handleDisconnect}
                transportType={transportType}
                onTransportChange={setTransportType}
                availableTransports={AVAILABLE_TRANSPORTS}
              />
            )
          }
        </PipecatAppBase>
      </FullScreenContainer>
    </ThemeProvider>
  );
};

const transcriptView = new URLSearchParams(window.location.search).get('view') === 'transcript';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {transcriptView ? (
      <ThemeProvider defaultTheme="terminal" disableStorage>
        <TranscriptView />
      </ThemeProvider>
    ) : (
      <Main />
    )}
  </StrictMode>
);
