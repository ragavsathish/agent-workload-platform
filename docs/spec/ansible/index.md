# Language-neutral contract for Voice Agent automation

The `.feature` files describe observable outcomes without naming an implementation
language or orchestration tool. They are a regeneration source: a replacement
implementation should be able to satisfy the same scenarios. This index tracks the
current source playbooks and verification commands; it is not part of the behavioral
contract. No feature here is an executed BDD test.

| Behavior feature | Current entry point | Supporting automation |
| --- | --- | --- |
| [Host readiness](preflight.feature) | `playbooks/preflight.yml` | `roles/host_preflight` |
| [Host installation](install_host_services.feature) | `playbooks/install_host_services.yml` | `roles/host_services` |
| [Native service lifecycle](native_services.feature) | `playbooks/native_services.yml` | declared service inventory |
| [Targeted edge update](deploy_edge.feature) | `playbooks/deploy_edge.yml` | deployment inventory |
| [Targeted gateway update](deploy_gateway.feature) | `playbooks/deploy_gateway.yml` | deployment inventory |
| [Repeated lifecycle](lifecycle.feature) | `playbooks/lifecycle.yml` | `tasks/lifecycle_cycle.yml`, `roles/verify_infrastructure` |
| [Infrastructure verification](verify.feature) | `playbooks/verify.yml` | `roles/verify_infrastructure` |
| [Deployed voice probe](blackbox_voice.feature) | `playbooks/blackbox_voice.yml` | synthetic voice test client |
| [Browser journeys](playwright_e2e.feature) | `playbooks/playwright_e2e.yml` | browser test projects |
| [Digital-twin RDF](digital_twin_e2e.feature) | `playbooks/digital_twin_e2e.yml` | RDF shape validator |
| [Benchmarks](benchmark.feature) | `playbooks/benchmark.yml` | `tasks/report_benchmark.yml`, benchmark modules and report template |

The three roles and two reusable task files are covered through their calling
playbooks. The [benchmark feature](benchmark.feature) also covers the five custom
benchmark modules: `benchmark_mlx.py`, `benchmark_smoke_test.py`,
`benchmark_compose_parallel.py`, `benchmark_compose_storage.py`, and
`benchmark_lifecycle.py`. Their shared execution and report rules live in
`module_utils/benchmark_common.py`. Inventory values and the report template are
implementation inputs; the scenarios state the behavior they are used to produce.

Run `make automation-spec-check` from the repository root. It checks that each playbook
has exactly one feature, each scenario has a unique stable ID, and the scenarios use
Given/When/Then. `make automation-check` also runs this inventory check and Ansible
syntax/lint checks. Those checks validate the documentation inventory and automation
syntax; they do not prove the deployment behavior. A fresh run of the relevant Make
target and its observable result is required for that claim.

The [measurement harness](../../../harness/README.md) separately judges the tools that
turn test output into Allure results. These features specify the infrastructure and
deployed-test orchestration those tools may observe; they are outside its 17-case
synthetic golden.
