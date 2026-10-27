# Personal knowledge graph application profile

Status: the production daily-journal writer and legacy projection migration are implemented. New
journal notes, classifier decisions, candidate assertions, and review events use the typed profile.
The live legacy graphs have not been migrated; preview first, then apply with the journal timezone.

This profile maps the personal journal and assertion-classification data to established RDF
vocabularies. It is an application profile, not a new general-purpose ontology. Reuse established
terms where their meaning fits, and define a small product-scoped vocabulary under `pk:`
(`urn:voice-agent:personal-knowledge:`) for details specific to this feature.

## Scope and vocabulary choices

| Concern | Reused vocabulary | Application-profile decision |
| --- | --- | --- |
| Conversation and source messages | Schema.org `Conversation`, `Message`, `sender`, `dateSent`, `text`, `hasPart` / `isPartOf` | The profile defines a source identifier only if the upstream source has no durable URI. A source message is evidence, not a claim. |
| Journal documents | Schema.org `DigitalDocument` / `CreativeWork`; Dublin Core Terms `identifier`, `created`, `modified`, `language`, `hasVersion`, `isVersionOf` | The profile defines `DailyJournal` as a specialized document and records the journal day and timezone explicitly. A rendered Markdown document is a presentation artifact; structured journal records are canonical. |
| Processing and provenance | PROV-O `Entity`, `Activity`, `SoftwareAgent`, `used`, `wasGeneratedBy`, `wasDerivedFrom`, `wasAssociatedWith`, `startedAtTime`, `endedAtTime` | Each journal generation and classifier invocation is a PROV activity. Durable task IDs identify activities, not untyped dangling resources. |
| Excerpts and model annotations | W3C Web Annotation `Annotation`, `body`, `target`, `motivatedBy`, `TextQuoteSelector` / `TextPositionSelector` | Use an annotation for a prediction or note about a source message or excerpt. Preserve a quote and selector when possible. Annotation is not itself a user assertion. |
| Taxonomies | SKOS `ConceptScheme`, `Concept`, `prefLabel`, `definition`, `inScheme`, `broader`, `exactMatch` | Maintain separate schemes for journal entry kinds, assertion kinds, classifier outcomes, and review states. Never reuse one category IRI across those different meanings. |
| Claim lifecycle | Schema.org `Claim`, `ReviewAction`, PROV-O, plus small product-specific terms | The profile defines `CandidateAssertion`, `ClassificationDecision`, `ReviewEvent`, and `ProfileFact` because the existing vocabularies do not specify this owner-reviewed personal-knowledge lifecycle. |
| Validation | SHACL | Shapes validate the application profile and its graph-boundary rules; SHACL is a constraint language, not an ontology. |
| Time | XSD date/time datatypes; OWL-Time only if interval reasoning is needed | Store source timestamp as `xsd:dateTimeStamp`; store the journal's local calendar date as `xsd:date` and timezone as an IANA timezone identifier. Do not introduce OWL-Time for simple ordering. |

SNOMED CT is intentionally excluded: it is a clinical reference terminology, not a general journal,
conversation, provenance, or assertion-lifecycle model. If a future health-data use case appears, map
only the relevant clinical concepts to SNOMED CT under its licensing and governance requirements.

## Mapping of current data

The mapping below describes the current implementation and the proposed interpretation. The `pk:`
namespace applies only to the Voice Agent personal-knowledge feature. Existing graph and predicate
identifiers remain a separate compatibility concern.

| Current RDF shape / field | Current meaning | Proposed mapping |
| --- | --- | --- |
| `schema:Message` capture node | Captured transcript plus capture/source identifier and timestamp | Retain as `schema:Message`; give it a stable source URI, sender, timestamp and `isPartOf` conversation/session. Avoid storing duplicate pseudo-IDs when an upstream message ID exists. |
| `schema:CreativeWork` journal note | Extracted note with text, timestamp, source, keywords, literal `additionalType` | Keep as `schema:CreativeWork` or specialize to `pk:JournalEntry`; `prov:wasDerivedFrom`/`schema:isBasedOn` links to source; entry kind becomes a SKOS concept, not a free-text type literal. |
| `schema:CreativeWork` daily journal page + `legacy:recordKind "codex_daily_journal"` | Daily Markdown document | Replace string discriminator with `a pk:DailyJournal, schema:DigitalDocument`; include date, timezone, generation activity and source links. |
| Earlier activity summary / reflection records typed as `schema:CreativeWork` | Small generated fragments that clutter the journal list and repeat the daily page | Keep their RDF and provenance for compatibility, but hide them as standalone journal cards. New daily pages are a single narrative document with direct source links and no extracted child notes. |
| `schema:additionalType` literal on a note/claim/classification | Overloaded among journal kind, assertion kind and prediction label | Replace with a purpose-specific object link to an IRI in the corresponding SKOS scheme. Keep `schema:additionalType` only for actual additional type IRIs, never literals used as enums. |
| `prov:wasGeneratedBy` durable task IRI | Says which durable task produced a page or record | Type target as `prov:Activity` (or a narrower `pk:` activity class), link activity to Pi Durable with stable ID, status, timestamps and responsible software agent as permitted by retention policy. |
| `prov:wasDerivedFrom` session IRI / string source IDs | Source lineage | Link to typed source entities (`schema:Conversation`, `schema:Message`) with stable IRIs. Avoid source IDs as literals when the source resource can be represented. |
| `schema:isBasedOn` | Used variously for source message, page, and review target | Retain only for the ordinary “based on” relation; use `prov:wasDerivedFrom` for derivation lineage and `oa:hasTarget` for annotation targets. Avoid treating the predicates as interchangeable. |
| `graph:assertion-classification` records (`legacy:recordKind "systemone_assertion_classification"`, `schema:additionalType`, confidence, model, review status) | Model-predicted assertion label linked to journal reflection/page | Represent as `oa:Annotation` targeting the exact source message/excerpt, with a typed `pk:ClassificationDecision` body; link decision to SKOS assertion-kind concept. Record model and run on PROV activity. Keep this distinct from a candidate proposition. |
| `schema:Claim` in review graph | Extracted evidence-backed candidate | Type as `pk:CandidateAssertion` and optionally `schema:Claim`; carry exact evidence link/quote, predicted category, source and lifecycle state. A classifier decision alone cannot instantiate this node. |
| `schema:Claim` in accepted graph | Owner-reviewed durable assertion | Type as `pk:ProfileFact` and `schema:Claim`; link to candidate and review event. Preserve the accepting owner and time. Acceptance is an explicit event, not an inference from graph location alone. |
| `schema:ReviewAction` / `graph:journal-feedback` / `graph:assertion-feedback` | Owner correction, accept/reject, or review feedback | Use a `pk:ReviewEvent` specialization of `prov:Activity`, optionally also `schema:ReviewAction`; capture actor, action concept, target, timestamp and reason. Do not overwrite the history of an earlier decision. |
| Literal `legacy:status`, `legacy:confidence`, `legacy:lowConfidence` | Lifecycle and model metadata | Status becomes a SKOS concept or tightly validated enum. Confidence belongs to the model decision, with model/run and calibration version; it is not a truth score on a claim. `lowConfidence` should be derived from a versioned threshold, not stored as an independent conflicting flag. |
| `schema:keywords` literal topics | Retrieval tags | Keep as literals only for genuinely open-ended search keywords; if a topic has identity or hierarchy, link it to a SKOS concept. |

## Proposed lifecycle and graph boundaries

```text
Source conversation/message
       │ used by
       ▼
PROV generation/classification activity ──generated──▶ Journal document / derived record
       │                                               │
       └──generated──▶ Classification decision         └──derived from──▶ source evidence
                              │
                         classifies source
                              │
                              └──may inform extraction; it is not a claim

Source evidence ──supports──▶ Candidate assertion ──review event──▶ accepted ProfileFact
                                           └────────review event──▶ rejected candidate
```

Named graphs should reflect lifecycle and access boundaries, not replace RDF typing:

| Graph role | Contents |
| --- | --- |
| Source | Retained source conversations/messages, subject to privacy and retention rules |
| Journal | Journal documents, notes, summaries and excerpts with provenance |
| Inference | Model runs and classification annotations/decisions, including unreviewed predictions |
| Review | Candidate assertions and pending/rejected review state |
| Accepted | Owner-approved profile facts only |
| Audit/feedback | Append-only review, correction, and deletion events |

This is a logical partition proposal. The current service must still enforce access; a named graph
alone is not an authorization boundary.

## Identifier, time and provenance rules

- Mint deterministic IRIs from the upstream system plus its immutable source ID. Do not derive
  identity from displayed labels or truncated IDs.
- If a source only provides an ID scoped to a session, include both session and message IDs in the
  source IRI. Preserve the original identifiers as metadata for round-trip debugging.
- Use `xsd:dateTimeStamp` for instants. A journal day is a local date plus an explicit IANA timezone;
  it is not the UTC date of the generation task.
- Every derived entity points to its source with PROV-O. Every generation/classification/review
  activity identifies its inputs and outputs where retention policy permits.
- Treat model, prompt, taxonomy version, threshold and runtime version as provenance for a decision.
  Predictions remain immutable outputs; a changed model creates a new decision, not an overwrite.
- Avoid duplicate content: either a page is the canonical text, or it is a rendered projection of
  structured records. The proposed direction is structured records as canonical and page text as a
  presentation/export artifact.

## Illustrative Turtle (proposed terms)

This is an example of the intended distinction; it is not yet production data or a committed ontology
file.

```turtle
@prefix pk: <urn:voice-agent:personal-knowledge:ontology#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix oa: <http://www.w3.org/ns/oa#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix schema: <https://schema.org/> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<urn:voice-agent:codex:session:S1:message:M7>
    a schema:Message, prov:Entity ;
    schema:identifier "M7" ;
    schema:text "I use TypeScript and Playwright for browser testing." ;
    schema:dateSent "2026-10-27T12:00:00+03:00"^^xsd:dateTimeStamp .

<urn:voice-agent:personal-knowledge:journal:2026-10-27>
    a pk:DailyJournal, schema:DigitalDocument, prov:Entity ;
    dcterms:identifier "journal:2026-10-27:Europe/Helsinki" ;
    pk:journalDate "2026-10-27"^^xsd:date ;
    pk:timeZone "Europe/Helsinki" ;
    prov:wasGeneratedBy <urn:voice-agent:personal-knowledge:activity:journal:task:T1> ;
    prov:wasDerivedFrom <urn:voice-agent:codex:session:S1:message:M7> .

<urn:voice-agent:personal-knowledge:activity:classify:T2>
    a pk:ClassificationActivity, prov:Activity ;
    prov:used <urn:voice-agent:codex:session:S1:message:M7> ;
    prov:wasAssociatedWith <urn:voice-agent:personal-knowledge:agent:systemone:model-v1> .

<urn:voice-agent:personal-knowledge:annotation:T2:M7>
    a oa:Annotation ;
    oa:motivatedBy oa:classifying ;
    oa:hasTarget <urn:voice-agent:codex:session:S1:message:M7> ;
    oa:hasBody <urn:voice-agent:personal-knowledge:decision:T2:M7> ;
    prov:wasGeneratedBy <urn:voice-agent:personal-knowledge:activity:classify:T2> .

<urn:voice-agent:personal-knowledge:decision:T2:M7>
    a pk:ClassificationDecision, prov:Entity ;
    pk:predictedKind <urn:voice-agent:personal-knowledge:concept:assertion-kind:skill-evidence> ;
    pk:confidence "0.71"^^xsd:decimal .

<urn:voice-agent:personal-knowledge:concept:assertion-kind:skill-evidence>
    a skos:Concept ;
    skos:inScheme <urn:voice-agent:personal-knowledge:taxonomy:assertion-kind> ;
    skos:prefLabel "Skill evidence"@en .
```

The example deliberately contains no `CandidateAssertion` or `ProfileFact`: classification labels
an input; it does not assert that the proposition is true. A separate extraction step may create a
candidate with an exact evidence span, and only an owner review event may accept it.

## SHACL profile coverage to add

1. `DailyJournalShape`: exactly one local journal date and timezone; generated by one activity; all
   structured components linked with `schema:hasPart`.
2. `SourceMessageShape`: stable identifier, one sender, timestamp, source conversation membership,
   and immutable source text/reference policy.
3. `ClassificationActivityShape` and `ClassificationDecisionShape`: model/run provenance, taxonomy
   scheme membership, bounded confidence/probability values, and target source evidence.
4. `CandidateAssertionShape`: exact source evidence, typed proposition, candidate lifecycle state,
   and no accepted state without review event.
5. `ProfileFactShape`: an accepted candidate plus an owner-authored acceptance event.
6. `ReviewEventShape`: one actor, one target, one action concept and one timestamp; events are
   append-only.
7. Named-graph checks (using SHACL-SPARQL only if supported by the deployed validator) to prevent
   predictions from being written to the accepted graph and to reject orphan provenance links.

## Migration plan

1. Inventory every writer, reader, query and current triple shape against the mapping above.
2. Confirm which retained source identifiers and text are allowed by the privacy/retention policy.
3. Add the application profile and SHACL shapes alongside the existing schema; do not rewrite data.
4. Build a deterministic, read-only projection from existing graphs and report counts, unmapped
   predicates, duplicate content and broken links.
5. Test readers against the projected graph and compare user-visible results with the current UI.
6. Switch writes only after the projection and validation pass. Keep old graphs available for
   rollback, then retire them in a separate reviewed operation.

## Open decisions before implementation

- Whether full message text is retained in RDF or only a protected source reference plus minimal
  quoted evidence.
- Whether journal feedback `delete` means hide from current projection, invalidate the record, or
  physically erase source content; these are different operations with different audit semantics.
- Whether Web Annotation selectors add enough value for message excerpts, or simpler product-specific evidence
  span is sufficient for this private graph.
- Whether task status/results belong in the personal knowledge graph at all; the durable task store
  may remain the source of truth, with provenance links only.
- Whether accepted facts are copied into a separate graph or represented as versioned lifecycle
  events over the same stable assertion resource.

Do not migrate or clear the current graph until these decisions, identifier rules, and SHACL
constraints are reviewed against real examples.
