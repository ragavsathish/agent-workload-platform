import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AudioDiagnosticsView } from './AudioDiagnosticsView';
import '../../client/design_system/elements.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioDiagnosticsView />
  </StrictMode>,
);
