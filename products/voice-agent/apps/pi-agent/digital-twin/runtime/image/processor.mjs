import { createHash } from "node:crypto";

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
  const mode = value.mode ?? "journal";
  if (mode !== "journal" && mode !== "classify") throw new Error("unknown ingestion mode");
  return { ...value, mode };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`request to ${new URL(url).pathname} failed with ${response.status}`);
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
    return { type: entry.type, text: entry.text.trim(), topics: entry.topics.map((topic) => topic.trim()) };
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
            topics: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 120 } },
          },
        },
      },
    },
  };
  const modelPayload = await postJson(`${modelBase}/api/chat`, {
    model, stream: false, think: false, format, options: { temperature: 0 },
    messages: [
      { role: "system", content: [
        "Create a lightweight cognitive journal from the owner's transcript.",
        "Capture meaningful thoughts, ideas, genuine questions, decisions, goals, and learnings.",
        "Keep the owner's meaning concise and do not invent conclusions or personal facts.",
        "Ignore routine commands, acknowledgements, quoted text, and assistant statements.",
        "Topics are retrieval labels, not claims of expertise.",
      ].join("\n") },
      { role: "user", content: input.transcript },
    ],
  });
  const content = modelPayload?.message?.content;
  if (typeof content !== "string") throw new Error("model returned no journal content");
  const entries = checkedEntries(JSON.parse(content));
  const capture = {
    id: captureId, identity: input.identity, sourceRef, capturedAt: input.capturedAt,
    transcript: input.transcript,
    entries: entries.map((entry, index) => ({ ...entry, id: `${captureId}:entry:${index + 1}` })),
  };
  const writer = await postJson(required("DIGITAL_TWIN_WRITER_URL"), capture, {
    authorization: `Bearer ${writerToken}`,
  });
  return { mode: "journal", captureId, entries: entries.length, writer };
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
        "Extract only what is explicitly stated by the owner; never infer expertise from a question or command.",
        "Each evidence_quote must be one exact, contiguous substring copied character-for-character from the transcript.",
        "Return an empty candidates array rather than guessing.",
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

const result = input.mode === "journal" ? await captureJournal() : await classifyAndExtract();
process.stdout.write(`${JSON.stringify(result)}\n`);
