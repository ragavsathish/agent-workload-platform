# Pi Durable task owner

`owner-server.js` is a long-lived LaunchAgent. One process opens its SQLite
store, and an exclusive owner lock prevents a second process from opening the
same store. Its private Unix socket defaults to
`/tmp/awp-pi-owner-<uid>/owner.sock`; the directory is mode `0700` and the
socket, database, and SQLite sidecars are mode `0600`. The store defaults to
`$HOME/.pi/agent/sessions/durable-owner.sqlite` in the service's private HOME.

The socket accepts one JSON object per line and returns one JSON object per
line. Every request has an `id` and `command`. Commands are `submit` (with a
stable UUID `requestId` and bounded validation `input`), `get`, `abort`,
`retry`, and `inspect`. The last three task commands take `taskId`. A response
has `{ id, success, data }` or `{ success: false, error }`. `get` returns
`{ state, result, failure }`, the shape consumed by the current task UI.
Unknown IDs return `null` on `get` and reject commands. Reusing a request ID
with different input rejects; reusing it with the same input returns the
original task ID.

The `voice.owner.validation` task proves native task creation, cancellation,
storage reopen, and `retryTask()` without invoking a model or touching a
workspace. The owner also admits the five public product task kinds through
native task definitions. The product task currently launches a bounded Python
executor; agent and product workflow migration into native conversations is
in progress.

Host Pi Durable conversations can register explicitly allowlisted MCP tools.
Each registered tool becomes a Pi Durable `defineTool` task with a namespaced
`mcp__server__tool` name. MCP calls default to unsafe replay; only tools named
in `safeReplayTools` may rerun after an interrupted call. Configure servers
with a private JSON file named by `PI_DURABLE_MCP_SERVERS_FILE` in `worker.env`:

```json
[{"name":"journal","url":"http://127.0.0.1:9000/mcp","allowedTools":["read_entry"]}]
```

The file may instead specify `command`, `args`, and `cwd` for a stdio MCP
server. Only listed tools are offered to the model. The current deployment
does not set this file, so product MCP registrations must be configured before
the Python product executor can be removed.

Run the lifecycle tests with
`pnpm --filter @agent-workload-platform/pi-durable-task test`. They start real
owner processes and kill one mid-task to verify a parked task and native
retry. `make test-pi-durable-mcp` runs the Gherkin Allure integration journey
through an agent call to an allowlisted MCP tool. Deployment uses
`make install-host-services` in the voice-agent product.
