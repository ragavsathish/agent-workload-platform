import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

export const ASSERTION_KINDS = [
  "conversation_topic",
  "skill_evidence",
  "profile_update",
  "none",
] as const;

export const PROFILE_FIELDS = [
  "job_title",
  "home_location",
  "credential",
  "employment",
  "none",
] as const;

export const AssertionKindSchema = Type.Union(
  ASSERTION_KINDS.map((value) => Type.Literal(value)),
);
export type AssertionKind = typeof ASSERTION_KINDS[number];

export const ProfileFieldSchema = Type.Union(
  PROFILE_FIELDS.map((value) => Type.Literal(value)),
);
export type ProfileField = typeof PROFILE_FIELDS[number];

const ProbabilitySchema = Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 }));
const ChoiceAnswerSchema = Type.Object(
  {
    type: Type.Literal("choice"),
    choice: Type.String(),
    probabilities: ProbabilitySchema,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: true },
);
const VonResponseSchema = Type.Object(
  {
    model: Type.String(),
    answers: Type.Object(
      {
        assertion_kind: ChoiceAnswerSchema,
        profile_field: ChoiceAnswerSchema,
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);

export const ExtractedCandidatesSchema = Type.Object(
  {
    candidates: Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1, maxLength: 200 }),
          evidence_quote: Type.String({ minLength: 1, maxLength: 1_000 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 8 },
    ),
  },
  { additionalProperties: false },
);
export type ExtractedCandidates = Static<typeof ExtractedCandidatesSchema>;

export type IdentifiedSkill = {
  skill: string;
  evidenceQuote: string;
};

export type TranscriptDecision = {
  kind: AssertionKind;
  kindConfidence: number;
  kindProbabilities: Record<string, number>;
  profileField: ProfileField;
  profileFieldConfidence: number;
  review: boolean;
};

export type TranscriptIngestionPlan = TranscriptDecision & {
  candidates: ExtractedCandidates["candidates"];
};

type JsonFetch = typeof fetch;

export const KIND_CRITERIA: Record<AssertionKind, string> = {
  conversation_topic:
    "A concrete subject the owner discusses, asks to explore, or repeatedly works on; not a durable claim about the owner.",
  skill_evidence:
    "An explicit first-person claim or strong direct evidence that the owner knows or can perform a durable skill.",
  profile_update:
    "An explicit first-person biographical change about job title, location, education, credential, or employment.",
  none:
    "A transient command, question, assistant statement, speculation, correction without a durable fact, or insufficient evidence.",
};

export const PROFILE_CRITERIA: Record<ProfileField, string> = {
  job_title: "The owner's current professional title changed or was explicitly stated.",
  home_location: "The owner's home country or location changed or was explicitly stated.",
  credential: "The owner explicitly stated an educational or occupational credential.",
  employment: "The owner explicitly stated starting, ending, or holding employment with an organization.",
  none: "The statement is not an explicit profile update in one of the listed fields.",
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("model returned a non-object response");
  }
  return value as Record<string, unknown>;
}

async function responseJson(response: Response, provider: string): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? JSON.stringify((payload as Record<string, unknown>).detail)
      : response.statusText || "request failed";
    throw new Error(`${provider} rejected the request: ${detail}`);
  }
  return payload;
}

export async function classifyTranscript(
  transcript: string,
  options: {
    baseUrl?: string;
    fetch?: JsonFetch;
    model?: string;
    providerName?: string;
    reviewThreshold?: number;
    signal?: AbortSignal;
  } = {},
): Promise<TranscriptDecision> {
  const text = transcript.trim();
  if (!text) throw new Error("transcript must not be empty");
  const request = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8000").replace(/\/$/, "");
  const response = await request(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model ?? "von-1.3.0",
      state: { speaker: "owner", transcript: text },
      questions: {
        assertion_kind: {
          type: "choice",
          instructions:
            "Choose one ontology bucket. An explicit first-person statement that the owner uses, knows, builds, or can perform something is skill_evidence, not conversation_topic. Do not infer a personal fact from a question or command.",
          criteria: KIND_CRITERIA,
        },
        profile_field: {
          type: "choice",
          instructions: "If this is a profile update, choose its field; otherwise choose none.",
          criteria: PROFILE_CRITERIA,
        },
      },
    }),
    signal: options.signal,
  });
  const providerName = options.providerName ?? "Von";
  const payload = await responseJson(response, providerName);
  if (!Check(VonResponseSchema, payload)) throw new Error(`${providerName} returned an invalid response`);

  const kindAnswer = payload.answers.assertion_kind;
  const profileAnswer = payload.answers.profile_field;
  if (!ASSERTION_KINDS.includes(kindAnswer.choice as AssertionKind)) {
    throw new Error(`${providerName} returned an unknown assertion kind: ${kindAnswer.choice}`);
  }
  if (!PROFILE_FIELDS.includes(profileAnswer.choice as ProfileField)) {
    throw new Error(`${providerName} returned an unknown profile field: ${profileAnswer.choice}`);
  }
  const kind = kindAnswer.choice as AssertionKind;
  const profileField = profileAnswer.choice as ProfileField;
  const threshold = options.reviewThreshold ?? 0.82;
  return {
    kind,
    kindConfidence: kindAnswer.confidence,
    kindProbabilities: kindAnswer.probabilities,
    profileField,
    profileFieldConfidence: profileAnswer.confidence,
    review: kind !== "none" && (
      kindAnswer.confidence < threshold
      || (kind === "profile_update" && (
        profileField === "none" || profileAnswer.confidence < threshold
      ))
    ),
  };
}

export async function extractTranscriptCandidates(
  transcript: string,
  decision: { kind: AssertionKind; profileField: ProfileField },
  options: {
    baseUrl?: string;
    discardInvalidEvidence?: boolean;
    fetch?: JsonFetch;
    model?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ExtractedCandidates> {
  if (decision.kind === "none") return { candidates: [] };
  const request = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const schema = JSON.parse(JSON.stringify(ExtractedCandidatesSchema)) as Record<string, unknown>;
  const extractionInstruction: Record<Exclude<AssertionKind, "none">, string> = {
    conversation_topic:
      "Extract the concrete subjects the owner is discussing, requesting, investigating, or working on.",
    skill_evidence:
      "Extract each technology, practice, or capability the owner explicitly says they use, know, or can perform.",
    profile_update:
      `Extract the explicit ${String(decision.profileField).replaceAll("_", " ")} value stated about the owner.`,
  };
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
            extractionInstruction[decision.kind],
            "Extract only what is explicitly stated by the owner; never infer expertise from a question or command.",
            "Each evidence_quote must be one exact, contiguous substring copied character-for-character from the transcript.",
            "Never insert ellipses, combine separated spans, normalize, or paraphrase evidence_quote.",
            "Return an empty candidates array rather than guessing.",
            `Required JSON schema: ${JSON.stringify(schema)}`,
          ].join("\n"),
        },
        { role: "user", content: transcript },
      ],
    }),
    signal: options.signal,
  });
  const payload = asRecord(await responseJson(response, "Ollama"));
  const message = asRecord(payload.message);
  if (typeof message.content !== "string") throw new Error("Ollama returned no structured content");
  let extracted: unknown;
  try {
    extracted = JSON.parse(message.content);
  } catch {
    throw new Error("Ollama returned invalid JSON");
  }
  if (!Check(ExtractedCandidatesSchema, extracted)) {
    throw new Error("Ollama returned candidates outside the extraction contract");
  }
  const invalidEvidence = extracted.candidates.filter(
    (candidate) => !transcript.includes(candidate.evidence_quote),
  );
  if (invalidEvidence.length > 0 && !options.discardInvalidEvidence) {
    throw new Error("Ollama returned evidence that is not present in the transcript");
  }
  return options.discardInvalidEvidence
    ? {
        candidates: extracted.candidates.filter(
          (candidate) => transcript.includes(candidate.evidence_quote),
        ),
      }
    : extracted;
}

/**
 * Identify reviewable skill candidates without promoting them to durable facts.
 *
 * This deliberately bypasses the broad assertion-kind classifier. The extractor
 * is constrained to explicit, positive, first-person capability statements and
 * every result must retain verbatim transcript evidence.
 */
export async function identifyExplicitSkills(
  transcript: string,
  options: {
    baseUrl?: string;
    fetch?: JsonFetch;
    model?: string;
    signal?: AbortSignal;
  } = {},
): Promise<IdentifiedSkill[]> {
  const text = transcript.trim();
  if (!text) throw new Error("transcript must not be empty");
  const extracted = await extractTranscriptCandidates(
    text,
    { kind: "skill_evidence", profileField: "none" },
    { ...options, discardInvalidEvidence: true },
  );
  return extracted.candidates.map((candidate) => ({
    skill: candidate.label,
    evidenceQuote: candidate.evidence_quote,
  }));
}

export async function planTranscriptIngestion(
  transcript: string,
  options: {
    fetch?: JsonFetch;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    reviewThreshold?: number;
    signal?: AbortSignal;
    vonBaseUrl?: string;
    vonModel?: string;
  } = {},
): Promise<TranscriptIngestionPlan> {
  const decision = await classifyTranscript(transcript, {
    baseUrl: options.vonBaseUrl,
    fetch: options.fetch,
    model: options.vonModel,
    reviewThreshold: options.reviewThreshold,
    signal: options.signal,
  });
  if (decision.kind === "none" || decision.review) return { ...decision, candidates: [] };
  const extracted = await extractTranscriptCandidates(transcript, decision, {
    baseUrl: options.ollamaBaseUrl,
    fetch: options.fetch,
    model: options.ollamaModel,
    signal: options.signal,
  });
  return { ...decision, candidates: extracted.candidates };
}
