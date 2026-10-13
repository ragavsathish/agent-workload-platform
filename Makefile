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
EAR_ENDIL_RUNTIME := runtimes/k3s-earendil
EAR_ENDIL_PI_IMAGE ?= local/earendil-pi:1.0.2
EAR_ENDIL_WASSETTE_IMAGE ?= local/earendil-wassette:0.8.0
YT_SL_REPO ?= ../yt-sl
EAR_ENDIL_YT_SL_IMAGE ?= local/earendil-yt-sl:0.1.0
EAR_ENDIL_COREDNS_IMAGE ?= rancher/mirrored-coredns-coredns:1.14.7
EAR_ENDIL_COREDNS_ARM64_DIGEST ?= sha256:9a631b1e34491f93a35334bc02d8ae190f16224be41689c7f42cc1711a95fe3a
EAR_ENDIL_LOCAL_PATH_IMAGE ?= rancher/local-path-provisioner:v0.0.37
EAR_ENDIL_LOCAL_PATH_ARM64_DIGEST ?= sha256:6a6bade778f51df4e3f9710db6b62ff6eb366cac897e7eccc3528ebd6d22e86c
EAR_ENDIL_BUSYBOX_IMAGE ?= rancher/mirrored-library-busybox:1.37.0
EAR_ENDIL_BUSYBOX_ARM64_DIGEST ?= sha256:fa8dc70514f29471fe118446e3f84040b19791531ec197836a4f43baf13d744b
EAR_ENDIL_IMAGE_ARCHIVE ?= $(EAR_ENDIL_RUNTIME)/.build/earendil-agent-images.tar
EAR_ENDIL_INFRA_IMAGE_ARCHIVE ?= $(EAR_ENDIL_RUNTIME)/.build/earendil-k3s-images.tar
WASSETTE_BIN ?= $(shell command -v wassette)
.PHONY: c4 c4-build c4-test c4-gondolin-build gondolin-browser-build c4-oci-build c4-oci-publish c4-oci-verify k3s-earendil-images k3s-earendil-yt-sl-image k3s-earendil-export k3s-earendil-validate k3s-earendil-production-validate k3s-earendil-smoke k3s-earendil-scan k3s-earendil-vm-test

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

k3s-earendil-images: c4-build
	@test -n "$(WASSETTE_BIN)" && test -x "$(WASSETTE_BIN)" || { echo "Set WASSETTE_BIN to a Linux Wassette 0.8.0 binary" >&2; exit 1; }
	@file "$(WASSETTE_BIN)" | grep -q ELF || { echo "WASSETTE_BIN must be a Linux ELF binary matching the k3s node architecture" >&2; exit 1; }
	docker build -t "$(EAR_ENDIL_PI_IMAGE)" -f "$(EAR_ENDIL_RUNTIME)/images/pi/Dockerfile" "$(EAR_ENDIL_RUNTIME)/images/pi"
	mkdir -p "$(EAR_ENDIL_RUNTIME)/.build/wassette"
	install -m 0755 "$(WASSETTE_BIN)" "$(EAR_ENDIL_RUNTIME)/.build/wassette/wassette"
	cp -L "$(C4_OCI_WASM)" "$(EAR_ENDIL_RUNTIME)/.build/wassette/c4-suite.wasm"
	docker build -t "$(EAR_ENDIL_WASSETTE_IMAGE)" -f "$(EAR_ENDIL_RUNTIME)/images/wassette/Dockerfile" "$(EAR_ENDIL_RUNTIME)/.build/wassette"

k3s-earendil-yt-sl-image:
	test -f "$(YT_SL_REPO)/Cargo.toml" && test -f "$(YT_SL_REPO)/yt-sl.sh"
	docker build -t "$(EAR_ENDIL_YT_SL_IMAGE)" -f "$(CURDIR)/$(EAR_ENDIL_RUNTIME)/images/yt-sl/Dockerfile" "$(YT_SL_REPO)"

k3s-earendil-validate:
	"$(EAR_ENDIL_RUNTIME)/scripts/validate.sh"

k3s-earendil-production-validate:
	kubectl kustomize --load-restrictor LoadRestrictionsNone \
		"$(EAR_ENDIL_RUNTIME)/manifests/overlays/production" \
		| tee /tmp/earendil-production.yaml \
		| grep -q 'name: pi-to-model-egress-proxy'
	! grep -q 'name: pi-model-https' /tmp/earendil-production.yaml
	grep -q 'HTTPS_PROXY' /tmp/earendil-production.yaml

k3s-earendil-smoke: k3s-earendil-validate
	"$(EAR_ENDIL_RUNTIME)/scripts/smoke-test.sh"

k3s-earendil-scan:
	"$(EAR_ENDIL_RUNTIME)/scripts/scan-images.sh"

k3s-earendil-export: k3s-earendil-yt-sl-image
	mkdir -p "$(dir $(EAR_ENDIL_IMAGE_ARCHIVE))"
	docker pull "$(EAR_ENDIL_COREDNS_IMAGE)@$(EAR_ENDIL_COREDNS_ARM64_DIGEST)"
	docker pull "$(EAR_ENDIL_LOCAL_PATH_IMAGE)@$(EAR_ENDIL_LOCAL_PATH_ARM64_DIGEST)"
	docker pull "$(EAR_ENDIL_BUSYBOX_IMAGE)@$(EAR_ENDIL_BUSYBOX_ARM64_DIGEST)"
	docker build --platform linux/arm64 --provenance=false \
		--build-arg "COREDNS_IMAGE=$(EAR_ENDIL_COREDNS_IMAGE)@$(EAR_ENDIL_COREDNS_ARM64_DIGEST)" \
		-t local/k3s-coredns:1.14.7 \
		-f "$(EAR_ENDIL_RUNTIME)/images/coredns/Dockerfile" \
		"$(EAR_ENDIL_RUNTIME)/images/coredns"
	docker tag "$(EAR_ENDIL_LOCAL_PATH_IMAGE)@$(EAR_ENDIL_LOCAL_PATH_ARM64_DIGEST)" local/k3s-local-path:v0.0.37
	docker tag "$(EAR_ENDIL_BUSYBOX_IMAGE)@$(EAR_ENDIL_BUSYBOX_ARM64_DIGEST)" local/k3s-busybox:1.37.0
	docker save --platform linux/arm64 \
		"$(EAR_ENDIL_PI_IMAGE)" \
		"$(EAR_ENDIL_WASSETTE_IMAGE)" \
		"$(EAR_ENDIL_YT_SL_IMAGE)" \
		-o "$(EAR_ENDIL_IMAGE_ARCHIVE)"
	@infra_root=$$(mktemp -d /tmp/earendil-k3s-images.XXXXXX); \
		trap 'rm -rf "$$infra_root"' EXIT; \
		mkdir -p "$$infra_root/layout"; \
		docker save \
			local/k3s-coredns:1.14.7 \
			local/k3s-local-path:v0.0.37 \
			local/k3s-busybox:1.37.0 \
			-o "$$infra_root/images.tar"; \
		tar -xf "$$infra_root/images.tar" -C "$$infra_root/layout"; \
		rm "$$infra_root/layout/manifest.json"; \
		tar -cf "$(EAR_ENDIL_INFRA_IMAGE_ARCHIVE)" -C "$$infra_root/layout" .

k3s-earendil-vm-test: k3s-earendil-validate k3s-earendil-export
	pnpm --filter @agent-workload-platform/k3s-earendil run test:vm
