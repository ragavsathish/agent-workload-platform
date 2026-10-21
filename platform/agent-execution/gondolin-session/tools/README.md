# Gondolin harness tools

`check-pi-vm.sh` is the deterministic, non-LLM Pi VM check. From
the repository root, run `make gondolin-check-pi-vm` with Bash and `jq` on
the host. Override `GONDOLIN_ONBOARDING_IMAGE`, `GONDOLIN_DEV_IMAGE_CACHE`,
or `GONDOLIN_DEV_IMAGE_STORE` when needed. The gate
clones a private Git checkout, launches the real Pi CLI in RPC mode, and sends
Pi `bash` commands through the Gondolin extension. The session-start hook
starts and checks the default dev Compose stack. The gate checks that Pi Bash
reaches Linux and writes through the workspace mount; it then closes Pi,
reopens the same session, checks the workspace and guest disk, and explicitly
disposes the checkpoint. Its private JSON result is under
`artifacts/benchmarks/`. This proves Pi's user Bash routing, not a
model-issued tool call or an autonomous agent task. Since RPC Bash alone does
not create a Pi transcript, the gate writes Pi's standard session header
before shutdown so the checkpoint can be saved and resumed.

`oracle.clj` is the Patrol trace and OTEL oracle used by the Compose benchmark
harness. It runs inside the VM, after Patrol has written `build/patrol-latest`.

```sh
/usr/local/bin/bb /workspace/platform/agent-execution/gondolin-session/tools/oracle.clj \
  /workspace/products/voice-agent/apps/client/build/patrol-latest \
  <run-id> <vm-index> [/benchmark-evidence/allure-results]
```

The tool prints one JSON verdict with `passed`, `browserTrace`, `otel`, and
`liveEdge` fields. In the `full-mock` Compose profile, Patrol runs a third
browser journey. Its loopback relay forwards one typed turn to the running
voice-edge with a unique W3C trace ID. Oracle requires a successful browser
`POST /api/pi-message` and the matching `pipecat-voice-edge.browser.pi.turn`
application span from Tempo. The relay preserves the returned edge response in
the browser transcript; only the trace ID, not the message, enters telemetry.
Exit status is 0 for a passing verdict, 1 for a failing verdict, and 2 for
an incorrect argument count. The collector and Tempo endpoints default to
`http://127.0.0.1:4318` and `http://127.0.0.1:3200`; set
`ORACLE_OTLP_COLLECTOR` and `ORACLE_TEMPO` to override them. The canary tests
collector-to-Tempo delivery, while the browser check validates the saved
Patrol trace evidence. The `liveEdge` field is `null` in the default dev profile.

When an Allure results directory is supplied, Oracle writes one
`*-result.json` file and a JSON verdict attachment there, including browser
trace and OTEL steps, plus the live edge step when required. Its `historyId` is stable for the same VM index across
benchmark generations; its `uuid` changes for every execution. The run ID is
recorded as an excluded parameter so it does not split the history.

The benchmark passes the VM result directories directly to `allure generate`,
stores an HTML report under the run's Patrol evidence directory, and appends to
`artifacts/benchmarks/oracle-allure-history.jsonl`. Those ignored artifacts
retain each generation locally. The Allure CLI is pinned as a dev dependency
of `@agent-workload-platform/gondolin-session`; run `pnpm install` before an
oracle-enabled benchmark. The JSON verdict remains the pass/fail source.

Run focused tests with Babashka:

```sh
bb platform/agent-execution/gondolin-session/tools/oracle_test.clj
```
