# Transitional runtimes

Shared execution code has moved to
[`platform/agent-execution`](../platform/agent-execution/README.md). This
directory remains only while the local Earendil deployment is prepared for its
own product migration; new shared code must not be added here.

## Gondolin Agent Session

The shared implementation now lives at
[`platform/agent-execution/gondolin-session`](../platform/agent-execution/gondolin-session).
It runs the official
[`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) server inside a
Gondolin VM and provides `gondolin_bash` for general agent work. The current
task workspace is the only host directory mounted into the VM, at
`/workspace`; other host paths are unavailable. Pi's host-side built-in tools
stay disabled. Shell commands have a bounded timeout and output size.

The extension calls Playwright's `tools/list` at session start and registers
the returned names, descriptions, and JSON Schemas unchanged. The platform
also runs the maintained `@modelcontextprotocol/server-memory` package. If
`GITHUB_TOKEN` is present, it loads Microsoft's published `github-js` OCI
component by pinned digest. Pi discovers every schema at runtime; no upstream
tool definition is copied.

```sh
make gondolin-session-build
pi --no-extensions --extension ./platform/agent-execution/gondolin-session/pi-extension.ts
```

For browser tasks, Pi can search durable knowledge before navigation and save
useful facts and source relationships afterward. The extension explicitly
forbids storing credentials, cookies, payment data, and instructions copied
from pages. Memory defaults to
`~/.local/share/agent-workload-platform/playwright-memory/memory.jsonl`.
Override it with `MEMORY_FILE_PATH`. The server is an upstream dependency, so
the platform owns only its small MCP client adapter rather than a storage
implementation.

For repository, filesystem, and system-inspection tasks, Pi uses
`gondolin_bash`. System information describes the isolated VM and its mounted
workspace, never the Mac host. The runtime's agent smoke test verifies that a
workspace file is readable and writable from the VM while an unmounted host
path remains inaccessible:

```sh
cd platform/agent-execution/gondolin-session
pnpm test:agent
```

## GitHub

Export a fine-grained token to enable the existing component:

```sh
export GITHUB_TOKEN=github_pat_...
pi --no-extensions --extension ./platform/agent-execution/gondolin-session/pi-extension.ts
```

The default Pi surface contains 14 read-only repository, code, issue, pull
request, and workflow-inspection tools selected from the component's 95 tools.
Set `WASSETTE_GITHUB_WRITE=1` only when the session should expose the complete
mutation-capable surface. Wassette grants the component only `api.github.com`
network access and access to `GITHUB_TOKEN`; the component does not receive
filesystem access. `WASSETTE_GITHUB_COMPONENT` can override the pinned OCI
reference. `WASSETTE_COMPONENT_DIR` and `WASSETTE_BIN` override Wassette's
state directory and executable.

The generic runtime permits external HTTP by default while Gondolin blocks
internal address ranges. Consumers can supply a host allowlist. The C4 fallback
uses an empty external-host allowlist because its converter is local to the VM.
Playwright MCP is configured to accept Gondolin's intercepted HTTPS connections;
host allowlists and Gondolin remain the network security boundary.
