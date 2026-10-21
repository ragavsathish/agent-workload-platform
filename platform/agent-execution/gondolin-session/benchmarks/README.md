# Gondolin VM benchmark report

Measurements from a Mac mini M4 Pro with 14 CPU cores, 64 GiB memory, and
macOS 26.6.2. The standalone Patrol tiers used four vCPUs and 8 GiB memory
per VM; the latest Compose plus Patrol runs used two vCPUs and 6 GiB memory.
Both used a 64 GiB copy-on-write root disk. These results describe this host and workload; they
are not universal capacity limits.

This is the consolidated findings report. Run measurements through the shared
[Ansible benchmark workflow](../../../../products/voice-agent/automation/playbooks/benchmark.yml);
see the [task guide](../benchmarks_py/docs/BENCHMARK_TASK.md) and
[category inputs](../benchmarks_py/docs/BENCHMARK_CATEGORIES.md). For rationale
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
successful VMs initially retained checkpoints of about 0.89 GiB each; these
benchmark checkpoints have since been disposed. This is 4/5 observed success,
not a reliable 5/5 capacity result. The raw result and per-VM logs are under
`artifacts/benchmarks/patrol-concurrent-5vm-2026-10-20T120631Z/`.

The earlier lightweight build tier completed at four VMs without measured
swap growth. Five VMs completed, but swap grew by about 835 MiB. Patrol uses
more memory and takes longer. Three is the highest 100%-passing Patrol tier
measured here. Four is not established as reliable; five has one 4/5 run and
one earlier attempt stopped by the swap guard before Patrol began. The guard
can overshoot its configured ceiling because host resource sampling occurs
every five seconds.

## Parallel full Compose startup

The 2026-10-21 Allure-enabled one-VM validation passed Compose readiness,
both Patrol journeys, browser trace checks, and the OTEL canary. It produced
one Allure test result with the Oracle verdict attached and generated a
[local HTML report](../../../../artifacts/benchmarks/patrol-evidence/compose-overlay2-1vm-2026-10-21T101852Z/allure-report/index.html).
The complete benchmark took 168.643 seconds; the
[raw result](../../../../artifacts/benchmarks/compose-overlay2-1vm-2026-10-21T101852Z/result.json)
records the Allure paths. The preceding three-VM result was also converted
into its own Allure generation. The shared ignored
`artifacts/benchmarks/oracle-allure-history.jsonl` now contains both
generations, with VM 1 linked by a stable history ID. Allure generation
happens after the measured VM time and does not change the Oracle verdict.

The 2026-10-21 rerun with the Babashka Oracle passed in all three independent
QEMU/Overlay2 VMs. Each VM started Compose, completed both Patrol journeys,
validated its two browser traces, and retrieved its own OTLP canary from
Tempo. Readiness took 45.695–47.866 seconds and Patrol took
157.047–161.394 seconds per VM. The complete run, including Oracle and VM
disposal, took 219.787 seconds. Minimum free host memory was 63%, swap did not
grow, and minimum free disk was 99.13 GiB. The
[raw rerun](../../../../artifacts/benchmarks/compose-overlay2-3vm-2026-10-21T092953Z/result.json)
contains all three Oracle verdicts. It finished 12.062 seconds faster than
the earlier three-VM run, a single-run difference rather than a measured
performance improvement. No benchmark checkpoints were saved.

The 2026-10-21 one-VM validation of the Gondolin
[`oracle.clj`](../tools/oracle.clj) tool passed Compose readiness, both Patrol
journeys, browser trace checks, and a collector-to-Tempo OTLP canary. The
benchmark harness invoked the Babashka tool inside the VM and captured its
JSON verdict. Readiness took 38.964 seconds, Patrol 131.656 seconds, and the
complete run including Oracle and VM disposal took 173.827 seconds. Host swap
did not grow. The [raw result](../../../../artifacts/benchmarks/compose-overlay2-1vm-2026-10-21T091932Z/result.json)
contains the verdict and trace IDs.

The 2026-10-21 trace and OTEL oracle validation passed in three independent
QEMU/Overlay2 VMs. Each VM started the six-service dev Compose profile, ran
both Patrol journeys, passed the browser-trace checks, and returned its
unique OTLP canary span from Tempo. Compose readiness was 46.556–46.852 seconds;
Patrol took 161.156–174.186 seconds per VM. Total elapsed time including
oracle checks and disposal was 231.849 seconds. Host swap did not grow;
minimum free memory was 61% and minimum free disk was 99.22 GiB. The
[raw oracle run](../../../../artifacts/benchmarks/compose-overlay2-3vm-2026-10-21T090717Z/result.json)
and its per-VM `patrolOracle` verdicts are retained. This tests the OTEL
collector-to-Tempo path; Patrol still uses its local HTTP fixture and does not
exercise the Compose voice edge. An earlier oracle-enabled three-VM attempt
stalled before one VM reached Patrol and was stopped; its other two completed
traces were preserved under ignored artifacts. The passing retry used bounded
npm fetching and a 360-second Patrol phase timeout. No benchmark VMs or
checkpoints were retained.

### Full-mock application-span qualification

The new shared Compose cache includes the four host-built application images
alongside the pulled images. A one-VM full-mock trial loaded them through the
normal `dev-compose` preload path, with no temporary multi-image archive. It
passed all three Patrol journeys and the browser, OTLP canary, and voice-edge
span oracles. Readiness took 87.544 seconds and the complete run took
272.351 seconds; see the [cache-backed one-VM result](../../../../artifacts/benchmarks/compose-overlay2-1vm-2026-10-21T123400Z/result.json).

Gitea Compose-cache run 64 then built the four application images through the
Go host API from committed revision `831a417`, exported 15 unique images for
16 services, and imported the handoff into the shared VM store. A fresh
one-VM full-mock run using only that imported cache passed all three Patrol
journeys and the browser-trace, OTLP canary, and voice-edge span oracles.
Compose readiness was 84.203 seconds, Patrol took 161.030 seconds, and the
complete run took 249.506 seconds. Host swap did not grow; the benchmark VM
and checkpoint were disposed. See the [Gitea-cache validation result](../../../../artifacts/benchmarks/compose-overlay2-1vm-2026-10-21T133601Z/result.json)
and its [Allure report](../../../../artifacts/benchmarks/patrol-evidence/compose-overlay2-1vm-2026-10-21T133601Z/allure-report/index.html).
This validates a committed-revision benchmark baseline. Edited application
source in an interactive Pi session is built inside that session's VM.
Run 64 records the earlier build-enabled workflow. The current Gitea cache job
pulls registry images only; a fresh full-mock trial must build its application
services in the VM before making the same claims.

A subsequent three-VM cache-backed trial reached Compose readiness in all
three guests in 103.075–106.292 seconds. Two guests produced all three Patrol
trace sets in their temporary workspaces; the third stalled in its first
Patrol target. The 600-second Patrol phase limit terminated the run, and the
runner disposed all three VMs without retaining those temporary traces or
per-VM Oracle verdicts. Minimum free host memory was 56%, swap did not grow,
and minimum free disk was 63.1 GiB. The [failed raw result](../../../../artifacts/benchmarks/compose-overlay2-3vm-2026-10-21T123847Z/result.json)
records the timeout. This trial does not establish whether the cache changes
parallel Patrol reliability; the earlier archive-backed three-VM trial below
passed once.

An earlier 2026-10-21 run used a freshly built QEMU development image with
Babashka and the current `dev-compose` installed. Three independent VMs
(6 GiB RAM and 2 vCPUs each) started the full-mock Compose profile in
parallel, then each ran one Patrol suite with all three journeys. All three
passed the browser-trace oracle, the OTLP canary, and the voice-edge
`browser.pi.turn` span check correlated to the live browser request. Compose
readiness took 95.824–96.045 seconds; Patrol took 203.404–213.185 seconds
per VM; the full run including Oracle and disposal took 322.528 seconds.
Minimum free host memory was 60%, host swap did not grow, and minimum free
disk was 63.59 GiB. The [raw result](../../../../artifacts/benchmarks/compose-overlay2-3vm-2026-10-21T121723Z/result.json)
and [Allure report](../../../../artifacts/benchmarks/patrol-evidence/compose-overlay2-3vm-2026-10-21T121723Z/allure-report/index.html)
contain the per-VM evidence. No VM checkpoints were retained. Startup
includes importing four host-built application images from a temporary
archive in each VM; it is not directly comparable with the six-service
dev-profile runs.

On 2026-10-21, a separate one-VM QEMU/Overlay2 run started the full-mock
Compose profile and passed all three Patrol journeys: voice shell, fixture
workspace, and a typed turn forwarded through the running voice-edge. Compose
readiness took 78.608 seconds, Patrol took 167.890 seconds, and the complete
run including Oracle and disposal took 251.133 seconds. All three browser
traces had zero bad responses, network failures, and console errors. The live
journey recorded `POST /api/pi-message` with HTTP 200. Oracle retrieved both
its independent OTLP canary and the `pipecat-voice-edge.browser.pi.turn`
application span under the live journey's trace ID from Tempo. See the
[raw result](../../../../artifacts/benchmarks/compose-overlay2-1vm-2026-10-21T115521Z/result.json)
and [Allure report](../../../../artifacts/benchmarks/patrol-evidence/compose-overlay2-1vm-2026-10-21T115521Z/allure-report/index.html).

This run staged Babashka and the current `dev-compose` wrapper into an older
local VM image, then imported four host-built application images before
Compose startup. Its readiness time includes that import and should not be
compared directly with the earlier six-service image-cache run. The
qualification result and trace evidence are retained; the staging tar and
Babashka copy were temporary local inputs.

The preceding manual dev-stack benchmark uses the VM image built by Gitea run 57
and the Compose cache prepared by Gitea run 58. Three independent QEMU guests
(6 GiB RAM, 2 vCPUs each) started the six active dev Compose services with
Overlay2, then each ran both Patrol journeys. All three passed Compose
readiness in 45.781–46.493 seconds and Patrol in 161.381–168.530 seconds.
The last Patrol run finished 215.685 seconds after VM startup began. All six
captured traces passed inspection with no unexpected network failures or
console errors. Host swap did not grow; minimum free memory was 62%, and
minimum free disk was 99.54 GiB. The
[manual Compose plus Patrol report](../../../../artifacts/benchmarks/ansible/20261021T081514Z-compose_parallel-1e70eea1/report.md)
contains the inputs and per-VM evidence. Patrol's voice and workspace
journeys use their local fixture server; they do not exercise the Compose
voice edge. The run enabled Patrol's browser HTTPS-ignore option because the
Gondolin proxy certificate is not trusted by Chromium for external font
requests in this image. This is one successful trial, not a capacity limit.

The preceding Compose-only baseline uses the same Gitea-built image
and the Compose cache prepared by Gitea run 58. Three independent QEMU guests
(6 GiB RAM, 2 vCPUs each) started the six active dev Compose services,
including the one-shot Oxigraph volume initializer, with Overlay2. All three
passed the Compose and endpoint readiness gates in 48.719–49.111 seconds;
wall clock was 49.111 seconds. Host free memory bottomed at 65%, swap did not
grow, and free disk bottomed at 104.16 GiB before recovering after VM disposal.
The [manual run report](../../../../artifacts/benchmarks/ansible/20261021T073553Z-compose_parallel-8258b69c/report.md)
contains inputs and per-VM evidence. This measures dev-stack startup, with no
Patrol journey. Neither dev-stack run is directly comparable to the full-mock 15-service
measurements below.

I started the full-mock Compose profile in independent Overlay2 VMs at the
same time. This measures startup and readiness only; no Patrol command ran.
The first version of the runner pinned krun; after settling on QEMU, I changed
its default to QEMU and repeated the tuned four-VM run there. All runs used a
64 GiB copy-on-write root disk, 14 cached images, and a read-only image cache.

| Parallel VMs | Backend and VM resources | Outcome | Time to readiness per VM | Wall clock | Host swap growth | Minimum free memory | Minimum free disk |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2 | krun, 8 GiB, 4 vCPUs | 2/2 ready | 65.443–65.510 s | 67.085 s | 0 MiB | 57% | 201.41 GiB |
| 3 | krun, 8 GiB, 4 vCPUs | Guard tripped; timing record inconsistent | 72.559–72.756 s recorded | 48.494 s (inconsistent) | 442.44 MiB sampled | 34% | 199.77 GiB |
| 4 | krun, 8 GiB, 4 vCPUs | Starts completed; memory floor breached | 80.689–81.929 s | 81.930 s | 0 MiB sampled through 33.3 s | 39% | 204.93 GiB |
| 4 | QEMU, 6 GiB, 2 vCPUs, 1 GiB guest swap | 4/4 ready | 87.561–88.647 s | 90.005 s | 0 MiB | 59% | 172.72 GiB |
| 4 | QEMU, 6 GiB, 2 vCPUs, no guest swap | 4/4 ready | 86.097–86.758 s | 88.907 s | 0 MiB | 58% | 176.49 GiB |

The two-VM result is one successful trial, not a capacity guarantee. Both
guests reported `overlay2`, used about 10.35 GiB on their guest root filesystems,
and reported about 12.16 GiB apparent Docker data. All 15 Compose services
passed startup readiness. The three-VM record is not comparable: its readiness
times (about 72.6–72.8 s) exceed the recorded wall clock (48.494 s), so it is
excluded from startup-time comparisons pending a rerun. It did record 442.44
MiB swap growth and 34% minimum free memory.

The earlier four-VM, 8 GiB krun run completed its four `session.start()` calls
in about 80.7–81.9 s, but free memory crossed the 40% floor at 33.3 s. A later
host reading showed swap 6,884 MiB above the run's baseline. Since that runner
stopped sampling at 33.3 s and waited for startup promises, it cannot attribute
that whole increase to the benchmark. The runner now closes guests at the first
guard trip and samples during shutdown and after closure.

With QEMU, 6 GiB RAM and 2 vCPUs per guest, all four stacks passed readiness
while free memory stayed at or above 58%; host swap was unchanged through
shutdown. A matched run with 1 GiB guest swap used at most 892 KiB of it; the
run without guest swap also passed, with similar readiness and host memory
results. These trials show no benefit from guest swap for this workload. Keep it
disabled by default to avoid writing an extra 1 GiB file into each guest disk.
The lower RAM and CPU settings are the meaningful change compared with the
8 GiB/4-vCPU trial. Each QEMU guest reported `overlay2`, 14 images, and passed
the Compose readiness gate. No checkpoints were saved. These are single trials,
not a capacity guarantee. The host still reports about 39.8 GiB used swap, but
that value was unchanged during both tests and free memory recovered to 70%.

Raw records are in ignored `artifacts/benchmarks/compose-full-mock-overlay2-*`
directories; curated summaries are in [`benchmark-results.json`](../benchmarks_py/benchmark-results.json).

## Full Compose stack with local mocks

An initial full-stack profile run used VFS and passed one Patrol run on
2026-10-20 in 260.86 seconds with an 8 GiB, 4-vCPU VM. It started 15 Compose services and passed the
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
[`benchmark-results.json`](../benchmarks_py/benchmark-results.json).

The Compose overrides use host networking and service URLs on `127.0.0.1`.
Loopback behavior and backend-specific probes are documented in the
[loopback/Compose networking note](../../../../docs/research/gondolin-loopback-compose-networking.md).
Networking is independent of the Docker storage driver.


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
[`benchmark-results.json`](../benchmarks_py/benchmark-results.json) for the OTLP publisher
below. The saved qcow2 checkpoint from the preceding VFS full-stack Patrol run
was disposed; its raw logs and result remain in the ignored artifacts tree.

### Staged QEMU qualification with strict host guardrails

On 2026-10-20, I repeated the full-mock Compose plus Patrol run with QEMU,
Overlay2, 6 GiB RAM, 2 vCPUs, and no guest swap. The benchmark required at
least 40% free host memory, at most 128 MiB host swap growth, at least 256 MiB
free host swap, and at least 100 GiB free disk. Each Pi VM started its own
15-service Compose stack, waited for service and endpoint readiness, then ran
the Patrol suite (voice shell/navigation and workspace HTTP journeys). The
benchmark runner explicitly disposed its saved guest checkpoint after each
Pi process exited.

| Parallel VMs | Patrol commands passed | Journey results | Time per VM | Peak combined QEMU RSS | Minimum free memory | Host swap growth | Minimum free disk |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1/1 | 2/2 passed | 215.69 s | 12.37 GB | 71% | -152.06 MiB | 200.14 GiB |
| 3, first trial | 2/3 | 5/6 passed | 259.04–273.97 s | 32.82 GB | 60% | -8 MiB | 179.99 GiB |
| 3, repeat | 3/3 | 6/6 passed | 278.57–282.27 s | 31.90 GB | 57% | 0 MiB | 177.33 GiB |
| 4 | 4/4 | 8/8 passed | 326.43–331.36 s | 25.81 GB | 42% | -16 MiB | 166.00 GiB |

Per-VM duration runs from Pi launch through guest startup, Compose readiness,
dependency installation, Playwright setup, Patrol, and shutdown. It is an
end-to-end duration, not a standalone VM boot or Compose readiness time. RSS
is the sum of registered QEMU process RSS samples, not guest working-set bytes.

The one-VM qualification passed. In the first three-VM trial, all guests
reached the full Compose readiness gate and reported Docker `overlay2`; two
Patrol suites passed both journeys. The remaining guest passed one journey,
then its other journey failed while installing Node.js dependencies with
`npm error code ETIMEDOUT`. A repeat passed all three suites. The four-VM tier
then passed all four suites. Every recorded trace had zero bad responses and
zero network failures; Patrol reported zero console errors.

Four VMs are the highest tier tested in this sequence, not yet a repeated
reliability result. Its minimum free host memory was 42%, two points above the
40% stop floor. Host swap growth and free disk stayed within their limits.

The first one-VM attempt in this sequence was invalidated by a runner typo that
called `npm run test:patrol.`; the command was corrected before recording the
passing result above. Raw results, logs, traces, and isolated workspaces are in
the ignored local artifacts tree at
[`patrol-concurrent-1vm-2026-10-20T175530Z`](../../../../artifacts/benchmarks/patrol-concurrent-1vm-2026-10-20T175530Z/)
and
[`patrol-concurrent-3vm-2026-10-20T175914Z`](../../../../artifacts/benchmarks/patrol-concurrent-3vm-2026-10-20T175914Z/).
The successful three-VM repeat and four-VM run are under
[`patrol-concurrent-3vm-2026-10-20T180619Z`](../../../../artifacts/benchmarks/patrol-concurrent-3vm-2026-10-20T180619Z/)
and
[`patrol-concurrent-4vm-2026-10-20T181111Z`](../../../../artifacts/benchmarks/patrol-concurrent-4vm-2026-10-20T181111Z/).
The first one-VM attempt remains at
`artifacts/benchmarks/patrol-concurrent-1vm-2026-10-20T175314Z/` for audit.
All benchmark checkpoints were disposed; the report records the partial
three-VM result in `../benchmarks_py/benchmark-results.json`.

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

## Instrumentation

[`benchmark-results.json`](../benchmarks_py/benchmark-results.json) is the
single curated machine-readable result file. It holds the measured workload
summaries and lifecycle/storage comparisons. Publish it with the Python OTLP
publisher described in the [benchmark task guide](../benchmarks_py/README.md).
Publishing sends recorded measurements to the configured OTLP endpoint; it
does not run a benchmark. Benchmark checkpoints have been disposed. Ignored
local logs, traces, workspaces, and raw result records remain for inspection.
