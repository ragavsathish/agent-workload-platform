# Gondolin Agent Session

This package supplies the Agent Session used by Pi task workers. It also
contains the separate trusted image-builder workflow.

## Runtime modules

- `pi-extension.ts` adapts Pi and owns one Gondolin VM at a time plus its
  session-scoped Capability Providers. It checkpoints durable Pi task VM disks
  at shutdown and resumes them with the same Pi session. It also validates `.pi/gondolin.json`
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

Measured Mac capacity and OTel queries are in the
[development-VM concurrency benchmark](benchmarks/README.md).

For a manual probe, `make gondolin-dev-build` prepares a reusable
Flutter/Node/Docker/Playwright toolchain image without repository source or app
output. Normal durable tasks select and provision their image through the
repository's `.pi/gondolin.json` before Pi starts. The extension remains
project-agnostic: it mounts only that session's chosen worktree at `/workspace`,
does not copy host process credentials or `.env` files, and starts a private
Docker daemon in the guest. Worktree-local environment files stay with that
worktree. At session shutdown, the VM process stops and its writable root disk
is saved beside the Pi session file as `<session.jsonl>.gondolin.qcow2`.
The next Pi process opening that session resumes the disk in a new VM.
Guest processes, tmpfs contents, and open ports do not survive; startup
commands run again. Builds and tests run through that VM, not on the host.
The optional `environment` map in `.pi/gondolin.json` supplies explicit
worktree-scoped guest environment variables without forwarding the host
process environment. This repository sets `PATROL_WEB_LOCALE=en-US` there for
its browser tests and enables Playwright's HTTPS certificate bypass only in
the isolated task VM, where Chromium does not trust the development egress
certificate used for Flutter's fallback font CDN.

`GONDOLIN_DEV_IMAGE_CACHE` optionally points to a trusted host directory of
pre-exported Compose images. It is mounted read-only at `/image-cache` in each
VM. The source repository's `make gondolin-dev-cache` prepares the Voice Agent
image set as one example; other repositories can use
`gondolin/prepare-compose-cache.mjs <compose.yml> <cache-directory>`. In the
guest, set `COMPOSE_FILE` to that worktree's Compose path and
`COMPOSE_CACHE_SERVICES` to the needed service names, then use `dev-compose`
to load only those cached image tags and apply its no-pull override. The
image bytes are shared; no Docker data root, named volume, or port is shared.
For this repository, `.pi/gondolin.json` selects `.pi/hooks/start-dev-stack.mjs`
as a Pi `session_start` hook. After the private Docker daemon starts, the hook
uses `dev-compose` to load the cached images and layer `.pi/compose.dev.yml`
over the existing `products/voice-agent/deploy/compose.yml`. The Pi override
selects only task-VM dependencies, replaces host networking and secrets with
guest-local settings, and retains the base image pins. It starts Grafana/OTel/Prometheus, S3Mock, Oxigraph,
Postgres, and Gitea, then checks readiness before Pi receives coding tools.
The guest loopback ports are 3000/4318/9090 for observability, 9092 for S3Mock,
7878 for Oxigraph, 5432 for Postgres, and 3001 for Gitea. When
`GONDOLIN_DEV_IMAGE_CACHE` is unset, the hook reports a skip and leaves the task
usable without the stack. The override's hardcoded dev passwords are disposable
and never used by host deployment. Running containers stop at checkpoint;
guest root-disk data survives for the next session. No host service or port is
shared. The agent should query these services, not start them in its prompt.
This is an isolated development dependency stack,
not the production Compose deployment: voice-edge, gateway, Tailscale, and
host inference are not started in the guest.
Docker bridge networking is not currently available in this dev guest build,
so multi-container Compose startup remains a separate unverified capability.
Use a clean worktree for Linux builds: macOS `node_modules` contains native
binaries that cannot run in the guest. Durable S3 workspaces already materialize
clean Git checkouts; install dependencies inside their session VM.
The dev image preinstalls Chromium for this repository's locked Playwright
version alongside the browser used by its bundled MCP tooling. After `npm ci`,
`npx playwright install chromium` verifies the client revision without a download
when the image and lockfile match. Run it to install a new revision if the
worktree uses a different lockfile or an older image. The image build test
checks that the Dockerfile pin matches the client lockfile.

## Lifecycle contract

1. The Pi Adapter synchronously replaces `read`, `write`, `edit`, and `bash`
   while the extension loads. No process or VM starts during this step.
2. `session_start` starts the Agent Session, runs the optional worktree-confined
   development startup hook, and discovers enabled Capability Providers. A
   configuration or startup error is rethrown; Pi never falls back to host
   coding tools.
3. Coding operations, Playwright, and user `!` commands share the same VM.
4. The product-selected workspace is mounted read-write at `/workspace`.
   Trusted skills, when present, are mounted read-only at `/skills`.
5. Network access is disabled unless enabled by trusted product defaults or a
   workspace-confined project policy. This repository declares its policy in
   `.pi/gondolin-policy.json`. WebSockets remain disabled by default.
6. `session_shutdown` checkpoints the root disk for a saved Pi session, then
   closes the VM and removes temporary output and metrics registration. Pi
   `--no-session` runs close without a checkpoint because they cannot resume.
7. `/gondolin-dispose` closes the active task VM, deletes its saved checkpoint,
   and exits Pi. For an inactive session, run
   `node platform/agent-execution/gondolin-session/dist/task-vm-cli.js dispose <pi-session-file>`.
   Disposal leaves the Pi transcript and mounted host workspace intact.

This follows Pi's extension guidance: register tools during the factory call,
start long-lived resources at `session_start`, and release them in
`session_shutdown`. Project image, compute, and network choices stay in JSON;
the extension only adapts them. The guest checkpoint preserves disk state,
while the Workspace Mount preserves source files. One Pi process holds an
exclusive ownership record for each saved guest disk. Keep the saved workspace
available for later resume; a deleted worktree cannot be reconstructed from
the guest checkpoint. Checkpoints may be large and remain until explicitly
disposed.
