# Pi Voice client

One Flutter interface targets web, iOS, and Android. Platform integrations stay
behind `lib/platform/` so widgets and conversation state do not depend on
browser JavaScript or native Pipecat SDK details.

The web adapter is production-active. The generated iOS and Android runners are
the mobile foundation; their native Pipecat transport adapters are still to be
implemented. Until then, mobile builds display the interface but cannot start a
voice session.

## Verify

```bash
./tool/flutterw analyze
./tool/flutterw test
./tool/flutterw build bundle
npm run build
npm run profile:web
```

`build bundle` verifies the platform-neutral Dart graph without requiring
Xcode or the Android SDK. Building an installable iOS or Android artifact still
requires the corresponding native toolchain.

The web release uses Flutter's Wasm build. Compatible browsers select Wasm;
Flutter's generated JavaScript remains in the same output as the fallback for
browsers without compatible WasmGC support.

React input diagnostics live separately in `../diagnostics` and are served at
`/diagnostics/`; they are deliberately not part of this Flutter application.

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
