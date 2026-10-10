# Host requirements

The public-facing workload is an immutable, rootless Podman appliance inside a dedicated libkrun
micro-VM. macOS retains only the hardware-accelerated inference services and initiates a narrow
reverse SSH connection into that VM.

## Required host

- Apple Silicon Mac running macOS 14 or newer
- 8 GiB RAM minimum; 16 GiB or more recommended
- 15 GiB free disk minimum; 35 GiB recommended for the VM, OCI images, and model caches
- Reliable outbound HTTPS and UDP access for OCI registries, model downloads, and Tailscale
- An iPhone or browser device signed into the same approved Tailscale account

The VM is configured for 4 vCPUs, 4 GiB RAM, and a 24 GiB sparse disk. MLX inference remains on
the Mac because Apple GPU acceleration is not available inside the Linux VM.

## Required software

Install these host tools before provisioning:

- Podman 5 or newer
- krunkit and libkrun (the Podman machine provider)
- uv and Python 3.13
- Node.js and npm (used only to produce the browser build)
- Ollama
- OpenSSH, curl, and the standard macOS LaunchAgent tooling

Docker Desktop, Kubernetes, k3s, and a Linux systemd installation on the Mac are not required.
systemd runs *inside* the Linux micro-VM through rootless Quadlet units. macOS uses LaunchAgents to
keep the VM, inference broker, and reverse tunnel alive.

Run the executable preflight report at any time:

```bash
make host-preflight
```

On a clean host, install the LaunchAgents before provisioning the Quadlet workload. The installer
waits for the host broker and VM; subsequent runs also wait for the existing containers to recover.

## Host configuration and credentials

`server/.env` must contain:

- a random `INFERENCE_BROKER_TOKEN` of at least 32 characters;
- the exact `OLLAMA_MODEL` permitted by the broker;
- the MLX Whisper and Kokoro model identifiers;
- the broker size and duration limits.

The background broker receives only those inference settings. Database credentials, Pi sessions,
subscription credentials, task queues, and host filesystem paths are not copied to its runtime.
The edge receives the broker token as a read-only Podman secret, not as an environment variable.

The user must authenticate the Tailscale sidecar once. No reusable Tailscale auth key is required:

```bash
make edge-status       # open the one-time login URL if shown
make edge-login        # bind the exact identity and HTTPS origin after login
```

`edge-login` enables Tailscale Serve only. It does not enable Funnel or anonymous Internet access.

## Models

Pull the configured Ollama model before first use:

```bash
make pull-model
```

MLX Whisper and Kokoro are cached by their Python libraries on first inference. Those downloads
require outbound access to their configured model registry and enough free disk for the selected
weights. Once cached, voice inference does not require a hosted speech API.

After installation, cache and exercise all three inference paths through the same authenticated
broker route used by the edge:

```bash
make edge-warm-models
```

## Host network contract

The only application listeners expected on macOS are:

| Address | Owner | Purpose |
|---|---|---|
| `127.0.0.1:9443` | inference broker | authenticated STT, TTS, and exact-model chat routes |
| `127.0.0.1:11434` | Ollama | local LLM inference |
| dynamic loopback port | Podman | SSH/API transport to the dedicated VM |

Nothing should listen on `0.0.0.0` or the Mac's LAN address for this deployment. The reverse SSH
forward is initiated by macOS and exposes only broker port 9443 on VM loopback. The VM has no macOS
home-directory or host-path mount.

Outbound access is required to the pinned OCI registries during provisioning, to Tailscale control
and relay endpoints, and to model registries during initial model download.

## Immutable inputs and updates

The Python, uv, Tailscale, and Podman machine OS inputs are pinned by OCI digest. Each provision:

1. checks the lockfiles and creates a clean browser build;
2. builds the edge from a temporary minimal context with network image resolution disabled;
3. renders Quadlet with the resulting edge image digest and `Pull=never`;
4. smoke-tests and deploys that exact image;
5. verifies rootless operation, all-zero capabilities, read-only filesystems, expected mounts,
   broker authorization, LaunchAgents, and absence of host filesystem shares;
6. removes only superseded images labelled as belonging to this project.

Use the repeated lifecycle test after host or dependency changes:

```bash
make edge-cycle-test
```

It performs three complete clean provisions and service restarts, then stops the VM and verifies
that the macOS keepalive agent restores the immutable workload. Override the count with
`EDGE_TEST_CYCLES=5 make edge-cycle-test`.

The checked-in digests and lockfiles make a deployment repeatable, but updates are intentional:
change a digest or dependency lockfile in source, review it, and reprovision. Do not use floating
container tags in deployed Quadlet files.

## Optional local task stack

Postgres/Absurd, the Pi worker, QEMU/Gondolin, and provider subscription login are required only for
the separate local agent-task workflow. They are not required for browser voice chat and are not
reachable from this edge deployment.
