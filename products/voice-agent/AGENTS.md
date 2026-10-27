# Voice Agent Rules

## Commands and queries

- Classify every agent operation as a query or command for API semantics, authorization, idempotency, and audit.
- Queries read or present existing state. Use bounded MCP or HTTP endpoints with the required read authorization.
- Commands change state or start work. Use authenticated command endpoints with explicit authorization and audit events.
- Prefer asynchronous commands that return a durable operation ID; expose status and immutable artifacts through bounded query endpoints.
- Name queries `get`, `inspect`, `open`, or `present`; name commands `submit`, `create`, `update`, or `cancel`.
- Keep large trace and video bytes out of MCP; pass opaque IDs, bounded metadata, and artifact URLs.

## Execution isolation

- Choose isolation independently of whether an operation is a command or query.
- Use Wassette when agent-selected code must run on the host and its filesystem, network, environment, and credential capabilities can be expressed narrowly with WASI.
- Grant each Wassette component only its required capabilities. Split components that need unrelated destinations or credentials.
- Use a container when the workload needs native dependencies, subprocesses, broader filesystem behavior, or networking that cannot be represented safely as a WASI component.
- The Pi Voice Service owns one persistent Gondolin voice VM across conversational and orchestrator session changes.
- Durable Pi tool execution follows `WORKER_PI_EXECUTION_MODE`: `gondolin` uses a task-scoped VM; `host` uses Pi's native host tools. Keep direct task submission, identity, queue, and result semantics independent of this deployment choice.
- Read the [architecture guide](docs/architecture/README.md) before changing voice or durable-task VM ownership and lifecycle.
- For Playwright traces, present existing traces directly. Run narrated-video generation in the container worker; Wassette is optional and justified only when it provides required host-side capability isolation.

## Ansible and MJS

- Ansible owns host and deployed state: preflight, installation, lifecycle, service wiring, and deployed integration checks.
- `.mjs` owns JavaScript application logic and focused tooling: runtimes, adapters, builds, generators, evaluations, and deterministic tests.
- Keep application decisions and data transformation out of Ansible.
- Keep host provisioning, service installation, and lifecycle orchestration out of `.mjs`.
- Ansible may invoke a repository-owned `.mjs` client when no state-aware module fits; the script should return a clear exit status and bounded machine-readable output.
- Use Make targets as the public entry points for infrastructure and deployed tests.
- Test in-process behavior with native JavaScript tests; use Ansible to verify observable deployed behavior across process boundaries.

## Bash

- Use Bash for small glue: invoke programs, connect standard streams, and perform simple local setup or checks.
- Use Make targets for repeatable operator entry points; keep their recipes thin.
- Use `.mjs`, Python, or the application language for parsing, data transformation, branching workflows, retries, and domain logic.
- Use Ansible modules for host or deployed state. Do not add Ansible `shell` or `raw` tasks.
- Use Ansible `command` with `argv` only when a repository-owned executable has no suitable state-aware module.
- Keep Bash scripts short, quote variables, enable strict error handling, and avoid printing secrets.

## Functional design

| Pattern | Rule |
|---|---|
| Functional core | Keep validation, decisions, transformations, and state transitions pure. |
| Imperative shell | Keep filesystem, network, time, processes, and lifecycle effects at the edges. |
| Boundary parsing | Convert untrusted input into validated domain values immediately. |
| Explicit states | Represent valid states and events explicitly; avoid loosely related flags. |
| Immutable transitions | Return new state instead of modifying shared state in place. |
| Ports and adapters | Depend on small capability interfaces, not infrastructure implementations. |
| Dependency injection | Pass configuration and external capabilities into components explicitly. |
| Projections | Expose bounded, sanitized views instead of internal state. |
| Factories | Construct effectful resources through focused creation functions. |
| Encapsulation | Hide queues, counters, caches, and mutable lifecycle state behind narrow operations. |
| Serialization | Serialize operations when concurrent mutation would make state inconsistent. |
| Resource lifecycle | Give creation, cancellation, timeout, and cleanup clear owners. |
| Error boundary | Normalize internal failures before returning them across a public boundary. |
| Global state | Avoid changing process-wide state; isolate and restore it when unavoidable. |
| Testing | Test the functional core deterministically and the imperative shell through observable effects. |

## Inference prompts

- Store each complete production system prompt in a colocated `SYSTEM.md`; runtime code owns schemas, request data, and other dynamic context.
- Give Pi one base `SYSTEM.md`. Store capability guidance in a colocated `APPEND_SYSTEM.md` and let its extension add a named `before_agent_start` section.
- Package the same prompt file into every runtime image or compiled artifact that performs that inference; keep one source of truth.
- Keep evaluation and judge prompts with their evaluation harnesses because they are not production inference prompts.

## Black-box testing

- Replace only the uncontrollable outer edge with a deterministic protocol driver; keep the production path behind that boundary real.
- Enter through a public production protocol and assert public outputs, durable effects, and telemetry rather than private implementation state.
- Group tests by the boundary they prove: contract, protocol, UI, deployed system, or ingress security.
- Keep protocol and UI black boxes separate for fast diagnosis; add a small number of full-path smoke tests that join them.
- Use fixtures inside contract and UI tests. Use real deployed dependencies when the purpose is integration confidence.
- Run locally by default. Require Tailscale only for behavior specifically owned by authenticated tailnet ingress.
- Retain bounded screenshots, traces, logs, and metrics on failure without exposing private payloads or credentials.
- Treat Ansible `verify` as a read-only deployed-contract black box: observe running state, hardening, connectivity, authentication, persistence, permissions, and telemetry through public or operator-visible interfaces.
- Keep lifecycle mutations in lifecycle tests and user journeys in protocol or UI black boxes; a successful `verify` does not prove that a fresh voice or MCP operation succeeds.
- Run `verify` before a journey to establish the deployment envelope, then use fresh outputs or metric deltas to prove the exercised path.
