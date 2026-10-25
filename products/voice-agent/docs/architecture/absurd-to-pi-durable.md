# Pi Durable task-owner cutover

The Agent Gateway now submits `agent-run`, `song-lyrics`, `song-render`,
`digital-twin-journal`, and `digital-twin-classify` directly to a long-lived Pi
Durable owner. The owner is one macOS LaunchAgent and the only writer to its
SQLite task store. Its native `defineTask` definitions own task state, resume,
abort, and `retryTask`. A bounded private HTTP endpoint serves the Gateway;
a mode-0600 Unix socket serves local inspection and recovery. Both use the
same owner process and store.

PostgreSQL still holds public proposals, song generations, and safe progress.
The public task/result JSON shape and approval flow are unchanged. The owner
returns a stable UUID as the public task ID; repeated submissions with the
same request ID and input return that task. Changed input is rejected.

The owner runs agent and lyric conversations directly through Pi Durable. The
same native conversation store and submission request ID are used in both
execution modes. The mode selects Pi Durable's host Node environment or a
Gondolin guest filesystem and shell environment. A narrow Python effect helper
prepares the task workspace, formats the public response, and captures artifacts;
it does not execute Pi. Music rendering
uses the same intent rule because its upstream call is not idempotent. The
owner's retry command is private and follows Pi Durable's native retry rules.
Specifically, `retryTask()` only re-enables a task parked at `restartLimit`;
calling it on a terminal failure has no effect. `inspect()` exposes a parked
task as blocked with reason `restart_limit`.

Pi Durable's `Conversation.submit()` is the native admission path for a model
conversation, with an idempotent `requestId`, a durable `Submission`, and
`submission(id)` after reopen. This cutover uses native `defineTask` for product
jobs because the public API also covers music rendering and digital-twin
extraction. The owner remains the only process writing each native task or
conversation store. Each agent-run retains its own conversation store, and the
owner exposes its task session socket for bounded follow-up during the idle
window.

The Absurd worker LaunchAgent, Habitat container and route, queue adapter,
queue database initialization, and Python SDK dependencies were removed from
the active deployment. Development task history in the old Absurd schema is
not migrated.

## Verification layers

- `pnpm --dir platform/agent-execution/pi-durable-task test` checks owner
  creation, idempotency, result query, abort, restart, native retry, product
  effect subprocess, and authenticated HTTP transport.
- `make test-pi-durable-mcp` checks our MCP registration, mode selection,
  and a Pi Durable write through a real Gondolin task VM when local assets exist.
- `bb -cp tool tool/container_mock/pi_durable_owner_test.clj` checks the C2
  state machine's success, duplicate, changed input, terminal failure,
  parked-task retry, abort, outage, and unauthorized scenarios.
- `packages/tasking/tests/infrastructure/test_pi_durable_owner_mock.py`
  calls the production Python client over HTTP against that Babashka mock.
- The deployed journey proposes and approves a scratch task through the
  public Gateway, then reads the Pi result and artifact through the same API.
  On 2026-10-25, proposal `c3902ba1-11f7-4f44-b1e6-1c17898125c3` completed
  and its workspace artifact contained `durable-cutover.txt` with the exact
  requested bytes `verified-2d928121\n`.

The C2 mock models the private owner protocol only. It does not emulate Pi's
conversation, tool replay, or S3. The deployed journey supplies that separate
confidence signal.
