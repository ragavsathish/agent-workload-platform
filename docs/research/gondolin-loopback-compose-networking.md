# Gondolin loopback and Compose networking

_Research note: 2026-10-20. Scope: the current agent-workload-platform
Gondolin development image and full-mock Compose profile on macOS, using the
project's captured QEMU Patrol run and a fresh krun startup observation._

## Finding

The broad claim that “QEMU brings loopback up while krun leaves it down” is not
supported by the evidence checked here. In a fresh krun session with no
`startupCommands`, the guest reported `lo UNKNOWN` with
`<LOOPBACK,UP,LOWER_UP>` and `127.0.0.1/8`, `::1/128`; `eth0` was also up. The
successful QEMU Patrol preflight likewise showed `lo` and `eth0` up. Thus, for
these specific image/runtime observations, both backends had loopback up before
the Docker startup hook normalized it. `UNKNOWN` is an operational state;
Linux documents administrative state separately. Here the `UP` flag and
assigned addresses show loopback was configured up ([Linux kernel operational
states](https://www.kernel.org/doc/html/latest/networking/operstates.html)).

The project startup hook currently runs `ip link set dev lo up` and assigns
`127.0.0.1/8` before starting Docker. This is a defensive normalization step
for this image family, not evidence that krun always leaves `lo` down. No
backend-wide conclusion follows from one image/build per backend, and the
Gondolin backend guide itself labels krun experimental and notes that some
krun networking edge cases remain under investigation ([Gondolin backend
guide](https://github.com/earendil-works/gondolin/blob/main/docs/backends.md)).

The earlier diagnosis also conflated distinct failures: the recorded initial
Patrol attempt failed with npm `EAI_AGAIN` resolving `registry.npmjs.org`.
That is a DNS resolution error; it is not evidence of `ENETUNREACH` caused by a
down loopback interface. The later QEMU Patrol preflight resolved the registry
and the run passed. The available artifacts do not substantiate an
`ENETUNREACH` report for this issue.

## Why the Compose profile uses loopback

The project replaces Compose's usual per-project bridge network with
`network_mode: host` for the services that need to communicate. The full-mock
override explains the reason in-repo: the guest Docker daemon cannot create
bridge networks, so service URLs are explicitly mapped to loopback. For
example, `voice-edge` points at `127.0.0.1:9444`, `:8000`, `:9450`, and `:4318`,
while other services point at their corresponding local ports. The dev
override uses the same host-network pattern for its selected services.

Docker documents that `network_mode: host` makes a container share the Docker
host's network stack; port publishing is unsupported in this mode, and service
name DNS resolution does not work. In this VM, the Docker host is the **guest
Linux VM**, not the macOS host. Consequently, containers in host mode share
that guest network namespace: a service listening on guest loopback can be
reached by another host-mode service through `127.0.0.1`. That is why the
override uses explicit loopback URLs and why guest `lo` needs to be usable.
Docker's standard Compose setup instead creates a default bridge network with
service-name discovery ([Compose networking docs](https://docs.docker.com/compose/how-tos/networking/)).

This loopback requirement is separate from Docker's `overlay2` image/layer
storage driver. Overlay2 does not provide network connectivity; Compose
network-mode selection determines how these containers share or isolate
network namespaces ([Docker network drivers](https://docs.docker.com/engine/network/drivers/),
[Docker overlay2 storage driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)).

Gondolin's network mediation also should not be confused with the guest's
loopback. Gondolin documents its controlled outbound network path and, for
libkrun, the backend parity guide warns of networking edge cases; neither
source establishes that krun leaves the Linux `lo` device down. The observed
guest interface state comes from `ip link`/`ip addr` inside the VM, not from
successful access to arbitrary host or Internet destinations. Gondolin's
network policy can block an outbound request even while loopback is up
([Gondolin security design](https://earendil-works.github.io/gondolin/security/),
[libkrun networking overview](https://github.com/libkrun/libkrun#networking)).

## Evidence and limits

- Project config: [`.pi/compose.full-mock.yml`](../../.pi/compose.full-mock.yml)
  says bridge networks are unavailable in the guest and maps service endpoints
  to `127.0.0.1`; [`.pi/compose.dev.yml`](../../.pi/compose.dev.yml) applies
  `network_mode: host` to selected dev services.
- Startup behavior: [`start-dev-docker.sh`](../../platform/agent-execution/gondolin-session/gondolin/start-dev-docker.sh)
  explicitly brings `lo` up and assigns `127.0.0.1/8` before it starts Docker
  with `--iptables=false --bridge=none`.
- QEMU observation: the successful Patrol run's saved Pi transcript is
  [`run-1.log`](../../artifacts/benchmarks/patrol-concurrent-1vm-2026-10-20T164656Z/run-1.log)
  (with the saved Pi transcript
  [`2026-10-20T16-46-56-830Z_patrol-2026-10-20T164656Z-1.jsonl`](../../artifacts/benchmarks/patrol-concurrent-1vm-2026-10-20T164656Z/run-1-pi-session/2026-10-20T16-46-56-830Z_patrol-2026-10-20T164656Z-1.jsonl)).
  The preflight includes `ip -br link` and `ip route`; the run used QEMU and
  completed successfully.
- krun observation: a fresh session on the same task image, before
  `start-dev-docker` ran, reported `lo UNKNOWN` with `LOOPBACK,UP,LOWER_UP`,
  `127.0.0.1/8`, and `::1/128`, and `eth0` up. A Node HTTP server bound to
  `127.0.0.1:18765` returned `loopback-ok` to a curl from the same guest. The
  structured local probe is
  [`krun-loopback-probe-2026-10-20.json`](../../artifacts/benchmarks/krun-loopback-probe-2026-10-20.json).
- These observations show the state for these configurations and boots. They
  do not prove that all versions, images, kernel builds, or startup paths behave
  identically. The explicit `lo` normalization remains useful as an idempotent
  setup guard; the evidence does not justify attributing it to a krun-only
  requirement.

## Primary sources

- [Gondolin backend comparison](https://github.com/earendil-works/gondolin/blob/main/docs/backends.md)
- [Gondolin security design and network architecture](https://earendil-works.github.io/gondolin/security/)
- [libkrun networking overview](https://github.com/libkrun/libkrun#networking)
- [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/)
- [Docker network drivers](https://docs.docker.com/engine/network/drivers/)
- [Docker OverlayFS storage driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)
- [Linux kernel interface operational states](https://www.kernel.org/doc/html/latest/networking/operstates.html)
