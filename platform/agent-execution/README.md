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

The build first creates the pinned Playwright-based guest image with AWS CLI, Git, and the
checksum-verified Gitea Tea client,
then converts it into architecture-specific Gondolin assets. Network access is
still supplied per VM by the consuming product; the binary alone grants no
egress or credentials. The Voice Agent task worker sets
`GONDOLIN_PUBLIC_INTERNET=1`, which permits public HTTP(S) destinations while
Gondolin continues to reject private, loopback, link-local, and metadata IP
ranges. Voice-conversation VMs do not inherit that worker-only setting.

The package is consumed by both Voice Agent workers and Architecture
Visualization's optional browser fallback.
