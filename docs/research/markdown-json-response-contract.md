---
type: reference
title: "Markdown JSON and rich-response contract research"
---

# Markdown JSON and rich-response contract research

Research date: 2026-10-16.

## Recommendation

Do not define a new JSON representation of Markdown. Use the standards at
their existing boundaries:

1. Use an MCP `CallToolResult` as the outer response envelope.
2. Carry the human-readable document as Markdown source with the registered
   `text/markdown` media type. Select and document one variant (CommonMark is
   the narrowest sensible default for this product).
3. Put machine-readable view data in `structuredContent` and validate it with
   the tool's JSON Schema `outputSchema`.
4. Bind a rich renderer through the MCP Apps tool metadata
   `_meta.ui.resourceUri`; keep the application HTML as a separate `ui://`
   resource. Do not put a renderer URI inside the response payload.
5. Parse Markdown to mdast only in a component that needs tree operations. If
   the response contract truly requires a JSON document tree, make a pinned
   mdast 5 `Root` the document payload, preserve its standard nodes, and extend
   it through namespaced unist `data`. Publish a project-owned JSON Schema
   generated from that pinned model and label it as a compatibility artifact:
   mdast itself does not publish a normative JSON Schema.

This replaces the repository's hand-built `presentation.kind = flow | status`
document format. Excalidraw remains an MCP App with its own bounded
`structuredContent` schema rather than becoming a Markdown AST extension.

## Why this is the least invented contract

Markdown is already registered as `text/markdown`; RFC 7763 also defines a
`variant` parameter to identify the intended Markdown dialect. It is a text
format, not a JSON data model. [RFC 7763](https://www.rfc-editor.org/info/rfc7763/)

MCP already defines the other two layers needed here:

- `content` is the interoperable fallback channel and can include an embedded
  text resource with a URI and MIME type.
- `structuredContent` is arbitrary JSON governed by the tool's
  `outputSchema`; a server must conform to that schema and clients should
  validate it. [MCP tools specification](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content)
- An MCP App is a predeclared `ui://` resource with
  `text/html;profile=mcp-app`; a tool points to it through
  `_meta.ui.resourceUri`. Unsupported hosts retain the tool's text fallback.
  [MCP Apps 2026-01-26 specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)

Therefore the product-specific surface can be limited to the JSON Schema for
the data a particular app consumes. It does not need to define another generic
document tree, app-discovery convention, or renderer transport.

## Candidate comparison

| Candidate | What is standardized | Official JSON Schema? | Extension model | Fit here |
|---|---|---:|---|---|
| `text/markdown` + CommonMark | Markdown media type and a precise Markdown syntax/conformance suite | Not applicable; the value is text | Markdown dialects and extensions | Best canonical human-readable document and fallback |
| mdast 5 + unist 3 | A Markdown AST in Web-IDL-like form; unist requires values to round-trip through JSON | No normative schema published by the specifications; official consumable types are `@types/mdast` and `@types/unist` | Typed nodes, unist `data`, and separately specified mdast extensions | Best optional internal AST, not the outer wire protocol |
| CommonMark reference AST | CommonMark defines syntax and reference parsers expose trees; the project publishes an XML DTD | No normative JSON AST/schema | Reference implementation node APIs and custom XML nodes | Good parser conformance target; poor JSON contract |
| Pandoc JSON AST | A broad document interchange AST with `pandoc-api-version`; the format is defined by `Text.Pandoc.Definition` | No official JSON Schema identified; the Haskell data types are authoritative | `RawBlock`, `RawInline`, filters, and Pandoc extensions | Excellent conversion IR, but much broader and heavier than this product needs |
| Markdoc | Markdown-based authoring framework with custom tag/node schemas, validation, transform, and a serializable render tree | Its “schemas” are runtime configuration objects, not a standard JSON Schema for the wire AST | Custom tags/nodes and transform functions | Useful if Markdoc becomes the authoring language; not a neutral response protocol |
| MCP content + Apps | Protocol messages, content blocks, tool `outputSchema`, `structuredContent`, app resources, and renderer linkage | Yes; MCP generates JSON Schema from its TypeScript source of truth | Tool schemas, namespaced `_meta`, content blocks, and optional negotiated extensions | Best outer contract and rich-view boundary |

### mdast/unist

mdast explicitly defines a Markdown AST and extends unist. The released mdast
specification describes node content models such as flow and phrasing content,
and directs TypeScript users to `@types/mdast`.
[mdast 5 specification](https://github.com/syntax-tree/mdast/blob/5.0.0/readme.md)

unist is deliberately a base tree model, not a self-sufficient Markdown
schema. It defines `type`, optional `data`, optional source `position`, and JSON
round-trippability. Ecosystems may extend `data`, and language-specific
specifications add node fields. [unist 3 specification](https://github.com/syntax-tree/unist/blob/3.0.0/readme.md)

The official parser and serializer support explicit extensions in both
directions, including GFM, directives, math, and MDX. This makes mdast the best
choice if this repository later needs syntax-aware search, transformation, or
editing. [mdast parser](https://github.com/syntax-tree/mdast-util-from-markdown),
[mdast serializer](https://github.com/syntax-tree/mdast-util-to-markdown)

It is not necessary merely to render Markdown. Sending both Markdown source
and an AST would create two potentially divergent sources of truth.

### CommonMark ASTs

CommonMark standardizes Markdown parsing behavior through its specification
and examples. The specification describes a two-phase tree-building strategy,
but does not prescribe a JSON serialization.
[CommonMark specification](https://spec.commonmark.org/current/)

The reference JavaScript implementation exposes node objects and an XML
renderer. The CommonMark project maintains a DTD for that XML representation,
not a JSON Schema. [commonmark.js](https://github.com/commonmark/commonmark.js),
[CommonMark DTD](https://github.com/commonmark/commonmark-spec/blob/master/CommonMark.dtd)

Consequently, “CommonMark JSON AST” would still require this project to choose
and maintain a serialization.

### Pandoc JSON AST

Pandoc JSON filters consume and produce a JSON representation of Pandoc's AST.
Pandoc states that the AST format itself is defined in
`Text.Pandoc.Definition`; a document contains metadata and blocks, with nested
inline elements. [Pandoc filters](https://pandoc.org/filters.html),
[pandoc-types](https://github.com/jgm/pandoc-types)

This is a mature interchange format when conversion among Markdown, DOCX,
LaTeX, and many other formats is a requirement. For a voice response UI it
adds a large document algebra and Pandoc API-version coupling without solving
MCP App selection or app data validation.

### Markdoc

Markdoc parses source into an AST, validates against configured node/tag
schemas, transforms it into a serializable render tree, and then renders it.
[Markdoc render phases](https://markdoc.dev/docs/render),
[Markdoc nodes](https://markdoc.dev/docs/nodes),
[Markdoc validation](https://markdoc.dev/docs/validation)

Those schemas define an authoring and rendering framework: allowed children,
attributes, transforms, and validation callbacks. They are not an official
JSON Schema for generic Markdown interchange. Markdoc is appropriate only if
the product intentionally adopts Markdoc syntax and runtime semantics.

### MCP content, structured content, and Apps

MCP's full protocol schema is defined in TypeScript and accompanied by a
generated JSON Schema. The default validation dialect is JSON Schema 2020-12.
[MCP schema rules](https://modelcontextprotocol.io/specification/draft/basic#schema),
[MCP Apps generated schema](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/generated/schema.json)

For tool results, `structuredContent` may contain any JSON value allowed by
the declared `outputSchema`. The specification requires conforming server
output and recommends client validation. It also recommends a text content
fallback for compatibility.
[MCP structured content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content)

MCP Apps separates static executable UI from dynamic data: the tool metadata
references a `ui://` HTML resource, while the tool result supplies content and
structured data. This separation improves caching, inspection, and sandbox
policy review. [MCP Apps resource discovery](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#resource-discovery)

## Proposed target shape

The following is illustrative MCP, not a new protocol:

```json
{
  "content": [
    {
      "type": "text",
      "text": "The deployment is healthy."
    },
    {
      "type": "resource",
      "resource": {
        "uri": "urn:pi-response:019d...",
        "mimeType": "text/markdown; charset=UTF-8; variant=CommonMark",
        "text": "## Deployment\n\nAll services are healthy."
      }
    }
  ],
  "structuredContent": {
    "spoken": "The deployment is healthy.",
    "title": "Deployment",
    "nodes": [
      { "id": "edge", "label": "Voice edge", "state": "healthy" }
    ],
    "edges": []
  }
}
```

The tool definition, not this result, carries the renderer binding:

```json
{
  "name": "show_voice_status",
  "inputSchema": { "type": "object", "properties": {} },
  "outputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["spoken", "title", "nodes", "edges"],
    "properties": {
      "spoken": { "type": "string", "maxLength": 2000 },
      "title": { "type": "string", "maxLength": 160 },
      "nodes": { "type": "array", "maxItems": 24 },
      "edges": { "type": "array", "maxItems": 48 }
    },
    "additionalProperties": false
  },
  "_meta": {
    "ui": {
      "resourceUri": "ui://voice-canvas/main",
      "visibility": ["model", "app"]
    }
  }
}
```

For Excalidraw, use a separate tool with its own `outputSchema` and
`ui://excalidraw/mcp-app.html`. If one tool must render several modes, use one
fixed shell app URI and a discriminated union in `structuredContent`; dynamic
per-result `resourceUri` selection is not the MCP Apps contract.

## Repository implications

The current implementation duplicates a private response model across:

- `products/voice-agent/apps/edge/presentation_response.py`
- `products/voice-agent/packages/tasking/src/voice_agent/tasking/application/pi_response.py`
- `products/voice-agent/apps/client/lib/models.dart`
- `products/voice-agent/apps/edge/SYSTEM.md`

It also selects `resourceUri` from `presentation.kind` after model generation.
That works inside this custom host, but it is not how MCP Apps discovers a UI.

A migration should therefore:

1. Define actual MCP tools for the plain/status view and Excalidraw view.
2. Give each tool a JSON Schema 2020-12 `outputSchema` and a static
   `_meta.ui.resourceUri`.
3. Make Markdown the full textual response and keep `spoken` as the bounded
   TTS projection in `structuredContent`.
4. Keep a `content` text fallback and, when preserving Markdown's media type
   matters, an embedded `text/markdown` resource.
5. Remove the generic `flow | status | excalidraw` parser only after the edge,
   task worker, gateway, and Flutter host accept the MCP result shape.
6. Add mdast only when a concrete syntax-tree consumer exists; do not require
   the LLM to generate mdast JSON.

## Decision summary

The proper reusable foundation is **MCP JSON Schema + `text/markdown`**. When a
JSON tree is a real requirement, the inner document contract should extend
**mdast 5/unist 3**, not define new Markdown node types from scratch. There is
no official mdast JSON Schema to import, so the repository would still own the
generated validation artifact and its versioning. Pandoc and Markdoc solve
broader, different problems.

This split lets the repository extend only the product data that is genuinely
specific—voice projection and view payloads—while reusing existing standards
for documents, protocol framing, validation, and embedded applications.
