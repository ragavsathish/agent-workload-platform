# Learning workflow for owner assertions

## What the October journal run established

The 25 journal takeaways were third-person summaries of project work. They are valid journal leads, but they are not owner utterances or reviewed assertion labels. The SystemOne run over them was a diagnostic only. Its ten `skill_evidence` choices cannot be used as evidence that the owner claimed those skills. Keep the 25 annotations in their unreviewed classification graph; do not copy them into a classifier gold set, profile graph, or training set.

The manual `classifyTranscript` call always sends `speaker: "owner"` to SystemOne. Its caller must verify origin before invocation. A future API change should make verified origin an explicit input rather than relying on the caller's convention.

## Repeatable review loop

1. **Collect source turns.** Use production Pi owner turns for release evaluation. Codex user-role turns can add diagnostic coverage, but the role field alone does not prove owner authorship. Preserve session ID, message ID, timestamp, and exact text in the private review queue. Never substitute journal prose or an assistant reply.
2. **Review provenance and privacy.** Mark whether the owner actually authored the text. Remove injected context, quoted third-party claims, secrets, and unsuitable records. Redact only with a recorded transformation; retain the source pointer privately. Do not export the draft to Git, Promptfoo sharing, telemetry, or the Hub.
3. **Label the classifier task.** On a verified, atomic assertion, choose one of `none`, `conversation_topic`, `skill_evidence`, or `profile_update`; choose a profile field only for `profile_update`. Record an evidence span, a short rationale, an error slice, and a semantic family. Put mixed or ambiguous turns in a diagnostic queue until the product defines splitting or precedence. The model prediction is a suggestion, never the gold label.
4. **Adjudicate and split.** Resolve disputed labels with a second pass. Keep wording variants, repeated claims, and related session turns in the same semantic family. Assign whole families to development, challenge, or a locked holdout. Check that no family crosses splits. Balance boundary cases, especially commands, questions, corrections, negation, quotations, and third-party claims.
5. **Measure the incumbent.** Freeze model, prompt/criteria, ontology, threshold, code, and scorer digests. Evaluate through production `classifyTranscript` with Promptfoo. Report per-class F1, false durable-fact rate, `none` recall, profile-field errors, calibration, review capture, and provider failures. Keep raw rows private; commit only approved aggregate results and DVC pointers.
6. **Improve one failure family at a time.** Start with provenance checks and prompt or policy changes. Compare on development and challenge data with fixed safety gates. Use the locked holdout once for a frozen promotion candidate. Train a task-specific structured classifier only after reviewed production errors persist across several scoped improvements and training is explicitly requested.

## Local Codex review draft

Run from `products/voice-agent`:

```sh
node apps/pi-agent/digital-twin/eval/codex-owner-turn-review.mjs \
  --sessions "$HOME/.codex/sessions" \
  --archived "$HOME/.codex/archived_sessions" \
  --from 2026-10-10 --through 2026-10-24 --limit 80 \
  --output apps/pi-agent/digital-twin/eval/private-manifests/codex-owner-turns.draft.json
```

The exporter scans only `response_item` messages with `role: "user"` and one text content item, deduplicates by session and message ID, and samples across sessions. It skips standalone environment and structured reply wrappers. The file is ignored by Git, created mode `0600`, and contains **pending** provenance and label fields. It deliberately does not assign gold labels or dataset splits. Human review must also inspect any other wrapper or quoted content that passes these mechanical filters.

## Current readiness

The October Codex draft is an annotation queue, not an evaluation or training dataset. There are no owner-reviewed labels, no family-disjoint splits, and no production-derived classifier baseline from this queue yet. The next gate is human review and adjudication. The existing 200 synthetic classifier examples remain useful for regression testing, but do not substitute for reviewed production behavior.
