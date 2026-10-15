export type TranscriptVisualResponse = {
  spoken: string;
  mermaid: string;
};

const MAX_SPOKEN_LENGTH = 2_000;
const MAX_DIAGRAM_LENGTH = 24_000;
const MERMAID_PREFIX =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|xychart-beta)\b/;

const stripCodeFence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  if (lines[0]?.startsWith('```')) lines.shift();
  if (lines.at(-1)?.trim() === '```') lines.pop();
  return lines.join('\n').trim();
};

export const parseTranscriptResponse = (
  value: string
): TranscriptVisualResponse | undefined => {
  try {
    const payload: unknown = JSON.parse(stripCodeFence(value));
    if (!payload || typeof payload !== 'object') return undefined;
    const response = payload as Partial<TranscriptVisualResponse>;
    const spoken = typeof response.spoken === 'string' ? response.spoken.trim() : '';
    const mermaid =
      typeof response.mermaid === 'string' ? stripCodeFence(response.mermaid) : '';
    if (
      !spoken ||
      spoken.length > MAX_SPOKEN_LENGTH ||
      !mermaid ||
      mermaid.length > MAX_DIAGRAM_LENGTH ||
      !MERMAID_PREFIX.test(mermaid)
    ) {
      return undefined;
    }
    return { spoken, mermaid };
  } catch {
    return undefined;
  }
};
