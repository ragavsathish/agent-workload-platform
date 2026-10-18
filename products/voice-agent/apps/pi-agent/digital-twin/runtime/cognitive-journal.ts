import { randomUUID } from "node:crypto";

import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

export const JOURNAL_ENTRY_TYPES = [
  "thought",
  "idea",
  "question",
  "decision",
  "goal",
  "learning",
  "unclassified",
] as const;

const JournalExtractionSchema = Type.Object(
  {
    entries: Type.Array(
      Type.Object(
        {
          type: Type.Union(JOURNAL_ENTRY_TYPES.map((value) => Type.Literal(value))),
          text: Type.String({ minLength: 1, maxLength: 1_000 }),
          topics: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
            maxItems: 8,
          }),
          evidenceQuote: Type.String({ minLength: 1, maxLength: 500 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 12 },
    ),
  },
  { additionalProperties: false },
);

type JournalExtraction = Static<typeof JournalExtractionSchema>;
type ExtractedJournalEntry = JournalExtraction["entries"][number];
export type JournalEntry = Omit<ExtractedJournalEntry, "evidenceQuote"> & { id: string };

export type CognitiveJournalCapture = {
  id: string;
  sourceRef: string;
  capturedAt: string;
  transcript: string;
  entries: JournalEntry[];
};

type JsonFetch = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("model returned a non-object response");
  }
  return value as Record<string, unknown>;
}

const LOW_VALUE_TRANSCRIPT_PATTERNS = [
  /^authenticated user\s*:/i,
  /^(?:voice black box|system|assistant)\b[^.!?\n]*\b(?:complete|connected|disconnected|authenticated|reported)\b[^.!?\n]*[.!?]?$/i,
  /^(?:can you hear (?:me|this)|are you okay|please repeat(?: what you said| any question.*)?)\??$/i,
  /^(?:do not change files|continue current activity|proceed with deeper analysis|select the latest version|propose a task in the default workspace|waiting for a moment to return)\.?$/i,
  /^(?:okay|ok|thanks|thank you|that works|go ahead|done(?: for now)?)\b[.!?]*$/i,
];

const ROUTINE_COMMAND_PATTERN = /^(?:please\s+)?(?:use|check|run|open|deploy|search|inspect|restart|query|read|create|add|show|extract|render|call|fix|explain|summarize|review|find|look up)\b/i;
const POLITE_COMMAND_PATTERN = /^(?:can|could|would|will)\s+you\b/i;
const REPORTED_SPEECH_PATTERN = /^(?:(?:a|an|the|my)\s+)?(?:assistant|system|blog|article|author|presenter|speaker|colleague)\b.*\b(?:said|says|suggested|proposed|claims?|argues?|explained|reported|believes?)\b/i;
const ATTRIBUTED_SPEECH_PATTERN = /^(?:according to\b|i\s+(?:read|heard|watched|saw|attended)\b)/i;

const CONTENT_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does", "for", "from",
  "he", "her", "him", "his", "i", "in", "is", "it", "its", "me", "my", "of", "on", "or",
  "our", "she", "that", "the", "their", "them", "they", "this", "to", "us", "was", "we",
  "were", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function contentWords(value: string): Set<string> {
  return new Set(normalized(value)
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)
    ?.filter((word) => !CONTENT_STOP_WORDS.has(word)) ?? []);
}

function isLowValueText(value: string): boolean {
  const text = value.trim();
  if (LOW_VALUE_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return contentWords(text).size < 2;
}

function isIneligibleJournalSentence(value: string): boolean {
  const text = value.trim();
  return isLowValueText(text)
    || ROUTINE_COMMAND_PATTERN.test(text)
    || POLITE_COMMAND_PATTERN.test(text)
    || REPORTED_SPEECH_PATTERN.test(text)
    || ATTRIBUTED_SPEECH_PATTERN.test(text);
}

export function prepareCognitiveJournalTranscript(value: string): string {
  return (value.match(/[^.!?\n]+[.!?]?/gu) ?? [value])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !isIneligibleJournalSentence(sentence))
    .join("\n");
}

function isSemanticallySupported(text: string, evidenceQuote: string): boolean {
  const evidenceWords = contentWords(evidenceQuote);
  return [...contentWords(text)].some((word) => evidenceWords.has(word));
}

function hasTypeEvidence(type: ExtractedJournalEntry["type"], evidenceQuote: string): boolean {
  if (type === "learning") {
    return /\b(?:learn(?:ed|t|ing)?|understand(?:ing|s|stood)?|reali[sz](?:e|ed|ing)|discover(?:ed|ing)?|found out|now know|makes? sense|means?)\b/i
      .test(evidenceQuote);
  }
  if (type === "decision") {
    return /\b(?:i|we)\s+(?:(?:have|'ve)\s+)?decided\b|\b(?:i|we)\s+(?:will|'ll)\b|\b(?:my|our|the)\s+decision\b/i
      .test(evidenceQuote);
  }
  return true;
}

function groundedJournalEntries(
  transcript: string,
  entries: ExtractedJournalEntry[],
): Array<Omit<ExtractedJournalEntry, "evidenceQuote">> {
  const source = normalized(transcript);
  const seen = new Set<string>();
  return entries.flatMap(({ evidenceQuote, ...entry }) => {
    const evidence = normalized(evidenceQuote);
    if (!evidence || !source.includes(evidence)) return [];
    if (isIneligibleJournalSentence(evidenceQuote) || isLowValueText(entry.text)) return [];
    if (!isSemanticallySupported(entry.text, evidenceQuote)) return [];
    if (!hasTypeEvidence(entry.type, evidenceQuote)) return [];
    const key = `${entry.type}\0${normalized(entry.text)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      ...entry,
      text: entry.text.trim(),
      topics: entry.topics.map((topic) => topic.trim()),
    }];
  });
}

export async function captureCognitiveJournal(
  transcript: string,
  options: {
    baseUrl?: string;
    fetch?: JsonFetch;
    id?: string;
    model?: string;
    now?: () => Date;
    sourceRef?: string;
    signal?: AbortSignal;
  } = {},
): Promise<CognitiveJournalCapture> {
  const text = transcript.trim();
  if (!text) throw new Error("transcript must not be empty");

  const id = options.id ?? randomUUID();
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  const sourceRef = options.sourceRef?.trim() || `pi-session:${id}`;
  const eligibleTranscript = prepareCognitiveJournalTranscript(text);
  if (!eligibleTranscript) {
    return { id, sourceRef, capturedAt, transcript: text, entries: [] };
  }

  const request = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const schema = JSON.parse(JSON.stringify(JournalExtractionSchema)) as Record<string, unknown>;
  const response = await request(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model ?? "qwen3.5:9b-mlx",
      stream: false,
      think: false,
      format: schema,
      options: { temperature: 0 },
      messages: [
        {
          role: "system",
          content: [
            "Create a lightweight cognitive journal from the owner's transcript.",
            "Capture meaningful thoughts, ideas, genuine questions, decisions, goals, and learnings.",
            "Each entry must have standalone value when read later without conversation context.",
            "Evaluate every sentence independently: ignore a noisy sentence without discarding meaningful owner statements elsewhere in the transcript.",
            "Explicit signals such as 'I think', 'an idea', 'we could', 'I decided', 'we will', 'my goal', 'I want', 'I learned', 'I realized', and 'I now understand' normally indicate durable journal content.",
            "A specific technical why/how question is a genuine question when its answer would remain useful later; an imperative request to run, check, open, deploy, search, or repeat something is a routine command.",
            "Project architecture and workflow choices can be durable decisions, goals, or ideas; they do not need to be biographical facts.",
            "Use unclassified only for a meaningful reflection that does not fit another type.",
            "Keep the owner's meaning and wording concise; do not invent conclusions or personal facts.",
            "For every entry, evidenceQuote must be an exact, contiguous, verbatim quote from the transcript that supports the entry.",
            "Ignore authentication or system status, routine commands, acknowledgements, navigation, requests to repeat, quoted text, and assistant statements.",
            "Do not classify identity, affiliation, biography, or merely consuming a source as learning. Learning requires the owner to express a new understanding.",
            "Reject vague fragments, context-dependent references, and generic phrases. Return an empty entries array when nothing has durable cognitive value.",
            "Topics are short retrieval labels, not claims of expertise.",
            `Required JSON schema: ${JSON.stringify(schema)}`,
          ].join("\n"),
        },
        {
          role: "user",
          content: "Why does the cache remain stale after the deployment completes?",
        },
        {
          role: "assistant",
          content: JSON.stringify({ entries: [{
            type: "question",
            text: "Why the cache remains stale after deployment.",
            topics: ["cache", "deployment"],
            evidenceQuote: "Why does the cache remain stale after the deployment completes?",
          }] }),
        },
        {
          role: "user",
          content: "I decided that local requests will bypass the remote proxy.",
        },
        {
          role: "assistant",
          content: JSON.stringify({ entries: [{
            type: "decision",
            text: "Local requests will bypass the remote proxy.",
            topics: ["local routing", "proxy"],
            evidenceQuote: "I decided that local requests will bypass the remote proxy.",
          }] }),
        },
        {
          role: "user",
          content: "System connected successfully. I now understand that retries need stable identifiers.",
        },
        {
          role: "assistant",
          content: JSON.stringify({ entries: [{
            type: "learning",
            text: "Retries need stable identifiers.",
            topics: ["retries", "identifiers"],
            evidenceQuote: "I now understand that retries need stable identifiers.",
          }] }),
        },
        { role: "user", content: "Check the logs and deploy it." },
        { role: "assistant", content: JSON.stringify({ entries: [] }) },
        { role: "user", content: eligibleTranscript },
      ],
    }),
    signal: options.signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`Ollama rejected journal extraction: ${response.statusText}`);
  const message = asRecord(asRecord(payload).message);
  if (typeof message.content !== "string") throw new Error("Ollama returned no journal content");

  let extracted: unknown;
  try {
    extracted = JSON.parse(message.content);
  } catch {
    throw new Error("Ollama returned invalid journal JSON");
  }
  if (!Check(JournalExtractionSchema, extracted)) {
    throw new Error("Ollama returned entries outside the journal contract");
  }

  const entries = groundedJournalEntries(text, extracted.entries);
  return {
    id,
    sourceRef,
    capturedAt,
    transcript: text,
    entries: entries.map((entry, index) => ({
      ...entry,
      id: `${id}:entry:${index + 1}`,
    })),
  };
}

function rdfLiteral(value: string): string {
  return JSON.stringify(value).replaceAll("\\/", "/");
}

function assertIri(value: string, name: string): string {
  if (!/^urn:[A-Za-z0-9][A-Za-z0-9:._~-]*$/.test(value)) {
    throw new Error(`${name} must be a safe URN`);
  }
  return value;
}

export function cognitiveJournalSparql(
  capture: CognitiveJournalCapture,
  graph = "urn:awp:digital-twin:graph:journal",
): string {
  const graphIri = assertIri(graph, "journal graph");
  const sourceIri = assertIri(`urn:awp:digital-twin:journal:${capture.id}`, "journal source");
  const triples = [
    `<${sourceIri}> a schema:Message ;`,
    `  schema:identifier ${rdfLiteral(capture.sourceRef)} ;`,
    `  schema:text ${rdfLiteral(capture.transcript)} ;`,
    `  schema:dateSent ${rdfLiteral(capture.capturedAt)}^^xsd:dateTime .`,
  ];

  for (const entry of capture.entries) {
    const entryIri = assertIri(`urn:awp:digital-twin:journal:${entry.id}`, "journal entry");
    const properties = [
      `  schema:additionalType ${rdfLiteral(entry.type)}`,
      `  schema:text ${rdfLiteral(entry.text)}`,
      `  schema:dateCreated ${rdfLiteral(capture.capturedAt)}^^xsd:dateTime`,
      `  schema:isBasedOn <${sourceIri}>`,
      ...entry.topics.map((topic) => `  schema:keywords ${rdfLiteral(topic)}`),
    ];
    triples.push(`<${entryIri}> a schema:CreativeWork ;\n${properties.join(" ;\n")} .`);
  }

  return [
    "PREFIX schema: <https://schema.org/>",
    "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
    `INSERT DATA { GRAPH <${graphIri}> {`,
    ...triples.map((line) => `  ${line.replaceAll("\n", "\n  ")}`),
    "} }",
    "",
  ].join("\n");
}
