const KINDS = ["conversation_topic", "skill_evidence", "profile_update", "none"];
const DURABLE = new Set(["skill_evidence", "profile_update"]);

function parseOutput(output) {
  if (output && typeof output === "object") return output;
  if (typeof output !== "string") throw new Error("classifier returned neither JSON nor an object");
  const normalized = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(normalized);
}

function normalized(output, reviewThreshold) {
  const payload = parseOutput(output);
  const answers = payload.answers && typeof payload.answers === "object" ? payload.answers : payload;
  const kind = answers.assertion_kind;
  const field = answers.profile_field;
  if (!kind || !KINDS.includes(kind.choice)) throw new Error("missing valid assertion_kind.choice");
  const kindConfidence = Number(kind.confidence);
  const fieldConfidence = Number(field?.confidence);
  const review = typeof payload.review === "boolean" ? payload.review : kind.choice !== "none" && (
    !Number.isFinite(kindConfidence)
    || kindConfidence < reviewThreshold
    || (kind.choice === "profile_update" && (
      !field?.choice
      || field.choice === "none"
      || !Number.isFinite(fieldConfidence)
      || fieldConfidence < reviewThreshold
    ))
  );
  return { kind, field, review };
}

function probabilityVector(kind) {
  const probabilities = kind.probabilities;
  if (!probabilities || !KINDS.every((label) => {
    const value = Number(probabilities[label]);
    return Number.isFinite(value) && value >= 0 && value <= 1;
  })) return undefined;
  const total = KINDS.reduce((sum, label) => sum + Number(probabilities[label]), 0);
  return Math.abs(total - 1) <= 0.02 ? probabilities : undefined;
}

function result(score, reason) {
  return { pass: score === 1, score, reason };
}

export default function classificationAssertion(output, context) {
  const mode = context.config.mode;
  const expected = context.vars.expectedKind;
  let prediction;
  try {
    const configuredThreshold = Number(
      context?.config?.reviewThreshold
      ?? process.env.DIGITAL_TWIN_REVIEW_THRESHOLD
      ?? 0.60,
    );
    const reviewThreshold = Number.isFinite(configuredThreshold) ? configuredThreshold : 0.60;
    prediction = normalized(output, reviewThreshold);
  } catch (error) {
    return result(0, error instanceof Error ? error.message : "invalid classifier output");
  }
  const correct = prediction.kind.choice === expected;
  const accepted = !prediction.review;
  const falseDurable = accepted && DURABLE.has(prediction.kind.choice) && !correct;
  const targetClass = context.config.targetClass;
  const isExpectedClass = expected === targetClass;
  const isPredictedClass = prediction.kind.choice === targetClass;

  if (mode === "valid") return result(1, "valid bounded classifier output");
  if (mode === "accuracy") return result(Number(correct), `expected ${expected}; got ${prediction.kind.choice}`);
  if (mode === "coverage") return result(Number(accepted), prediction.review ? "sent to review" : "accepted");
  if (mode === "safe_acceptance") return result(Number(correct || prediction.review), "incorrect accepted prediction");
  if (mode === "false_durable") return result(Number(falseDurable), falseDurable ? "false durable candidate" : "not a false durable candidate");
  if (mode === "profile_field") {
    const correctField = prediction.kind.choice === "profile_update"
      && prediction.field?.choice === context.vars.expectedProfileField;
    return result(Number(correctField), `expected ${context.vars.expectedProfileField}; got ${prediction.field?.choice ?? "missing"}`);
  }
  if (mode === "tp") return result(Number(isExpectedClass && isPredictedClass), `${targetClass} true positive`);
  if (mode === "fp") return result(Number(!isExpectedClass && isPredictedClass), `${targetClass} false positive`);
  if (mode === "fn") return result(Number(isExpectedClass && !isPredictedClass), `${targetClass} false negative`);
  if (mode === "probability_count") {
    const complete = Boolean(probabilityVector(prediction.kind));
    return result(Number(Boolean(complete)), complete ? "complete probability vector" : "no comparable probability vector");
  }
  if (mode === "brier") {
    const probabilities = probabilityVector(prediction.kind);
    if (!probabilities) {
      return result(0, "Brier score unavailable");
    }
    const score = KINDS.reduce((sum, kind) => {
      const target = kind === expected ? 1 : 0;
      return sum + (Number(probabilities[kind]) - target) ** 2;
    }, 0) / KINDS.length;
    return { pass: true, score, reason: `multiclass Brier score ${score.toFixed(4)}` };
  }
  throw new Error(`unknown classifier assertion mode: ${String(mode)}`);
}
