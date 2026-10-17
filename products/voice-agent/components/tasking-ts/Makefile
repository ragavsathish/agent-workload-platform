SHELL := /bin/bash
.DEFAULT_GOAL := build
.DELETE_ON_ERROR:

WASM := dist/tasking.wasm
WASSETTE ?= $(HOME)/.local/bin/wassette
WAC ?= wac
WAC_VERSION := 0.10.1
COMPONENT_DIR ?= $(HOME)/Library/Application Support/PipecatEdge/wassette-components
COMPONENT_ID := tasking
WIT_DOCS_INJECT_REV := 129ce9bd741d0c458c6478c8ed23d753cc06fb46
DOCS_BUILDER_IMAGE := rust@sha256:e90e846de4124376164ddfbaab4b0774c7bdeef5e738866295e5a90a34a307a2
SOURCES := package.json package-lock.json Cargo.toml Cargo.lock tsconfig.core.json scripts/clean.mjs src/core/index.ts src/core/root-imports.d.ts src/gateway-http/lib.rs wit/world.wit wit/deps/wasi-cli-0.2.0/package.wit

.PHONY: setup toolchain build check install clean

setup: toolchain node_modules/.package-lock.json

toolchain:
	@command -v "$(WAC)" >/dev/null || { echo "Install wac-cli and expose wac on PATH" >&2; exit 1; }
	@test "$$($(WAC) --version)" = "wac-cli $(WAC_VERSION)" || { \
		echo "Expected wac-cli $(WAC_VERSION); run: cargo install --locked wac-cli --version $(WAC_VERSION)" >&2; exit 1; }
	@command -v cargo >/dev/null || { echo "Cargo is required" >&2; exit 1; }

node_modules/.package-lock.json: package.json package-lock.json
	npm ci

$(WASM): $(SOURCES) | toolchain node_modules/.package-lock.json
	PATH="$$(dirname "$(WAC)"):$$PATH" npm run build
	cargo build --locked --release --target wasm32-wasip2
	install -m 600 target/wasm32-wasip2/release/voice_tasking_gateway_http.wasm dist/gateway-http.wasm
	"$(WAC)" plug dist/tasking-core.wasm --plug dist/gateway-http.wasm -o "$(WASM)"
	chmod 600 "$(WASM)"
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

check: build
	npm run typecheck
	cargo fmt --check
	cargo check --locked --target wasm32-wasip2

clean:
	npm run clean
	cargo clean

install: build
	@test -x "$(WASSETTE)" || { echo "Wassette not found: $(WASSETTE)" >&2; exit 1; }
	@mkdir -p "$(COMPONENT_DIR)"
	@chmod 700 "$(COMPONENT_DIR)"
	@"$(WASSETTE)" component unload --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" >/dev/null 2>&1 || true
	"$(WASSETTE)" component load --component-dir "$(COMPONENT_DIR)" "file://$(CURDIR)/$(WASM)"
	"$(WASSETTE)" permission grant network --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" 127.0.0.1:9444
	"$(WASSETTE)" permission grant environment-variable --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" TASK_GATEWAY_BASE_URL
	"$(WASSETTE)" permission grant environment-variable --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" TASK_GATEWAY_TOKEN
	"$(WASSETTE)" permission grant environment-variable --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" TASK_IDENTITY
	"$(WASSETTE)" inspect --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)"
