# Allure measurement snapshot

**Pinned run:** `2026-10-28T17-47-20-707Z-36590` at commit `2bd2486` (`2026-10-28T17:53:44.811Z`).
**Results:** 105 total; passed 104, skipped 1.
**Recorded steps:** 195 steps in 43 passed cases; 62 cases have no passed Gherkin steps.

The feature files below preserve the recorded step names and order, grouped by Allure
epic and feature. They are an **observed test specification**, not a new source of
product authority or an executable Cucumber suite. The validation layer records
whether a case exercised a deployed journey, deployed integration, or a fixture or
component boundary. A passed mock case does not prove the deployed path. This snapshot
does not copy attachments, transcripts, credentials, or other payloads.

The result filenames in each scenario resolve under the ignored local directory
`artifacts/test-reports/2026-10-28T17-47-20-707Z-36590/allure-results/`. The HTML report is at
`artifacts/test-reports/2026-10-28T17-47-20-707Z-36590/report/index.html` when available.
A newer Allure run does not retroactively change this snapshot; rerun
`python3 docs/spec/extract_allure.py` to refresh it and review the diff.

## Durable behavior specs

The [bounded-context specs](../../spec/contexts/index.md) own domain rules C1–C9.
The [owner journey slice](../../plan/04-owner-work-to-release/spec.feature) composes
those rules across contexts using stable scenario IDs. They are curated contracts;
the Allure files below remain observed measurements of a pinned run.

## Feature files

- [Digital twin / Process a completed owner turn](features/digital-twin--process-a-completed-owner-turn.feature) — 2 cases (integration: 2)
- [Durable work / Continue durable work](features/durable-work--continue-durable-work.feature) — 17 cases (integration: 16, journey: 1)
- [Gateway access / Access the protected gateway](features/gateway-access--access-the-protected-gateway.feature) — 2 cases (deployedIntegration: 2)
- [Knowledge and review / Correct and review journal knowledge](features/knowledge-and-review--correct-and-review-journal-knowledge.feature) — 4 cases (deployedIntegration: 1, integration: 3)
- [Knowledge and review / Explore journal knowledge](features/knowledge-and-review--explore-journal-knowledge.feature) — 3 cases (integration: 3)
- [Media creation / Create and review a song](features/media-creation--create-and-review-a-song.feature) — 2 cases (integration: 2)
- [Operations / Inspect system health](features/operations--inspect-system-health.feature) — 1 case (journey: 1)
- [Voice conversation / Explore journal knowledge from Pi](features/voice-conversation--explore-journal-knowledge-from-pi.feature) — 1 case (journey: 1)
- [Voice conversation / Inspect conversation diagnostics](features/voice-conversation--inspect-conversation-diagnostics.feature) — 7 cases (integration: 6, journey: 1)
- [Voice conversation / Talk with Pi](features/voice-conversation--talk-with-pi.feature) — 4 cases (integration: 1, journey: 3)

## Coverage boundary

The [case inventory](cases.md) lists every result, including cases without Gherkin
steps and skipped cases. Those cases may contain useful assertions, but this extractor
does not invent acceptance steps for them. In particular, inspect the skipped Grafana
trace MCP App journey before claiming that entire browser path is covered.

The existing [voice-to-durable plan](../../plan/01-voice-to-durable/plan.md) interprets
one product slice. Its acceptance text is intentionally curated; the extracted file
[here](features/durable-work--continue-durable-work.feature) records exact Allure steps.
