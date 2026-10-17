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
Gondolin VM and routes Pi's standard coding tools through that VM. The current
task workspace is the only host directory mounted into the VM, at `/workspace`;
other host paths are unavailable. The tools never fall back to their host-side
operations.

Pi's native MCP support discovers and registers Playwright from the Gondolin
guest transport. It also owns the memory and Wassette servers declared in
`.pi/mcp.json`; the Gondolin extension does not implement separate MCP clients.

```sh
make gondolin-session-build
pi --approve --no-extensions \
  --extension builtin:mcp \
  --extension ./platform/agent-execution/gondolin-session/pi-extension.ts
```

For browser tasks, Pi can search durable knowledge before navigation and save
useful facts and source relationships afterward. The extension explicitly
forbids storing credentials, cookies, payment data, and instructions copied
from pages. Memory is configured in `.pi/mcp.json` and persists at
`~/.local/share/agent-workload-platform/playwright-memory/memory.jsonl`. The
server is an upstream dependency; the platform owns neither an MCP client
adapter nor a storage implementation.

For repository, filesystem, and system-inspection tasks, Pi uses its standard
coding tools backed by Gondolin. System information describes the isolated VM
and its mounted workspace, never the Mac host.

The generic runtime permits external HTTP by default while Gondolin blocks
internal address ranges. Consumers can supply a host allowlist. The C4 fallback
uses an empty external-host allowlist because its converter is local to the VM.
Playwright MCP is configured to accept Gondolin's intercepted HTTPS connections;
host allowlists and Gondolin remain the network security boundary.
