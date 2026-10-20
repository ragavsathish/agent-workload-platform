# Gondolin VM benchmark report

Measurements from a Mac mini M4 Pro with 14 CPU cores, 64 GiB memory, and
macOS 26.6.2. Each Patrol VM had four vCPUs, 8 GiB guest memory, and a 64 GiB
copy-on-write root disk. These results describe this host and workload; they
are not universal capacity limits.

This is the consolidated measurement and reproduction report. For rationale
and source references, see the [Overlay2/VFS storage research note](../../../../docs/research/gondolin-docker-storage-driver-overlay2-vs-vfs.md),
[loopback/Compose networking note](../../../../docs/research/gondolin-loopback-compose-networking.md),
and [checkpoint disk note](../../../../docs/research/gondolin-checkpoint-disk-optimization.md).

## Results

| Workload | Parallel VMs | Passed | Time per run | Peak VM RSS | Minimum free memory | Swap growth | Minimum free disk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Flutter web release build | 1 | 1/1 | 24.57 s | 3.68 GB | 51% | 0 MiB | 31 GiB |
| Flutter web release build | 2 | 2/2 | 25.29–27.44 s | 7.41 GB | 51% | 0 MiB | 31 GiB |
| Flutter web release build | 3 | 3/3 | 28.05–30.00 s | 9.75 GB | 44% | 0 MiB | 31 GiB |
| Flutter web release build | 4 | 4/4 | 31.19–32.40 s | 12.57 GB | 37% | 0 MiB | 30 GiB |
| Flutter web release build | 5 | 5/5 | 33.64–38.94 s | 10.70 GB | 35% | 835 MiB | 30 GiB |
| Patrol, current dev image | 3 | **3/3** | 176.71–181.44 s | 14.14 GB | 34% | 2,615 MiB | 290.49 GiB |
| Patrol, current dev image | 4 | **3/4** | 191.30–332.71 s | 16.41 GB | 34% | 2,648 MiB | 282.46 GiB |
| Patrol, current dev image | 5 | **0/5** | interrupted at 151.45–152.90 s | 16.48 GB | 34% | 1,509 MiB | 296.38 GiB |
| Patrol, current dev image, repeat | 5 | **4/5** | 220.85–224.26 s for completed runs; one interrupted at 17,354 s | 24.25 GB | 35% | -136 MiB | 63.96 GiB |

The latest three-VM Patrol tier passed the voice and workspace journeys in
each VM. All six traces passed inspection with no bad responses, unexpected
network failures, or console errors. The four-VM tier passed in three VMs;
the fourth stalled during Flutter dependency resolution and was interrupted
after 332.71 seconds. It did not save a VM checkpoint. Three successful
checkpoints were about 913 MiB each.

A five-VM attempt was stopped before any Patrol command completed. It exceeded
the configured 384 MiB swap-growth ceiling: the 5-second sample showed 1,481
MiB growth and final growth was 1,509 MiB. This run began with only 821 MiB of
free swap while other Gondolin VMs were active. The stop used SIGINT; none of
the five sessions saved a guest checkpoint. The retained host workspaces and
raw result are in `artifacts/benchmarks/patrol-concurrent-5vm-2026-10-20T093556Z/`.

The three-VM sessions were then resumed concurrently in fresh Pi processes.
All three guest commands passed. Each Pi process took about 13.13 seconds for
the resume probe and command.

A later five-VM run completed Patrol in four VMs in 220.85–224.26 seconds each.
The fifth VM remained in its Flutter build for 17,354 seconds (about 4 h 49 m)
without producing a command exit status, so I interrupted it to continue the
Compose comparison. Swap did not grow during this run (-136 MiB net), minimum
free host memory was 35%, and minimum free disk was 63.96 GiB. The four
successful VMs retained checkpoints of about 0.89 GiB each; the interrupted
VM did not retain a checkpoint. This is 4/5 observed success, not a reliable
5/5 capacity result. The raw result and per-VM logs are under
`artifacts/benchmarks/patrol-concurrent-5vm-2026-10-20T120631Z/`.

The earlier lightweight build tier completed at four VMs without measured
swap growth. Five VMs completed, but swap grew by about 835 MiB. Patrol uses
more memory and takes longer. Three is the highest 100%-passing Patrol tier
measured here. Four is not established as reliable; five has one 4/5 run and
one earlier attempt stopped by the swap guard before Patrol began. The guard
can overshoot its configured ceiling because host resource sampling occurs
every five seconds.

## Full Compose stack with local mocks

The full-stack profile passed one Patrol run on 2026-10-20 in 260.86 seconds
with an 8 GiB, 4-vCPU VM. It started 15 Compose services and passed the
stack's dependency health and endpoint readiness gates:
`agent-gateway`, `fluent-bit`, `gitea`, `grafana-mcp`,
`grafana-mcp-bootstrap`, `habitat`, `otel-lgtm`, `oxigraph`, `oxigraph-init`,
`postgres`, `s3mock`, `s3mock-init`, `trace-render-worker`, `traefik`, and
`voice-edge`. The only omitted Compose service was Tailscale; the profile uses
local ingress identity instead. Native inference was replaced by the local
deterministic broker mock. S3Mock is the stack's test S3 implementation.

Patrol itself ran the voice shell/navigation journey and the workspace HTTP
journey. The workspace journey targets the harness's local fixture server;
the voice journey checks the UI shell and navigation. Neither journey was
routed through the Compose voice edge. The Compose services were started and
readiness-checked alongside the browser tests, so this measures Patrol plus
full-stack startup/resource load, not end-to-end Patrol integration with the
Compose services.

The run passed (`piExitCode: 0`, `commandExitCode: 0`), reported -8 MiB swap
growth, 60% minimum free host memory, and 153.94 GiB minimum free disk from a
213.15 GiB baseline. The runner's registered-process RSS metric peaked at
16.74 GB; treat it as an aggregate process metric rather than guest RAM use.
At the time, the retained checkpoint directory occupied about 59 GiB. A
second successful 14-service checkpoint from the preceding run was similar.
Both saved VFS checkpoints have since been disposed; their logs and result
records remain. A five-VM full-stack run was not attempted: five
copies at the observed disk footprint would need roughly 295 GiB, while this
host had 154 GiB free after the successful run and less than 0.5 GiB of free
swap.

The 59 GiB was mostly Docker's private data inside the guest, not Patrol
output. An offline audit showed 58 GiB under `/var/lib/docker/vfs/dir`; Docker
volumes accounted for about 115 MiB and Playwright browsers used 2.5 GiB. VFS
layer-copy behavior, OverlayFS kernel support, and the fail-closed Overlay2
startup requirement are documented in the [storage research note](../../../../docs/research/gondolin-docker-storage-driver-overlay2-vs-vfs.md).

### Controlled VFS versus Overlay2 startup

On 2026-10-20, I ran two sequential full-mock Compose startups with each Docker
storage driver. All four runs used the same krun guest setup (8 GiB, 4 vCPUs, 64 GiB
copy-on-write root disk), image cache, mounts, Compose services, local broker,
and readiness checks. The 15-service profile started in both runs; all explicit
HTTP probes passed, and the one-shot volume and Grafana bootstrap containers
completed successfully. Fluent Bit was started but has no HTTP readiness probe.
No Patrol journey ran in this comparison, so these numbers describe guest boot,
cached image loading, Compose startup, and service readiness rather than Patrol
time.

| Metric | VFS | Overlay2 | Overlay2 change |
| --- | ---: | ---: | ---: |
| Time to full-stack readiness (median; range) | 106.628 s (103.906–109.350) | 61.264 s (60.946–61.582) | 42.5% faster |
| Guest root filesystem used (`df`) | 61.18 GiB | 10.37 GiB | 83.1% lower |
| Guest root filesystem available | 1.75 GiB | 52.59 GiB | +50.84 GiB |
| Docker directory apparent size (`du -sb`) | 54.50 GiB | 12.16 GiB | 77.7% lower |
| Active driver directory apparent size (`du -sb`) | VFS: 54.44 GiB | Overlay2: 12.10 GiB | — |

These are two runs per driver, a small repeatability check rather than a large
statistical sample. The `du -sb` numbers are apparent file sizes; `df` is the
guest filesystem usage measurement. All four VMs were disposable and closed
without saving checkpoints. A VFS run used about 55 GiB of guest Docker data
and temporarily consumed about 55 GiB of host disk; host free space returned
after disposal. The structured record, including both raw repetitions, is in
[`benchmark-results.json`](benchmark-results.json).

The Compose overrides use host networking and service URLs on `127.0.0.1`.
Loopback behavior and backend-specific probes are documented in the
[loopback/Compose networking note](../../../../docs/research/gondolin-loopback-compose-networking.md).
Networking is independent of the Docker storage driver.

Repeat either arm after building the corresponding local guest image:

```sh
node platform/agent-execution/gondolin-session/benchmarks/benchmark-compose-storage.mjs \
  voice-agent-gondolin:dev-vfs-loopback-test vfs
node platform/agent-execution/gondolin-session/benchmarks/benchmark-compose-storage.mjs \
  voice-agent-gondolin:dev-overlay2-loopback-test overlay2
```

The runner prints one JSON result line and closes the guest without saving a
checkpoint. The temporary image tags above are local benchmark inputs; use
image variants built from the same guest base when repeating the comparison.

Repeat the one-VM full-stack profile with:

```sh
GONDOLIN_BENCHMARK_IMAGE="$PWD/artifacts/gondolin-dev-overlay2-qemu-v2/aarch64" \
python3 platform/agent-execution/gondolin-session/benchmarks/run-patrol-concurrency.py \
  --parallelism 1 --vm-memory 8G --vm-cpus 4 --max-swap-growth-mib 4096 \
  --full-compose-mock --vmm qemu \
  --overlay .pi/compose.dev.yml \
  --overlay products/voice-agent/apps/client/patrol_test/workspace_web_test.dart \
  --overlay products/voice-agent/apps/client/tool/inspect-patrol-trace.mjs
```

### Overlay2 Patrol result

The 2026-10-20 follow-up passed in one QEMU VM. Docker reported `overlay2`; the
guest resolved `registry.npmjs.org`; `npm ci`, Playwright Chromium setup, and
`npm run test:patrol` exited successfully. The voice shell/navigation journey
and typed conversation/durable-work journey each passed (2 passed, 0 failed).
Their traces recorded 746 and 828 network requests, with zero bad responses,
network failures, or console errors. The full-mock Compose stack started its 15
services; inference and tailnet identity/ingress used local mocks.

| Metric | Result |
| --- | ---: |
| VM and storage | QEMU, 8 GiB, 4 vCPUs, Docker Overlay2 |
| Runner duration | 212.16 s |
| Peak registered VM RSS | 14.99 GiB |
| Minimum host free memory | 60% |
| Swap growth | 0 MiB |
| Host free disk, before → minimum | 89.40 → 80.18 GiB |
| Retained guest checkpoint | 0; explicitly disposed |

The QEMU kernel ships OverlayFS as a compressed module. `modprobe` alone
returned `Exec format error`; the dev image now decompresses the module before
inserting it. QEMU was used for working guest egress while keeping the same
Overlay2 storage driver. The earlier krun attempt had `EAI_AGAIN` resolving the
npm registry. The QEMU image build ID is
`3cb3c5e4-fce3-5b31-a4ca-8ab9e314f9d9`.

Raw result, session transcript, reports, and trace evidence are under
[`artifacts/benchmarks/patrol-concurrent-1vm-2026-10-20T164656Z/`](../../../../artifacts/benchmarks/patrol-concurrent-1vm-2026-10-20T164656Z/)
in the ignored local artifacts tree. The run is recorded in
[`benchmark-results.json`](benchmark-results.json) for the OTLP publisher
below. The saved qcow2 checkpoint from the preceding VFS full-stack Patrol run
was disposed; its raw logs and result remain in the ignored artifacts tree.

## VM startup, resume, and disk

The sequential lifecycle probe used the previous dev image, so compare it as a
separate measurement from the current-image Patrol runs.

| Measurement | Result |
| --- | ---: |
| Cold startup, median of three | 1.456 s |
| Fresh checkpoint resume | 1.152 s |
| Resume Patrol checkpoints, median of three | 1.144 s |
| Save a fresh checkpoint | 49 ms; 13.4 MiB allocated |
| Save a Patrol checkpoint after resume | 415 ms; 1.80 GiB allocated |
| Retained Patrol checkpoint sizes in that probe | 1.80, 0.92, and 1.80 GiB |

The root disk advertises 64 GiB; these values are allocated checkpoint space.
Startup timing includes VM creation or resume, guest boot, and startup
commands. It excludes Pi startup, model time, and Patrol execution.

## Repeat the Patrol benchmark

Run one Patrol command in each independent Pi VM:

```sh
python3 platform/agent-execution/gondolin-session/benchmarks/run-patrol-concurrency.py \
  --parallelism 5 --vm-memory 6G --vm-cpus 2 --max-swap-growth-mib 4096 \
  --overlay products/voice-agent/apps/client/patrol_test/workspace_web_test.dart \
  --overlay products/voice-agent/apps/client/tool/inspect-patrol-trace.mjs
```

The runner records raw evidence under ignored `artifacts/benchmarks/` and
supports 1–8 VMs. It requires at least 25% free host memory before starting
and stops on low swap growth, disk, or free-memory headroom. VM memory and CPU
limits can be set per run. It uses the current Git HEAD and the current
prebuilt dev image by default. Set
`GONDOLIN_BENCHMARK_IMAGE` to select another image. MCP servers and automatic
skill discovery are disabled during the measurement; this keeps the load
focused on VM-backed development and makes it optimistic for fully connected
Pi sessions.

To measure VM lifecycle using a Patrol run's `result.json`, pass that file to
the lifecycle probe:

```sh
node platform/agent-execution/gondolin-session/benchmarks/benchmark-task-vm-lifecycle.mjs \
  artifacts/benchmarks/patrol-concurrent-3vm-<timestamp>/result.json
```

## Instrumentation

[`benchmark-results.json`](benchmark-results.json) is the single curated,
machine-readable result file. It contains the lightweight and Patrol tiers,
resume verification, and lifecycle measurements. The OTLP publisher reads
this file and emits the concurrency, lifecycle, and VFS/Overlay2 storage
comparison gauges:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
  node platform/agent-execution/gondolin-session/benchmarks/publish-otel.mjs \
  platform/agent-execution/gondolin-session/benchmarks/benchmark-results.json
```

Publishing sends the recorded measurements to the configured OTLP endpoint;
it does not run a benchmark. Saved qcow2 checkpoint disks from the completed
benchmark VMs have been disposed. Ignored local logs, traces, workspaces, and
result records remain for inspection.
