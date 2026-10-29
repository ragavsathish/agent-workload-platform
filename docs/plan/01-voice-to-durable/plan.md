---
type: plan
title: "Slice 01: Voice to durable work"
---

# Slice 01: Voice to durable work

**Status:** characterization of existing behavior, recorded 2026-10-28. This slice is a
documentation baseline, not an implementation ticket or a new passing test claim.

## User outcome

An owner asks the active Pi session to perform bounded work in a scratch workspace. The
request becomes a native Pi Durable task. The owner can find the same task in the Flutter
task board, inspect progress, and download the result after completion.

## Scope and boundaries

The [D2 delegated-task view](../../../products/voice-agent/docs/architecture/d2-delegated-task.mmd)
is the runtime sequence. The [C2 container view](../../../products/voice-agent/docs/architecture/c2-container.mmd)
shows the Browser, Voice Edge, Agent Gateway, Pi Durable Owner, and result store as distinct
containers. The [deployment/security view](../../../products/voice-agent/docs/architecture/deployment-security.mmd)
shows owner authentication and the host/Gondolin execution branches.

The slice begins with a request from an existing Pi session and ends with the owner-visible
task result and artifact. Speech-to-text fidelity is tested by a separate voice protocol
journey. The task may be submitted through the voice conversation or the private CLI;
the latter is separate evidence for native owner and identity behavior.

## Acceptance examples

See [spec.feature](spec.feature). They describe outcomes a reader can check, but are not
bound to a feature runner. The [Allure-extracted durable feature](../../evidence/allure/features/durable-work--continue-durable-work.feature)
preserves the exact recorded steps from the latest pinned run, including its deployed
journey and fixture-backed cases. Each slice scenario cites the stable rules owned by
[Voice Conversation](../../spec/contexts/c1-voice-conversation/spec.feature),
[Tasking](../../spec/contexts/c2-tasking/spec.feature), and
[Agent Execution](../../spec/contexts/c8-agent-execution/spec.feature).
The current test mapping is:

| Example | Existing evidence | What it does and does not prove |
| --- | --- | --- |
| Submit from Pi session, see same task in Flutter | [Deployed durable Playwright test](../../../products/voice-agent/tests/e2e/playwright/durable.spec.ts) | Exercises a real scratch task through the browser and owner. Requires an opt-in deployed run. |
| Narrate progress and download the result | [Deployed durable Playwright test](../../../products/voice-agent/tests/e2e/playwright/durable.spec.ts) | Checks narration and downloaded workspace ZIP with a unique file. |
| Native CLI submission appears to same owner | [Allure guide](../../../products/voice-agent/tests/allure/README.md) | `make playwright-durable-cli` is a separate opt-in journey, with a configured exact owner identity. |
| Reject invalid identity or workspace | [Testing guide](../../../products/voice-agent/TESTING.md) | Security expectation documented there; verify the applicable auth or gateway test before claiming a fresh pass. |

The [testing guide](../../../products/voice-agent/TESTING.md) explains why `make verify` is
deployment evidence and `make blackbox-e2e` or `make allure-durable` supplies journey
evidence. The [Allure guide](../../../products/voice-agent/tests/allure/README.md) explains
report paths and the coverage audit.

## Decisions and open verification

[decisions.md](decisions.md) records the design choices visible in this slice. Before using
this slice to certify a deployment, check its current task execution mode and run the
appropriate opt-in deployed journey. Record the result and report path with the deployment
being certified.
