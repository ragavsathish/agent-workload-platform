SHELL := /bin/bash
.DEFAULT_GOAL := build
.DELETE_ON_ERROR:

TARGET := wasm32-wasip2
WASM := dist/arxiv_rs.wasm
BUILDER_IMAGE := rust@sha256:e90e846de4124376164ddfbaab4b0774c7bdeef5e738866295e5a90a34a307a2
WASSETTE ?= $(HOME)/.local/bin/wassette
COMPONENT_DIR ?= $(HOME)/Library/Application Support/PipecatEdge/wassette-components
COMPONENT_ID := arxiv_rs
UPSTREAM_COMPONENT_ID := microsoft_arxiv-rs

.PHONY: setup build check install clean

setup:
	@command -v docker >/dev/null || { echo "Docker is required" >&2; exit 1; }

build: $(WASM)

check: build
	@test -s "$(WASM)"

clean:
	rm -rf dist target

$(WASM): Makefile Cargo.toml Cargo.lock rust-toolchain.toml src/lib.rs src/bindings.rs wit/world.wit
	@set -euo pipefail; \
	docker run --rm \
		-e HOST_UID="$$(id -u)" -e HOST_GID="$$(id -g)" \
		-v "$(CURDIR):/work" \
		-v voice-arxiv-cargo-registry:/usr/local/cargo/registry \
		-v voice-arxiv-rustup:/usr/local/rustup \
		-w /work \
		"$(BUILDER_IMAGE)" \
		bash -c 'set -euo pipefail; rustup target add "$(TARGET)"; cargo build --locked --release --target "$(TARGET)"; chown -R "$$HOST_UID:$$HOST_GID" target'; \
	mkdir -p "$(CURDIR)/dist"; \
	install -m 600 "$(CURDIR)/target/$(TARGET)/release/arxiv_rs.wasm" "$(CURDIR)/$(WASM)"; \
	shasum -a 256 "$(CURDIR)/$(WASM)"

install: $(WASM)
	@test -x "$(WASSETTE)" || { echo "Wassette not found: $(WASSETTE)" >&2; exit 1; }
	@test -s "$(WASM)" || { echo "Build $(WASM) first" >&2; exit 1; }
	@mkdir -p "$(COMPONENT_DIR)"
	@chmod 700 "$(COMPONENT_DIR)"
	@"$(WASSETTE)" component unload --component-dir "$(COMPONENT_DIR)" "$(UPSTREAM_COMPONENT_ID)" >/dev/null 2>&1 || true
	@"$(WASSETTE)" component unload --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" >/dev/null 2>&1 || true
	"$(WASSETTE)" component load --component-dir "$(COMPONENT_DIR)" "file://$(CURDIR)/$(WASM)"
	"$(WASSETTE)" permission grant network --component-dir "$(COMPONENT_DIR)" "$(COMPONENT_ID)" export.arxiv.org
	"$(WASSETTE)" component list --component-dir "$(COMPONENT_DIR)" --output-format table
