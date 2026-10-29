---
type: measurement
title: "LLM persona simulation"
---

# LLM persona simulation

This extends the [parallel source model](parallel-source-simulation.md) with simulated stakeholder decisions. It asks a local Ollama model to play five personas from the [one EventStorming walk](event-storming-walk.md): product owner, Gondolin runtime maintainer, behavior qualification reviewer, PR lyric reviewer, and release operator. Each receives only the synthetic evidence within that role's decision boundary. The persona responses determine which facts enter the simulated streams; the existing ledger then shuffles and duplicates those facts to test convergence.

Run `make event-persona-simulate` to regenerate the [JSON transcript and result](persona-simulation.json). By default it uses `qwen3.5:4b-mlx` at `http://127.0.0.1:11434`. Set `PERSONA_MODEL` or `OLLAMA_BASE_URL` to use another installed Ollama model or endpoint. `node docs/event-model/simulate-personas.mjs 1000` changes the number of delivery schedules per scenario. The script requires a reachable model; it fails rather than substituting scripted persona answers.

## How decisions become events

The personas answer `approve` or `hold` with a reason. All five are asked in parallel against a fixed scenario snapshot. A deterministic guard checks the evidence required for each decision, so an LLM approval cannot bypass a failed qualification or release prerequisite. The walk is then compiled in order: an owner approval admits the task; the runtime decision admits image and task result facts; qualification admits the PR; lyric approval admits the render and soundtrack; release approval admits release and verification facts. Independent knowledge and alert investigation facts remain on their own streams.

The output keeps each persona answer, guard outcome, emitted event IDs, and final projection. This makes a mistaken or surprising LLM decision visible. Convergence is tested **after** those decisions are fixed; it does not assert that repeated model calls always make the same decision.

## Observed local run

| Scenario | Owner | Runtime | Qualification | Lyrics | Release | Emitted facts | Delivery schedules | Outcome |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| Clean change | Approve | Approve | Approve | Approve | Approve | 25 | 100/100 converged | Verified |
| Failed behavior check | Approve | Approve | Hold | Approve | Hold | 13 | 100/100 converged | Qualification, PR, and release blocked |

In the failed case, the owner and runtime personas still approve their earlier, independent decisions. The qualification reviewer and release operator hold because the behavior check failed. This is why persona evidence is scoped: an earlier role should not retroactively block task admission based on evidence produced later in the walk.

This remains a synthetic model experiment. It does not run real Pi Durable tasks, build a Gondolin image, open a PR, deploy a release, or test model decisions against private owner data. The transcript records one local LLM run, while deterministic replay checks delivery-order convergence for the facts produced by that run.
