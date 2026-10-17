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
.PHONY: gondolin-session-build gondolin-builder-build

gondolin-session-build:
	docker compose --profile $(GONDOLIN_PROFILE) -f platform/agent-execution/gondolin-session/gondolin/compose.yaml build $(GONDOLIN_BROWSER_SERVICE)
	mkdir -p $(GONDOLIN_BROWSER_ASSETS)
	$(GONDOLIN) build --config $(GONDOLIN_BROWSER_CONFIG) --output $(GONDOLIN_BROWSER_ASSETS)

gondolin-builder-build:
	docker compose --profile $(GONDOLIN_PROFILE) -f platform/agent-execution/gondolin-session/image-builder/compose.yaml build $(GONDOLIN_BUILDER_SERVICE)
	mkdir -p $(GONDOLIN_BUILDER_ASSETS)
	$(GONDOLIN) build --config $(GONDOLIN_BUILDER_CONFIG) --output $(GONDOLIN_BUILDER_ASSETS)
