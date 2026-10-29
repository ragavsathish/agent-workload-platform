# Behavior specifications

The [bounded-context contracts](contexts/index.md) own the domain rules C1–C9. The [owner journey slice](../plan/04-owner-work-to-release/spec.feature) composes those rules across contexts; [voice to durable work](../plan/01-voice-to-durable/spec.feature) is a narrower current journey. Stable scenario IDs connect slice steps to their owning rules.

The [deployment behavior contracts](ansible/index.md) and [host component contracts](go/index.md) describe implementation boundaries in language-neutral Gherkin. Their checkers preserve source inventory and stable IDs. The [Allure snapshot](../evidence/allure/index.md) records observed test measurements and validation layers; it is evidence to reconcile with a contract, not a replacement for one.

| Need | Read |
| --- | --- |
| A rule owned by one context | [C1–C9 index](contexts/index.md) |
| An end-to-end owner journey | [Slice 04](../plan/04-owner-work-to-release/spec.feature) |
| A component or deployment behavior | [Host component](go/index.md) or [deployment](ansible/index.md) contract |
| A test observation | [Allure evidence](../evidence/allure/index.md) |
