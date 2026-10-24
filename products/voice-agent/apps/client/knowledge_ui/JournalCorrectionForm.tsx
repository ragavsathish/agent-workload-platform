import { useState } from 'react';

export const JOURNAL_TYPES = ['thought', 'idea', 'question', 'decision', 'goal', 'learning'] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];
export type JournalCorrection = { text: string; type: JournalType; topics: string[] };

export function JournalCorrectionForm({ initial, saving = false, saveLabel = 'Save correction', onSave, onCancel }: {
  initial: JournalCorrection;
  saving?: boolean;
  saveLabel?: string;
  onSave: (correction: JournalCorrection) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [type, setType] = useState<JournalType>(initial.type);
  const [topics, setTopics] = useState(initial.topics.join(', '));
  const [submitting, setSubmitting] = useState(false);
  const busy = saving || submitting;
  const parsedTopics = [...new Set(topics.split(',').map((topic) => topic.trim()).filter(Boolean))];
  const valid = text.trim().length > 0 && text.trim().length <= 1000
    && parsedTopics.length <= 12 && parsedTopics.every((topic) => topic.length <= 80);
  return <form className="journal-correction-form" onSubmit={(event) => {
    event.preventDefault();
    if (valid && !busy) {
      setSubmitting(true);
      void Promise.resolve(onSave({ text: text.trim(), type, topics: parsedTopics })).then(
        () => setSubmitting(false), () => setSubmitting(false),
      );
    }
  }}>
    <label>Corrected note<textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} maxLength={1000} required /></label>
    <label>Note type<select value={type} onChange={(event) => setType(event.target.value as JournalType)}>
      {JOURNAL_TYPES.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}
    </select></label>
    <label>Topic tags <small>Separate with commas</small><input value={topics} onChange={(event) => setTopics(event.target.value)} /></label>
    {!valid && <p role="alert">Enter a note under 1,000 characters and up to 12 tags of 80 characters each.</p>}
    <div className="review-actions"><button className="pi-button review-primary" type="submit" disabled={busy || !valid}>{busy ? 'Saving…' : saveLabel}</button><button className="pi-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
