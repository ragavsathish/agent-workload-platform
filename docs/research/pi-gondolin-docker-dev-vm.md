# Pi + Gondolin development VM

_Historical probe and design revision: 2026-10-19. The current task VM lifecycle
checkpoints durable Pi sessions for explicit disposal; see the
[Agent Session README](../../platform/agent-execution/gondolin-session/README.md)._

## Selection and lifecycle

Each durable task materializes a repository worktree. Its `.pi/gondolin.json`
selects the guest image, build inputs, CPU, memory, and network policy. Before
Pi starts, the task worker computes the image cache key from committed build
inputs. The declared `image` is a logical base tag; the effective Gondolin tag
also includes that cache key. The worker asks Gondolin whether this exact tag is
installed. On a local miss it dispatches the trusted image-builder workflow
from the snapshot's source branch, waits for completion, and imports the
versioned image from a host-local handoff directory. The Action runs in the
separate builder VM and writes only to that handoff directory; it does not
publish this development image to Gitea packages or the OCI registry.
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

Flutter 3.47.7 ran inside a Gondolin VM. Under the default QEMU backend, a
private Docker daemon started with `vfs`; `overlay2` failed because the guest
could not load the kernel module. Switching only the Docker flag is unsafe.
The development VM now selects Gondolin's libkrun backend, whose bundled
kernel exposes OverlayFS as built in. In the rebuilt dev rootfs,
`start-dev-docker` started a private daemon reporting `overlay2`, and a direct
OverlayFS write/read/remove probe passed. VFS is no longer selected for new
Docker development VMs.

The full multi-container Compose Patrol stack is still **not yet verified**.
The benchmark harness failed before starting its Pi VM; a direct session got
past Docker startup but its local mock inference broker did not become ready.
The image cache avoids remote image pulls but does not establish that the
Compose services can communicate correctly. A single-process mock UX and
in-VM Playwright can still use guest loopback.
External browser preview needs explicit [Gondolin ingress](https://earendil-works.github.io/gondolin/ingress/);
guest ports are not automatically exposed to macOS or Tailscale.

The next gate is to diagnose the mock broker startup and then prove the full
Compose service set and Patrol flow in a bounded VM test.
