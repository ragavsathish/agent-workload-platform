C4_WORKLOAD := workloads/c4-excalidraw
C4_INPUT ?= $(C4_WORKLOAD)/examples/composable-c4-pipeline.mmd
C4_OUTPUT ?= artifacts/c4-excalidraw/composable-c4-pipeline.excalidraw
C4_MODEL ?= openai-codex/gpt-5.6-terra

.PHONY: c4 c4-build c4-test

c4-build:
	npm --prefix $(C4_WORKLOAD) run build
	npm --prefix $(C4_WORKLOAD) run components:load

c4-test:
	npm --prefix $(C4_WORKLOAD) test

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
