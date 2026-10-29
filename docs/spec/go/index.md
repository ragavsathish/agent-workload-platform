# Behavior contracts for host components

The `.feature` files describe observable behavior without naming an implementation
language or orchestration tool. They are a regeneration contract: an implementation
in any language may satisfy them. This index tracks the current source files and
verification commands; it is not part of the behavioral contract.

| Source module | Production source | Behavior feature |
| --- | --- | --- |
| `platform/agent-execution/gondolin-session/image-builder/go.mod` | `docker_job_api.go` | [Host job API](job_api.feature), [Compose cache](compose_cache.feature), [Image build](image_build.feature) |
| `platform/agent-execution/gondolin-session/image-builder/go.mod` | `compose_cli.go` | [Command-line workflows](cli.feature) |
| `platform/agent-execution/gondolin-session/image-builder/go.mod` | `compose_pull_api.go` | [Command-line workflows](cli.feature) |
| `platform/agent-execution/gondolin-session/image-builder/go.mod` | `compose_cache_import.go` | [Cache import](cache_import.feature) |
| `platform/agent-execution/gondolin-session/image-builder/go.mod` | `image_archive.go` | [Image archives](image_archive.feature) |
| `platform/agent-execution/gondolin-session/image-builder/go.mod` | `image_build_api.go` | [Image build](image_build.feature), [Command-line workflows](cli.feature) |
| `products/voice-agent/apps/host-observability/storage-collector/go.mod` | `main.go` | [Storage telemetry](storage_collector.feature) |

Run `make go-spec-check` from the repository root. It discovers Go modules, checks
that every production Go file is mapped above, and validates scenario syntax and
stable IDs. It does not execute the scenarios. The image-builder's `go test ./...`
provides implementation-level evidence for many of them; the storage collector has
no Go test suite yet. Consult fresh test and deployed results before claiming runtime
conformance.

The [Ansible contracts](../ansible/index.md) describe orchestration around the
Voice Agent. The [measurement harness](../../../harness/README.md) describes how
tool output becomes Allure measurements. Neither replaces these component contracts.
