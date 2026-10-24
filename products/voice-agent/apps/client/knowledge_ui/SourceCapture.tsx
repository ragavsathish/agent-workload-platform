export type EvidenceSpan = { quote: string; start: number; end: number };

export function SourceCaptureHeader({ source, sourceId }: { source: string; sourceId?: string }) {
  return <div className="source-link"><span className="capture-icon" aria-hidden="true">▤</span><span><strong>{source}</strong>{sourceId && <small>Source ID: {sourceId}</small>}</span></div>;
}

export function SourceCapture({ source, sourceId, transcript, evidence }: {
  source: string;
  sourceId?: string;
  transcript: string;
  evidence?: EvidenceSpan;
}) {
  const exact = evidence && transcript.slice(evidence.start, evidence.end) === evidence.quote;
  return <div className="source-capture">
    <SourceCaptureHeader source={source} sourceId={sourceId} />
    <blockquote>{exact ? <>{transcript.slice(0, evidence.start)}<mark>{evidence.quote}</mark>{transcript.slice(evidence.end)}</> : transcript}</blockquote>
    <p className="source-note">{exact ? 'Highlighted text is the exact evidence span.' : 'Source transcript is shown for context. No exact evidence span is stored for this note.'}</p>
  </div>;
}
