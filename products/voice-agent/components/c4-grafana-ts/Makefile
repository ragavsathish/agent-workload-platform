SHELL := /bin/bash
.DEFAULT_GOAL := build

WASM := dist/c4-grafana.wasm
WASSETTE ?= $(HOME)/.local/bin/wassette
COMPONENT_DIR ?= $(HOME)/Library/Application Support/PipecatEdge/wassette-components
COMPONENT_ID := c4-grafana
WIT_DOCS_INJECT_REV := 129ce9bd741d0c458c6478c8ed23d753cc06fb46
DOCS_BUILDER_IMAGE := rust@sha256:e90e846de4124376164ddfbaab4b0774c7bdeef5e738866295e5a90a34a307a2
SOURCES := package.json package-lock.json tsconfig.json scripts/clean.mjs src/index.ts test/compiler.test.mjs wit/world.wit

.PHONY: build check install

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

build: $(WASM)

$(WASM): $(SOURCES) | node_modules
	npm run build
	@docker run --rm \
		-e HOST_UID="$$(id -u)" -e HOST_GID="$$(id -g)" \
		-v "$(CURDIR):/work" \
		-v voice-wit-docs-cargo-registry:/usr/local/cargo/registry \
		-v voice-wit-docs-tools:/tools \
		-w /work \
		"$(DOCS_BUILDER_IMAGE)" \
		bash -c 'set -euo pipefail; test -x /tools/bin/wit-docs-inject || cargo install --locked --root /tools --git https://github.com/Mossaka/wit-docs-inject.git --rev "$(WIT_DOCS_INJECT_REV)" wit-docs-inject; /tools/bin/wit-docs-inject --component "$(WASM)" --wit-dir wit --inplace; chown "$$HOST_UID:$$HOST_GID" "$(WASM)"'
	@shasum -a 256 "$(WASM)"

check: node_modules
	npm test
	npm run typecheck

install: $(WASM)
	@test -x "$(WASSETTE)" || { echo "Wassette not found: $(WASSETTE)" >&2; exit 1; }
	@mkdir -p "$(COMPONENT_DIR)"
	@chmod 700 "$(COMPONENT_DIR)"
	@"$(WASSETTE)" component unload --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" >/dev/null 2>&1 || true
	"$(WASSETTE)" component load --component-dir "$(COMPONENT_DIR)" "file://$(CURDIR)/$(WASM)"
	"$(WASSETTE)" inspect --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)"
