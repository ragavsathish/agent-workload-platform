import { classifyTranscript } from "../../dist/digital-twin/runtime/ingestion.js";

export default class ClefProvider {
  id() {
    return `clef:${process.env.CLEF_MODEL || "Cloudflare/clef-flash"}`;
  }

  async callApi(_prompt, context) {
    const transcript = context?.vars?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) {
      return { error: "classifier eval requires a non-empty transcript variable" };
    }
    try {
      const decision = await classifyTranscript(transcript, {
        baseUrl: process.env.CLEF_BASE_URL || "http://127.0.0.1:30000",
        model: process.env.CLEF_MODEL || "Cloudflare/clef-flash",
        providerName: "Clef",
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
        metadata: { model: process.env.CLEF_MODEL || "Cloudflare/clef-flash" },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Clef classification failed" };
    }
  }
}
