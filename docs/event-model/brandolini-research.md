---
type: reference
title: "EventStorming: primary-source review for the AWP model"
---

# EventStorming: primary-source review for the AWP model

This note uses Alberto Brandolini's own writing and the official EventStorming site. It is a method reference for regenerating the [event model](index.md), not a record of a facilitated workshop with domain experts.

## Three scales of modelling

| Format | Purpose and scope | Ingredients to show |
| --- | --- | --- |
| **Big Picture** | Discover an entire business line and contradictions between perspectives. Start with domain events, then enforce a timeline, identify pivotal events and swimlanes, add people and systems, and capture magenta Hot Spots. A narrated walkthrough tests the resulting story. | Past-tense events, people, systems, pivotal events, temporal branches, Hot Spots. |
| **Process Modelling** | Explore or design one cross-functional process and its variations. Follow each branch to a stable end state; make the decision grammar explicit. | Events, commands, actors, systems, policies, read models, Hot Spots. |
| **Software Design** | Explore how cooperating software models could support a process. Visualise boundaries and test aggregate behaviour and consistency. | The process grammar plus aggregates, bounded contexts, lifecycle and boundary alternatives. |

Sources: [Brandolini/Avanscoperta, “EventStorming”](https://www.avanscoperta.it/en/eventstorming/) (sections “Main recipes”, “Big Picture”, “Process Modelling”, “Software Design”); [Brandolini, “Collaborative Process Modelling with EventStorming”](https://medium.com/@ziobrando/collaborative-process-modelling-with-eventstorming-17ed363650c0); [Brandolini, *Introducing EventStorming* contents](https://leanpub.com/introducing_eventstorming).

## Modelling rules that matter here

1. **Discover events before designing a mechanism.** Big Picture begins with events contributed by people who know the work. Sorting them into a timeline exposes disagreements. Pivotal events split phases and are provisional; their names and placement can change. A code-derived board is therefore a hypothesis to validate with operators, users, and maintainers, rather than a completed Big Picture workshop. Sources: [Avanscoperta EventStorming](https://www.avanscoperta.it/en/eventstorming/); [Avanscoperta Pivotal Events](https://www.avanscoperta.it/en/eventstorming/pivotal-events/).
2. **Use the process grammar to expose decisions.** A person or automatic policy issues a command, usually in light of a read model; the command may produce an event. A policy answers what happens *whenever* an event occurs, and should be challenged for exceptions and timing. A read model is the information required to decide, not automatically a persisted projection. An external system is an actor in the story whose behaviour and vocabulary may need clarification. Source: [Brandolini, “Collaborative Process Modelling with EventStorming”](https://medium.com/@ziobrando/collaborative-process-modelling-with-eventstorming-17ed363650c0).
3. **Keep uncertainty visible.** Hot Spots record disagreements, missing rules, disputed terms, and alternatives for later resolution. The official patterns advise incremental notation, fuzzy definitions during discovery, and capturing objections while first sketching the main path. Do not force simultaneous or loosely ordered work into a false single sequence. Sources: [EventStorming patterns](https://www.eventstorming.com/patterns/); [“Conversational System”](https://www.eventstorming.com/patterns/conversational-system/); [“Rush to the goal”](https://www.eventstorming.com/patterns/rush-to-the-goal/).
4. **Treat design elements as proposals until tested.** Software Design brings in aggregates and bounded contexts to discuss consistency, lifecycle, and responsibility boundaries. Big Picture pivotal events may suggest public integration events, but Brandolini says discovery is not precise design. Sources: [Avanscoperta EventStorming](https://www.avanscoperta.it/en/eventstorming/); [Avanscoperta Pivotal Events](https://www.avanscoperta.it/en/eventstorming/pivotal-events/).
5. **Separate EventStorming from Event Sourcing.** EventStorming is a collaborative discovery/design method. The official FAQ says Process Modelling implies no specific software infrastructure; Software Design can work well with Event Sourcing or CQRS, but some parts fit simpler architectures. An orange event on a board is not evidence that an event was persisted, published, or replayable. Source: [Avanscoperta EventStorming FAQ](https://www.avanscoperta.it/en/eventstorming/).

## Implications for regenerating our artifacts

- Build a **Big Picture narrative** from the Gherkin evidence, with past-tense business/domain events in temporal order and explicit parallel branches. Keep the source scenario beside each candidate event. Label every event and boundary as *candidate* until domain participants validate it. This is an application of Brandolini's event-first and walkthrough steps, not a claim that a workshop occurred. [Source](https://www.avanscoperta.it/en/eventstorming/).
- Zoom into selected processes, especially durable task execution, voice session completion, image preparation, journal review, and alert investigation. For each path, show trigger → actor or policy → command → event → next decision or stable state; name the read model used at each decision. Include refusal, timeout, retry, and concurrent branches where the scenarios establish them. This applies Brandolini's process grammar and rule that paths should complete. [Source](https://medium.com/@ziobrando/collaborative-process-modelling-with-eventstorming-17ed363650c0).
- Put open questions in a **Hot Spot register**, with evidence and a proposed validation conversation. Examples to investigate include whether a voice turn completion starts durable work, how task completion relates to artifact capture, and whether image handoff completion is a domain fact or only artifact evidence. These are questions inferred from the repo model, not Brandolini's factual claims. [Source for Hot Spot practice](https://www.avanscoperta.it/en/eventstorming/).
- Keep the C4/Structurizr model as an **architecture view** of observed and proposed components. A diagram of containers or a proposed event store should not be presented as the EventStorming board itself. EventStorming can inform boundary and aggregate choices; those choices need a separate design pass. [Source](https://www.avanscoperta.it/en/eventstorming/).

## Source list

- [Alberto Brandolini / Avanscoperta, EventStorming](https://www.avanscoperta.it/en/eventstorming/) — current official method description and FAQ.
- [Alberto Brandolini / Avanscoperta, Pivotal Events](https://www.avanscoperta.it/en/eventstorming/pivotal-events/) — timeline splitters and provisional boundaries.
- [Alberto Brandolini, Collaborative Process Modelling with EventStorming](https://medium.com/@ziobrando/collaborative-process-modelling-with-eventstorming-17ed363650c0) — process grammar and rules.
- [EventStorming.com, Patterns](https://www.eventstorming.com/patterns/) — official facilitation patterns and anti-patterns.
- [Alberto Brandolini, Introducing EventStorming](https://leanpub.com/introducing_eventstorming) — author/publisher contents and framing.
