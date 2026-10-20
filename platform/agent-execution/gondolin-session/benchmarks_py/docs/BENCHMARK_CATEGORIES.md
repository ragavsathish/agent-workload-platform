# Benchmark task categories

Run `products/voice-agent/automation/playbooks/benchmark.yml` with
`benchmark_kind`. The playbook calls the corresponding Python module directly.
Run it from `products/voice-agent`.
See `BENCHMARK_VERIFICATION.md` for the measured qemu comparisons with the
historical results JSON.
Each run writes a private JSON report, a Jinja-rendered Markdown report, and
the runner log under `artifacts/benchmarks/ansible/`. The measurement code is
in the new `platform/agent-execution/gondolin-session/benchmarks_py/` modules.

| Category | `benchmark_kind` | Required inputs |
| --- | --- | --- |
| Native host inference | `mlx` | Native services and model configuration |
| Concurrent Pi VM smoke tests | `smoke_test` | Gondolin image and Git `benchmark_workspace`; optional `benchmark_prompt_file` |
| Parallel Compose VM startup | `compose_parallel` | `benchmark_image`, `benchmark_workspace`, and `benchmark_compose_file` or `benchmark_workload_command` |
| VM Docker storage | `compose_storage` | Compose inputs plus `benchmark_storage_driver` (`vfs` or `overlay2`) |
| VM lifecycle | `lifecycle` | `benchmark_smoke_test_result` with retained checkpoint disks |

Example, using the repository's Ansible Core invocation:

```sh
ANSIBLE_CONFIG=automation/ansible.cfg uvx --from ansible-core ansible-playbook \
  automation/playbooks/benchmark.yml \
  -e benchmark_kind=compose_parallel \
  -e benchmark_image="$PWD/../../artifacts/gondolin-dev-overlay2-qemu-v2/aarch64" \
  -e benchmark_workspace=/path/to/project \
  -e benchmark_compose_file=compose.yml \
  -e benchmark_parallelism=4 \
  -e benchmark_vm_memory_gib=6 \
  -e benchmark_vm_cpus=2
```

Set `benchmark_kind` for another category. For the storage comparison,
run `benchmark.yml` separately for each driver with matched guest
images. Use `--check` to validate a task selection without executing a
benchmark. Reports are produced on both successful and failed runner exits.
Set `benchmark_retain_checkpoints=true` on a smoke test run only when you plan to
run the lifecycle benchmark; retained disks consume host storage until disposed.

Compose workloads are project agnostic: the workspace is mounted at
`/workspace`, and a relative Compose file is started with `docker compose up
-d --wait`. A custom `benchmark_workload_command` argv list can replace that
step. The default Docker bootstrap command can be replaced with
`benchmark_bootstrap_command` or disabled with an empty list. The image cache
mount is optional. Use a VM image whose Docker driver matches
`benchmark_storage_driver`. Qemu is the default VMM.

The Gondolin SDK is only available to JavaScript. A small `vm_bridge.mjs` adapter
exposes VM start, command, checkpoint, and close to the Python benchmark
modules. Compose probes use direct guest commands; the smoke test keeps
Pi's Bash tool call because that is the path being measured. The smoke test
prompt lives in a separate file so each project can supply its own test.
