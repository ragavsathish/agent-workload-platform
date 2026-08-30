C4_WORKLOAD := workloads/c4-excalidraw
C4_INPUT ?= $(C4_WORKLOAD)/examples/composable-c4-pipeline.mmd
C4_OUTPUT ?= artifacts/c4-excalidraw/composable-c4-pipeline.excalidraw
C4_MODEL ?= openai-codex/gpt-5.6-terra
C4_HOST_ARCH := $(shell uname -m)
ifeq ($(filter arm64 aarch64,$(C4_HOST_ARCH)),)
C4_GONDOLIN_ARCH := x86_64
C4_GONDOLIN_PROFILE := amd64
else
C4_GONDOLIN_ARCH := aarch64
C4_GONDOLIN_PROFILE := arm64
endif
C4_GONDOLIN_SERVICE := playwright-layout-$(C4_GONDOLIN_PROFILE)
C4_PLAYWRIGHT_VERSION := 1.58.2
C4_GONDOLIN_ASSETS := artifacts/c4-gondolin/$(C4_GONDOLIN_ARCH)
C4_GONDOLIN_CONFIG := adapters/c4-gondolin/gondolin/playwright-layout.$(C4_GONDOLIN_ARCH).json
C4_GONDOLIN ?= npx --yes @earendil-works/gondolin@0.12.0

.PHONY: c4 c4-build c4-test c4-gondolin-build

c4-build:
	pnpm --dir adapters/mermaid-to-excalidraw run build
	pnpm --dir adapters/c4-gondolin run build
	pnpm --dir $(C4_WORKLOAD) run build
	pnpm --dir $(C4_WORKLOAD) run components:load

c4-test:
		pnpm --dir $(C4_WORKLOAD) test

c4-gondolin-build:
	docker compose --profile $(C4_GONDOLIN_PROFILE) -f adapters/c4-gondolin/compose.yaml build $(C4_GONDOLIN_SERVICE)
	mkdir -p $(C4_GONDOLIN_ASSETS)
	$(C4_GONDOLIN) build --config $(C4_GONDOLIN_CONFIG) --output $(C4_GONDOLIN_ASSETS)

c4:
	@test -f "$(C4_INPUT)" || { echo "C4 input not found: $(C4_INPUT)" >&2; exit 1; }
	@mkdir -p "$(dir $(C4_OUTPUT))"
	EXCALIDRAW_NO_OPEN=1 \
	EXCALIDRAW_PIPELINE_OUT="$(abspath $(C4_OUTPUT))" \
	pi --model "$(C4_MODEL)" \
		--thinking low \
		--print \
		--no-session \
		--no-context-files \
		--no-extensions \
		--no-builtin-tools \
		--tools excalidraw_c4_render \
		--extension "$(abspath $(C4_WORKLOAD)/pi-extension.ts)" \
		-- \
		"@$(abspath $(C4_INPUT))" \
		"Call excalidraw_c4_render exactly once with the complete attached Mermaid source. Do not rewrite it or construct Excalidraw JSON yourself."
