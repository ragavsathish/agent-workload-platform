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

The local `pi-durable-task` CLI submits an `agent-run` task straight to this
private owner socket. It records owner identity, instruction, workspace, and
creation time with the native submission; `describe` and `list_native` expose
only these CLI submissions to the authenticated Gateway projection. This lets
the Flutter task board query their state, bounded progress feed, narration,
result, and artifact without creating an HTTP proposal first. The socket's
filesystem permissions are the CLI's local authorization boundary.

For a repository task in Gondolin mode, the checked-out workspace may declare
its Gitea access in `.pi/gondolin.json`:

```json
{
  "gitea": {"repository":"agent-workload-platform","access":"write"},
  "hooks": {
    "sessionStart":".pi/hooks/configure-gitea.clj",
    "sessionStop":".pi/hooks/push-non-main.clj"
  }
}
```

The declared repository must match the task workspace identity. The owner
reads that repository's token from `GITEA_TASK_TOKEN_DIR` on the host. The
declared Clojure start hook configures the guest's Git remote and, when
installed, Tea login. Gondolin exposes only a placeholder to the VM and
substitutes the token in HTTP authorization headers for the allowed Gitea
upstream. Token values do not belong in Pi JSON or the repository.
Scratch tasks and workspaces without a declaration receive no Gitea writer.
The voice VM uses its separate instance-admin token. The Clojure stop hook
pushes committed work after each settled task submission (including follow-ups).
A checkout on `main`, `master`, or a detached HEAD moves to
`pi/task-<task-id>`; an existing non-main branch keeps its name.
The push is never forced. Uncommitted changes remain in the workspace.

```sh
pnpm --dir platform/agent-execution/pi-durable-task run build
node platform/agent-execution/pi-durable-task/dist/cli.js submit \
  --identity owner@example.com --workspace scratch \
  --instruction 'Inspect the workspace and report what you find.'
node platform/agent-execution/pi-durable-task/dist/cli.js list \
  --identity owner@example.com
```

Use the exact owner login accepted by the Voice Edge; another identity will not
appear on that owner's Flutter board. `get --task-id UUID` and `abort --task-id
UUID` operate on the native task. The CLI is a private local operator command,
not a tailnet endpoint.

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
