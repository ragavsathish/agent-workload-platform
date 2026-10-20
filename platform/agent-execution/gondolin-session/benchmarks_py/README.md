# Python machine and VM benchmarks

These modules are the benchmark runners. Ansible calls one Python runner
per benchmark type and renders Markdown with a Jinja template.

| Python runner | Measurement |
| --- | --- |
| `host_inference.py` | Warm LLM, TTS, and STT throughput and process resources |
| `smoke_test.py` | Concurrent Pi/Gondolin smoke tests and host headroom |
| `compose_parallel.py` | Concurrent project Compose VM readiness and host headroom |
| `compose_storage.py` | Project Compose startup and Docker storage use for one driver |
| `lifecycle.py` | VM cold start, checkpoint resume, and checkpoint save |
| `publish_otel.py` | Publish saved benchmark results; does not run a workload |

`host_metrics.py`, `compose_common.py`, `task_checkpoint.py`, and `results.py`
hold reusable Python logic. Gondolin itself has no Python SDK in this repo;
`vm_client.py` speaks a small JSON-lines protocol to `vm_bridge.mjs`, which
only calls `GondolinSession` operations. This is the remaining JavaScript
boundary. The smoke test retains Pi's Bash tool call because it is the
behavior under test. Its prompt is loaded from a file under `prompts/` or from
a project-supplied file. Compose metrics use direct guest commands and Python
parsing rather than guest shell scripts.

The Compose runners accept a host workspace and either a relative Compose file
or a custom guest argv vector. They mount the workspace at `/workspace` and do
not depend on voice-agent paths or profiles. Their Docker bootstrap command and
image cache mount are configurable.

Run benchmarks with `products/voice-agent/automation/playbooks/benchmark.yml`;
see `docs/BENCHMARK_TASK.md`, `docs/BENCHMARK_CATEGORIES.md`, and
`docs/BENCHMARK_VERIFICATION.md`.
The Python OTLP publisher can be run separately:

```sh
python3 platform/agent-execution/gondolin-session/benchmarks_py/publish_otel.py \
  platform/agent-execution/gondolin-session/benchmarks_py/benchmark-results.json
```
