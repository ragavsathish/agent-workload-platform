import { createHash } from "node:crypto";

const ENTRY_TYPES = new Set([
  "thought",
  "idea",
  "question",
  "decision",
  "goal",
  "learning",
  "unclassified",
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readInput() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const value = JSON.parse(input);
  for (const name of ["identity", "sessionId", "messageId", "transcript", "capturedAt"]) {
    if (typeof value[name] !== "string" || !value[name].trim()) {
      throw new Error(`${name} must be a non-empty string`);
    }
  }
  if (value.transcript.length > 20_000) throw new Error("transcript is too large");
  return value;
}

function checkedEntries(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) {
    throw new Error("model returned an invalid journal object");
  }
  if (value.entries.length > 12) throw new Error("model returned too many entries");
  return value.entries.map((entry) => {
    if (!entry || typeof entry !== "object" || !ENTRY_TYPES.has(entry.type)) {
      throw new Error("model returned an invalid entry type");
    }
    if (typeof entry.text !== "string" || !entry.text.trim() || entry.text.length > 1_000) {
      throw new Error("model returned invalid entry text");
    }
    if (!Array.isArray(entry.topics) || entry.topics.length > 8
      || entry.topics.some((topic) => typeof topic !== "string" || !topic.trim() || topic.length > 120)) {
      throw new Error("model returned invalid entry topics");
    }
    return {
      type: entry.type,
      text: entry.text.trim(),
      topics: entry.topics.map((topic) => topic.trim()),
    };
  });
}

const input = await readInput();
const modelBase = required("DIGITAL_TWIN_MODEL_BASE_URL").replace(/\/$/, "");
const writerUrl = required("DIGITAL_TWIN_WRITER_URL");
const writerToken = required("DIGITAL_TWIN_WRITER_TOKEN");
const model = required("DIGITAL_TWIN_MODEL");
const format = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "topics"],
        properties: {
          type: { enum: [...ENTRY_TYPES] },
          text: { type: "string", minLength: 1, maxLength: 1_000 },
          topics: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
  },
};
const modelResponse = await fetch(`${modelBase}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    think: false,
    format,
    options: { temperature: 0 },
    messages: [
      {
        role: "system",
        content: [
          "Create a lightweight cognitive journal from the owner's transcript.",
          "Capture meaningful thoughts, ideas, genuine questions, decisions, goals, and learnings.",
          "Keep the owner's meaning concise and do not invent conclusions or personal facts.",
          "Ignore routine commands, acknowledgements, quoted text, and assistant statements.",
          "Topics are retrieval labels, not claims of expertise.",
        ].join("\n"),
      },
      { role: "user", content: input.transcript },
    ],
  }),
});
if (!modelResponse.ok) throw new Error(`model request failed with ${modelResponse.status}`);
const modelPayload = await modelResponse.json();
const content = modelPayload?.message?.content;
if (typeof content !== "string") throw new Error("model returned no journal content");
const entries = checkedEntries(JSON.parse(content));
const captureId = createHash("sha256")
  .update(`${input.sessionId}\0${input.messageId}`)
  .digest("hex")
  .slice(0, 32);
const capture = {
  id: captureId,
  identity: input.identity,
  sourceRef: `pi-session:${input.sessionId}:${input.messageId}`,
  capturedAt: input.capturedAt,
  transcript: input.transcript,
  entries: entries.map((entry, index) => ({ ...entry, id: `${captureId}:entry:${index + 1}` })),
};
const writerResponse = await fetch(writerUrl, {
  method: "POST",
  headers: {
    authorization: `Bearer ${writerToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(capture),
});
if (!writerResponse.ok) throw new Error(`writer request failed with ${writerResponse.status}`);
const result = await writerResponse.json();
process.stdout.write(`${JSON.stringify({ captureId, entries: entries.length, writer: result })}\n`);
