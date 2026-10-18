# Tasking Wassette component

This module exposes the voice agent's durable task operations through Wassette. Its external
interface is the task vocabulary used by Pi. Internally, WAC composes two WebAssembly components:

- `tasking-core` owns validation, task paths, response validation, and the single-call submission
  interface. It hides the gateway's proposal and approval protocol as an implementation detail.
- `gateway-http` is a small Rust adapter for the authenticated agent gateway. Rust is used only for
  this effect adapter because ComponentizeJS 0.19 does not syncify an asynchronous export when that
  export is consumed through WAC composition.

The resulting `dist/tasking.wasm` is the only artifact loaded by Wassette. Wassette grants that
artifact network access only to the loopback task and trace APIs and access only to the three
`TASK_*` variables plus the non-secret `TRACE_RENDER_BASE_URL`. No gateway credential appears in a
model-visible tool argument.
Pi sees only submission, exact session-name lookup, status, and cancellation; it cannot create or
approve proposals directly. Reused albums receive persisted `· Take N` suffixes, so the displayed
name resolves to one owner-scoped task.
The same component exposes asynchronous Playwright trace render submission and status. That adapter
has a separate capability limited to the loopback trace service; the voice VM never receives trace
filesystem access, FFmpeg, renderer dependencies, or broker credentials.

```bash
make -C products/voice-agent/components/tasking-ts build
make -C products/voice-agent/components/tasking-ts install
```

The component depends on `wac-cli` for build-time composition. The installed voice runtime starts
Wassette with a mode-0600 env file containing `TASK_GATEWAY_BASE_URL`, `TASK_GATEWAY_TOKEN`,
`TASK_IDENTITY`, and `TRACE_RENDER_BASE_URL`; Wassette's per-component policy decides which loaded
component may read them.
