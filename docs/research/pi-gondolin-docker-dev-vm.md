# Pi + Gondolin development VM

_Live probe and design revision: 2026-10-19. This supersedes the per-commit application-image experiment._

## Selection and lifecycle

Each durable task materializes a repository worktree. Its `.pi/gondolin.json`
selects the guest image, build inputs, CPU, memory, and network policy. Before
Pi starts, the task worker computes the image cache key from committed build
inputs. On a Gitea package miss it dispatches the trusted, existing image-builder
workflow, verifies the published manifest, and installs the Gondolin image ref.
Then Pi's [Gondolin extension](../../platform/agent-execution/gondolin-session/pi-extension.ts)
starts **one VM for that Pi session** with that worktree at `/workspace`.
Closing the Pi session closes the VM. The image is reusable across worktrees;
Docker runtime state, volumes, networks, ports, and mounts are not.

The repo-specific [dev Dockerfile](../../platform/agent-execution/gondolin-session/gondolin/Dockerfile.dev)
contains toolchains, not app source or a built product. Its narrow build context
is the `gondolin/` toolchain directory, so ordinary application commits do not
invalidate the image. `make gondolin-dev-build` remains a manual, local toolchain
probe; normal durable tasks use `.pi/gondolin.json` and the trusted builder.
Durable tasks materialize clean Git checkouts; this matters because a macOS
`node_modules` tree contains native packages that cannot run in Linux. Install
dependencies inside the VM and keep the developer host's dependency tree out.
No host Docker socket is exposed to a task VM. Pi runs on the host and routes
coding/Playwright operations to the guest, following [Pi's extension lifecycle](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

## Shared image bytes

The optional [Compose cache preparer](../../platform/agent-execution/gondolin-session/gondolin/prepare-compose-cache.mjs)
exports per-image archives and a no-pull override without building source. A trusted path
in `GONDOLIN_DEV_IMAGE_CACHE` is mounted read-only at `/image-cache`. `dev-compose`
loads only images named in `COMPOSE_CACHE_SERVICES` into each VM's private
Docker data root, then uses the worktree-selected `COMPOSE_FILE` plus the
override. The image archives are shared;
the loaded store and all mutable runtime state are not. Worktree `.env` files
remain worktree-local and are not copied from host process environment.
The guest's `vfs` driver expands layers substantially; loading all 15 service
images eagerly grew a disposable VM disk by about 32 GiB, so selection is
mandatory for image-consuming commands.

## Live result and remaining gate

Flutter 3.47.7 ran inside a Gondolin VM. A private Docker daemon started with
`vfs`, loaded a cached BusyBox archive, and ran a container with
`--network=none`. `overlay2` and Docker bridge networks failed in this guest:
kernel module insertion returned an exec-format error and bridge creation
reported `package not installed`. Therefore the full multi-container Compose
stack is **not yet verified or supported** in this dev guest build. The image cache avoids
remote image pulls but does not fix the guest networking limitation. A
single-process mock UX and in-VM Playwright can still use guest loopback.
External browser preview needs explicit [Gondolin ingress](https://earendil-works.github.io/gondolin/ingress/);
guest ports are not automatically exposed to macOS or Tailscale.

The next gate is to reconcile the dev guest's kernel and module artifacts (the
separate trusted builder VM already runs a private `overlay2` daemon), then
prove a Compose bridge and service-to-service traffic in a bounded VM test.
