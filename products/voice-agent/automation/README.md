# Infrastructure automation

Ansible owns host preflight, host-service installation, deployed-state
verification, lifecycle testing, and infrastructure-backed integration tests.
Application tests remain in their native language when they exercise an
in-process module or a local adapter.

Docker Compose reads only `deploy/.env` plus explicit files in
`deploy/secrets/`. `make config-init` initializes missing secret files and
`make host-services-env` projects the same private configuration into ignored,
least-privilege files under `deploy/host-env/`. Ansible treats those files as
opaque inputs: it validates and installs them, but does not parse configuration
or render secrets.

Install the pinned collections once:

```bash
make automation-setup
```

Common entry points:

```bash
make host-preflight
make install-host-services
make verify
make cycle-test
make digital-twin-test
make playwright-voice
make playwright-diagnostics
make playwright-grafana
make automation-check
```

Make targets are the only infrastructure-test entry points. Tests do not carry
shell compatibility wrappers.

## Module policy

Playbooks use purpose-built modules for state and inspection:

- `community.docker` for Compose lifecycle, container facts, and container exec;
- `community.general.launchd` for macOS jobs;
- `community.postgresql` for database assertions;
- `ansible.builtin.uri` for HTTP, Grafana, Gitea, Prometheus, and SPARQL;
- built-in file, fact, command, and assertion modules for host checks.

Do not add `shell` or `raw` tasks. `command` is reserved for repository-owned
test clients and tools that have no state-aware Ansible module. Pass arguments
with `argv` and mark read-only commands with `changed_when: false`.

Tasks that handle prepared secret-bearing files are marked `no_log: true`.
Secrets must not be copied into facts that can later be printed.

## Test seam

The playbooks assert observable deployed state: running containers and jobs,
effective mounts and ports, network reachability, authentication, persistence,
and telemetry ingestion. Node and Python tests assert deterministic application
behavior such as request rewriting and configuration construction. A deployed
contract may have both forms of coverage, but the playbook must not reproduce
private implementation assertions.
