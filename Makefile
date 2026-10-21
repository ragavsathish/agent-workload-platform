.DEFAULT_GOAL := help

VOICE_AGENT_DIR := products/voice-agent
VOICE_AGENT_TARGETS := setup build check start up logs status verify down recreate
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
GONDOLIN_DEV_IMAGE_CACHE := artifacts/gondolin-dev-images/$(GONDOLIN_ARCH)
GONDOLIN_DEV_IMAGE_STORE ?= $(HOME)/.cache/gondolin/$(GONDOLIN_ARCH)
.PHONY: help FORCE $(VOICE_AGENT_TARGETS) $(WASM_TARGETS) gondolin-session-build gondolin-builder-build gondolin-dev-build gondolin-dev-cache require-babashka

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
		'  make voice-TARGET   Run any additional Voice Agent target' \
		'  make gondolin-session-build | gondolin-builder-build | gondolin-dev-build' \
		'  make gondolin-dev-cache  Cache Compose images for read-only VM mounts'

$(VOICE_AGENT_TARGETS) $(WASM_TARGETS):
	$(MAKE) -C $(VOICE_AGENT_DIR) $@

voice-%: FORCE
	$(MAKE) -C $(VOICE_AGENT_DIR) $*

FORCE:

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

gondolin-dev-cache: require-babashka
	bb platform/agent-execution/gondolin-session/gondolin/prepare-compose-cache.clj products/voice-agent/deploy/compose.yml $(GONDOLIN_DEV_IMAGE_CACHE) $(GONDOLIN_DEV_IMAGE_STORE)

require-babashka:
	@command -v bb >/dev/null || { echo "Install Babashka (bb) to run the Clojure tooling." >&2; exit 1; }
