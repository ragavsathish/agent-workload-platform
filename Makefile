.DEFAULT_GOAL := help

VOICE_AGENT_DIR := products/voice-agent
VOICE_AGENT_TARGETS := setup build check start up logs status verify down recreate allure-oracle-check automation-spec-check go-spec-check
VOICE_AGENT_TARGETS += login host-preflight pull-model install-host-services
VOICE_AGENT_TARGETS += native-start native-stop native-restart native-status
WASM_TARGETS := wasm-setup wasm-build wasm-check wasm-install wasm-clean

HOST_ARCH := $(shell uname -m)
ifeq ($(filter arm64 aarch64,$(HOST_ARCH)),)
GONDOLIN_ARCH := x86_64
GONDOLIN_PROFILE := amd64
else
GONDOLIN_ARCH := aarch64
GONDOLIN_PROFILE := arm64
endif
GONDOLIN ?= npx --yes @earendil-works/gondolin@0.13.0
GONDOLIN_BROWSER_ASSETS := artifacts/gondolin-browser/$(GONDOLIN_ARCH)
GONDOLIN_BROWSER_CONFIG := platform/agent-execution/gondolin-session/gondolin/playwright-mcp.$(GONDOLIN_ARCH).json
GONDOLIN_BROWSER_SERVICE := voice-runtime-$(GONDOLIN_PROFILE)
GONDOLIN_BUILDER_ASSETS := artifacts/gondolin-builder/$(GONDOLIN_ARCH)
GONDOLIN_BUILDER_CONFIG := platform/agent-execution/gondolin-session/image-builder/gondolin.$(GONDOLIN_ARCH).json
GONDOLIN_BUILDER_SERVICE := image-builder-$(GONDOLIN_PROFILE)
GONDOLIN_DEV_ASSETS := artifacts/gondolin-dev/$(GONDOLIN_ARCH)
GONDOLIN_DEV_CONFIG := platform/agent-execution/gondolin-session/gondolin/dev.$(GONDOLIN_ARCH).json
GONDOLIN_DEV_SERVICE := dev-runtime-$(GONDOLIN_PROFILE)
GONDOLIN_DEV_IMAGE_CACHE ?= $(HOME)/.cache/gondolin/compose-index/$(notdir $(CURDIR))/$(GONDOLIN_ARCH)
GONDOLIN_DEV_IMAGE_STORE ?= $(HOME)/.cache/gondolin/$(GONDOLIN_ARCH)
GONDOLIN_DEV_CACHE_HANDOFF ?=
GONDOLIN_COMPOSE_CACHE_HANDOFF ?= $(HOME)/.cache/gondolin/compose-cache-handoff
GONDOLIN_IMAGE_BUILDER_HANDOFF ?= $(HOME)/Library/Application Support/PipecatEdge/gondolin-image-handoff
.PHONY: help FORCE $(VOICE_AGENT_TARGETS) $(WASM_TARGETS) docs-check context-spec-check event-model-check event-source-simulate event-persona-simulate event-storming-render event-storming-walk-render owner-workday-render component-regeneration-render one-big-wall-render orchestrator-theme-render gondolin-session-build gondolin-builder-build gondolin-dev-build gondolin-dev-cache gondolin-dev-cache-import gondolin-docker-job-api-up gondolin-docker-job-api-down gondolin-docker-job-api-test

help:
	@printf '%s\n' \
		'Agent Workload Platform' \
		'' \
		'  make setup          Install product and WASM build dependencies' \
		'  make build          Build the Voice Agent and every WASM component' \
		'  make check          Run the complete development suite' \
		'  make start|up|down  Operate the Voice Agent deployment' \
		'  make native-start|native-stop|native-restart|native-status' \
		'                      Manage the eight macOS services' \
		'  make login          Authenticate and configure tailnet ingress' \
		'  make verify         Verify deployed infrastructure' \
		'  make wasm-build     Build every WASM component' \
		'  make wasm-check     Check every WASM component' \
		'  make wasm-install   Install every WASM component into Wassette' \
		'  make event-source-simulate  Replay parallel event deliveries and report convergence' \
		'  make event-persona-simulate  Ask local LLM personas, then replay their events' \
		'  make voice-TARGET   Run any additional Voice Agent target' \
		'  make gondolin-session-build | gondolin-builder-build | gondolin-dev-build' \
		'  make gondolin-docker-job-api-up|down  Run or stop the host Docker API service' \
		'  make gondolin-dev-cache  Prepare Compose image archives locally' \
		'  make gondolin-dev-cache-import GONDOLIN_DEV_CACHE_HANDOFF=<path>  Import Gitea cache output' \

$(VOICE_AGENT_TARGETS) $(WASM_TARGETS):
	$(MAKE) -C $(VOICE_AGENT_DIR) $@

voice-%: FORCE
	$(MAKE) -C $(VOICE_AGENT_DIR) $*

FORCE:

event-model-check:
	node docs/event-model/check.mjs

context-spec-check:
	node docs/spec/contexts/check.mjs

docs-check: context-spec-check event-model-check
	ruby docs/check_okf.rb
	node docs/spec/ansible/check.mjs
	node docs/spec/go/check.mjs

event-source-simulate:
	node docs/event-model/simulate-parallel-sources.mjs > docs/event-model/parallel-source-simulation.json
	cat docs/event-model/parallel-source-simulation.json

event-persona-simulate:
	node docs/event-model/simulate-personas.mjs > docs/event-model/persona-simulation.json
	cat docs/event-model/persona-simulation.json

event-storming-render:
	python3 docs/event-model/render_event_storming.py

event-storming-walk-render:
	python3 docs/event-model/render_event_storming_walk.py

owner-workday-render:
	python3 docs/event-model/render_owner_workday_walk.py

component-regeneration-render:
	python3 docs/event-model/render_component_regeneration_walk.py

one-big-wall-render:
	python3 docs/event-model/render_one_big_wall.py

orchestrator-theme-render:
	python3 docs/event-model/render_orchestrator_theme.py

gondolin-session-build:
	docker compose --profile $(GONDOLIN_PROFILE) -f platform/agent-execution/gondolin-session/gondolin/compose.yaml build $(GONDOLIN_BROWSER_SERVICE)
	mkdir -p $(GONDOLIN_BROWSER_ASSETS)
	$(GONDOLIN) build --config $(GONDOLIN_BROWSER_CONFIG) --output $(GONDOLIN_BROWSER_ASSETS)

gondolin-builder-build:
	docker compose --profile $(GONDOLIN_PROFILE) -f platform/agent-execution/gondolin-session/image-builder/compose.yaml build $(GONDOLIN_BUILDER_SERVICE)
	mkdir -p $(GONDOLIN_BUILDER_ASSETS)
	$(GONDOLIN) build --config $(GONDOLIN_BUILDER_CONFIG) --output $(GONDOLIN_BUILDER_ASSETS)

gondolin-dev-build:
	docker compose --profile $(GONDOLIN_PROFILE) -f platform/agent-execution/gondolin-session/gondolin/dev-compose.yaml build $(GONDOLIN_DEV_SERVICE)
	mkdir -p $(GONDOLIN_DEV_ASSETS)
	$(GONDOLIN) build --config $(GONDOLIN_DEV_CONFIG) --output $(GONDOLIN_DEV_ASSETS)

gondolin-dev-cache:
	@set -eu; \
	config=$$(mktemp); \
	trap 'rm -f "$$config"' EXIT; \
	docker compose -f products/voice-agent/deploy/compose.yml config --format json > "$$config"; \
	revision=$$(git rev-parse HEAD); \
	run_id=local-$$(date +%s); \
	docker run --rm \
		-v "$(CURDIR):/workspace" \
		-v "$(HOME):/hosthome" \
		-v "$(abspath $(GONDOLIN_DEV_IMAGE_CACHE)):/image-cache" \
		-v "$(GONDOLIN_COMPOSE_CACHE_HANDOFF):/handoff" \
		-v "$(GONDOLIN_DEV_IMAGE_STORE):/image-store" \
		-v /var/run/docker.sock:/var/run/docker.sock \
		-v "$$config:/compose.json:ro" \
		-w /workspace/platform/agent-execution/gondolin-session/image-builder \
		-e HOME=/hosthome \
		-e DOCKER_HOST_SOCKET=/var/run/docker.sock \
		-e GONDOLIN_COMPOSE_CACHE_HANDOFF=/handoff \
		-e GONDOLIN_COMPOSE_CACHE_HOST_HANDOFF="$(GONDOLIN_COMPOSE_CACHE_HANDOFF)" \
		golang:1.25-alpine go run . compose pull /compose.json "$$revision" "$(GONDOLIN_ARCH)" "$$run_id" \
			/image-cache /image-store

gondolin-dev-cache-import:
	@test -n "$(GONDOLIN_DEV_CACHE_HANDOFF)" || { echo "Set GONDOLIN_DEV_CACHE_HANDOFF to the completed Gitea handoff directory." >&2; exit 1; }
	docker run --rm -v "$(CURDIR):$(CURDIR)" -v "$(HOME):$(HOME)" -w "$(CURDIR)/platform/agent-execution/gondolin-session/image-builder" golang:1.25-alpine go run . compose import "$(abspath $(GONDOLIN_DEV_CACHE_HANDOFF))" "$(abspath $(GONDOLIN_DEV_IMAGE_CACHE))" "$(abspath $(GONDOLIN_DEV_IMAGE_STORE))"

gondolin-docker-job-api-test:
	docker run --rm -v "$(CURDIR)/platform/agent-execution/gondolin-session/image-builder:/src" -w /src golang:1.25-alpine go test ./...

gondolin-docker-job-api-up:
	@test -n "$(GONDOLIN_DOCKER_JOB_API_TOKEN)" || { echo "Set GONDOLIN_DOCKER_JOB_API_TOKEN before starting the host API." >&2; exit 1; }
	@mkdir -p "$(GONDOLIN_COMPOSE_CACHE_HANDOFF)" "$(GONDOLIN_IMAGE_BUILDER_HANDOFF)"
	@GONDOLIN_DOCKER_JOB_API_TOKEN="$(GONDOLIN_DOCKER_JOB_API_TOKEN)" GONDOLIN_COMPOSE_CACHE_HANDOFF="$(GONDOLIN_COMPOSE_CACHE_HANDOFF)" GONDOLIN_IMAGE_BUILDER_HANDOFF="$(GONDOLIN_IMAGE_BUILDER_HANDOFF)" docker compose --profile host-api -f platform/agent-execution/gondolin-session/image-builder/compose.yaml up -d --build docker-job-api

gondolin-docker-job-api-down:
	@test -n "$(GONDOLIN_DOCKER_JOB_API_TOKEN)" || { echo "Set GONDOLIN_DOCKER_JOB_API_TOKEN to stop the host API." >&2; exit 1; }
	@GONDOLIN_DOCKER_JOB_API_TOKEN="$(GONDOLIN_DOCKER_JOB_API_TOKEN)" GONDOLIN_COMPOSE_CACHE_HANDOFF="$(GONDOLIN_COMPOSE_CACHE_HANDOFF)" GONDOLIN_IMAGE_BUILDER_HANDOFF="$(GONDOLIN_IMAGE_BUILDER_HANDOFF)" docker compose --profile host-api -f platform/agent-execution/gondolin-session/image-builder/compose.yaml stop docker-job-api
	@GONDOLIN_DOCKER_JOB_API_TOKEN="$(GONDOLIN_DOCKER_JOB_API_TOKEN)" GONDOLIN_COMPOSE_CACHE_HANDOFF="$(GONDOLIN_COMPOSE_CACHE_HANDOFF)" GONDOLIN_IMAGE_BUILDER_HANDOFF="$(GONDOLIN_IMAGE_BUILDER_HANDOFF)" docker compose --profile host-api -f platform/agent-execution/gondolin-session/image-builder/compose.yaml rm -f docker-job-api
