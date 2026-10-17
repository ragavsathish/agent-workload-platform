import { classifyTranscript } from "../../dist/digital-twin/runtime/ingestion.js";

export default class VonProvider {
  id() {
    return `von:${process.env.VON_MODEL || "von-1.3.0"}`;
  }

  async callApi(_prompt, context) {
    const transcript = context?.vars?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) {
      return { error: "classifier eval requires a non-empty transcript variable" };
    }
    try {
      const decision = await classifyTranscript(transcript, {
        baseUrl: process.env.VON_BASE_URL,
        model: process.env.VON_MODEL,
        reviewThreshold: process.env.DIGITAL_TWIN_REVIEW_THRESHOLD
          ? Number(process.env.DIGITAL_TWIN_REVIEW_THRESHOLD)
          : undefined,
      });
      return {
        output: JSON.stringify({
          assertion_kind: {
            choice: decision.kind,
            confidence: decision.kindConfidence,
            probabilities: decision.kindProbabilities,
          },
          profile_field: {
            choice: decision.profileField,
            confidence: decision.profileFieldConfidence,
          },
        }),
        metadata: { model: process.env.VON_MODEL || "von-1.3.0" },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Von classification failed" };
    }
  }
}
