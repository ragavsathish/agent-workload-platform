# Pi + Gondolin development VM

_Architecture and original probe notes, 2026-10-19. The measured implementation
status was updated on 2026-10-20; see the [benchmark report](../../platform/agent-execution/gondolin-session/benchmarks/README.md),
[Overlay2 storage decision](gondolin-docker-storage-driver-overlay2-vs-vfs.md),
[loopback findings](gondolin-loopback-compose-networking.md), and
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

The optional [Compose cache preparer](../../platform/agent-execution/gondolin-session/gondolin/prepare-compose-cache.clj)
exports per-image archives and a no-pull override without building source. The
path in `GONDOLIN_DEV_IMAGE_CACHE` is mounted read-only at `/image-cache` and
contains the repository's Compose index and override. Set
`GONDOLIN_DEV_IMAGE_STORE` to the shared store root, mounted read-only at
`/image-store`. Tar archives live at `agent/images` in that store, following
K3s's preload directory convention. Each repository keeps its own
index and override while all VMs mount the same archive bytes. Pruning one
repository's index cannot remove archives used by another. SHA-256 checksums
in the index are verified before loading.
The `Prepare Compose image cache` Gitea workflow runs this export in the trusted
builder VM and writes to its separate host-mounted Compose-cache handoff. The
host importer verifies each archive checksum before installing it into the
shared store and updating the repository index. Services with Compose `build:`
entries are left for each task VM to build from its checked-out source. The
existing VM-image workflow and handoff remain independent.
`dev-compose` loads only images named in `COMPOSE_CACHE_SERVICES` into each VM's private
Docker data root, then uses the worktree-selected `COMPOSE_FILE` plus the
override. The image archives are shared;
the loaded store and all mutable runtime state are not. Worktree `.env` files
remain worktree-local and are not copied from host process environment.
Docker uses Overlay2 in the development VM. The earlier VFS disk-growth
observation is superseded by the controlled VFS/Overlay2 comparison in the
[storage decision note](gondolin-docker-storage-driver-overlay2-vs-vfs.md).

## Verified status (2026-10-20)

The dev image loads OverlayFS as needed and requires Docker's `overlay2`
storage driver; it fails closed if OverlayFS is unavailable. Both the libkrun
and QEMU guest kernels were validated, with QEMU used for the passing Patrol
run because it had working registry DNS in that test. The full-mock profile
started 15 services and passed readiness checks. A separate Patrol run passed
both journeys, but those journeys were not routed through voice-edge. See the
[benchmark report](../../platform/agent-execution/gondolin-session/benchmarks/README.md)
for exact scope and evidence paths. The measured storage tradeoff and
alternative backends are in the [Overlay2 storage note](gondolin-docker-storage-driver-overlay2-vs-vfs.md).

External browser preview still requires explicit [Gondolin ingress](https://earendil-works.github.io/gondolin/ingress/);
guest ports are not automatically exposed to macOS or Tailscale.
