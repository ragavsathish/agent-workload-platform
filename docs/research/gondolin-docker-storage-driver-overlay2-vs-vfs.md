# Docker storage in Gondolin: Overlay2 vs VFS

**Decision:** use Docker's classic `overlay2` driver for the development Compose stack inside Gondolin VMs. Keep startup fail-closed when OverlayFS is unavailable. Keep VFS as a deliberate diagnostic/control option, not the default.

**Status:** measured and functionally validated on the current development image, 2026-10-20. The storage comparison is a small two-run-per-driver benchmark, not a broad performance study.

## Scope

This compares Docker Engine running **inside the Linux guest** of a macOS Gondolin VM. It does not compare Docker Desktop's host-side storage. The controlled run used an 8 GiB guest, 4 vCPUs, a 64 GiB copy-on-write root disk, the same cached images, mounts, network policy, Compose files, and startup hook. The profile started the 15-service full-mock Compose stack and waited for its configured readiness checks. Four total runs were executed serially: two with VFS and two with Overlay2. No Patrol command ran during this comparison.

The currently tested configuration explicitly invokes `dockerd --storage-driver=overlay2`; `docker info` reported `overlay2`. The evidence therefore describes the classic Docker graph-driver path. Docker Engine 29 and later use the containerd image store by default on fresh installs, so any future Docker package upgrade should record `docker info -f '{{.DriverStatus}}'` and revalidate the selected backend. Docker distinguishes the containerd `overlayfs` snapshotter from classic `overlay2`. [Docker's containerd image store documentation](https://docs.docker.com/engine/storage/containerd/)

## Measured results

| Metric | VFS median (range) | Overlay2 median (range) | Overlay2 difference |
| --- | ---: | ---: | ---: |
| Time from session start to full Compose readiness | 106.628 s (103.906–109.350) | 61.264 s (60.946–61.582) | 42.5% lower |
| Guest root filesystem used (`df`) | 61.18 GiB | 10.37 GiB | 83.1% lower |
| Guest root filesystem available (`df`) | 1.75 GiB | 52.59 GiB | +50.84 GiB |
| `/var/lib/docker` apparent size (`du -sb`) | 54.50 GiB | 12.16 GiB | 77.7% lower |
| Driver directory apparent size (`du -sb`) | VFS dir: 54.44 GiB | Overlay2 dir: 12.10 GiB | — |

All four runs started the 15-service profile, loaded 14 unique images, and passed the explicit HTTP readiness checks; the one-shot volume and Grafana bootstrap jobs completed. Fluent Bit was started but has no HTTP readiness probe. `df` reports filesystem block usage; `du -sb` reports apparent file sizes, so those measures are intentionally shown separately. The temporary benchmark VMs were closed without saving checkpoints.

This is sufficient evidence to select a driver for this stack: Overlay2 saved roughly 50 GiB of guest root capacity and reached readiness about 45 seconds sooner in these runs. It is not a prediction for all Docker workloads, a claim about Patrol speed, or a high-confidence statistical estimate. The image cache was warm, runs were serial, and there were only two repetitions per driver.

## Why Overlay2 wins for this stack

Docker's VFS driver creates a deep copy of each parent image layer for each new layer. It has no copy-on-write (CoW) support, so it is intentionally useful as a compatibility fallback and for debugging, with a substantial storage and performance cost. This matches the observed expansion: the initial audit found about 6.4 GiB of logical image data but 58 GiB under `/var/lib/docker/vfs/dir`; the controlled VFS runs used about 54.44 GiB in that directory. [Docker VFS driver guide](https://docs.docker.com/engine/storage/drivers/vfs-driver/) and [storage driver overview](https://docs.docker.com/engine/storage/drivers/)

Overlay2 uses Linux OverlayFS to present image layers as a union filesystem. Image layers can be shared as read-only lower layers, with container writes held in a writable upper layer (copy-up when a lower-layer file is modified). That avoids VFS's repeated full parent-layer copies for this image-heavy Compose stack. Docker describes Overlay2 as its classic, broadly compatible driver for supported Linux systems. [Docker OverlayFS / Overlay2 driver guide](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/) and [Linux kernel OverlayFS documentation](https://docs.kernel.org/filesystems/overlayfs.html)

### Kernel and startup compatibility

The development guest now requires OverlayFS before Docker starts:

- `start-dev-docker.sh` checks `/proc/filesystems` and refuses to start Docker if `overlay` is unavailable. It explicitly starts `dockerd` with `--storage-driver=overlay2` and verifies an already-running daemon is using Overlay2.
- In the default QEMU guest kernel (`6.18.52-0-virt`), OverlayFS was supplied as a compressed `overlay.ko.gz` module. `modprobe overlay` alone failed with `Exec format error`; decompressing the module and inserting it with `insmod` worked. The startup script includes this fallback.
- The tested libkrun kernel (`6.12.68`) exposed OverlayFS as a built-in filesystem. Docker started with `overlay2`, and a direct overlay mount write/read/remove probe passed.
- A separate full-mock Compose Patrol run on QEMU passed both Patrol journeys with Docker reporting Overlay2. This proves functional use with that run's QEMU image and working egress. It is a validation, not a matched VFS-versus-Overlay2 Patrol timing comparison.

See the implementation in [`start-dev-docker.sh`](../../platform/agent-execution/gondolin-session/gondolin/start-dev-docker.sh) and the image setup in [`Dockerfile.dev`](../../platform/agent-execution/gondolin-session/gondolin/Dockerfile.dev).

## Alternatives considered

| Option | Assessment for this Gondolin guest | Decision |
| --- | --- | --- |
| **VFS** | Works without a CoW filesystem and is a useful known-good control. Deep-copies parent layers, producing the measured ~54.5 GiB Docker directory and slower startup. Docker describes it as intended mainly for testing or when no CoW-capable option is available. | Retain for debugging/comparison; don't use for the normal full Compose profile. |
| **Overlay2 (classic graph driver)** | Uses the guest kernel's OverlayFS and the current ext4-backed Docker data directory. Measured substantially smaller and faster; exercised by full-stack startup and a passing Patrol run. Needs usable OverlayFS support and compatible lower-layer behavior. | **Selected.** Fail closed rather than silently reverting to VFS. |
| **containerd image store with `overlayfs` snapshotter** | Newer Docker backend based on containerd snapshotters, distinct from classic Overlay2. Default for fresh Docker Engine 29+ installs. Docker notes it stores compressed and unpacked image data, which can use more disk than legacy drivers; its location is configured separately. We did not benchmark it in these VMs. | Revisit when the guest Docker Engine is upgraded or if snapshotter features are needed; measure it as a separate backend. |
| **Btrfs** | Offers CoW snapshots and thin provisioning but requires the Docker data root to be on Btrfs and adds filesystem/kernel setup. The current guest data root is on ext4; converting or adding a Btrfs data filesystem would change the VM image and maintenance model. Docker itself says Overlay2 is usually preferable and documents known Btrfs driver issues. | Not selected; no benefit demonstrated for this workload over Overlay2. [Docker Btrfs guide](https://docs.docker.com/engine/storage/drivers/btrfs-driver/) |
| **ZFS** | Provides snapshot/clone features, but requires a ZFS-backed Docker data root and ZFS kernel module/userspace setup. It adds guest image and operations complexity without a measured need here. Docker advises production use only for operators with substantial ZFS-on-Linux experience. | Not selected. [Docker ZFS guide](https://docs.docker.com/engine/storage/drivers/zfs-driver/) |
| **fuse-overlayfs** | Primarily intended for rootless Docker when rootless Overlay2 is unavailable. This guest runs a rootful daemon and has kernel OverlayFS support, so introducing a FUSE path is unnecessary. | Not selected. [Docker storage-driver selector](https://docs.docker.com/engine/storage/drivers/select-storage-driver/) |
| **devicemapper** | Legacy block-level thin-provisioning driver, removed from Docker Engine 25.0. | Not a viable current option. [Docker deprecated/removed features](https://docs.docker.com/engine/deprecated/) |
| **aufs / legacy `overlay`** | Both are removed from current Docker Engine versions (Engine 24.0); Overlay2 superseded the older `overlay` driver. | Not viable candidates. [Docker deprecated/removed features](https://docs.docker.com/engine/deprecated/) |

The VM filesystem itself remains a qcow2/copy-on-write virtual disk. Docker's Overlay2 storage driver is a separate layer inside the Linux guest. These two CoW layers serve different boundaries; the comparison changed Docker's in-guest driver while keeping the VM disk mode and size fixed.

## Networking is a separate concern

The full-mock Compose profile uses `network_mode: host` and guest-local service URLs. That is why the guest loopback interface and `127.0.0.1` route need to be available. It has no causal connection to Overlay2 versus VFS. The startup script normalizes loopback state across guest images; see [Gondolin loopback and Compose networking findings](gondolin-loopback-compose-networking.md). Docker documents host networking as sharing the host's network namespace. [Docker host network driver](https://docs.docker.com/engine/network/drivers/host/)

## Reproduction

Build both local guest image variants from the same base and cache, differing only in their storage-driver startup configuration. Then run the benchmark twice per driver, serially:

```sh
node platform/agent-execution/gondolin-session/benchmarks/benchmark-compose-storage.mjs \
  voice-agent-gondolin:dev-vfs-loopback-test vfs
node platform/agent-execution/gondolin-session/benchmarks/benchmark-compose-storage.mjs \
  voice-agent-gondolin:dev-overlay2-loopback-test overlay2
```

The benchmark runner records the readiness duration, selected driver, guest `df` values, Docker directory apparent sizes, and unique image count, then closes each session without saving a checkpoint. The two raw repetitions and medians are retained in [`benchmark-results.json`](../../platform/agent-execution/gondolin-session/benchmarks/benchmark-results.json); the consolidated benchmark report and separate Overlay2 Patrol results are in [`benchmarks/README.md`](../../platform/agent-execution/gondolin-session/benchmarks/README.md). The benchmark workload is the full-mock 15-service Compose startup; it does not route the Patrol journeys through `voice-edge`.

## References

- Docker, [Storage drivers overview](https://docs.docker.com/engine/storage/drivers/)
- Docker, [Select a storage driver](https://docs.docker.com/engine/storage/drivers/select-storage-driver/)
- Docker, [OverlayFS / Overlay2 storage driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)
- Docker, [VFS storage driver](https://docs.docker.com/engine/storage/drivers/vfs-driver/)
- Docker, [containerd image store](https://docs.docker.com/engine/storage/containerd/)
- Docker, [Btrfs storage driver](https://docs.docker.com/engine/storage/drivers/btrfs-driver/)
- Docker, [ZFS storage driver](https://docs.docker.com/engine/storage/drivers/zfs-driver/)
- Docker, [Deprecated Docker Engine features](https://docs.docker.com/engine/deprecated/)
- Linux kernel, [OverlayFS documentation](https://docs.kernel.org/filesystems/overlayfs.html)
- Docker, [Host network driver](https://docs.docker.com/engine/network/drivers/host/)
