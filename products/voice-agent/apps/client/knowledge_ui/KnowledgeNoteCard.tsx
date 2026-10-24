import './knowledge-widgets.css';

export type KnowledgeNote = {
  id: string;
  text: string;
  type: string;
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
  const content = <>
    <span className="entry-meta"><span className={`type-mark type-${note.type}`} aria-hidden="true" /><span>{note.type}</span>{note.createdAt && <time dateTime={note.createdAt}>{new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(note.createdAt))}</time>}</span>
    {headingId ? <h2 id={headingId} className="entry-text">{note.text}</h2> : <span className="entry-text">{note.text}</span>}
    <span className="entry-tags">{note.topics.slice(0, 2).map((topic) => <span className="tag-chip" key={topic}>{topic}</span>)}{note.topics.length > 2 && <span className="tag-overflow">+{note.topics.length - 2}</span>}</span>
  </>;
  if (onSelect) return <button type="button" className={`knowledge-note-card entry-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>{content}</button>;
  return <article className="knowledge-note-card entry-card">{content}</article>;
}
