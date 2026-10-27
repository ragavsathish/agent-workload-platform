# Private personal digital twin

This directory owns the Pi agent's complete digital-twin implementation:

| Path | Purpose |
| --- | --- |
| `runtime/` | Production modules, CLIs, RDF, and operational scripts |
| `eval/` | Offline-only Promptfoo providers, corpora, calibration, and local results |
| `tests/` | Process-level safety and Oxigraph integration coverage |
| `docs/` | Ontology, evaluator, and local-model research |

The dependency direction is one-way: evaluation may import the compiled runtime interface, while
runtime code never imports evaluation code, corpora, judges, or Promptfoo.

The Pi agent production package publishes only `dist/`. It contains the compiled runtime modules,
but excludes `digital-twin/eval/`, gold data, judge outputs, Promptfoo, tests, and research notes.
The launch-agent installer also rejects a production artifact if evaluation code or Promptfoo is
present.

## Durable Pi-session ingestion

The digital twin listens outside the Pi voice service. A separate launch agent scans persisted Pi
sessions and fans each completed owner turn into independently retryable `digital-twin-journal` and
`digital-twin-classify` Pi Durable tasks. The stable Pi session and message IDs form each branch's
idempotency identity, so listener restarts and task resumes cannot create duplicate journal facts
or review candidates. Each persisted prompt carries user-versus-developer origin metadata; the
listener excludes developer bootstrap turns before they reach either extraction branch.

Each handler runs the transcript in its own disposable Gondolin microVM. The
guest has no workspace mount or public internet access. Synthetic networking permits only:

- the configured loopback Qwen endpoint;
- the configured loopback Von/Clef-compatible classifier endpoint; and
- fixed-shape journal and review writers exposed by the agent gateway under a separate credential.

The guest receives no database credentials, the general agent-gateway credential, or Oxigraph's
SPARQL endpoint. The host writer validates the structured payload. Journal entries go only to the
journal graph; classifier output goes only to the pending-review graph.

The guest image is not built by a runtime worker. Its declaration lives in
`runtime/image/gondolin.json`; a trusted Gitea Actions job asks the host Docker API to build it and
write a versioned tar to the local image handoff. The host installer imports that tar and registers
`digital-twin-ingest:v1` with Gondolin:

```bash
make digital-twin-image-build
```

This folder implements a local-first RDF knowledge graph for a person. The vocabulary and SHACL
profile live in `runtime/rdf/ontology/` and `runtime/rdf/shapes/personal-knowledge.shacl.ttl`;
the proposal and mapping are documented in
[`docs/ontology-application-profile.md`](docs/ontology-application-profile.md). The app profile
reuses established vocabularies and defines only the Voice Agent personal-knowledge terms missing from them.
Oxigraph uses named graphs to separate source, journal, inference, review, accepted knowledge, and
feedback lifecycles:

| File / writer | Named graph | Purpose |
| --- | --- | --- |
| `private/cv.ttl` | `urn:awp:digital-twin:graph:cv` | Identity, employment, education, and skills stated in CVs |
| `private/conversation.ttl` | `urn:awp:digital-twin:graph:conversation` | Topics and preferences explicitly expressed in chat |
| `private/learning.ttl` | `urn:awp:digital-twin:graph:learning` | Learning resources, watch events, covered topics, and source claims |
| `private/provenance.ttl` | `urn:awp:digital-twin:graph:provenance` | Source and generation records for the other graphs |
| Journal and classifier writers | `urn:awp:digital-twin:graph:journal` | Source messages and structured journal records |
| Classifier writer | `urn:awp:digital-twin:graph:review` | Evidence-bound candidate assertions awaiting owner review |
| Owner review writer | `urn:awp:digital-twin:graph:accepted` | Owner-accepted profile facts |
| Journal and assertion feedback writers | `urn:awp:digital-twin:graph:journal-feedback`, `urn:awp:digital-twin:graph:assertion-feedback` | Append-only owner review and correction events |
| Classifier projection | `urn:awp:digital-twin:graph:assertion-classification` | Earlier unreviewed classifier predictions; retained for compatibility during projection migration |
| `runtime/rdf/ontology/*.ttl` | `urn:awp:digital-twin:graph:ontology` | Voice Agent personal-knowledge profile and SKOS concepts |

The profile primarily reuses these established vocabularies:

- [Schema.org](https://schema.org/) for the profile, education, skills, messages, and documents.
- [W3C Organization Ontology](https://www.w3.org/TR/vocab-org/) for employment memberships and
  organizational roles.
- [PROV-O](https://www.w3.org/TR/prov-o/) for source lineage and generation activities.
- [Dublin Core Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/) for document metadata.
- [W3C Web Annotation](https://www.w3.org/TR/annotation-model/) for source-targeted classifier annotations.
- [SKOS](https://www.w3.org/TR/skos-reference/) for controlled journal, assertion, and review concepts.
- [SHACL](https://www.w3.org/TR/shacl/) for validating the application profile.

Two operational named graphs complete the review lifecycle:

- `urn:awp:digital-twin:graph:review` stores pending or rejected candidates and classifier metadata.
- `urn:awp:digital-twin:graph:accepted` stores only owner-accepted `schema:Claim` resources.

## Lightweight cognitive journal

Thoughts and ideas use a separate journal graph. New journal writes are typed with the Voice Agent personal-knowledge vocabulary,
use SKOS concept IRIs for their kinds, and include PROV-O source and generation links. Legacy
`schema:additionalType` string values are still emitted temporarily so current readers continue to
work while the graph projection is migrated. Journal entries remain separate from candidate
assertions and accepted profile facts.

Capture transcript text from standard input and append the extracted journal entries to private
Oxigraph storage:

```bash
printf '%s\n' 'I think memory should remain separate from accepted facts.' \
  | make digital-twin-capture-journal
```

Supported entry types are `thought`, `idea`, `question`, `decision`, `goal`, `learning`, and
`unclassified`. The complete input text is retained alongside the entries, but the journal is not
promoted into CV facts or skill assertions. Query it with:

```bash
make digital-twin-query QUERY=apps/pi-agent/digital-twin/runtime/rdf/queries/journal-summary.rq
```

The CV, conversation, videos, and repositories are sources, not ontologies. Conversation statements
and learning evidence remain separate and should not become durable profile facts without review.

### Daily Codex journal pages

Submit one day's owner messages to `POST /v1/digital-twin/daily-journals` with the authenticated
owner identity, an IANA timezone, local journal date, and source references, timestamps, and text.
The gateway admits one idempotent `digital-twin-daily-journal` task to Pi Durable. The task uses the
checked-in detailed daily-journal prompt and writes through the bounded
`POST /v1/digital-twin/daily-journal` endpoint.

The resulting `pk:DailyJournal` is one private narrative page, grounded in the supplied owner
messages and linked to every source and the generating PROV activity. It is written as selective,
connected prose rather than a list of tasks or extracted quote fragments. Earlier generated child
notes remain in RDF for provenance, but the journal list no longer presents them as separate notes.
Re-running a task replaces the page's generated projection while leaving its source messages and
review history intact.

### Legacy projection migration

Preview eligible legacy daily pages and assertion-classifier annotations without writing:

```bash
make digital-twin-migrate-preview
```

After reviewing the candidate counts, add typed projections with the timezone used for the journal:

```bash
make digital-twin-migrate TIME_ZONE=Europe/Helsinki
```

The migration is additive and idempotent. It leaves legacy triples in place, only maps classifier
records that link to a source `schema:Message` and have a recognized class plus valid confidence,
and never creates candidate assertions or accepted profile facts. A daily page with an unparseable
date or no source link is skipped. The migration command has not been run against the live store.

### Journal observation and feedback

Every production journal task returns a payload-free decision summary containing the extractor
version, sentence counts, whether the model ran, and model/grounded/rejected entry counts. The
worker exports only these bounded counts and the outcomes `filtered`, `no-entries`, or `written` to
OpenTelemetry. Capture IDs, transcripts, entry text, topics, and identities are never metric
attributes.

Owner-authenticated feedback is stored separately in
`urn:awp:digital-twin:graph:journal-feedback`:

- `POST /v1/digital-twin/journal/{entryId}/feedback` records `keep`, `delete`, `edit`, or
  `wrong_type`; edits require `correctedText` and wrong-type reports require `correctedType`.
- `POST /v1/digital-twin/journal/misses` records an expected entry omitted from a known capture.
- `GET /v1/digital-twin/journal/feedback` uses the read-only digital-twin capability to export the
  private, human-reviewed evidence for offline evaluation.

Deleted entries are excluded from journal queries while their correction event remains available
for evaluation. Never use unreviewed model output as a gold label.

### Reviewed journal evaluation

Extraction quality is measured on private, human-reviewed production captures, not with unit tests.
The first command samples the journal graph into an ignored review queue. Predictions are included
only as reviewer suggestions and are removed from the finalized manifest:

```bash
make digital-twin-journal-export \
  ARGS='--output apps/pi-agent/digital-twin/eval/private-manifests/journal-review.draft.json --limit 40'
```

Review every case, including explicit empty cases. Redact secrets, set `privacyReview.status` to
`passed` with `reviewedAt`, assign each case an error slice and semantic family, and change its
annotation status to `reviewed` or `adjudicated`. Each expected entry needs an exact contiguous
`evidenceQuote` from the transcript. Keep every semantic family in one split.

Finalize the queue only after that human work is complete. Finalization fails closed on pending
privacy review, pending annotations, unassigned error slices, invalid evidence, or split leakage:

```bash
make digital-twin-journal-finalize \
  ARGS='--input apps/pi-agent/digital-twin/eval/private-manifests/journal-review.draft.json --output apps/pi-agent/digital-twin/eval/private-manifests/journal-review.json'
```

Evaluate through the same transcript prefilter and extraction boundary used in production:

```bash
make digital-twin-journal-eval \
  ARGS='--input apps/pi-agent/digital-twin/eval/private-manifests/journal-review.json --output apps/pi-agent/digital-twin/eval/private-results/journal-review --split development'
```

The result includes row-level matches and failures, aggregate capture and entry precision/recall/F1,
per-type confusion, error-slice metrics, latency, operational failures, and immutable dataset,
configuration, runtime, and evaluator digests. Locked holdout evaluation requires the explicit
`--allow-locked-holdout` flag and should run once for a promotion decision.

## Transcript ingestion contract

The Pi transcript pipeline makes one bounded decision before extraction:

| Assertion kind | Meaning | RDF target after review |
| --- | --- | --- |
| `conversation_topic` | A subject the owner discusses or asks to explore | `schema:Message` → `schema:about` → `schema:DefinedTerm` |
| `skill_evidence` | An explicit claim or direct evidence of a durable skill | `schema:Person` → `schema:knowsAbout` → `schema:DefinedTerm` |
| `profile_update` | An explicit change to job title, location, credential, or employment | Existing Schema.org or ORG profile shape |
| `none` | A transient instruction, question, assistant statement, or uncertain claim | Nothing |

[Von](https://github.com/wfzyx/von) selects the assertion kind and profile field through a pinned
local SystemOne service on port `8010`; port `8000` belongs to Grafana MCP. Decisions below the
configured confidence threshold do not reach extraction. Ollama then uses
the checked TypeBox schema in `apps/pi-agent/digital-twin/runtime/ingestion.ts` to extract labels and exact
evidence quotes. A quote that is not present verbatim in the transcript is rejected.

The default `0.60` confidence gate is calibrated against the pinned Von 1.3.7 runtime: 19 of the
200 grouped gold examples reach extraction, all 19 are correctly routed, and no `none` example
becomes a durable candidate. Recalibrate before changing the model, prompt, or threshold.

This is intentionally a candidate pipeline. Classification never promotes a conversation claim into
durable knowledge by itself. High-confidence extracted candidates still enter the review graph as
`pending`; only an owner-authenticated accept decision copies one into the accepted graph. The
journal and classifier jobs retry independently, so failure in either branch cannot block the other.

For the first narrow ingestion slice, identify explicit skill candidates from transcript text on
standard input. Results include verbatim evidence and are not written to Oxigraph:

```bash
printf '%s\n' 'I use TypeScript and Playwright for browser testing.' \
  | make digital-twin-identify-skills
```

Questions, commands, interests, hypotheticals, negations, quotations, and third-party capabilities
must produce no skill candidate. Treat the JSON output as a review queue, not as accepted facts.

## Classifier evaluation

For production-derived assertion labels, start with the
[owner assertion learning workflow](docs/owner-assertion-learning-workflow.md). Its Codex export is an
unreviewed private queue; journal summaries and classifier predictions are not gold labels.

The classifier bake-off uses pinned Promptfoo `0.124.1` with 200 synthetic, claim-level gold
examples: 50 for each assertion kind. The same ontology criteria are compared across:

- local Von through the production `classifyTranscript` boundary;
- TypeSafe Jev 1.13 when `TYPESAFE_API_KEY` is configured;
- local Cloudflare Clef-flash through its Jev-compatible SystemOne endpoint at
  `http://127.0.0.1:30000` by default.

LM Studio Atla Selene 1 Mini 8B is an independent semantic judge, not a classifier row. Deterministic
gold labels remain authoritative; Selene's non-gating score and reason help review disagreements. Promptfoo
reports accuracy, coverage, safe acceptance, false durable candidates, probability coverage, Brier
score, per-class precision/recall/F1, and the Selene judge score. Override the classifier with
`CLEF_BASE_URL` and `CLEF_MODEL`; override the judge with `LM_STUDIO_BASE_URL`,
`LM_STUDIO_JUDGE_MODEL`, and, if required, `LM_STUDIO_API_KEY`. The legacy `LM_STUDIO_MODEL`
variable remains a fallback.

```bash
make digital-twin-pull-judge
make digital-twin-load-judge
make digital-twin-eval
make digital-twin-eval ARGS='--no-cache --output digital-twin/eval/results/results.json --output digital-twin/eval/results/report.html'
make digital-twin-judge-calibration ARGS='--no-cache --output digital-twin/eval/results/judge-calibration.json'
make digital-twin-judge-report RESULTS=digital-twin/eval/results/judge-calibration.json
pnpm --dir apps/pi-agent eval:classifier:view
```

Selene is configured as a Promptfoo-native `llm-rubric` grading provider, so grader calls use
Promptfoo caching, retries, token accounting, metadata, and `graderError` handling. The calibration
suite contains 40 synthetic cases grouped into 20 `goldCase` families: 32 development rows and 8
locked holdout rows. A paraphrase family never crosses the split. Before interpreting agreement,
a human must review every entry in `apps/pi-agent/digital-twin/eval/digital-twin-judge.labels.json`; `null` is
reported as `unreviewed`, never silently replaced by the machine-authored proposed verdict.

The judge report counts provider, timeout, and malformed-output failures as `notJudged` and excludes
them from semantic agreement. It reports them separately instead of converting them to `incorrect`.

Provider credentials are read only from environment variables. Promptfoo sharing is disabled and
local result files are ignored because evaluation artifacts contain the full test inputs and model
outputs.

## Classifier artifacts

DVC versions privacy-reviewed reproducibility bundles against the loopback-only S3Mock service. Git
stores only `artifacts.dvc`, configuration, and the bundle schema; the ignored `artifacts/`
directory contains reviewed manifests, configuration, and aggregate qualification evidence. MLflow
owns model versions and aliases; DVC records their immutable model-version/run references rather
than duplicating model weights. No Hugging Face account or service is involved.

```bash
make digital-twin-artifact-add
make digital-twin-artifact-verify
```

The verification command validates the manifest, pushes the current bundle, restores it into a
clean temporary DVC checkout, and byte-compares the fixture. See
[`docs/artifact-management.md`](docs/artifact-management.md) for lifecycle and privacy rules.

## Private data

Put the four Turtle files in `runtime/rdf/private/`. That directory is ignored by Git because the
files may contain personal data. The checked-in `runtime/rdf/example/` files document the shape
without containing the real profile.

Load the four private profile graphs and the checked-in vocabulary graph into Oxigraph:

```bash
make digital-twin-load
```

The loader replaces only these four named graphs. It does not clear the rest of the RDF store.
Oxigraph remains unexposed on the host; the scripts send requests through the already-private
Compose data network.

Run the safe default summary or provide another checked-in/read-only query:

```bash
make digital-twin-query
make digital-twin-query QUERY=apps/pi-agent/digital-twin/runtime/rdf/queries/provenance.rq
```

The query helper accepts only a local file and submits a SPARQL query, never an update.

Run the disposable integration test against isolated temporary named graphs:

```bash
make digital-twin-test
```

Validate private Turtle before loading it:

```bash
make digital-twin-validate
```

The SHACL shapes constrain people, terms, messages, memberships, learning resources, watch actions,
source claims, and graph provenance. Validation runs before the integration test loads RDF into
Oxigraph.

Query learning resources, topics, and source claims:

```bash
make digital-twin-query QUERY=apps/pi-agent/digital-twin/runtime/rdf/queries/learning-summary.rq
```
