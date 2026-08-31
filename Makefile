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
C4_GONDOLIN_ASSETS := artifacts/c4-gondolin/$(C4_GONDOLIN_ARCH)
C4_GONDOLIN_CONFIG := adapters/c4-gondolin/gondolin/playwright-layout.$(C4_GONDOLIN_ARCH).json
C4_GONDOLIN ?= npx --yes @earendil-works/gondolin@0.12.0
GONDOLIN_BROWSER_ASSETS := artifacts/gondolin-browser/$(C4_GONDOLIN_ARCH)
GONDOLIN_BROWSER_CONFIG := runtimes/gondolin-browser/gondolin/playwright-mcp.$(C4_GONDOLIN_ARCH).json
C4_OCI_REPOSITORY ?= ghcr.io/ragavsathish/agent-workload-platform/c4-suite
C4_OCI_VERSION ?= $(shell node -p "require('./$(C4_WORKLOAD)/components/package.json').version")
C4_OCI_REVISION := $(shell git rev-parse HEAD)
C4_OCI_SHORT_REVISION := $(shell git rev-parse --short=12 HEAD)
C4_OCI_WASM := $(C4_WORKLOAD)/components/dist/c4-suite.wasm
C4_OCI_SBOM := artifacts/c4-excalidraw/oci/c4-suite.spdx.json
C4_OCI_ARTIFACT_TYPE := application/vnd.agent-workload-platform.wasm.component.v1
C4_OCI_SOURCE := https://github.com/ragavsathish/agent-workload-platform

.PHONY: c4 c4-build c4-test c4-gondolin-build gondolin-browser-build c4-oci-build c4-oci-publish c4-oci-verify

c4-build:
	pnpm --dir $(C4_WORKLOAD) run build
	pnpm --dir $(C4_WORKLOAD) run components:load

c4-test:
	pnpm --dir $(C4_WORKLOAD) test

c4-gondolin-build:
	docker compose --profile $(C4_GONDOLIN_PROFILE) -f adapters/c4-gondolin/compose.yaml build $(C4_GONDOLIN_SERVICE)
	mkdir -p $(C4_GONDOLIN_ASSETS)
	$(C4_GONDOLIN) build --config $(C4_GONDOLIN_CONFIG) --output $(C4_GONDOLIN_ASSETS)

gondolin-browser-build:
	mkdir -p $(GONDOLIN_BROWSER_ASSETS)
	$(C4_GONDOLIN) build --config $(GONDOLIN_BROWSER_CONFIG) --output $(GONDOLIN_BROWSER_ASSETS)

c4-oci-build:
	pnpm --dir $(C4_WORKLOAD) run build:wasm
	@mkdir -p "$(dir $(C4_OCI_SBOM))"
	@sbom_root=$$(mktemp -d /tmp/c4-suite-sbom.XXXXXX); \
		trap 'rm -rf "$$sbom_root"' EXIT; \
		cp "$(C4_WORKLOAD)/components/package.json" "$$sbom_root/package.json"; \
		mkdir -p "$$sbom_root/dependencies/excalidraw-core"; \
		cp "$(C4_WORKLOAD)/core/package.json" "$$sbom_root/dependencies/excalidraw-core/package.json"; \
		pnpm --filter c4-excalidraw-wassette-components list --prod --json --depth Infinity \
			| jq -r '.[0].dependencies | .. | objects | .path? // empty' \
			| while IFS= read -r dependency_path; do \
				dependency_index=$$(( $${dependency_index:-0} + 1 )); \
				cp -RL "$$dependency_path" "$$sbom_root/dependencies/$$dependency_index"; \
			done; \
		syft scan "dir:$$sbom_root" \
			--select-catalogers +javascript-package-cataloger \
			--source-name c4-suite \
			--source-version "$(C4_OCI_VERSION)" \
			-o "spdx-json=$(C4_OCI_SBOM)"

c4-oci-publish: c4-oci-build
	cd "$(dir $(C4_OCI_WASM))" && oras push \
		--artifact-type "$(C4_OCI_ARTIFACT_TYPE)" \
		--annotation "org.opencontainers.image.title=c4-suite.wasm" \
		--annotation "org.opencontainers.image.description=Composed C4-to-Excalidraw WebAssembly component" \
		--annotation "org.opencontainers.image.source=$(C4_OCI_SOURCE)" \
		--annotation "org.opencontainers.image.revision=$(C4_OCI_REVISION)" \
		--annotation "org.opencontainers.image.version=$(C4_OCI_VERSION)" \
		"$(C4_OCI_REPOSITORY):$(C4_OCI_VERSION),sha-$(C4_OCI_SHORT_REVISION)" \
		"$(notdir $(C4_OCI_WASM)):application/wasm"
	cd "$(dir $(C4_OCI_SBOM))" && oras attach \
		--artifact-type application/spdx+json \
		--annotation "org.opencontainers.image.title=c4-suite.spdx.json" \
		"$(C4_OCI_REPOSITORY):$(C4_OCI_VERSION)" \
		"$(notdir $(C4_OCI_SBOM)):application/spdx+json"

c4-oci-verify:
	@verify_root=$$(mktemp -d /tmp/c4-suite-verify.XXXXXX); \
		trap 'rm -rf "$$verify_root"' EXIT; \
		oras manifest fetch "$(C4_OCI_REPOSITORY):$(C4_OCI_VERSION)" >/dev/null; \
		oras pull "$(C4_OCI_REPOSITORY):$(C4_OCI_VERSION)" -o "$$verify_root/wasm" >/dev/null; \
		cmp "$(C4_OCI_WASM)" "$$verify_root/wasm/$(notdir $(C4_OCI_WASM))"; \
		sbom_digest=$$(oras discover --format json --artifact-type application/spdx+json \
			"$(C4_OCI_REPOSITORY):$(C4_OCI_VERSION)" \
			| jq -r '.referrers[0].digest // empty'); \
		test -n "$$sbom_digest"; \
		oras pull "$(C4_OCI_REPOSITORY)@$$sbom_digest" -o "$$verify_root/sbom" >/dev/null; \
		cmp "$(C4_OCI_SBOM)" "$$verify_root/sbom/$(notdir $(C4_OCI_SBOM))"; \
		echo "Verified Wasm and SPDX SBOM at $(C4_OCI_REPOSITORY):$(C4_OCI_VERSION)"

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
