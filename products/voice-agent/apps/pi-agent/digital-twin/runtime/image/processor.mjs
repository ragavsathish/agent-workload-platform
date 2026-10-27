import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const COGNITIVE_JOURNAL_SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/cognitive-journal/SYSTEM.md", import.meta.url),
  "utf8",
).trim();
const CANDIDATE_EXTRACTION_SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/candidate-extraction/SYSTEM.md", import.meta.url),
  "utf8",
).trim();
const DAILY_JOURNAL_SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/daily-journal/SYSTEM.md", import.meta.url),
  "utf8",
).trim();

const ENTRY_TYPES = new Set([
  "thought", "idea", "question", "decision", "goal", "learning", "unclassified",
]);
const ASSERTION_KINDS = new Set([
  "conversation_topic", "skill_evidence", "profile_update", "none",
]);
const PROFILE_FIELDS = new Set([
  "job_title", "home_location", "credential", "employment", "none",
]);
const KIND_CRITERIA = {
  conversation_topic: "A concrete subject the owner discusses, asks to explore, or repeatedly works on; not a durable claim about the owner.",
  skill_evidence: "An explicit first-person claim or strong direct evidence that the owner knows or can perform a durable skill.",
  profile_update: "An explicit first-person biographical change about job title, location, education, credential, or employment.",
  none: "A transient command, question, assistant statement, speculation, correction without a durable fact, or insufficient evidence.",
};
const PROFILE_CRITERIA = {
  job_title: "The owner's current professional title changed or was explicitly stated.",
  home_location: "The owner's home country or location changed or was explicitly stated.",
  credential: "The owner explicitly stated an educational or occupational credential.",
  employment: "The owner explicitly stated starting, ending, or holding employment with an organization.",
  none: "The statement is not an explicit profile update in one of the listed fields.",
};
const JOURNAL_EXTRACTOR_VERSION = "journal-v4-sentence-gate";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function normalized(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function contentWords(value) {
  return new Set(normalized(value)
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)
    ?.filter((word) => !CONTENT_STOP_WORDS.has(word)) ?? []);
}

function isLowValueText(value) {
  const text = value.trim();
  if (LOW_VALUE_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return contentWords(text).size < 2;
}

function isIneligibleJournalSentence(value) {
  const text = value.trim();
  return isLowValueText(text)
    || ROUTINE_COMMAND_PATTERN.test(text)
    || POLITE_COMMAND_PATTERN.test(text)
    || REPORTED_SPEECH_PATTERN.test(text)
    || ATTRIBUTED_SPEECH_PATTERN.test(text);
}

function eligibleJournalTranscript(value) {
  return (value.match(/[^.!?\n]+[.!?]?/gu) ?? [value])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !isIneligibleJournalSentence(sentence))
    .join("\n");
}

function journalSentences(value) {
  return (value.match(/[^.!?\n]+[.!?]?/gu) ?? [value])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isSemanticallySupported(text, evidenceQuote) {
  const evidenceWords = contentWords(evidenceQuote);
  return [...contentWords(text)].some((word) => evidenceWords.has(word));
}

function hasTypeEvidence(type, evidenceQuote) {
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

async function readInput() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const value = JSON.parse(input);
  for (const name of ["identity"]) {
    if (typeof value[name] !== "string" || !value[name].trim()) {
      throw new Error(`${name} must be a non-empty string`);
    }
  }
  const mode = value.mode ?? "journal";
  if (mode === "daily-journal") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.journalDate) || typeof value.timeZone !== "string") {
      throw new Error("daily journal requires journalDate and timeZone");
    }
    if (value.taskId !== undefined && (typeof value.taskId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.taskId))) {
      throw new Error("daily journal taskId must be a UUID");
    }
    if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 300) {
      throw new Error("daily journal source list is invalid");
    }
    const total = value.sources.reduce((size, source) => size + (typeof source.transcript === "string" ? source.transcript.length : 0), 0);
    if (total > 200_000) throw new Error("daily journal source bundle is too large");
  } else {
    for (const name of ["sessionId", "messageId", "transcript", "capturedAt"]) {
      if (typeof value[name] !== "string" || !value[name].trim()) {
        throw new Error(`${name} must be a non-empty string`);
      }
    }
    if (value.transcript.length > 20_000) throw new Error("transcript is too large");
    if (mode !== "journal" && mode !== "classify") throw new Error("unknown ingestion mode");
  }
  return { ...value, mode };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail = Array.isArray(payload?.detail)
      ? payload.detail.map((item) => {
        const location = Array.isArray(item.loc) ? item.loc.join(".") : "request";
        return `${location}: ${item.msg}`;
      }).join("; ")
      : typeof payload?.detail === "string" ? payload.detail : "";
    throw new Error(`request to ${new URL(url).pathname} failed with ${response.status}${detail ? ` (${detail})` : ""}`);
  }
  return payload;
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
    if (typeof entry.evidenceQuote !== "string" || !entry.evidenceQuote.trim()
      || entry.evidenceQuote.length > 500) {
      throw new Error("model returned invalid entry evidence");
    }
    return {
      type: entry.type,
      text: entry.text.trim(),
      topics: entry.topics.map((topic) => topic.trim()),
      evidenceQuote: entry.evidenceQuote.trim(),
    };
  });
}

function groundedJournalEntries(transcript, entries) {
  const source = normalized(transcript);
  const seen = new Set();
  return entries.flatMap(({ evidenceQuote, ...entry }) => {
    const evidence = normalized(evidenceQuote);
    if (!evidence || !source.includes(evidence)) return [];
    if (isIneligibleJournalSentence(evidenceQuote) || isLowValueText(entry.text)) return [];
    if (!isSemanticallySupported(entry.text, evidenceQuote)) return [];
    if (!hasTypeEvidence(entry.type, evidenceQuote)) return [];
    const key = `${entry.type}\0${normalized(entry.text)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [entry];
  });
}

const input = await readInput();
const captureId = createHash("sha256")
  .update(`${input.sessionId}\0${input.messageId}`)
  .digest("hex")
  .slice(0, 32);
const sourceRef = `pi-session:${input.sessionId}:${input.messageId}`;
const modelBase = required("DIGITAL_TWIN_MODEL_BASE_URL").replace(/\/$/, "");
const model = required("DIGITAL_TWIN_MODEL");
const writerToken = required("DIGITAL_TWIN_WRITER_TOKEN");

async function captureJournal() {
  const inputSentences = journalSentences(input.transcript);
  const eligibleSentences = inputSentences.filter(
    (sentence) => !isIneligibleJournalSentence(sentence),
  );
  const eligibleTranscript = eligibleSentences.join("\n");
  if (!eligibleTranscript) {
    return {
      mode: "journal", captureId, entries: 0, skipped: "low-value-transcript",
      decision: {
        extractorVersion: JOURNAL_EXTRACTOR_VERSION,
        outcome: "filtered",
        inputSentences: inputSentences.length,
        eligibleSentences: 0,
        modelInvoked: false,
        modelEntries: 0,
        groundedEntries: 0,
        rejectedEntries: 0,
      },
    };
  }
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
          required: ["type", "text", "topics", "evidenceQuote"],
          properties: {
            type: { enum: [...ENTRY_TYPES] },
            text: { type: "string", minLength: 1, maxLength: 1_000 },
            topics: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 120 } },
            evidenceQuote: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
  };
  const modelPayload = await postJson(`${modelBase}/api/chat`, {
    model, stream: false, think: false, format, options: { temperature: 0 },
    messages: [
      { role: "system", content: COGNITIVE_JOURNAL_SYSTEM_PROMPT },
      { role: "user", content: "Why does the cache remain stale after the deployment completes?" },
      { role: "assistant", content: JSON.stringify({ entries: [{
        type: "question",
        text: "Why the cache remains stale after deployment.",
        topics: ["cache", "deployment"],
        evidenceQuote: "Why does the cache remain stale after the deployment completes?",
      }] }) },
      { role: "user", content: "I decided that local requests will bypass the remote proxy." },
      { role: "assistant", content: JSON.stringify({ entries: [{
        type: "decision",
        text: "Local requests will bypass the remote proxy.",
        topics: ["local routing", "proxy"],
        evidenceQuote: "I decided that local requests will bypass the remote proxy.",
      }] }) },
      { role: "user", content: "System connected successfully. I now understand that retries need stable identifiers." },
      { role: "assistant", content: JSON.stringify({ entries: [{
        type: "learning",
        text: "Retries need stable identifiers.",
        topics: ["retries", "identifiers"],
        evidenceQuote: "I now understand that retries need stable identifiers.",
      }] }) },
      { role: "user", content: "Check the logs and deploy it." },
      { role: "assistant", content: JSON.stringify({ entries: [] }) },
      { role: "user", content: eligibleTranscript },
    ],
  });
  const content = modelPayload?.message?.content;
  if (typeof content !== "string") throw new Error("model returned no journal content");
  const modelEntries = checkedEntries(JSON.parse(content));
  const entries = groundedJournalEntries(input.transcript, modelEntries);
  const capture = {
    id: captureId, identity: input.identity, sourceRef, capturedAt: input.capturedAt,
    transcript: input.transcript,
    entries: entries.map((entry, index) => ({ ...entry, id: `${captureId}:entry:${index + 1}` })),
  };
  const writer = await postJson(required("DIGITAL_TWIN_WRITER_URL"), capture, {
    authorization: `Bearer ${writerToken}`,
  });
  return {
    mode: "journal", captureId, entries: entries.length, writer,
    decision: {
      extractorVersion: JOURNAL_EXTRACTOR_VERSION,
      outcome: entries.length > 0 ? "written" : "no-entries",
      inputSentences: inputSentences.length,
      eligibleSentences: eligibleSentences.length,
      modelInvoked: true,
      modelEntries: modelEntries.length,
      groundedEntries: entries.length,
      rejectedEntries: modelEntries.length - entries.length,
    },
  };
}

function localDate(timestamp, timeZone) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("daily journal source timestamp is invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function captureDailyJournal() {
  const refs = new Set();
  const sources = input.sources.map((source) => {
    if (!source || source.speaker !== "owner"
      || typeof source.sourceRef !== "string" || !source.sourceRef.trim()
      || typeof source.capturedAt !== "string" || !source.capturedAt.trim()
      || typeof source.transcript !== "string" || !source.transcript.trim()
      || source.transcript.length > 20_000) {
      throw new Error("daily journal source message is invalid");
    }
    if (refs.has(source.sourceRef)) throw new Error("daily journal source references must be unique");
    refs.add(source.sourceRef);
    if (localDate(source.capturedAt, input.timeZone) !== input.journalDate) {
      throw new Error("daily journal source timestamp is outside journalDate");
    }
    return {
      sourceRef: source.sourceRef,
      speaker: "owner",
      capturedAt: source.capturedAt,
      transcript: source.transcript,
    };
  });
  const modelBase = required("DIGITAL_TWIN_MODEL_BASE_URL").replace(/\/$/, "");
  const model = required("DIGITAL_TWIN_MODEL");
  const writerToken = required("DIGITAL_TWIN_WRITER_TOKEN");
  const format = {
    type: "object", additionalProperties: false,
    required: ["title", "story"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      story: { type: "string", minLength: 1, maxLength: 8_000 },
    },
  };
  const response = await postJson(`${modelBase}/api/chat`, {
    model, stream: false, think: false, format, options: { temperature: 0 },
    messages: [
      { role: "system", content: DAILY_JOURNAL_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({
        journalDate: input.journalDate,
        timeZone: input.timeZone,
        sources,
      }) },
    ],
  });
  if (typeof response?.message?.content !== "string") {
    throw new Error("model returned no daily journal content");
  }
  const generated = JSON.parse(response.message.content);
  if (typeof generated.title !== "string" || !generated.title.trim() || generated.title.length > 200
    || typeof generated.story !== "string" || !generated.story.trim()
    || generated.story.length > 8_000) {
    throw new Error("model returned an invalid daily journal page");
  }
  const story = generated.story.trim();
  if (/^(?:#{1,6}\s|[-*]\s|\d+[.)]\s)/mu.test(story)) {
    throw new Error("daily journal story must be prose, not a list or outline");
  }
  const id = createHash("sha256")
    .update(`${input.journalDate}\0${input.timeZone}`)
    .digest("hex")
    .slice(0, 32);
  const capture = {
    id, identity: input.identity, journalDate: input.journalDate, timeZone: input.timeZone,
    ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
    capturedAt: new Date().toISOString(), title: generated.title.trim(), story, sources,
  };
  const writer = await postJson(required("DIGITAL_TWIN_DAILY_JOURNAL_WRITER_URL"), capture, {
    authorization: `Bearer ${writerToken}`,
  });
  return {
    mode: "daily-journal", journalId: id, journalDate: input.journalDate,
    sources: sources.length, storyCharacters: story.length, writer,
  };
}

function checkedChoice(answer, allowed, name) {
  if (!answer || typeof answer !== "object" || !allowed.has(answer.choice)
    || typeof answer.confidence !== "number" || answer.confidence < 0 || answer.confidence > 1
    || !answer.probabilities || typeof answer.probabilities !== "object") {
    throw new Error(`classifier returned an invalid ${name}`);
  }
  return answer;
}

async function classifyAndExtract() {
  const classifierBase = required("DIGITAL_TWIN_CLASSIFIER_BASE_URL").replace(/\/$/, "");
  const classifierModel = required("DIGITAL_TWIN_CLASSIFIER_MODEL");
  const classified = await postJson(`${classifierBase}/v1/systemone`, {
    model: classifierModel,
    state: { speaker: "owner", transcript: input.transcript },
    questions: {
      assertion_kind: {
        type: "choice",
        instructions: "Choose one ontology bucket. An explicit first-person statement that the owner uses, knows, builds, or can perform something is skill_evidence, not conversation_topic. Do not infer a personal fact from a question or command.",
        criteria: KIND_CRITERIA,
      },
      profile_field: {
        type: "choice",
        instructions: "If this is a profile update, choose its field; otherwise choose none.",
        criteria: PROFILE_CRITERIA,
      },
    },
  });
  const kind = checkedChoice(classified?.answers?.assertion_kind, ASSERTION_KINDS, "assertion kind");
  const profile = checkedChoice(classified?.answers?.profile_field, PROFILE_FIELDS, "profile field");
  const threshold = Number(process.env.DIGITAL_TWIN_REVIEW_THRESHOLD ?? "0.60");
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("DIGITAL_TWIN_REVIEW_THRESHOLD must be between 0 and 1");
  }
  const lowConfidence = kind.choice !== "none" && (
    kind.confidence < threshold
    || (kind.choice === "profile_update" && (profile.choice === "none" || profile.confidence < threshold))
  );
  if (kind.choice === "none" || (kind.choice === "profile_update" && profile.choice === "none")) {
    return { mode: "classify", captureId, kind: kind.choice, candidates: 0, lowConfidence };
  }
  if (lowConfidence) {
    return { mode: "classify", captureId, kind: kind.choice, candidates: 0, lowConfidence };
  }

  const extractionInstructions = {
    conversation_topic: "Extract the concrete subjects the owner is discussing, requesting, investigating, or working on.",
    skill_evidence: "Extract each technology, practice, or capability the owner explicitly says they use, know, or can perform.",
    profile_update: `Extract the explicit ${profile.choice.replaceAll("_", " ")} value stated about the owner.`,
  };
  const format = {
    type: "object", additionalProperties: false, required: ["candidates"],
    properties: {
      candidates: {
        type: "array", maxItems: 8,
        items: {
          type: "object", additionalProperties: false, required: ["label", "evidence_quote"],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 200 },
            evidence_quote: { type: "string", minLength: 1, maxLength: 1_000 },
          },
        },
      },
    },
  };
  const extractedPayload = await postJson(`${modelBase}/api/chat`, {
    model, stream: false, think: false, format, options: { temperature: 0 },
    messages: [
      { role: "system", content: [
        extractionInstructions[kind.choice],
        CANDIDATE_EXTRACTION_SYSTEM_PROMPT,
      ].join("\n") },
      { role: "user", content: input.transcript },
    ],
  });
  const content = extractedPayload?.message?.content;
  if (typeof content !== "string") throw new Error("model returned no candidate content");
  const extracted = JSON.parse(content);
  if (!extracted || !Array.isArray(extracted.candidates) || extracted.candidates.length > 8) {
    throw new Error("model returned invalid candidates");
  }
  const candidates = extracted.candidates.flatMap((candidate, index) => {
    if (!candidate || typeof candidate.label !== "string" || !candidate.label.trim()
      || candidate.label.length > 200 || typeof candidate.evidence_quote !== "string"
      || !input.transcript.includes(candidate.evidence_quote)) return [];
    return [{
      id: `${captureId}:candidate:${index + 1}`,
      label: candidate.label.trim(), evidenceQuote: candidate.evidence_quote,
    }];
  });
  if (candidates.length === 0) {
    return { mode: "classify", captureId, kind: kind.choice, candidates: 0, lowConfidence };
  }
  const review = await postJson(required("DIGITAL_TWIN_REVIEW_WRITER_URL"), {
    id: captureId, identity: input.identity, sourceRef, capturedAt: input.capturedAt,
    classification: {
      kind: kind.choice, confidence: kind.confidence, probabilities: kind.probabilities,
      profileField: profile.choice, profileFieldConfidence: profile.confidence,
      lowConfidence,
      model: typeof classified.model === "string" ? classified.model : classifierModel,
    },
    candidates,
  }, { authorization: `Bearer ${writerToken}` });
  return {
    mode: "classify", captureId, kind: kind.choice,
    candidates: candidates.length, lowConfidence, review,
  };
}

const result = input.mode === "daily-journal"
  ? await captureDailyJournal()
  : input.mode === "journal" ? await captureJournal() : await classifyAndExtract();
process.stdout.write(`${JSON.stringify(result)}\n`);
