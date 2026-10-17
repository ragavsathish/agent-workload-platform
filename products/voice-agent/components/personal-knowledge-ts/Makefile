SHELL := /bin/bash
.DEFAULT_GOAL := build

WASM := dist/personal-knowledge.wasm
WASSETTE ?= $(HOME)/.local/bin/wassette
WAC ?= $(HOME)/.cargo/bin/wac
COMPONENT_DIR ?= $(HOME)/Library/Application Support/PipecatEdge/wassette-components
COMPONENT_ID := personal-knowledge
WIT_DOCS_INJECT_REV := 129ce9bd741d0c458c6478c8ed23d753cc06fb46
DOCS_BUILDER_IMAGE := rust@sha256:e90e846de4124376164ddfbaab4b0774c7bdeef5e738866295e5a90a34a307a2
SOURCES := package.json package-lock.json Cargo.toml Cargo.lock tsconfig.core.json scripts/clean.mjs src/core/index.ts src/core/root-imports.d.ts src/gateway-http/lib.rs wit/world.wit wit/deps/wasi-cli-0.2.0/package.wit

.PHONY: build check install

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

$(WASM): $(SOURCES) | node_modules
	@test -x "$(WAC)" || { echo "WAC not found: $(WAC)" >&2; exit 1; }
	PATH="$$(dirname "$(WAC)"):$$PATH" npm run build
	cargo build --locked --release --target wasm32-wasip2
	install -m 600 target/wasm32-wasip2/release/voice_personal_knowledge_gateway_http.wasm dist/gateway-http.wasm
	"$(WAC)" plug dist/personal-knowledge-core.wasm --plug dist/gateway-http.wasm -o "$(WASM)"
	@docker run --rm \
		-e HOST_UID="$$(id -u)" -e HOST_GID="$$(id -g)" \
		-v "$(CURDIR):/work" \
		-v voice-wit-docs-cargo-registry:/usr/local/cargo/registry \
		-v voice-wit-docs-tools:/tools \
		-w /work \
		"$(DOCS_BUILDER_IMAGE)" \
		bash -c 'set -euo pipefail; test -x /tools/bin/wit-docs-inject || cargo install --locked --root /tools --git https://github.com/Mossaka/wit-docs-inject.git --rev "$(WIT_DOCS_INJECT_REV)" wit-docs-inject; /tools/bin/wit-docs-inject --component "$(WASM)" --wit-dir wit --inplace; chown "$$HOST_UID:$$HOST_GID" "$(WASM)"'
	@shasum -a 256 "$(WASM)"

build: $(WASM)

check: node_modules
	npm run typecheck
	cargo fmt --check
	cargo check --locked --target wasm32-wasip2

install: $(WASM)
	@test -x "$(WASSETTE)" || { echo "Wassette not found: $(WASSETTE)" >&2; exit 1; }
	@mkdir -p "$(COMPONENT_DIR)"
	@chmod 700 "$(COMPONENT_DIR)"
	@"$(WASSETTE)" component unload --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" >/dev/null 2>&1 || true
	"$(WASSETTE)" component load --component-dir "$(COMPONENT_DIR)" "file://$(CURDIR)/$(WASM)"
	"$(WASSETTE)" permission grant network --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" 127.0.0.1:9444
	"$(WASSETTE)" permission grant environment-variable --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" KNOWLEDGE_GATEWAY_BASE_URL
	"$(WASSETTE)" permission grant environment-variable --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" KNOWLEDGE_GATEWAY_TOKEN
	"$(WASSETTE)" permission grant environment-variable --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" KNOWLEDGE_IDENTITY
	"$(WASSETTE)" inspect --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)"
