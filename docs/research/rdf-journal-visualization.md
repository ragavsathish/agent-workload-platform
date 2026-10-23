# RDF and visualization for the cognitive journal

**Status:** Research and design recommendation
**Scope:** How to visualize the Oxigraph-backed journal in the existing review MCP app; no UI changes are made here.

## Recommendation

Use Oxigraph as the authoritative RDF store, query a bounded journal slice with SPARQL, and present the result as a **topic-filtered journal timeline/list inside the existing MCP review app**. Keep a graph explorer as an optional developer/diagnostic view for selected RDF subgraphs. A force-directed RDF graph should not be the default journal interface.

The user task is to find, understand, and review journal notes. A topic is currently stored as a literal keyword, not as a first-class concept with explicit semantic links. Drawing every RDF term as a node would therefore add graph mechanics without adding useful topic meaning. A topic index plus dated notes makes the actual retrieval path visible and keeps transcript evidence and review controls together.

## What the code stores today

`captureCognitiveJournal` extracts entries with a type, text, up to eight topic strings, and an evidence quote. The writer persists each capture and its entries in the named graph `urn:awp:digital-twin:graph:journal`:

- A capture is a `schema:Message` with `schema:identifier`, `schema:text`, and `schema:dateSent`.
- An entry is a `schema:CreativeWork` with `schema:additionalType`, `schema:text`, `schema:dateCreated`, and `schema:isBasedOn` pointing to its capture.
- Each topic string is stored as a `schema:keywords` literal.
- The named graph separates the journal dataset from other RDF data.

See [`cognitive-journal.ts`](../../products/voice-agent/apps/pi-agent/digital-twin/runtime/cognitive-journal.ts) and [`journal_annotation_export.clj`](../../products/voice-agent/apps/pi-agent/digital-twin/eval/journal_annotation_export.clj).

The journal-review MCP app accepts a bounded array of entries as JSON, including a `topics: string[]` field, and owns the in-memory review queue and navigation. The Pi prompt currently says to send `topics: []`; that discards persisted `schema:keywords` before the UI sees them. The data is available for topic filtering once the read query and mapping pass it through. See [`APPEND_SYSTEM.md`](../../products/voice-agent/apps/pi-agent/voice-agent/prompts/journal-review/APPEND_SYSTEM.md) and [`server.ts`](../../products/voice-agent/apps/journal-review-mcp/src/server.ts).

## RDF visualization versus journal visualization

RDF models a graph as subject–predicate–object triples; an RDF dataset can contain a default graph and named graphs ([RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/)). That model is useful for linking a journal entry to its source capture, representing typed values, and querying connections. It does not dictate that the end-user interface must draw every triple as a node and edge.

| View | Best fit | Fit for this journal |
| --- | --- | --- |
| Topic-filtered timeline/list | Find a note by subject or time; read and review source evidence | **Recommended default.** Topics are currently plain keyword literals, and notes have capture timestamps and source links. |
| RDF graph explorer | Inspect resource relationships, ontology structure, provenance paths, or malformed data | Useful as an optional diagnostic view, especially for a selected note and its capture. Poor default for reading many long transcript/note literals. |
| Taxonomy/tree | Browse explicitly curated parent/child concepts | Not yet supported by the data: there are no stable topic resources or broader/narrower relations. |
| Topic co-occurrence map | Discover which subjects tend to appear together | A later aggregate view; derive edges from notes that share multiple topic labels, label it as co-occurrence, and do not imply causal or hierarchical semantics. |

### Recommended interaction model

1. Show a topic index/facet with counts and an explicit **All notes** and **Untagged** option.
2. Selecting a topic filters the date-ordered note list. A note with several topics can appear under each topic, but it retains one stable entry ID and one review outcome.
3. Keep the current note’s full source transcript, exact evidence selection, and Previous/Next review controls available from the list selection.
4. Show topic strings as editable/reviewable tags only if the review contract persists those changes. Otherwise show them as extracted labels, not as committed taxonomy assignments.
5. Keep a global queue progress indicator. Topic filtering should not silently redefine the total number of reviewed queue items; if progress is filter-scoped, label it explicitly.
6. Preserve notes with no keywords under **Untagged** rather than dropping them from topic navigation.

The current `navigate_review` API navigates a single queue by position. If topic filtering is added, define whether Previous/Next means the global queue or the filtered result; the least surprising model is that changing the topic filter establishes an explicit filtered queue, while progress communicates its scope.

## Standards and vocabularies

### RDF datasets and SPARQL

Use the existing named graph boundary in every journal read query. Named graphs are part of RDF Dataset organization, and SPARQL is the standard query language and HTTP protocol for sending queries to a processing service ([RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/), [SPARQL 1.1 Protocol](https://www.w3.org/TR/sparql11-protocol/)). The current project calls Oxigraph’s `/query` endpoint using SPARQL and JSON results; continue returning a minimal application DTO to the MCP app instead of exposing the store endpoint to browser code.

Example bounded query for an entry, its topic strings, and its source transcript:

```sparql
PREFIX schema: <https://schema.org/>

SELECT ?entry ?kind ?text ?createdAt ?topic ?capture ?transcript WHERE {
  GRAPH <urn:awp:digital-twin:graph:journal> {
    ?entry a schema:CreativeWork ;
      schema:additionalType ?kind ;
      schema:text ?text ;
      schema:dateCreated ?createdAt ;
      schema:isBasedOn ?capture .
    ?capture a schema:Message ; schema:text ?transcript .
    OPTIONAL { ?entry schema:keywords ?topic }
  }
}
ORDER BY DESC(?createdAt) DESC(?entry) ?topic
LIMIT 200
```

Rows are one-per-entry-topic (and one row for entries with no keyword). Group rows by `?entry` in the application layer, deduplicate topic values, then pass each entry once into the MCP queue. Do not let the SPARQL join multiply queue items. Keep identifiers stable and preserve exact source transcript text for evidence offsets.

For a topic count index, aggregate separately so a multi-topic entry contributes once to each of its topic counts:

```sparql
PREFIX schema: <https://schema.org/>

SELECT ?topic (COUNT(DISTINCT ?entry) AS ?entryCount) WHERE {
  GRAPH <urn:awp:digital-twin:graph:journal> {
    ?entry a schema:CreativeWork ; schema:keywords ?topic .
  }
}
GROUP BY ?topic
ORDER BY DESC(?entryCount) LCASE(STR(?topic))
```

The app should scope both queries to the private journal graph and apply a sensible limit/time window. Return topic counts and entry DTOs through the trusted Pi/MCP path; do not let a browser-supplied SPARQL query execute against the private store.

### Schema.org keywords and SKOS

The existing `schema:keywords` values are strings. Schema.org defines `keywords` as keywords or tags associated with a Thing, which fits lightweight extracted labels, but does not by itself give those labels stable identity, hierarchy, or controlled-vocabulary semantics ([Schema.org `keywords`](https://schema.org/keywords)). Treat the current values as **facets/tags**, not as canonical concepts. Normalize whitespace/case for duplicate counting and filtering at the presentation boundary only; do not rewrite original RDF values without an explicit migration policy.

If the product later needs curated topic identity, aliases, language-specific preferred labels, synonyms, or parent/child browsing, SKOS is a fitting standard. SKOS models URI-identified concepts and concept schemes, labels such as `skos:prefLabel`/`skos:altLabel`, and semantic relations such as `skos:broader`, `skos:narrower`, and `skos:related` ([SKOS Primer](https://www.w3.org/TR/skos-primer/), [SKOS Reference](https://www.w3.org/TR/skos-reference/)). Convert a free-text label to a SKOS concept only through explicit curation or a reviewable concept-mapping step; do not infer a hierarchy from co-occurrence or string similarity.

### SHACL, PROV-O, and VoID

- **SHACL:** use for RDF shape validation, not as the visualization model. The W3C SHACL Recommendation validates data graphs against shapes; it also notes that shapes can support UI building and integration ([SHACL](https://www.w3.org/TR/shacl/)). The repository’s ontology notes already describe SHACL validation. Shapes can document required entry fields, cardinalities, datatypes, and source relationships; they do not make a graph visualization automatically user-friendly.
- **PROV-O:** useful if the journal needs interoperable provenance beyond its current `schema:isBasedOn` link—for example, modeling an extraction/review activity, its generated entry, and the responsible agent. PROV-O defines reusable `prov:Entity`, `prov:Activity`, and `prov:Agent` classes and provenance relations ([PROV-O](https://www.w3.org/TR/prov-o/)). Do not add it just to render the existing transcript link; current Schema.org relationships are enough for this UI.
- **VoID:** intended for metadata about RDF datasets, including structural and access descriptions ([VoID](https://www.w3.org/TR/void/)). It could describe dataset-level statistics or a SPARQL endpoint for a published dataset, but the private local journal does not need VoID to drive its topic view.

## Renderer options

| Option | Strengths from first-party documentation | Recommendation |
| --- | --- | --- |
| No graph library for the journal list | Uses the MCP app’s existing HTML/CSS and queue components; easiest way to preserve evidence review and accessibility semantics | **Use for the default journal/topics experience.** |
| Cytoscape.js | Browser graph theory/visualization library, supports directed graphs, labels, selectors, layouts, touch interaction, and headless analysis ([docs](https://js.cytoscape.org/)) | Consider only for an optional selected-subgraph explorer. Map RDF IRIs to stable node IDs and predicates to labeled directed edges; render literals as terminal nodes or side-panel properties. |
| vis-network | Canvas network view with styles, physics/layout and clustering; documentation says it works smoothly for a few thousand nodes/edges ([docs](https://visjs.github.io/vis-network/docs/network/)) | Lightweight alternative for a quick exploratory network, but would still need RDF-to-node/edge mapping and careful graph-size controls. |

Neither library is an RDF data model or SPARQL client. Both take node/edge structures; an adapter must decide how RDF subjects, predicates, objects, named graphs, and literal values map to those structures. Keep the RDF query and privacy boundary in the existing host-side Pi service; send only the selected, bounded subgraph to a renderer.

## Suggested implementation sequence

1. Update the journal review query/prompt to return `schema:keywords` and group SPARQL rows by entry ID so each suggestion appears once.
2. Add a topic facet/index and filtered note list to the current MCP app, preserving one queue state per entry and making filter/progress scope clear.
3. Add explicit handling for empty topics, duplicate labels, and entries matching multiple topics. Verify exact evidence offsets still refer to the original transcript.
4. Use a read-only SPARQL query through the existing host integration; avoid exposing raw store access or a general-purpose query editor in the end-user app.
5. Add a graph explorer only when a concrete debugging or relationship-discovery task justifies it. Start from one selected note and show its capture/provenance neighborhood, rather than loading the whole journal graph.
6. If topics become a managed taxonomy, introduce SKOS concept resources and mapping/review policy before designing a hierarchy view.

## Sources

- [RDF 1.1 Concepts and Abstract Syntax](https://www.w3.org/TR/rdf11-concepts/) — RDF graph and dataset model.
- [SPARQL 1.1 Protocol](https://www.w3.org/TR/sparql11-protocol/) — HTTP query transport and result return.
- [Schema.org `keywords`](https://schema.org/keywords) — existing keyword/tag field semantics.
- [SKOS Primer](https://www.w3.org/TR/skos-primer/) and [SKOS Reference](https://www.w3.org/TR/skos-reference/) — concept schemes, labels, and semantic relations.
- [SHACL Recommendation](https://www.w3.org/TR/shacl/) — RDF graph constraints and their uses.
- [PROV-O Recommendation](https://www.w3.org/TR/prov-o/) — interoperable provenance model.
- [VoID vocabulary](https://www.w3.org/TR/void/) — metadata for RDF datasets.
- [Cytoscape.js documentation](https://js.cytoscape.org/) and [vis-network documentation](https://visjs.github.io/vis-network/docs/network/) — browser graph rendering and interaction.
- Repository implementation: [`cognitive-journal.ts`](../../products/voice-agent/apps/pi-agent/digital-twin/runtime/cognitive-journal.ts), [`journal_annotation_export.clj`](../../products/voice-agent/apps/pi-agent/digital-twin/eval/journal_annotation_export.clj), [`APPEND_SYSTEM.md`](../../products/voice-agent/apps/pi-agent/voice-agent/prompts/journal-review/APPEND_SYSTEM.md), [`journal-review MCP server`](../../products/voice-agent/apps/journal-review-mcp/src/server.ts), and [`ontology-research.md`](../../products/voice-agent/apps/pi-agent/digital-twin/docs/ontology-research.md).
