# Benchmark verification, 2026-10-20

The comparison source is
`platform/agent-execution/gondolin-session/benchmarks_py/benchmark-results.json`.
Ansible reports and raw runner evidence are under `artifacts/benchmarks/ansible/`
and `artifacts/benchmarks/` respectively.

| Workload | Historical qemu run | Latest Python and Ansible run | Difference |
| --- | ---: | ---: | ---: |
| Four VM full mock Compose, readiness median | 86,464 ms | 90,436 ms | +3,972 ms (+4.6%) |
| Four VM full mock Compose, wall clock | 88,907 ms | 91,504 ms | +2,597 ms (+2.9%) |
| One VM full mock voice Patrol | 215.69 s | 219.31 s | +3.62 s (+1.7%) |

Both matched runs used qemu, 6 GiB RAM and 2 vCPUs per VM, Overlay2, and no
guest swap. All VMs and both Patrol journeys passed. The latest Compose run
had 43% minimum free host memory, 0 MiB swap growth, and 165.07 GiB minimum
free disk; the historical run had 58%, 0 MiB, and 176.49 GiB. The latest voice
run had 68% minimum free host memory, 0 MiB swap growth, and 184.30 GiB minimum
free disk; the historical run had 71%, -152.06 MiB, and 200.14 GiB. These are
single runs under different host conditions, so the differences are
observations rather than performance claims.

The Compose comparison uses historical ID
`compose-full-mock-overlay2-4vm-2026-10-20T17-44-24-716Z` and new report
`artifacts/benchmarks/ansible/20261020T195847Z-compose_parallel-b369aed0/report.json`.
Its raw result is
`artifacts/benchmarks/compose-overlay2-4vm-2026-10-20T200020Z/result.json`.
The voice comparison uses historical ID
`mac-m4-pro-2026-10-20-patrol-full-compose-qemu-6g-2c` and new report
`artifacts/benchmarks/ansible/20261020T200649Z-smoke_test-f546597e/report.json`.
Its raw result and captured Patrol traces are under
`artifacts/benchmarks/smoke-test-1vm-2026-10-20T200649Z/`.

The current manifest and historical Patrol record both identify Gondolin build
`3cb3c5e4-fce3-5b31-a4ca-8ab9e314f9d9`; the OCI source digest also matches
(`sha256:f3809baa34d4151c7dda8283638463c14ed537a8fe7813bdd254ac16b01f559d`).
The first rerun used a guest `PATH` without system `sbin` paths, so OverlayFS
could not load; the next omitted `dev-compose` from `PATH`. The successful
Compose rerun used the full system path. The first two voice attempts hid the
image's preinstalled Flutter SDK: one failed on Git ownership for a nested
Flutter checkout, and its retry began downloading a duplicate Dart SDK and was
stopped. Neither retained a checkpoint. The passing voice run used the image's
Flutter and system paths and registered the nested Flutter checkout as a Git
safe directory. These setup attempts are excluded from the timing comparison.

The historical Compose entry records `medianReadinessMs: 86263.5`, but its
four listed `readinessMs` values have a median of 86,464 ms. This comparison
uses the listed measurements. The historical JSON was left unchanged.

The new generic Pi smoke prompt also passed through `benchmark.yml` on one
qemu VM in 9.32 seconds. Pi and its Bash `/bin/true` command both exited zero.
Its report is
`artifacts/benchmarks/ansible/20261020T185317Z-smoke_test-98f64d68/report.md`.
After moving the Ansible modules to `automation/library/`, the same entry point
passed again on one qemu VM in 10.37 seconds. The report is
`artifacts/benchmarks/ansible/20261020T193214Z-smoke_test-605eb654/report.md`.

Ruff, Ansible syntax checks for all category playbooks, Ansible check mode for
all five modules, and ansible-lint passed. The storage, lifecycle, and native
inference workloads were not run as real measurements in this verification.
