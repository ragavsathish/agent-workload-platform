# Gondolin harness tools

`oracle.clj` is the Patrol trace and OTEL oracle used by the Compose benchmark
harness. It runs inside the VM, after Patrol has written `build/patrol-latest`.

```sh
/usr/local/bin/bb /workspace/platform/agent-execution/gondolin-session/tools/oracle.clj \
  /workspace/products/voice-agent/apps/client/build/patrol-latest \
  <run-id> <vm-index>
```

The tool prints one JSON verdict with `passed`, `browserTrace`, and `otel` fields.
Exit status is 0 for a passing verdict, 1 for a failing verdict, and 2 for
an incorrect argument count. The collector and Tempo endpoints default to
`http://127.0.0.1:4318` and `http://127.0.0.1:3200`; set
`ORACLE_OTLP_COLLECTOR` and `ORACLE_TEMPO` to override them. The canary tests
collector-to-Tempo delivery, while the browser check validates the saved
Patrol trace evidence.

Run focused tests with Babashka:

```sh
bb platform/agent-execution/gondolin-session/tools/oracle_test.clj
```
