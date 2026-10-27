import './knowledge-widgets.css';

export type KnowledgeNote = {
  id: string;
  text: string;
  type: string;
  recordKind?: string;
  topics: string[];
  createdAt?: string;
};

export function KnowledgeNoteCard({
  note, selected = false, onSelect, headingId,
}: {
  note: KnowledgeNote;
  selected?: boolean;
  onSelect?: () => void;
  headingId?: string;
}) {
  const dailyJournal = note.recordKind === 'codex_daily_journal';
  const label = dailyJournal ? 'Daily journal' : note.type;
  const preview = dailyJournal ? note.text.split('\n', 1)[0]?.replace(/^#+\s*/u, '') ?? note.text : note.text;
  const content = <>
    <span className="entry-meta"><span className={`type-mark type-${dailyJournal ? 'daily-journal' : note.type}`} aria-hidden="true" /><span>{label}</span>{note.createdAt && !dailyJournal && <time dateTime={note.createdAt}>{new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(note.createdAt))}</time>}</span>
    {headingId ? <h2 id={headingId} className="entry-text">{preview}</h2> : <span className="entry-text">{preview}</span>}
    <span className="entry-tags">{note.topics.slice(0, 2).map((topic) => <span className="tag-chip" key={topic}>{topic}</span>)}{note.topics.length > 2 && <span className="tag-overflow">+{note.topics.length - 2}</span>}</span>
  </>;
  if (onSelect) return <button type="button" className={`knowledge-note-card entry-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>{content}</button>;
  return <article className="knowledge-note-card entry-card">{content}</article>;
}
