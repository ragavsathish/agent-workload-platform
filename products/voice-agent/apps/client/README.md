# Pi Voice client

One Flutter interface targets web, iOS, and Android. Platform integrations stay
behind `lib/platform/` so widgets and conversation state do not depend on
browser JavaScript or native Pipecat SDK details.

The web adapter is production-active. On iOS and Android, a small native Flutter
shell embeds that same private web workspace. It requests the operating-system
microphone permission only when the page starts a voice conversation, grants the
page microphone access but not camera access, and prevents navigation away from
the configured workspace origin. The device must be connected to the tailnet.

Visual responses use the MCP Apps protocol. Flutter hosts the official MCP App
bridge in a sandboxed iframe. A locally bundled Mermaid app handles normal
status and flow views; a locally bundled Excalidraw app handles explicit rich or
editable diagram requests. Excalidraw and its fonts are built from
`vendor/excalidraw-mcp`, are loaded only when selected, and make no CDN request.
The dark journal-review app uses Recogito Text Annotator for exact evidence spans
and sends natural-language review requests back through the active voice session.
These apps receive only bounded presentation data. The host does not expose task
approval, execution, credentials, links, exports, or server tools.

## Isolated UX development

Within a Pi development VM, run the Flutter web client and a synthetic
host-services API on one guest-loopback origin, without LaunchAgents, a voice
model, or Tailscale:

```bash
npm run dev:mock
```

Open `http://127.0.0.1:8766/?view=transcript` in guest Playwright. Type “Show a Mermaid diagram”,
“Show Marp slides”, “Show editable Excalidraw”, “Show the Playwright trace”,
or “Review the journal annotation”, then open the visual in the transcript.
The mock serves the built Flutter client and deterministic `/api/pi-*` and
`/api/tasks` responses; `GET /api/mock/scenes` lists its presentation scenes.
To reuse an existing build, run `npm run dev:mock:serve`. Set `MOCK_HOST_PORT`
to choose another loopback port.

This is a UI/MCP contract fixture, not a simulated voice model or a durable
task VM. Trace artifact links, the official Grafana MCP App, speech recognition,
and task execution still require their integration services. The production
client and iframe bridge are unchanged; the fixture is a separate process.

For a manual toolchain probe, prepare the reusable Gondolin dev image once
from the repository root:

```bash
make gondolin-dev-build
```

This packages Flutter, Node, Docker, and Playwright tools; it does not build
the project. Normal durable tasks instead read this repository's
`.pi/gondolin.json`: the task worker asks the trusted image builder for the
toolchain image only on a cache miss, then Pi starts one VM for that task
session with its worktree mounted at `/workspace`. Run `npm ci`, `npm run build`,
browser tests, and the mock server through Pi's Gondolin tools **inside that
VM**. Later sessions reuse the image but get fresh VMs and private Docker
state. Neither the host nor Gitea builds a per-commit app image.
Use a clean worktree: macOS `node_modules` contains native binaries such as
`esbuild` that fail in Linux. The durable task's materialized Git checkout is
clean, and `npm ci` installs Linux dependencies there without touching the
developer machine's checkout.
The current dev image preinstalls the browser for the client's locked Playwright
1.58.2, as well as the browser used by its bundled MCP tooling. After `npm ci`,
`npx playwright install chromium` verifies the client browser without downloading
it. Run that command to install a new revision when using an older dev image or
after changing the lockfile. Forcing the MCP browser executable for client
tests caused pointer actions to miss MCP App controls.

Optionally run `make gondolin-dev-cache` from the repository root to export its Compose
images once. Set `GONDOLIN_DEV_IMAGE_CACHE` to the resulting
`artifacts/gondolin-dev-images/<architecture>` directory and
`GONDOLIN_DEV_IMAGE_STORE` to `~/.cache/gondolin/<architecture>` before starting Pi.
The image archives are shared read-only; Docker volumes, networks, ports, and
runtime layers remain private to each VM. For another worktree or project,
prepare its own cache from its Compose file. Inside the guest, set `COMPOSE_FILE`
to that worktree's Compose path and `COMPOSE_CACHE_SERVICES` to the needed
service names before using `dev-compose` for image-consuming commands. It loads
only selected images and applies a no-pull override. It does not share environment
files: provide any Compose `.env` or `--env-file` from the session's worktree.
This dev guest build lacks usable Docker bridge networking. Pi's `session_start`
hook automatically layers the VM-only `.pi/compose.dev.yml` over the existing
deployment Compose file on guest host networking when the shared cache is
mounted. It starts observability, S3Mock, Oxigraph,
Postgres, and Gitea with disposable state. It does not run the production
voice-edge/gateway/Tailscale stack or copy host secrets into the VM.

Playwright and the mock can both use guest loopback. External browser preview
requires an explicit, loopback-scoped Gondolin ingress route; guest ports are
not automatically published to the Mac or Tailscale. The separate Gitea image
builder is not used for interactive development sessions.

Preview the journal reviewer through the Flutter Web host in the VM without
Tailscale or a running voice backend:

```bash
npm run prototype:journal-review
```

Then open in guest Playwright
`http://127.0.0.1:8765/?view=journal-review-preview&prototype=journal-review&variant=A`.
Variants `A`, `B`, and `C` are available only on that prototype URL; the normal
MCP App does not render the prototype switcher.

Override the production workspace at build time when needed:

```bash
./tool/flutterw run \
  --dart-define=VOICE_WEB_URL=https://pipecat-edge.tailf6d713.ts.net/
```

## Verify inside the Pi development VM

```bash
./tool/flutterw analyze
./tool/flutterw test
./tool/flutterw build bundle
npm run build
npx playwright install chromium
npm run test:browser
npm run test:patrol
npm run profile:web
```

`test:browser` exercises the MCP App bridge and the Mermaid, Marp, Recogito
journal-review, and Excalidraw renderers with Vitest Browser Mode using its Playwright provider.
The tests keep the production opaque-origin iframe sandbox intact, verify its
least-privilege permissions and resource allowlist, and inspect renderer output
through Playwright's server-side frame API. A Playwright trace is attached for
every test and retained under `build/vitest-playwright-traces/`; Vitest copies
reporter attachments to `build/vitest-attachments/`.

The Patrol web run always records a Playwright trace for two isolated journeys:
the responsive voice shell and the typed Pi/task workspace. The workspace uses
the production `VoiceApi` against an external deterministic HTTP fixture rather
than constructing screens or injecting a Dart fake. It covers context compaction,
resuming a persisted Pi session, consecutive typed turns without waiting for TTS,
streamed response interruption, task approval, task creation, task cancellation,
and opening Mermaid, Marp, Excalidraw, trace, and journal MCP presentations.

The wrapper applies a version-checked workaround for Patrol 4.10.0's trace
teardown failure, validates each archive, and reads a redacted evidence summary
covering browser actions, API requests, network failures, console messages, and
screenshots. Every run is retained below `build/patrol-runs/`; `build/patrol-latest`
points to the newest run and `build/patrol-trace-evidence.json` contains its
evidence summary.

`build bundle` verifies the platform-neutral Dart graph without requiring
Xcode or the Android SDK. Building an installable iOS or Android artifact still
requires the corresponding native toolchain. The iOS runner uses Flutter Swift
Package Manager integration; run it through Flutter so microphone permission
configuration is discovered from `ios/Runner/Info.plist`.

The web release uses Flutter's Wasm build. Compatible browsers select Wasm;
Flutter's generated JavaScript remains in the same output as the fallback for
browsers without compatible WasmGC support.

React input diagnostics live separately in `../diagnostics` and are served at
`/diagnostics/`. System-to-code evidence, C4 views, and live operational health
are consolidated in Grafana at `/metrics/`; neither surface is part of this
Flutter application.

## Pi workspace UX

The typed conversation and durable-task workspace uses Pi Web 0.12.2
(`b017cd48425d05aa4952051db2e4fc031c134094`) as a behavioral and visual
reference. It is a native Flutter implementation, not an embedded React app.
Repository browsing, terminals, model/provider settings, credentials, plugins,
and skills remain outside the client; Gitea, Wassette, Gondolin, and the
orchestrator retain those responsibilities. The existing voice surface and its
transport lifecycle are intentionally independent from this workspace.

## Client UX performance profile

UX timing stays in the client to guide product performance improvements. It
never posts to the server and never records transcript text, audio, presentation
source, URLs, or error messages. The bounded profile contains first-frame time,
Flutter build/raster timings and jank counts, start/mute/stop latency, and
MCP App mount latency. On web, the latest 500 samples persist locally across
reloads.

Inspect raw web samples or an aggregate with p50, p95, maximum, count, and
errors in the browser console:

```js
window.__piUxTelemetry.snapshot()
window.__piUxTelemetry.summary()
```

Clear the local profile after an optimization to establish a fresh baseline:

```js
window.__piUxTelemetry.clear()
```

`npm run profile:web` builds the release and profiles cold startup and five
seconds of idle behavior in containerized Chromium for phone Wasm, phone
JavaScript fallback, and desktop Wasm. It enforces budgets for transfer size,
blocking time, first frame, and idle CPU work and prints the largest transferred
resources for investigation. The `?force_js=1` switch exists only to reproduce
the fallback path during profiling. The latest report is written to
`build/ux-profile.json`.

The 2026-10-16 cold-phone profile identified eager Pipecat and diagram loading
as avoidable startup costs. Pipecat now loads when a conversation starts and
the sandboxed MCP App mounts only when a structured presentation arrives; the
initial conversation map is a lightweight Flutter drawing. Compared with the original JavaScript build, the JavaScript
fallback reduced resource-timing transfer from 5.41 MB to 2.65 MB, blocking
time from 773 ms to 632 ms, heap from 26.9 MB to 15.8 MB, and FCP from 1,112 ms
to 932 ms. On a Wasm-capable phone profile, heap is 8.2 MB and FCP is 880 ms.
Idle CPU work is below 1 ms/s in both paths.
