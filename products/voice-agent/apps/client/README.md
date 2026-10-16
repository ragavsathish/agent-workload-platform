# Pi Voice client

One Flutter interface targets web, iOS, and Android. Platform integrations stay
behind `lib/platform/` so widgets and conversation state do not depend on
browser JavaScript or native Pipecat SDK details.

The web adapter is production-active. On iOS and Android, a small native Flutter
shell embeds that same private web workspace. It requests the operating-system
microphone permission only when the page starts a voice conversation, grants the
page microphone access but not camera access, and prevents navigation away from
the configured workspace origin. The device must be connected to the tailnet.

On supported Chromium builds, the page progressively registers three WebMCP
tools: read the bounded active workspace state, send a typed Pi message, and
create a pending task. It never exposes task approval or execution. WebMCP is
currently an experimental browser capability; unsupported browsers and native
WKWebView continue normally without registering tools.

For local Chrome testing, enable `chrome://flags/#enable-webmcp-testing` before
loading the page. The registration status can be inspected without invoking a
tool:

```js
JSON.parse(await window.voiceBridge.installWebMcp())
```

Override the production workspace at build time when needed:

```bash
./tool/flutterw run \
  --dart-define=VOICE_WEB_URL=https://pipecat-edge.tailf6d713.ts.net/
```

## Verify

```bash
./tool/flutterw analyze
./tool/flutterw test
./tool/flutterw build bundle
npm run build
npm run test:webmcp
npm run test:patrol
npm run profile:web
```

The Patrol web run always records a Playwright trace for two isolated journeys:
the responsive voice shell and the typed Pi/task workspace. The workspace uses
the production `VoiceApi` against an external deterministic HTTP fixture rather
than constructing screens or injecting a Dart fake. It covers context compaction,
resuming a persisted Pi session, consecutive typed turns without waiting for TTS,
streamed response interruption, task approval, task creation, and task cancellation.

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
never posts to the server and never records transcript text, audio, Mermaid
source, URLs, or error messages. The bounded profile contains first-frame time,
Flutter build/raster timings and jank counts, start/mute/stop latency, and
Mermaid render latency. On web, the latest 500 samples persist locally across
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

The 2026-10-16 cold-phone profile identified eager Pipecat and Mermaid loading
as the avoidable startup cost. Those modules now load only when a conversation
starts or a live diagram arrives; the initial conversation map is a lightweight
Flutter drawing. Compared with the original JavaScript build, the JavaScript
fallback reduced resource-timing transfer from 5.41 MB to 2.65 MB, blocking
time from 773 ms to 632 ms, heap from 26.9 MB to 15.8 MB, and FCP from 1,112 ms
to 932 ms. On a Wasm-capable phone profile, heap is 8.2 MB and FCP is 880 ms.
Idle CPU work is below 1 ms/s in both paths.
