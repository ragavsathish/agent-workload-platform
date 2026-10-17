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
        },
        { additionalProperties: false },
      ),
      { maxItems: 12 },
    ),
  },
  { additionalProperties: false },
);

type JournalExtraction = Static<typeof JournalExtractionSchema>;
export type JournalEntry = JournalExtraction["entries"][number] & { id: string };

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
            "Use unclassified for a meaningful reflection that does not fit another type.",
            "Keep the owner's meaning and wording concise; do not invent conclusions or personal facts.",
            "Ignore routine commands, acknowledgements, and assistant statements.",
            "Topics are short retrieval labels, not claims of expertise.",
            `Required JSON schema: ${JSON.stringify(schema)}`,
          ].join("\n"),
        },
        { role: "user", content: text },
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

  const id = options.id ?? randomUUID();
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  return {
    id,
    sourceRef: options.sourceRef?.trim() || `pi-session:${id}`,
    capturedAt,
    transcript: text,
    entries: extracted.entries.map((entry, index) => ({
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
