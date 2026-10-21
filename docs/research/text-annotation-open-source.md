# Open-source text annotation UI for journal review

Research date: 2026-10-18. Sources are project-owned repositories and documentation.

## Recommendation

Use [`@recogito/text-annotator`](https://github.com/recogito/text-annotator-js) as the span-selection component inside a small journal-review UI. Keep our reviewed manifest and finalizer as the source of truth. Wrap that same UI as an MCP App only when inline delivery is useful.

This is the narrow reuse seam we need:

- Recogito creates and edits exact selections, preserving both the selected quote and character offsets.
- Its annotation `bodies` intentionally carry application-specific payloads, so our entry type, canonical text and topics can remain attached to the selected evidence.
- It exposes create/update/delete/selection events, programmatic selection, styling, undo/redo, and a maintained React wrapper.
- It is a client-side library rather than an annotation platform, so there is no second user database, task scheduler, export format or review state to reconcile.
- It is BSD-3-Clause licensed and was active at the time of review.

The library does **not** supply record navigation, `No durable entry`, blind prediction reveal, privacy review, autosave, semantic-family assignment or our manifest validation. Those are small, domain-specific controls around the component rather than reasons to adopt a general annotation server. See the project's [API and data model](https://github.com/recogito/text-annotator-js#annotator-api), [React package/release notes](https://github.com/recogito/text-annotator-js/releases), and [license](https://github.com/recogito/text-annotator-js/blob/main/LICENSE).

Suggested mapping:

| Journal field | UI/storage mapping |
|---|---|
| Evidence quote | Recogito selector `quote`, `start`, `end` |
| Entry type | annotation body with a controlled value |
| Canonical text | annotation body edited in our side panel |
| Topics | annotation body containing a string list |
| Multiple entries | one annotation per evidence-backed entry |
| No durable entry | case-level action owned by our app |
| Model suggestion | separate read-only overlay, hidden until requested |

## Candidate comparison

| Candidate | Exact spans | Per-span type + editable text/topics | Empty case | Local use | Embedding/MCP fit | Verdict |
|---|---:|---:|---:|---:|---|---|
| [Recogito Text Annotator](https://github.com/recogito/text-annotator-js) | Yes: quote and offsets | Yes, through application-defined annotation bodies and our editor | Add one app button | Pure browser component | Best: library and React wrapper fit directly inside an MCP App View | **Use this component** |
| [Potato](https://github.com/davidjurgens/potato) | Yes, including dialogue and multiple text targets | Span labels and separate free-text schemes compose, but canonical text is not inherently a child of each span; custom work is still needed | Triage/skip and conditional schemes are available | Self-hosted Python app | Adaptable web UI, but GPL-3.0 and a full platform | Best ready-made fallback; heavier than the problem |
| [Argilla](https://github.com/argilla-io/argilla) | Yes through `SpanQuestion` | A dataset can combine span and text questions, but a text response is question-level, not naturally one canonical-text/topics record per selected span | Draft/discard can represent this, or add a label question | Docker/self-hosted | Separate Vue/FastAPI application; no reusable annotation component | Capable, but the workflow/data-model impedance remains |
| [doccano](https://github.com/doccano/doccano) | Yes for sequence labeling | Native sequence-label output is `[start, end, label]`; no per-span canonical text/topics form | Classification or omission can approximate it | pip, Docker, Compose | Full Nuxt/Django app and REST API, not a reusable component | Good NER tool, weak match for compound journal entries |
| [INCEpTION](https://github.com/inception-project/inception) | Yes, configurable to character-level spans | Strong: custom span layers can carry typed string/boolean/integer features and controlled tagsets | Document labels/metadata can model it | JAR or Docker | Large Java application; UI is not a drop-in component | Technically complete, operationally excessive for one owner and 40 cases |
| [brat](https://github.com/nlplab/brat) | Yes | Types, attributes and notes exist, but extending the older CGI-oriented UI is costly | Must customize | Local CGI server | Old application architecture, not an embeddable modern package | Useful precedent, not a new foundation |
| [Universal Data Tool](https://github.com/UniversalDataTool/universal-data-tool) | Yes for NER | Its composite/data-entry interfaces may approximate the form | Can be composed | Web, desktop or Docker | React integration is advertised, but the dedicated [`react-nlp-annotate`](https://github.com/UniversalDataTool/react-nlp-annotate) component has seen little recent development | Broader but less focused and less active than Recogito |

### Potato

Potato is the closest complete off-the-shelf workflow. It supports text and dialogue span targets, radio/select/free-text schemes, conditional forms, triage, assignment, adjudication, and JSON-family exports. The current docs show that text and dialogue fields can be span targets and that schemes can be combined on one page: [instance display and span targets](https://github.com/davidjurgens/potato/blob/master/docs/annotation-types/instance_display.md), [dialogue annotation](https://github.com/davidjurgens/potato/blob/master/docs/annotation-types/structured/dialogue_annotation.md), and the [project overview](https://github.com/davidjurgens/potato#annotation-schemes).

However, its basic span object is still primarily a quote/offset/label. A separate free-text scheme is record-level rather than intrinsically coupled to each span. Meeting our exact entry-card interaction would therefore require a custom Potato annotation type or custom layout. At that point, embedding Recogito in our small manifest-native page is the shallower change. Potato's GPL-3.0 license also matters if we copy or distribute modified code; consuming its behavior as a separately hosted tool is a different boundary.

Potato does ship an MCP server, but it is **not an MCP App**. Its official [MCP server documentation](https://github.com/davidjurgens/potato/blob/master/docs/tools/mcp_server.md) describes tools for task authoring, screenshots, status, item access, annotation submission and export. It does not register a `ui://` resource or MCP App View. Its support for importing `mcp` traces is likewise a trace format, not an inline UI.

### Argilla

Argilla supports exactly selected text plus a controlled label through `SpanQuestion`, and it separately supports free-text questions, suggestions, drafts, discard and review queues. These features are documented in [question types](https://docs.argilla.io/latest/reference/argilla/settings/questions/), [the annotation workflow](https://github.com/argilla-io/argilla/blob/develop/docs/_source/practical_guides/annotate_dataset.md), and [suggestions/records](https://github.com/argilla-io/argilla/blob/develop/docs/_source/practical_guides/create_update_dataset/records.md).

The mismatch is structural: a span response is a list of `{start, end, label}` values while a `TextQuestion` produces a separate response. It does not naturally render a repeatable entry card where every selected span owns canonical text and topics. In addition, the maintainers state that the mature codebase is now focused on fixes and patches rather than new features, so a workflow-specific UI extension is a poor bet; see the notice in the [official repository](https://github.com/argilla-io/argilla).

### doccano

doccano is easy to run locally and provides collaborative sequence labeling with a REST API. Its official [README](https://github.com/doccano/doccano#usage) documents pip, Docker and Docker Compose deployment. Its [sequence-labeling tutorial](https://doccano.github.io/doccano/tutorial/) shows the exported unit as `[start, end, label]`.

That is suitable for named-entity annotation, but not our compound object without modifying the frontend and backend. Canonical text, topics, family and case disposition are not per-span fields in the native sequence-label workflow.

### INCEpTION and brat

INCEpTION can represent the domain most faithfully among full platforms. Custom span layers support character-level boundaries, and features can be controlled strings or other primitive types. It also includes curation and recommendation facilities. See the official [layers and features guide](https://inception-project.github.io/releases/42.1/docs/user-guide.html) and [local/Docker deployment guide](https://inception-project.github.io/documentation/latest/admin-guide).

That power comes with a multi-user Java application, its own project/data model and an export adapter. It is proportionate for a research annotation program, not a single-owner 40-case review queue.

brat remains a clear model for fast text-bound and relational annotation, but its local installation is based on Python CGI and conventional web-server setup. See the [official repository](https://github.com/nlplab/brat) and [installation guide](https://brat.nlplab.org/installation.html). Its architecture and activity make it a poor component source for a new MCP-hosted interface.

### Universal Data Tool

Universal Data Tool supports text classification, named-entity recognition, data entry and composite interfaces, and its repository says it can be integrated into a React application. It can run as a web/desktop app or in Docker; see the [official repository](https://github.com/UniversalDataTool/universal-data-tool) and [UDT format](https://github.com/UniversalDataTool/udt-format).

Its reusable NLP component is [`react-nlp-annotate`](https://github.com/UniversalDataTool/react-nlp-annotate), but that component was substantially less active than Recogito at review time. UDT therefore offers more surface area and less confidence for the exact seam we need.

## MCP App distinction

None of the annotation projects above is currently a true MCP App. A true MCP App registers a tool linked to a `ui://` HTML resource; the host fetches that resource and renders it in a sandboxed iframe, and the View can call tools through the host. That two-part contract is defined in the official [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/) and [quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html).

An MCP server alone does not provide an inline application. Potato is the important example here: it exposes useful MCP tools, but no MCP App resource/View.

For private journal review, the thin architecture should be:

```text
model-visible launch tool
  -> ui:// journal review View
      -> Recogito span component
      -> local entry-card controls
      -> app-only load/save/finalize tools
      -> existing private manifest + validator
```

MCP Apps permit tools to be visible only to the app (`visibility: ["app"]`), while the launch tool can expose only safe counts to the model. The official [`McpUiToolMeta`](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiToolMeta.html) documents this distinction. This lets the transcript remain in the UI/tool boundary rather than becoming model-visible chat content.

## Minimal adoption plan

1. Spike Recogito in a static page using one real private draft record; do not add a database.
2. Map each annotation to `{evidence, type, text, topics}` and verify emoji, punctuation, multiline transcripts, overlapping selections and reload stability.
3. Add `No durable entry`, save/next, back, undo, and hidden model-suggestion controls around it.
4. Read and write the existing private queue/manifest through a narrow local API, then run the existing finalizer unchanged.
5. Only after the local interaction feels good, package the page as an MCP App View and replace direct HTTP persistence with app-only tools.

This reuses the difficult text-selection behavior while keeping the product-specific workflow small and under our control.
