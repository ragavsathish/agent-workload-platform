# UX research: browsing a digital-twin knowledge base

**Status:** Research and product-design recommendation
**Date:** 2026-10-23
**Scope:** A standalone, local-first journal and knowledge explorer backed by the project's Oxigraph RDF store. This is a design and data-model assessment; no UI changes are made here.

## Recommendation

Build one standalone **Journal & Knowledge** page with two synchronized ways to browse the same bounded result set:

1. **Journal** (the default): searchable, filterable entries in a date-grouped chronological timeline, with a selected-entry detail view showing the complete note, its source capture, topic tags, type, and provenance.
2. **Map** (a secondary exploration mode): a Cytoscape view of a small, purposeful projection—journal entries, source captures, and topic-tag groupings—linked to the same journal and detail selection.

Make the timeline and source text the reliable way to read and navigate. Use the map to discover local relationships and move between related notes; do not make the map the only way to access content. Keep a visible **Journal / Map** mode switch and a persistent details pane. Put search and one **Filter** control in the journal toolbar, then show active filters as removable chips next to the results. Selecting a note, tag, or source in either view should update the other views and announce the selection. This follows coordinated-view interaction patterns while treating the graph as an optional exploration aid, not as the journal itself. [Roberts, *Exploratory visualization with multiple linked views*](https://www.cs.kent.ac.uk/pubs/2004/1822/); [Neo4j Bloom product docs](https://neo4j.com/docs/bloom-user-guide/current/about-bloom/).

The graph should start from a selected note or topic and show its nearby relationships, not load every RDF triple or transcript literal. Show relationship labels and clear provenance paths. Use the term **tag** for current `schema:keywords` values; do not display them as a hierarchy or claim that they are curated concepts. Add a SKOS taxonomy view only after stable concept identifiers and reviewed semantic relationships exist. [Schema.org `keywords`](https://schema.org/keywords); [W3C SKOS Primer](https://www.w3.org/TR/skos-primer/).

## What the repository currently represents

The journal extraction accepts up to 12 entries per capture. Each entry contains a type, text, up to eight topic strings, and an evidence quote. Before writing, code verifies that the quote appears in the transcript and applies grounding checks; then it removes `evidenceQuote` from the `JournalEntry` type. The RDF writer stores the capture as a `schema:Message` and the note as a `schema:CreativeWork`, with `schema:isBasedOn` linking the note to its source capture. It stores the note type, text, creation timestamp, and each topic as a `schema:keywords` literal. It does not currently persist the exact evidence quote, an extractor/model identifier, an extraction confidence, or a review outcome. [Repository: `cognitive-journal.ts`](../../products/voice-agent/apps/pi-agent/digital-twin/runtime/cognitive-journal.ts).

The journal graph is a named graph, `urn:awp:digital-twin:graph:journal`; the Pi configuration points to a local Oxigraph endpoint, and the journal-review system prompt uses a bounded read-only SPARQL query ordered by date. The prompt currently maps `topics` to an empty array, although the export implementation reads `schema:keywords`; therefore, topic display is not yet wired through the live review request. [Repository: `voice-config.ts`](../../products/voice-agent/apps/pi-agent/voice-agent/voice-config.ts), [`APPEND_SYSTEM.md`](../../products/voice-agent/apps/pi-agent/voice-agent/prompts/journal-review/APPEND_SYSTEM.md), [`journal_annotation_export.clj`](../../products/voice-agent/apps/pi-agent/digital-twin/eval/journal_annotation_export.clj). RDF datasets can contain named graphs, but RDF itself does not prescribe a user-interface presentation for them. [W3C RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/).

The MCP review queue has optional confidence and evidence presentation fields, plus per-item outcomes. These are presentation/queue fields, not persisted journal RDF properties. The server stores queues in a process-local `Map`, so review outcomes are transient across server restarts unless another persistence path is added. The existing review interface can validate a supplied quote against transcript offsets, but an evidence quote must be supplied to it. [Repository: `journal-review MCP server`](../../products/voice-agent/apps/journal-review-mcp/src/server.ts), [`journal_review_app/index.html`](../../products/voice-agent/apps/client/journal_review_app/index.html).

### Consequences for the UX

- Show **source capture** as the evidence relationship the RDF actually records. If no exact quote/anchor is available, label the transcript as the source and do not visually imply that a specific sentence was retained as the model's justification.
- Do not show a confidence meter for entries without stored, defined confidence values. Absence is **unknown**, not zero and not a low score.
- Do not portray review state as durable knowledge-base state until it is persisted. If showing an in-progress MCP queue, label its scope and session lifetime; otherwise keep review status in the review workflow and let the explorer show only stored facts.
- Do not claim a topic hierarchy. Current keywords support tag facets and co-occurrence; they do not establish parent/child meaning.

## Information architecture and interaction model

### A. Journal mode: reading first

Use an adaptable journal-and-detail layout on wide screens and a stacked layout on narrow screens:

- **Journal timeline:** all notes, newest first, grouped under date headings (for example, “Today”, “Yesterday”, then “22 October 2026”). Each row contains a short statement, time, type, a compact source indicator, and at most a small number of topic tags. Preserve stable entry identity when one note appears under multiple tags.
- **Detail pane:** show the selected note's full text, type and tags, capture date, source transcript/context, and provenance. Keep it alongside the timeline on wide screens; on narrow screens, open it as a detail view with an obvious return to the same date and scroll position. If an exact evidence span becomes a persisted field, render it inline with a “View in source” action and nearby transcript context.
- **Filter menu:** one visible `Filter` button opens a concise, user-triggered menu with clearly named groups for note type, topic, and date range. Keep “All notes” as the default; include “Untagged” only if it has practical value in the data. Search topics inside the menu when the tag list grows. Show the number of matching notes in the trigger or results header.
- **Active filters:** render selected type/topic/date criteria as removable chips adjacent to the results. Include a single “Clear all” action when any filters are active. A selected tag in the note detail can add the same topic filter and produce the same chip.

Keep search available in both modes. The Filter menu can be shared across modes, but the applied chips and result count must remain visible so users can tell when the journal/map is scoped. A tag selected in the map filters the journal to notes with that tag. Keep an **All notes** state and preserve untagged records rather than silently dropping them. A note with multiple tags remains one record and one identity; do not duplicate its stored review state just because it appears in multiple filtered views.

### A1. Date-grouped timeline and lower-clutter filtering

**Repository observation.** The current Journal mode already sorts entries newest-first and shows a date on every row, but it also shows a persistent topic rail, a separate always-visible type selector, topic tags on each card, a Journal/Map switch, and a detail pane. This duplicates filter affordances across the rail, toolbar, list, and details. The live list is a flat sequence; it does not yet provide date-group headings. [Repository: `KnowledgeBaseView.tsx`](../../products/voice-agent/apps/knowledge-base/src/KnowledgeBaseView.tsx); [repository stylesheet](../../products/voice-agent/apps/knowledge-base/src/styles.css).

**Evidence from sources.** A Microsoft Research study designed timeline visualizations specifically for retrieving queried items from personal stores: an overview showed the distribution of results over time and a detail view exposed individual results. This supports time as a useful navigation/context dimension for personal archives, though it does not prove that every journal needs a visual chart. [Ringel et al., *Milestones in Time: The Value of Landmarks in Retrieving Information from Personal Stores*](https://www.erichorvitz.com/landmark.htm). A 2025 usability study of a clinical timeline plus free-text notes found that participants valued chronological document navigation and direct access to the underlying notes; its domain and 10-physician sample limit generalization to this personal journal. [Torsvik et al., *LabVis*](https://link.springer.com/article/10.1186/s12911-025-03173-7). Apple’s search guidance recommends starting with a broad scope, allowing refinement, and using contextual filters; it describes tokens as a way to represent editable search criteria while warning that tokens can be less discoverable if used alone. [Apple Human Interface Guidelines: Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields).

For filtering, NN/g describes progressive disclosure as initially presenting a small set of important options and deferring specialized options until requested. Carbon documents popovers as a pattern for user-triggered filter menus and specifies keyboard opening, focus, and Escape behavior. NN/g also emphasizes visible indication that data is filtered. [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/); [Carbon: Disclosures](https://www.carbondesignsystem.com/building-blocks/core/patterns/disclosures); [NN/g: Data Tables—Four Major User Tasks](https://www.nngroup.com/articles/data-tables/).

**Important tension.** Carbon's filtering guidance says controls for multiple filter categories are usually placed beside or above the dataset and “should never be put within a menu or dropdown.” That is a real discoverability tradeoff for the requested single-menu treatment. [Carbon: Filtering](https://www.carbondesignsystem.com/building-blocks/core/patterns/filtering). The compact menu proposal below is therefore a product-specific hypothesis for a personal journal with a small number of filter categories, not a universal best practice. Keep the menu trigger visible and named (“Filter”, not an unlabeled icon), summarize active criteria outside it, and validate whether users can find and combine topic/type/date filters. If testing shows repeated menu-opening or poor filter discovery, move the most-used category back into a visible scope control.

**Proposed interaction and layout (inference from evidence plus the current UI).**

1. The default screen shows **Journal** as a vertical stream grouped by local calendar date. Use relative labels for the newest groups (“Today”, “Yesterday”) and a full date for older groups. Keep ordering newest first; show an entry's time in the row so same-day notes are ordered and distinguishable. Do not introduce a separate chart or timeline axis in the first iteration: date headings create temporal landmarks without spending space on a second visualization.
2. Each date heading includes a count for that day. The note remains one row even when it has several topic strings. Show the note type and source affordance; show no more than two topic tags inline, with overflow available in the detail pane. This reduces repeated label noise while retaining context.
3. The toolbar contains a broad, live-updating search field, one labeled **Filter** button with an active-count badge, and the **Journal / Map** switch. Search covers note text, transcript, source label, and topic strings, matching current behavior. Keep the result count and current scope visible.
4. The Filter menu groups controls under **Type**, **Topic**, and **Date**. Use checkboxes for multi-select topics and single-select/clearable controls for type and date range. Provide a topic search when topic count exceeds what fits comfortably. For a short, fast local query, apply on selection; preserve filter focus and scroll position while results update. NN/g notes that quick interactive filters suit exploratory use, while batch apply can suit multi-criteria or slower queries. [NN/g: User Intent Affects Filter Design](https://www.nngroup.com/articles/applying-filters/); [Carbon: Filtering](https://www.carbondesignsystem.com/building-blocks/core/patterns/filtering).
5. After the menu closes, show active filter chips immediately above the timeline, for example `Type: Idea ×`, `Topic: Privacy ×`, `Date: Last 30 days ×`, plus `Clear all`. Removing a chip updates the same state and results; the menu trigger reflects the remaining active count. Keep topic tags on note cards visually distinct from the removable applied-filter chips so a content label is not mistaken for active scope. Carbon distinguishes selectable and dismissible tags by interaction and purpose, which supports using separate semantics/affordances for these two roles. [Carbon: Tag guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/tag/guidelines).
6. The graph remains under **Map**, adjacent to the visible Journal mode. Map uses the same query, filters, selected note, and detail selection. Its scope line repeats the active count and filters; switching back to Journal restores the prior date grouping and scroll position. The graph stays secondary because its job is relationship discovery, while the timeline directly supports reading and finding a specific dated note. This hierarchy is a product inference supported by the personal-store timeline evidence and the known graph-density/accessibility constraints documented below.
7. On mobile, preserve the same order: search and Filter; active chips; Journal/Map switch; dated note stream. Open filters in a bottom sheet or full-screen panel if the grouped menu cannot be used comfortably. Keep keyboard and screen-reader support for menu, chips, and the map's equivalent HTML note list.

**Tradeoffs and validation.** Date grouping increases scanning landmarks but consumes vertical space, especially when many groups contain one note; use compact headings and avoid decorative separators or a plotted axis until task testing shows a need. Relative dates are easy to scan but age; retain a full machine-readable `time` value and show explicit dates on older groups. A single filter menu reduces persistent controls but hides choices and may make topic discovery slower; active chips improve state visibility but can themselves become cluttered with many selections. Cap visible chips and offer a `+N filters` disclosure if needed, while retaining a keyboard-accessible route to each removal. Validate with find-a-note tasks by phrase/date/topic, combined-filter tasks, opening a source, switching to Map and back, and observing restoration of scroll position. Measure task completion/time and errors with a growing dataset and keyboard/screen-reader use; adjust the menu/visible controls from observed use rather than assuming compactness is automatically clearer.

### B. Map mode: relationship discovery

Use a deliberately small graph grammar:

| Visual item | Meaning | Current RDF support |
| --- | --- | --- |
| Journal note | One `schema:CreativeWork` entry | Directly represented |
| Source capture | One `schema:Message` transcript/capture | Directly represented |
| Tag | A distinct `schema:keywords` string, promoted to a **view-only grouping node** | Tag is stored as a literal; a tag node is a visualization projection, not an RDF resource |
| `based on` edge | Note points to its source capture via `schema:isBasedOn` | Directly represented |
| `tagged with` edge | View groups a note with a normalized tag value | Derived for display from `schema:keywords`; label it as grouping by tag |

Do not create a graph node for every literal property (full transcript, note text, timestamps, confidence values). Put those readable properties in the details pane. This keeps prose readable and the visible graph focused on relationships. Add distinct edge labels and a legend; encode node kind with shape/icon as well as color.

Initial map: all nodes for a bounded period or capped result count, with tag nodes and note/source relationships. On selection, show the selected node's one-hop neighborhood; “Expand related” can add another hop behind an explicit user action. For broad tags, let users open the tag's journal list rather than flooding the canvas with every matching entry. Provide a “Reset map” action and an indication of the current scope (date range, filters, number of displayed entries). If node counts exceed the usability/performance threshold established in testing, switch to a bounded neighborhood instead of rendering a larger scene.

Neo4j Bloom's first-party documentation is a useful interaction reference: it separates graph search, exploration, inspection, and perspectives, and lets a user expand a selection, fit to selection, or dismiss unrelated nodes. Adopt those task patterns, not its Neo4j-specific search grammar or editing semantics. [Bloom features](https://neo4j.com/docs/bloom-user-guide/current/about-bloom/); [Bloom search bar and actions](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/search-bar/).

### C. Synchronized selection and navigation

Use the same stable RDF IRI or application ID for the note in SPARQL results, list rows, map nodes, deep links within the page, and the detail pane. Selecting the same note in any view should preserve the current detail and highlight the same note in the other view. Selecting a source should list all entries based on it. Selecting a tag should open a filtered list and show the relevant note/tag projection. Keep browser back/forward useful for changing mode, filters, and selected note without putting transcript text or private data into the URL.

Research on coordinated views describes selection/brushing and combined navigation as useful exploration operations, while noting that users need to understand how views are linked. Make the synchronization visible: highlight the selected item in the graph and list, and announce “Selected note …; 3 related notes” in accessible status text. [Roberts, *Exploratory visualization with multiple linked views*](https://www.cs.kent.ac.uk/pubs/2004/1822/).

## Evidence, provenance, confidence, and review

### Provenance should answer “where did this come from?”

For each note, expose a readable provenance block: **Captured on [date] → extracted from [capture/source] → this note**. If a future model records extraction activity, model, prompt/version, and review action, show these as provenance events with their timestamps and agent identity, not as a confidence badge. PROV-O's starting-point model distinguishes entities, activities, and agents, with properties such as `prov:used`, `prov:wasGeneratedBy`, and `prov:wasAssociatedWith`; it supports describing a provenance chain without conflating the generated note with its source. [W3C PROV-O](https://www.w3.org/TR/prov-o/).

Current `schema:isBasedOn` is enough to navigate from a note to its source capture. PROV-O is an optional future modeling improvement when there is a concrete need to represent extraction/revision activities and responsibility. Do not add vocabulary solely to decorate the graph. A compact source link and source text are more useful today than a dense provenance graph.

### Evidence should be exact and inspectable

A stored evidence anchor should include the exact quote plus offsets or another stable anchor into the exact source text. Verify that `transcript.slice(start, end) === quote` before displaying it; the MCP server already applies this contract to supplied evidence. If no retained anchor exists, offer the source transcript without highlighting a guessed substring. The extraction code currently checks the evidence quote against the original transcript and then discards it when creating the RDF entry. That gap means the explorer cannot reliably distinguish an exact retained citation from a substring inferred later. [Repository: `cognitive-journal.ts`](../../products/voice-agent/apps/pi-agent/digital-twin/runtime/cognitive-journal.ts); [repository: `journal-review MCP server`](../../products/voice-agent/apps/journal-review-mcp/src/server.ts).

### Confidence is a separate signal from review state

The current journal extraction contract has no confidence value. Do not infer confidence from an entry's type, whether it has a tag, model output order, or whether it passed grounding checks. If confidence is added later, persist its meaning, scale, model/version, and calibration context; present it as “model estimate” and keep human decisions as a separate state. Review outcomes should include actor/time and remain independent of extraction confidence. The existing server has outcomes (`pending`, `accepted`, `edited`, `rejected`, `missed`, `empty`) but keeps them only in memory. [Repository: `cognitive-journal.ts`](../../products/voice-agent/apps/pi-agent/digital-twin/runtime/cognitive-journal.ts); [repository: `journal-review MCP server`](../../products/voice-agent/apps/journal-review-mcp/src/server.ts).

## Tags versus a curated knowledge taxonomy

Schema.org defines `keywords` as keywords or tags associated with an item, and accepts text values. That matches the current writer: repeated literal values, not resources with identity. Use them as facets; light display normalization may group case/whitespace variants, but preserve the original literal and avoid silently changing stored values. Label any normalization explicitly if it affects result counts. [Schema.org `keywords`](https://schema.org/keywords); [repository: `cognitive-journal.ts`](../../products/voice-agent/apps/pi-agent/digital-twin/runtime/cognitive-journal.ts).

If the intended product becomes a managed concept system—with stable IDs, preferred and alternate labels, definitions, multilingual variants, or meaningful hierarchy—represent topics as reviewed `skos:Concept` resources in a named `skos:ConceptScheme`. SKOS provides `prefLabel`, `altLabel`, `definition`, `broader`, `narrower`, and `related` terms. Its hierarchy and associative edges express asserted meaning; do not infer `broader`/`narrower` from tag co-occurrence or text similarity. [W3C SKOS Primer](https://www.w3.org/TR/skos-primer/); [W3C SKOS Reference](https://www.w3.org/TR/skos-reference/).

A useful progression is: (1) retain free tags and provide filters; (2) show an optional co-occurrence view clearly labeled “tags that appear together”; (3) introduce stable SKOS concepts only when the owner needs synonym handling, definitions, or reviewed hierarchy. A co-occurrence line is an aggregation over shared notes, not an RDF assertion that one topic is semantically related to another. Keep it visually and verbally distinct from asserted RDF relations.

## Privacy and local-first boundaries

Journal data includes personal conversation text. Keep SPARQL execution in the trusted Pi/backend path and send the browser only a bounded result DTO or subgraph. Do not expose a general SPARQL editor or direct browser access to Oxigraph in the consumer-facing page. The existing prompt already asks Pi to query the named journal graph read-only, and Oxigraph is configured at a loopback endpoint; the MCP app HTML has a Content Security Policy with `connect-src 'none'`. Preserve these boundaries when introducing the page. [Repository: `APPEND_SYSTEM.md`](../../products/voice-agent/apps/pi-agent/voice-agent/prompts/journal-review/APPEND_SYSTEM.md); [`voice-config.ts`](../../products/voice-agent/apps/pi-agent/voice-agent/voice-config.ts); [`journal_review_app/index.html`](../../products/voice-agent/apps/client/journal_review_app/index.html).

Avoid sending transcript contents, search strings, node labels, and query results to third-party analytics or remote rendering services. Do not place private transcript text in shareable URLs, browser history state, telemetry, or error messages. Offer an explicit source/capture link from the note detail rather than revealing full transcripts in graph labels. These are product recommendations derived from the repository's local/private storage design; they are not capabilities guaranteed merely by using RDF or Cytoscape.

## Accessibility and inclusive interaction

Cytoscape.js is a graph theory/rendering library with canvas support; its graph elements are not automatically a complete semantic HTML reading experience. Provide equivalent access through real HTML controls and content: list/table view, search, filters, keyboard-operable selection, and a details pane. Every graph action must have a non-canvas equivalent. [Cytoscape.js documentation](https://js.cytoscape.org/); [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

At minimum:

- Meet WCAG 2.2 keyboard operation and visible-focus criteria for search, filters, list items, graph controls, and details. The map itself should support a documented keyboard sequence (move selection, open detail, expand/collapse neighborhood, zoom/reset) or be optional beside fully functional list navigation. [WCAG 2.2, 2.1.1 and 2.4.7](https://www.w3.org/TR/WCAG22/).
- Do not communicate node types, tags, review states, or selected state using color alone; pair color with shape, text, icon, or outline. [WCAG 2.2, Use of Color](https://www.w3.org/TR/WCAG22/#use-of-color).
- Give the graph a concise text summary and selected-neighborhood description, and expose a synchronized list of related nodes/edges. A static image description alone is inadequate for tasks that require exploration. Research on accessible visualizations highlights the need for navigable structure, not just an image or raw data alternative. [MIT CSAIL, Olli](https://vis.csail.mit.edu/pubs/olli/); [Microsoft Research, Chart Reader](https://www.microsoft.com/en-us/research/publication/chart-reader-accessible-visualization-experiences-designed-with-screen-reader-users/).
- Respect reduced-motion preferences; keep layout movement controlled and provide a stable option. Make text contrast, focus ring, target size, zoom controls, and responsive list/detail behavior part of QA. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## Scale and performance

A force-directed overview of the full RDF dataset will get crowded before the user's task is complete. Node-link visualization can become cluttered and can degrade on larger graphs; graph-visualization research treats visual complexity and task-specific interaction as central issues. Cytoscape's own performance guide states that cost increases with graph size, rich styles, edges, high pixel ratio, and compound nodes, and recommends simplification and viewport techniques for very large graphs. [TU Wien, survey of empirical graph-visualization complexity](https://www.cg.tuwien.ac.at/research/publications/2019/YOGHOURDJIAN2019/); [Cytoscape.js performance guide](https://js.cytoscape.org/#performance).

Use server-side SPARQL filters, a bounded date range/page size, and distinct entry grouping so a multi-tag join does not multiply note records. Return only graph elements needed for the selected scope. Add more nodes through explicit neighborhood expansion or search. Avoid running expensive force layouts after every small selection; preserve a stable layout or focus layout only on the current subgraph. Cytoscape documents selector and rendering costs and practical options such as lower pixel ratio and hiding edges during viewport interaction for very large graphs. Benchmark with realistic synthetic and real graph sizes before choosing caps; do not promise a specific universal node count. [Cytoscape.js performance guide](https://js.cytoscape.org/#performance); [repository: bounded journal query in `APPEND_SYSTEM.md`](../../products/voice-agent/apps/pi-agent/voice-agent/prompts/journal-review/APPEND_SYSTEM.md).

## Implementation recommendation

1. **Close data gaps first:** pass through stored topic literals; add a stable entry/capture DTO; persist exact evidence quote and source offsets if source highlighting is a requirement. Define whether review outcomes belong in the knowledge graph or a separate review store, and persist them before showing them as durable state.
2. **Ship the reading surface:** search, a single filter entry point with visible active chips, a date-grouped newest-first journal timeline, and a detail panel with source capture. Preserve an all-notes state and untagged entries. Keep this useful with graph rendering unavailable.
3. **Add the Cytoscape map as a second mode:** start from selected item/tag and render only notes, source captures, and virtual tag groupings. Support search, expand one hop, fit selection, clear/reset, and linked details. Keep the graph read-only.
4. **Add explicit semantics only when governed:** if taxonomy behavior is wanted, introduce SKOS concepts and an owner-reviewed mapping from strings to IDs; keep extracted tags and canonical concepts distinguishable.
5. **Validate with tasks rather than visual preference:** ask users to find a note by phrase/date/topic, inspect its source, understand why two notes appear related, and return to the full journal. Test keyboard and screen-reader paths alongside pointer interaction; measure task completion and error rates on small and larger datasets. The graph is useful only when it improves these tasks over the list.

### Proposed acceptance checks

- Every note returned by a query is discoverable in Journal mode, including untagged notes.
- Journal mode groups notes by date, remains newest-first, and retains the selected note and scroll position when switching Journal/Map or removing one filter.
- The default toolbar exposes search, one clearly labeled Filter control, and Journal/Map; active criteria are visible and individually removable without reopening the menu.
- The filter menu is keyboard operable, names its Type/Topic/Date groups, preserves focus as results update, and has a clear-all action. Validate filter discovery because one menu trades persistent visibility for reduced control clutter.
- A note appears once in the list regardless of how many topic values the SPARQL join returns.
- Selecting a note/tag/source in either mode synchronizes list, map, and detail state.
- The detail view distinguishes source capture, exact retained evidence, generated note, and any later human review decision.
- Missing confidence is rendered as “not available” or omitted, never as zero.
- A user can complete search, filtering, selection, source reading, and mode switching using keyboard and a screen reader without depending on the canvas.
- Query scope, displayed counts, and map expansion state are visible; loading a large graph never happens implicitly.
- Browser requests remain within the trusted host boundary, and transcript content does not leak through URLs or telemetry.

## Source register

### Standards and first-party technical/product documentation

- [W3C RDF 1.1 Concepts and Abstract Syntax](https://www.w3.org/TR/rdf11-concepts/) — RDF graphs and datasets, including named graphs.
- [Schema.org `keywords`](https://schema.org/keywords) — keyword/tag property and supported text values.
- [W3C SKOS Primer](https://www.w3.org/TR/skos-primer/) and [SKOS Reference](https://www.w3.org/TR/skos-reference/) — concepts, labels, and asserted hierarchical/associative relations.
- [W3C PROV-O](https://www.w3.org/TR/prov-o/) — Entity, Activity, Agent and provenance relations.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) — keyboard access, focus, color, and accessibility criteria.
- [Cytoscape.js documentation](https://js.cytoscape.org/) — graph interaction APIs and performance considerations.
- [Neo4j Bloom User Guide](https://neo4j.com/docs/bloom-user-guide/current/about-bloom/) — first-party graph exploration/search/inspection patterns used as a product reference.
- [Apple Human Interface Guidelines: Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields) — broad-to-narrow search, scope bars, contextual filtering, and token tradeoffs.
- [Carbon Design System: Filtering](https://www.carbondesignsystem.com/building-blocks/core/patterns/filtering) — single/multiple selection patterns and the discoverability guidance against putting multiple filter categories inside one menu.
- [Carbon Design System: Disclosures](https://www.carbondesignsystem.com/building-blocks/core/patterns/disclosures) — user-triggered filter popovers and keyboard interaction.
- [Carbon Design System: Tag guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/tag/guidelines) — selectable, dismissible, and read-only tag roles.

### UX and accessibility research

- [Roberts, “Exploratory visualization with multiple linked views”](https://www.cs.kent.ac.uk/pubs/2004/1822/) — coordinated exploration and linked selections/navigation.
- [Blanco, Zong & Satyanarayan, “Olli: An Extensible Visualization Library for Screen Reader Accessibility”](https://vis.csail.mit.edu/pubs/olli/) — keyboard-navigable, screen-reader-accessible structural representation.
- [Thompson et al., “Chart Reader: Accessible Visualization Experiences Designed with Screen Reader Users”](https://www.microsoft.com/en-us/research/publication/chart-reader-accessible-visualization-experiences-designed-with-screen-reader-users/) — iterative co-design and interactive reading/exploration for screen-reader users.
- [Yoghourdjian et al., “Exploring the limits of complexity: A survey of empirical studies on graph visualisation”](https://www.cg.tuwien.ac.at/research/publications/2019/YOGHOURDJIAN2019/) — empirical graph-visualization complexity research.
- [Ringel, Cutrell, Dumais & Horvitz, “Milestones in Time: The Value of Landmarks in Retrieving Information from Personal Stores”](https://www.erichorvitz.com/landmark.htm) — overview/detail timeline for retrieval from personal content.
- [Torsvik et al., “LabVis: usability testing of a prototype tool for integrating timeline graphs and clinical notes”](https://link.springer.com/article/10.1186/s12911-025-03173-7) — task-based study on chronological document navigation alongside a timeline; domain-specific evidence with a small participant sample.
- [NN/G, “Progressive Disclosure”](https://www.nngroup.com/articles/progressive-disclosure/) — rationale and criteria for keeping common actions visible while deferring less-used choices.
- [NN/G, “User Intent Affects Filter Design”](https://www.nngroup.com/articles/applying-filters/) — interactive versus batch filtering and result continuity.
- [NN/G, “Data Tables: Four Major User Tasks”](https://www.nngroup.com/articles/data-tables/) — find/filter tasks and making active filtering visible.

### Repository evidence

- [`cognitive-journal.ts`](../../products/voice-agent/apps/pi-agent/digital-twin/runtime/cognitive-journal.ts) — extractor contract, grounding, RDF writing, fields currently persisted.
- [`journal-review APPEND_SYSTEM.md`](../../products/voice-agent/apps/pi-agent/voice-agent/prompts/journal-review/APPEND_SYSTEM.md) — read-only SPARQL request and current topic/evidence mapping behavior.
- [`journal-review MCP server`](../../products/voice-agent/apps/journal-review-mcp/src/server.ts) — queue, evidence checks, optional confidence, transient outcomes.
- [`voice-config.ts`](../../products/voice-agent/apps/pi-agent/voice-agent/voice-config.ts) — Oxigraph endpoint configuration.
- [`journal_annotation_export.clj`](../../products/voice-agent/apps/pi-agent/digital-twin/eval/journal_annotation_export.clj) — export query reading topic strings and grouping entries.
- [`open-world-knowledge-c3.md`](../../products/voice-agent/apps/pi-agent/digital-twin/docs/open-world-knowledge-c3.md) — journal/open-world knowledge path and owner review boundary.
