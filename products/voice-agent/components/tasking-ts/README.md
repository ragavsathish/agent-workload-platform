# Tasking Wassette component

This module exposes the voice agent's durable task operations through Wassette. Its external
interface is the task vocabulary used by Pi. Internally, WAC composes two WebAssembly components:

- `tasking-core` owns validation, task paths, response validation, and the single-call submission
  interface. It hides the gateway's proposal and approval protocol as an implementation detail.
- `gateway-http` is a small Rust adapter for the authenticated agent gateway. Rust is used only for
  this effect adapter because ComponentizeJS 0.19 does not syncify an asynchronous export when that
  export is consumed through WAC composition.

The resulting `dist/tasking.wasm` is the only artifact loaded by Wassette. Wassette grants that
artifact network access only to the loopback gateway and access only to the three `TASK_*`
environment variables. No gateway credential appears in a model-visible tool argument.
Pi sees only submission, status, and cancellation; it cannot create or approve proposals directly.

```bash
make -C products/voice-agent/components/tasking-ts build
make -C products/voice-agent/components/tasking-ts install
```

The component depends on `wac-cli` for build-time composition. The installed voice runtime starts
Wassette with a mode-0600 env file containing `TASK_GATEWAY_BASE_URL`, `TASK_GATEWAY_TOKEN`, and
`TASK_IDENTITY`; Wassette's per-component policy decides which loaded component may read them.
