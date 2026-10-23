import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../../client/design_system/elements.css';
import { KnowledgeBaseView } from './KnowledgeBaseView';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KnowledgeBaseView />
  </StrictMode>,
);
