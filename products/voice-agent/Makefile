.PHONY: setup build up start logs down recreate verify cycle-test login status grafana-password grafana-mcp-token warm-models benchmark-mlx publish-workspace blackbox-voice blackbox-e2e blackbox-personal-knowledge playwright-voice playwright-diagnostics playwright-grafana host-preflight install-host-services wassette-arxiv-build wassette-arxiv-install wassette-tasking-build wassette-tasking-install wassette-personal-knowledge-build wassette-personal-knowledge-install grafana-c4-dashboard digital-twin-image-build digital-twin-load digital-twin-query digital-twin-validate digital-twin-test digital-twin-identify-skills digital-twin-capture-journal digital-twin-eval db-init broker worker pull-model check

COMPOSE = docker compose --env-file deploy/.env -f deploy/compose.yml

setup:
	uv sync --project apps/broker --python 3.13
	uv sync --project apps/gateway --python 3.13
	uv sync --project apps/worker --python 3.13
	uv sync --project apps/edge --python 3.13
	cd apps/client && npm ci
	cd ../../vendor/excalidraw-mcp && pnpm install --frozen-lockfile --ignore-scripts --ignore-workspace --config.node-linker=isolated
	cd apps/diagnostics && npm ci
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent install
	cp -n deploy/.env.example deploy/.env || true
	cp -n apps/edge/.env.example apps/edge/.env || true

build: grafana-c4-dashboard
	cd apps/client && npm run build
	cd apps/diagnostics && npm run build
	$(COMPOSE) build

up:
	./scripts/compose-up.sh
	$(MAKE) logs

start:
	./scripts/compose-up.sh

logs:
	@mkdir -p "$$HOME/Library/Logs/PipecatEdge"
	@touch "$$HOME/Library/Logs/PipecatEdge/broker.log" "$$HOME/Library/Logs/PipecatEdge/pi-voice.log" "$$HOME/Library/Logs/PipecatEdge/worker.log" "$$HOME/Library/Logs/PipecatEdge/image-builder.log" "$$HOME/Library/Logs/PipecatEdge/host-observability.log" "$$HOME/Library/Logs/PipecatEdge/digital-twin-listener.log"
	@chmod 600 "$$HOME/Library/Logs/PipecatEdge/"*.log
	@interrupted=0; \
	tail -n 100 -F "$$HOME/Library/Logs/PipecatEdge/"*.log & tail_pid=$$!; \
	trap 'interrupted=1' INT TERM; \
	$(COMPOSE) logs -f --tail=100 agent-gateway voice-edge tailscale traefik gitea habitat; status=$$?; \
	kill "$$tail_pid" 2>/dev/null || true; \
	wait "$$tail_pid" 2>/dev/null || true; \
	if [[ "$$interrupted" == 1 || "$$status" == 130 ]]; then exit 0; fi; \
	exit "$$status"

down:
	$(COMPOSE) down

recreate:
	$(COMPOSE) up -d --wait --force-recreate
	./scripts/compose-verify.sh

verify:
	./scripts/compose-verify.sh

cycle-test:
	./tests/e2e/compose-cycle.sh

login:
	./scripts/compose-login.sh

status:
	$(COMPOSE) ps
	$(COMPOSE) exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status || true
	launchctl print "gui/$$UID/com.sathish.pipecat-broker" | sed -n '1,20p'
	launchctl print "gui/$$UID/com.sathish.pipecat-host-observability" | sed -n '1,20p'
	launchctl print "gui/$$UID/com.sathish.pipecat-worker" | sed -n '1,20p'
	launchctl print "gui/$$UID/com.sathish.pipecat-image-builder" | sed -n '1,20p'

grafana-password:
	@test -s deploy/secrets/grafana-admin-password || { echo "Run make up first" >&2; exit 1; }
	@printf 'Grafana user: admin\nGrafana password: '
	@cat deploy/secrets/grafana-admin-password

grafana-mcp-token:
	@test -s deploy/secrets/grafana-mcp-caller-token || { echo "Run make start first" >&2; exit 1; }
	@cat deploy/secrets/grafana-mcp-caller-token

warm-models:
	./scripts/edge-warm-models.sh

benchmark-mlx:
	./scripts/edge-warm-models.sh >/dev/null
	uv run --project apps/broker python apps/broker/benchmark.py $(ARGS)

publish-workspace:
	@test -n "$(WORKSPACE_ID)" -a -n "$(REPOSITORY)" || { echo "Set WORKSPACE_ID and REPOSITORY" >&2; exit 2; }
	cd apps/gateway && PYTHONPATH=src:../../packages/tasking/src uv run --env-file ../../deploy/.env python -m voice_gateway.publish_workspace "$(WORKSPACE_ID)" "$(REPOSITORY)"

blackbox-voice:
	./tests/e2e/blackbox-voice.sh "$(UTTERANCE)"

blackbox-e2e: blackbox-personal-knowledge
	./tests/e2e/blackbox-e2e.sh

blackbox-personal-knowledge: wassette-personal-knowledge-install
	uv run --project apps/gateway python tests/e2e/personal-knowledge-regression.py

playwright-voice:
	./tests/e2e/playwright-voice.sh

playwright-diagnostics:
	./tests/e2e/playwright-diagnostics.sh

playwright-grafana:
	./tests/e2e/playwright-grafana.sh

host-preflight:
	./scripts/host-preflight.sh

install-host-services: wassette-arxiv-install wassette-tasking-install wassette-personal-knowledge-install digital-twin-image-build
	./scripts/install-launch-agents.sh

wassette-arxiv-build:
	$(MAKE) -C components/arxiv-rs build

wassette-arxiv-install: wassette-arxiv-build
	$(MAKE) -C components/arxiv-rs install

wassette-tasking-build:
	$(MAKE) -C components/tasking-ts build

wassette-tasking-install: wassette-tasking-build
	$(MAKE) -C components/tasking-ts install

wassette-personal-knowledge-build:
	$(MAKE) -C components/personal-knowledge-ts build

wassette-personal-knowledge-install: wassette-personal-knowledge-build
	$(MAKE) -C components/personal-knowledge-ts install

grafana-c4-dashboard:
	node deploy/observability/generate-c4-heatmap.mjs

digital-twin-image-build:
	./scripts/gitea-sync.sh
	pnpm --dir ../.. --filter @agent-workload-platform/gondolin-session build
	PYTHONPATH=packages/tasking/src uv run --project apps/worker python scripts/install-digital-twin-image.py

digital-twin-load:
	./apps/pi-agent/digital-twin/runtime/scripts/load.sh

digital-twin-query:
	./apps/pi-agent/digital-twin/runtime/scripts/query.sh $(QUERY)

digital-twin-validate:
	uv run --with 'pyshacl>=0.30,<1' python apps/pi-agent/digital-twin/runtime/scripts/validate.py \
		--shapes apps/pi-agent/digital-twin/runtime/rdf/shapes/profile.shacl.ttl \
		$(or $(DATA),apps/pi-agent/digital-twin/runtime/rdf/private)

digital-twin-test:
	./apps/pi-agent/digital-twin/tests/e2e.sh

digital-twin-identify-skills:
	pnpm --dir apps/pi-agent digital-twin:skills

digital-twin-capture-journal:
	./apps/pi-agent/digital-twin/runtime/scripts/capture-journal.sh

digital-twin-eval:
	pnpm --dir apps/pi-agent eval:classifier $(ARGS)

digital-twin-judge-calibration:
	pnpm --dir apps/pi-agent eval:judge-calibration $(ARGS)

digital-twin-judge-report:
	pnpm --dir apps/pi-agent eval:judge-report -- $(RESULTS)

digital-twin-pull-judge:
	lms get --gguf --yes https://huggingface.co/AtlaAI/Selene-1-Mini-Llama-3.1-8B-Q4_K_M-GGUF

digital-twin-load-judge:
	@if lms ps | rg -q '^selene-1-mini-llama-3.1-8b'; then \
		echo 'Selene judge is already loaded.'; \
	else \
		lms load selene-1-mini-llama-3.1-8b --identifier selene-1-mini-llama-3.1-8b --yes; \
	fi

db-init:
	./scripts/db-init.sh

broker:
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker python -m voice_agent.speech.presentation.http

worker:
	PYTHONPATH=apps/worker/src:packages/tasking/src:packages/telemetry/src uv run --project apps/worker python -m voice_worker.main

pull-model:
	ollama pull qwen3.5:9b-mlx

check:
	node --test deploy/observability/c4-dashboard.test.mjs
	$(MAKE) -C components/tasking-ts check
	$(MAKE) -C components/personal-knowledge-ts check
	pnpm --dir ../.. --filter @agent-workload-platform/otel test
	pnpm --dir ../.. --filter @agent-workload-platform/gondolin-session check
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent check
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent test
	pnpm --dir apps/pi-agent exec promptfoo validate config -c digital-twin/eval/promptfooconfig.mjs
	uv sync --project apps/broker --python 3.13
	uv run --project apps/broker ruff check --config apps/broker/pyproject.toml apps/broker packages/telemetry deploy/test_prepare_compose.py deploy/test_finalize_edge.py
	uv run --project apps/broker pyright --project apps/broker/pyproject.toml apps/broker packages/telemetry
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker pytest apps/broker/tests packages/telemetry/tests deploy/test_prepare_compose.py deploy/test_finalize_edge.py
	uv sync --project apps/gateway --python 3.13
	uv run --project apps/gateway ruff check --config apps/gateway/pyproject.toml apps/gateway packages/tasking
	uv run --project apps/gateway pyright --project apps/gateway/pyproject.toml apps/gateway packages/tasking
	PYTHONPATH=apps/gateway/src:packages/tasking/src:packages/telemetry/src uv run --project apps/gateway pytest apps/gateway/tests packages/tasking/tests
	uv sync --project apps/worker --python 3.13
	uv run --project apps/worker ruff check --config apps/worker/pyproject.toml apps/worker
	uv run --project apps/worker pyright --project apps/worker/pyproject.toml apps/worker
	PYTHONPATH=apps/worker/src:packages/tasking/src:packages/telemetry/src uv run --project apps/worker pytest apps/worker/tests
	uv sync --project apps/edge --python 3.13
	cd apps/edge && PYTHONPATH=.:../../packages/telemetry/src uv run ruff check . && uv run pyright
	cd apps/edge && PYTHONPATH=.:../../packages/telemetry/src uv run python -m unittest discover -p 'test_*.py'
	cd apps/client && npm run lint
	cd apps/client && npm test
	cd apps/client && npm run build
	cd apps/diagnostics && npm run lint
	cd apps/diagnostics && npm run build
	$(MAKE) grafana-c4-dashboard
	$(COMPOSE) config --quiet
	for script in scripts/*.sh; do bash -n "$$script"; done
	for script in tests/e2e/*.sh deploy/launchd/run-*.sh; do bash -n "$$script"; done
	for plist in deploy/launchd/*.plist; do plutil -lint "$$plist"; done
