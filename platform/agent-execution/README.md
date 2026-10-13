# Agent Execution

Agent Execution owns the reusable boundary for running agent tools in an
isolated session. Products choose their own prompts, policies, and workflows;
this context supplies the session, workspace mount, browser bridge, memory
bridge, and optional capability providers.

`gondolin-session/` is the current implementation. Build it from the repository
root with:

```sh
make gondolin-session-build
```

The package is consumed by both Voice Agent workers and Architecture
Visualization's optional browser fallback.
