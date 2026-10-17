# Private personal digital twin

This directory owns the Pi agent's complete digital-twin implementation:

| Path | Purpose |
| --- | --- |
| `runtime/` | Production modules, CLIs, RDF, and operational scripts |
| `eval/` | Offline-only Promptfoo providers, corpora, calibration, and local results |
| `tests/` | Runtime unit and Oxigraph integration coverage |
| `docs/` | Ontology, evaluator, and local-model research |

The dependency direction is one-way: evaluation may import the compiled runtime interface, while
runtime code never imports evaluation code, corpora, judges, or Promptfoo.

The Pi agent production package publishes only `dist/`. It contains the compiled runtime modules,
but excludes `digital-twin/eval/`, gold data, judge outputs, Promptfoo, tests, and research notes.
The launch-agent installer also rejects a production artifact if evaluation code or Promptfoo is
present.

## Durable Pi-session ingestion

The digital twin listens outside the Pi voice service. A separate launch agent scans persisted Pi
sessions and submits each completed owner turn to the existing Absurd queue. The stable Pi session
and message IDs form the task's idempotency identity, so listener restarts and queue retries cannot
create duplicate journal facts.

The `digital-twin-ingest` handler runs the transcript in its own disposable Gondolin microVM. The
guest has no workspace mount or public internet access. Synthetic networking permits only:

- the configured loopback local-model endpoint; and
- the fixed-shape journal writer exposed by the agent gateway under a separate writer credential.

The guest never receives Postgres credentials, the general agent-gateway credential, or Oxigraph's
SPARQL endpoint. The host writer validates the structured journal and generates an idempotent
`INSERT DATA` for the fixed journal graph.

The guest image is not built by a runtime worker. Its declaration lives in
`runtime/image/gondolin.json`; the trusted Gitea Actions builder publishes a digest-addressed OCI
image and the host installer verifies that digest before registering `digital-twin-ingest:v1` with
Gondolin:

```bash
make digital-twin-image-build
```

This folder defines a local-first RDF knowledge graph for a person. Oxigraph stores four named
graphs so consumers can distinguish durable CV evidence, provisional conversation evidence, and
source-grounded learning evidence:

| File | Named graph | Purpose |
| --- | --- | --- |
| `cv.ttl` | `urn:awp:digital-twin:graph:cv` | Identity, employment, education, and skills stated in CVs |
| `conversation.ttl` | `urn:awp:digital-twin:graph:conversation` | Topics and preferences explicitly expressed in chat |
| `learning.ttl` | `urn:awp:digital-twin:graph:learning` | Learning resources, watch events, covered topics, and source claims |
| `provenance.ttl` | `urn:awp:digital-twin:graph:provenance` | Source and generation records for the other graphs |

The model deliberately uses only three established vocabularies:

- [Schema.org](https://schema.org/) for the profile, education, skills, messages, and documents.
- [W3C Organization Ontology](https://www.w3.org/TR/vocab-org/) for employment memberships and
  organizational roles.
- [PROV-O](https://www.w3.org/TR/prov-o/) with Dublin Core Terms for source lineage.

## Lightweight cognitive journal

Thoughts and ideas use a separate append-only journal graph. They remain lightweight
`schema:CreativeWork` entries with a type, text, retrieval topics, timestamp, and one automatic
source reference. They do not require full PROV-O records or verbatim evidence matching.

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

## Transcript ingestion contract

The Pi transcript pipeline makes one bounded decision before extraction:

| Assertion kind | Meaning | RDF target after review |
| --- | --- | --- |
| `conversation_topic` | A subject the owner discusses or asks to explore | `schema:Message` → `schema:about` → `schema:DefinedTerm` |
| `skill_evidence` | An explicit claim or direct evidence of a durable skill | `schema:Person` → `schema:knowsAbout` → `schema:DefinedTerm` |
| `profile_update` | An explicit change to job title, location, credential, or employment | Existing Schema.org or ORG profile shape |
| `none` | A transient instruction, question, assistant statement, or uncertain claim | Nothing |

[Von](https://github.com/wfzyx/von) selects the assertion kind and profile field. Decisions below
the configured confidence threshold are review items and do not reach extraction. Ollama then uses
the checked TypeBox schema in `apps/pi-agent/digital-twin/runtime/ingestion.ts` to extract labels and exact
evidence quotes. A quote that is not present verbatim in the transcript is rejected.

This is intentionally a candidate pipeline. Classification never promotes a conversation claim into
the durable CV graph by itself.

For the first narrow ingestion slice, identify explicit skill candidates from transcript text on
standard input. Results include verbatim evidence and are not written to Oxigraph:

```bash
printf '%s\n' 'I use TypeScript and Playwright for browser testing.' \
  | make digital-twin-identify-skills
```

Questions, commands, interests, hypotheticals, negations, quotations, and third-party capabilities
must produce no skill candidate. Treat the JSON output as a review queue, not as accepted facts.

## Classifier evaluation

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

## Private data

Put the four Turtle files in `runtime/rdf/private/`. That directory is ignored by Git because the
files may contain personal data. The checked-in `runtime/rdf/example/` files document the shape
without containing the real profile.

Load all four graphs into the private Oxigraph container:

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
