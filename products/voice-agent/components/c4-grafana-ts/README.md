# C4 to Grafana Wassette component

This TypeScript WebAssembly component compiles authoritative Mermaid C4 sources into a Grafana
dashboard JSON document. It accepts typed diagram, evidence, and activity records through WIT and is
discoverable by the Pi voice orchestrator through Wassette.

The component is deliberately capability-free: it cannot read the repository, write the generated
dashboard, contact Grafana, query Prometheus, read environment variables, or execute processes. The
caller reads the source files, calls `compile-dashboard`, validates the returned JSON, and chooses
where to save or provision it. Grafana renders Mermaid through the pinned Grafmaid panel and executes
the generated PromQL queries.

Build, test, and install it into the voice orchestrator's component directory:

```bash
make -C products/voice-agent/components/c4-grafana-ts check
make -C products/voice-agent/components/c4-grafana-ts install
```

After installation, Pi discovers the tool lazily through `tool_search`. It can also be inspected or
called directly:

```bash
component_dir="$HOME/Library/Application Support/PipecatEdge/wassette-components"
wassette tool read --component-dir "$component_dir" compile-dashboard
wassette tool invoke --component-dir "$component_dir" compile-dashboard --args '{
  "options": {
    "dashboard-title": "Architecture",
    "dashboard-uid": "architecture-c4",
    "description": "Generated C4 dashboard",
    "refresh": "10s",
    "time-from": "now-15m",
    "evidence-markdown": ""
  },
  "diagrams": [{
    "id": "context",
    "title": "C1 Context",
    "mermaid": "flowchart LR\nA[User] --> B[System]",
    "width": 24,
    "height": 14
  }],
  "evidence": [],
  "activity": []
}'
```

The build uses pinned `jco`, `componentize-js`, and TypeScript versions from `package-lock.json`.
It also pins `wit-docs-inject` by Git revision so Wassette exposes the WIT documentation to agents.
Generated files, dependencies, and the `.wasm` artifact are ignored. The checked-in TypeScript,
lockfile, WIT contract, pinned builder image, and pinned documentation injector are the build inputs.

The repository build adapter in `deploy/observability/generate-c4-heatmap.mjs` reads the source files,
invokes this component through a temporary Wassette component directory, validates the returned
dashboard, and writes the provisioned JSON. The same component remains available to agents through
the persistent Wassette directory. Neither use grants the WebAssembly component filesystem or
Grafana credentials.

Each activity overlay must use a unique, single-letter Grafana `ref-id` (`A` through `Z`) within its
diagram. Put the actual OpenTelemetry service name, such as `voice-edge` or `agent-gateway`, in
`service-name`; descriptive values such as `voice_edge` are rejected before dashboard compilation.
