# Gondolin Agent Session

This package supplies the Agent Session used by Pi task workers. It also
contains the separate trusted image-builder workflow.

## Runtime modules

- `pi-extension.ts` adapts Pi and owns one disposable Gondolin VM plus its
  session-scoped Capability Providers. It also validates `.pi/gondolin.json`
  and its network policy.
- `prompts/*/APPEND_SYSTEM.md` declares capability-owned runtime instructions added through Pi's named prompt section.
  The extension selects the configured skills and network layers.
- `session.ts` owns the Gondolin VM lifecycle, mounts, network hooks, metrics,
  startup commands, and the minimal guest-process MCP transport. Both the Pi
  task extension and the persistent Voice Agent use this session.
- `gondolin-operations.ts` adapts Pi's conventional file and shell operations to
  Gondolin. Listing and searching use Bash commands inside the same VM. Host
  process environment variables are deliberately not forwarded to guest shell
  commands.
- Pi's native MCP support owns memory, Wassette, and every other host MCP server
  declared in `.pi/mcp.json`. When `GONDOLIN_BROWSER_TOOLS=1`, the extension
  becomes the single MCP owner so it can attach Playwright's in-VM transport;
  it delegates config loading and every other transport to Pi. Launch that mode
  with `--no-mcp` to disable Pi's duplicate built-in MCP extension.

The `image-builder/` directory is a separate module containing its manager,
workflow, guest executor, installer, Dockerfile, Compose definition, and
architecture manifests. It produces and installs the image selected by
`.pi/gondolin.json`; it does not participate in an active Pi Agent Session.

## Lifecycle contract

1. The Pi Adapter synchronously replaces `read`, `write`, `edit`, and `bash`
   while the extension loads. No process or VM starts during this step.
2. `session_start` starts the Agent Session and discovers enabled Capability
   Providers. A configuration or startup error is rethrown; Pi never falls
   back to host coding tools.
3. Coding operations, Playwright, and user `!` commands share the same VM.
4. The product-selected workspace is mounted read-write at `/workspace`.
   Trusted skills, when present, are mounted read-only at `/skills`.
5. Network access is disabled unless enabled by trusted product defaults or a
   workspace-confined project policy. This repository declares its policy in
   `.pi/gondolin-policy.json`. WebSockets remain disabled by default.
6. `session_shutdown` closes guest processes, the VM, temporary output, and
   metrics registration. Shutdown is idempotent.

This follows Pi's extension guidance: register tools during the factory call,
start long-lived resources at `session_start`, and release them in
`session_shutdown`. Project image, compute, and network choices stay in JSON;
the extension only adapts them. It follows Gondolin's workload model: persist
through explicit Workspace Mounts and treat the VM itself as disposable.
