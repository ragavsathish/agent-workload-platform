# Machine and VM benchmarks as Ansible tasks

`benchmark.yml` calls the selected category-specific Python Ansible module
directly. The new
Python benchmark implementations live in
`platform/agent-execution/gondolin-session/benchmarks_py/`. Every execution creates a private directory under
`artifacts/benchmarks/ansible/` containing `report.json`, `report.md`, and
`runner.log`. The runner's own full result remains linked in both reports.
The playbook reports failure after rendering the Markdown report.

Run from `products/voice-agent` with Ansible Core installed (or replace
`ansible-playbook` with the repository's `uvx --from ansible-core` invocation):

```sh
ANSIBLE_CONFIG=automation/ansible.cfg ansible-playbook \
  automation/playbooks/benchmark.yml \
  -e benchmark_kind=compose_parallel \
  -e benchmark_image="$PWD/../../artifacts/gondolin-dev-overlay2-qemu-v2/aarch64" \
  -e benchmark_workspace=/path/to/project \
  -e benchmark_compose_file=compose.yml \
  -e benchmark_parallelism=4 \
  -e benchmark_vm_memory_gib=6 \
  -e benchmark_vm_cpus=2
```

Other `benchmark_kind` values are:

- `smoke_test`: independent Pi/Gondolin project journeys; requires
  `benchmark_image` and a Git `benchmark_workspace`. It accepts a prompt file,
  VM count, resources, overlays, and host headroom limits.
- `compose_storage`: one VFS or Overlay2 project startup; requires
  `benchmark_image`, `benchmark_workspace`, a Compose file or workload command,
  and `benchmark_storage_driver` (`vfs` or `overlay2`). Run
  both drivers with matched image builds to compare them.
- `mlx`: warm the native models, then measure local LLM, TTS, and optionally STT requests; accepts
  `benchmark_iterations`, `benchmark_skip_stt`, and `benchmark_stt_wav`.
- `lifecycle`: measure VM cold boot, checkpoint resume, and save costs from a
  smoke test result whose checkpoint disks are still retained; set
  `benchmark_smoke_test_result`. To produce those disks, run the smoke test with
  `benchmark_retain_checkpoints=true`.

The VM task must run on the Mac that has the Gondolin images and tools. It is a
measurement command, so each execution returns `changed: true`; Ansible check
mode reports the planned command without running it. Set
`benchmark_timeout_seconds` for an upper bound. The report directory and files
are private (`0700` and `0600`) because raw benchmark evidence can contain
transcripts and local paths.

The Compose categories mount `benchmark_workspace` at `/workspace` in each VM.
Set `benchmark_compose_file` to a file relative to that directory; the runner
executes `docker compose up -d --wait`. For a project that needs its own VM
startup logic, set `benchmark_workload_command` to an argv list instead of a
Compose file. `benchmark_bootstrap_command` defaults to
`['/usr/local/bin/start-dev-docker']` and may be set to `[]` when the image
starts Docker itself. `benchmark_image_cache` optionally mounts a host
directory read-only at `/image-cache`. The workload command should read secrets
from project files or its runtime environment, not from command arguments,
because benchmark reports record the arguments.
Set `benchmark_guest_environment` for required VM environment variables; reports
record only its key names. Qemu is the default VMM for all new VM benchmarks.

The Pi VM smoke test reads its complete Pi instruction from
`benchmark_prompt_file`. The default
`benchmarks_py/prompts/vm_smoke_test.md` runs `/bin/true` through Pi's Bash
tool. For this repository's browser journey, use
`benchmarks_py/prompts/voice_agent_smoke_test.md` and provide the project-specific
image cache, browser assets, environment, overlays, and artifact capture path.
The full mock voice-agent journey uses
`benchmark_guest_environment.GONDOLIN_COMPOSE_PROFILE=full-mock`, overlays
`.pi/hooks/start-dev-stack.mjs`, `.pi/compose.full-mock.yml`,
`.pi/postgres-full-mock-init.sql.template`, and
`products/voice-agent/apps/client/tool/patrol-mock-inference-broker.mjs`, and
captures `products/voice-agent/apps/client/build/patrol-latest`.
The runner clones `benchmark_workspace` at its current Git revision for each
VM. `benchmark_config_path` selects the project-relative Gondolin configuration.
