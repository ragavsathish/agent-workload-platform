import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { KnowledgeGraph } from './KnowledgeGraph';
import { KnowledgeNoteCard } from './KnowledgeNoteCard';
import { JournalCorrectionForm, JOURNAL_TYPES, type JournalCorrection, type JournalType } from './JournalCorrectionForm';
import { SourceCaptureHeader } from './SourceCapture';

export function mountKnowledgeWidgets({
  noteContainer, graphContainer, sourceContainer, correctionContainer, id, text, type, topics, sourceId, sourceLabel, onSelectTopic, onSaveCorrection, onCancelCorrection,
}: {
  noteContainer: HTMLElement;
  graphContainer: HTMLElement;
  sourceContainer?: HTMLElement | null;
  correctionContainer?: HTMLElement | null;
  id: string;
  text: string;
  type: string;
  topics: string[];
  sourceId: string;
  sourceLabel: string;
  onSelectTopic?: (topic: string) => void;
  onSaveCorrection?: (correction: JournalCorrection) => void | Promise<void>;
  onCancelCorrection?: () => void;
}) {
  const noteRoot = createRoot(noteContainer);
  const graphRoot = createRoot(graphContainer);
  const sourceRoot = sourceContainer ? createRoot(sourceContainer) : undefined;
  const correctionRoot = correctionContainer ? createRoot(correctionContainer) : undefined;
  flushSync(() => {
    noteRoot.render(<KnowledgeNoteCard note={{ id, text, type, topics }} headingId="suggestion-title" />);
    graphRoot.render(<KnowledgeGraph entries={[{ id, text, sourceId, sourceLabel, topics }]} selectedId={id} onSelectTopic={onSelectTopic} />);
    sourceRoot?.render(<SourceCaptureHeader source={sourceLabel} sourceId={sourceId} />);
    if (onSaveCorrection && onCancelCorrection) correctionRoot?.render(
      <JournalCorrectionForm initial={{ text, type: (JOURNAL_TYPES as readonly string[]).includes(type) ? type as JournalType : 'thought', topics }} onSave={onSaveCorrection} onCancel={onCancelCorrection} />,
    );
  });
  return () => {
    noteRoot.unmount();
    graphRoot.unmount();
    sourceRoot?.unmount();
    correctionRoot?.unmount();
  };
}
