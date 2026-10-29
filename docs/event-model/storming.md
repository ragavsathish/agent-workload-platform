---
type: reference
title: "EventStorming board index and source coverage"
---

# EventStorming board index and source coverage

This board is a **hypothesis derived from Gherkin and code**. It has not been
co-created or validated with domain participants. Read the
[single EventStorming walk](event-storming-walk.md) first for candidate past-tense
events, timeline branches, pivotal moments, and hotspots. The
[Big Picture slices](big-picture.md) retain supporting detail. Then use the
[process model](process-model.md) for commands, policies,
read models, and complete success/refusal paths. The [Structurizr workspace](workspace.dsl)
maps the currently running C4 containers; it is not a substitute for the
EventStorming board. See the [Brandolini review](brandolini-research.md) for the
method and sources.

## Review of the first board

| Earlier issue | Regeneration |
| --- | --- |
| A table of features and outcomes had no left-to-right story. | Four event-first timelines and a task-to-sandbox bridge now show ordering, branching, and pivotal moments. |
| UI rendering, access decisions, tests, and byte samples were labeled as domain events. | They are now actions, policy outcomes, or evidence; only candidate state-changing domain facts stay on the orange timeline. |
| Commands, policies, read models, and storage owners appeared at once. | The Big Picture is separate from narrower Process Modelling and C4 architecture. |
| The event store proposal could be mistaken for the result of discovery. | It remains a separate, explicitly proposed software design with unresolved migration and atomicity decisions. |
| Uncertainty was buried in prose. | Eight numbered hotspots are visible beside the relevant timeline and point to verification conversations. |

## Gherkin source coverage

The links below map every feature to a lane; they do **not** assert that each
scenario produces a unique domain event. UI and negative scenarios can constrain
a policy or read model without adding an orange note.

| Lane | Product journeys | Automation behaviors | Host component behaviors |
| --- | --- | --- | --- |
| A · voice and delegated work | [Talk with Pi](../evidence/allure/features/voice-conversation--talk-with-pi.feature), [conversation diagnostics](../evidence/allure/features/voice-conversation--inspect-conversation-diagnostics.feature), [continue durable work](../evidence/allure/features/durable-work--continue-durable-work.feature), [create and review a song](../evidence/allure/features/media-creation--create-and-review-a-song.feature) | [Deployed voice probe](../spec/ansible/blackbox_voice.feature), [browser journeys](../spec/ansible/playwright_e2e.feature) | — |
| B · knowledge and review | [Process a completed turn](../evidence/allure/features/digital-twin--process-a-completed-owner-turn.feature), [correct and review](../evidence/allure/features/knowledge-and-review--correct-and-review-journal-knowledge.feature), [explore knowledge](../evidence/allure/features/knowledge-and-review--explore-journal-knowledge.feature), [voice navigation to knowledge](../evidence/allure/features/voice-conversation--explore-journal-knowledge-from-pi.feature) | [Digital-twin verification](../spec/ansible/digital_twin_e2e.feature) | — |
| C · image preparation | [Durable work image cases](../evidence/allure/features/durable-work--continue-durable-work.feature) | — | [Job protocol](../spec/go/job_api.feature), [build](../spec/go/image_build.feature), [archive](../spec/go/image_archive.feature), [Compose cache](../spec/go/compose_cache.feature), [cache import](../spec/go/cache_import.feature), [CLI](../spec/go/cli.feature) |
| D · deployment and evidence | [Protected gateway](../evidence/allure/features/gateway-access--access-the-protected-gateway.feature), [system health](../evidence/allure/features/operations--inspect-system-health.feature) | [Preflight](../spec/ansible/preflight.feature), [install](../spec/ansible/install_host_services.feature), [native services](../spec/ansible/native_services.feature), [edge deploy](../spec/ansible/deploy_edge.feature), [gateway deploy](../spec/ansible/deploy_gateway.feature), [lifecycle](../spec/ansible/lifecycle.feature), [verify](../spec/ansible/verify.feature), [benchmark](../spec/ansible/benchmark.feature) | [Storage collector](../spec/go/storage_collector.feature) |

## Walkthrough and validation questions

Ask a voice user, durable-work owner, knowledge reviewer, image-builder maintainer,
and operator to narrate their lane independently. Start at each pivotal event and
ask what happened before, what can happen next, who decides, and what information
they need. Reconcile duplicate or disputed terms in the [hotspots](big-picture.md)
before using this board to choose aggregate or bounded-context boundaries.
