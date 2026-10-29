---
type: measurement
title: "Parallel event source convergence experiment"
---

# Parallel event source convergence experiment

This is a model experiment for the [proposed event-sourced read model](event-sourcing-proposal.md), using the [one EventStorming walk](event-storming-walk.md) as its scenario. It does not run the deployed Voice Agent, Pi Durable, Gondolin, or the current stores. The proposal currently covers a single task stream; this experiment asks what would be required to build one **cross-owner** view of the whole improvement loop.

Run `make event-source-simulate` to regenerate the [JSON report](parallel-source-simulation.json) from [the simulation](simulate-parallel-sources.mjs). Pass a run count directly with `node docs/event-model/simulate-parallel-sources.mjs 10000` for a larger sample. Seeds and event values are fixed, so each count is reproducible.

## Model and convergence rule

The synthetic change has 25 distinct facts in 10 independently delivered streams: knowledge, image, durable task, measurement, qualification, PR, lyric task, render task, release, and alert investigation. A delivery may arrive before a fact from another stream, after a later fact from its own stream, or more than once. The simulator shuffles deliveries for each seed and adds duplicate deliveries to approximate an at-least-once feed.

Each fact carries an event ID, stream ID, stream version, and change ID. The ledger rejects a reused ID with different content and two IDs claiming one stream version. It only projects a **contiguous version prefix** per stream, buffering later versions until gaps fill. The cross-stream projection is recalculated from accepted facts after every delivery. It joins the task result, qualification, PR, soundtrack, and release by explicit commit, artifact, oracle, lyrics, song, and PR references. Gates remain false until all required facts agree.

Convergence means every complete delivery schedule ends with the same projection as the ordered reference schedule. Safety means no intermediate view reports a result, qualification, soundtrack, release, or verification before its required facts are present. The simulator also checks that an already true status never becomes false as these append-only facts arrive.

## Observed result

| Check | Result |
| --- | ---: |
| Randomized schedules | 1,000 |
| Source streams / distinct facts | 10 / 25 |
| Total deliveries, including duplicates | 36,317 |
| Final projections equal to reference | 1,000 / 1,000 |
| Intermediate safety and monotonicity failures | 0 |
| One-shot, arrival-order-sensitive release decisions that disagreed | 342 / 1,000 |

Seed 1 illustrates the order problem: release approval first arrived at delivery 15, while the PR soundtrack first arrived at delivery 28. A one-shot release handler decided `false` and never corrected itself. The dependency-checked projection became ready once both facts were available, regardless of which arrived first.

The negative cases remove lyrics approval, qualification, or image registration, and separately change the pinned song or qualification artifact. The relevant downstream gates remain closed. Conflicting event IDs and stream versions are rejected.

An additional 10,000-seed run also converged in all 10,000 schedules; its one-shot baseline disagreed in 3,463 schedules.

## What this establishes

For this fixed, append-only scenario, **parallel delivery converges if the read model buffers per-stream gaps, deduplicates, joins on stable references, and recomputes dependency gates**. Arrival order by itself is insufficient for a one-shot policy decision. An actual release command should consume a versioned, complete eligibility view and recheck its prerequisites when it executes.

This is evidence about the proposed projection algorithm, not a proof of distributed production behavior. It does not exercise concurrent writers to one stream, crashes and recovery, missing facts that never arrive, retractions/corrections, schema upgrades, retention, the live databases, or side effects caused by commands. Before implementing a shared read model, the owners need an explicit event contract and a decision about how each current store publishes durable, replayable facts. In particular, the current image-job state is in memory and cannot meet that contract without a durability change.
