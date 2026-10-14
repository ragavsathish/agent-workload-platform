.PHONY: setup build up start logs down recreate verify cycle-test login status grafana-password warm-models benchmark-mlx publish-workspace blackbox-voice blackbox-e2e playwright-voice host-preflight install-host-services db-init broker worker pull-model check

COMPOSE = docker compose --env-file deploy/.env -f deploy/compose.yml

setup:
	uv sync --project apps/broker --python 3.13
	uv sync --project apps/gateway --python 3.13
	uv sync --project apps/worker --python 3.13
	uv sync --project apps/edge --python 3.13
	cd apps/web && npm ci
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent install
	cp -n deploy/.env.example deploy/.env || true
	cp -n apps/edge/.env.example apps/edge/.env || true

build:
	cd apps/web && npm run build
	$(COMPOSE) build

up:
	./scripts/compose-up.sh
	$(MAKE) logs

start:
	./scripts/compose-up.sh

logs:
	@mkdir -p "$$HOME/Library/Logs/PipecatEdge"
	@touch "$$HOME/Library/Logs/PipecatEdge/broker.log" "$$HOME/Library/Logs/PipecatEdge/pi-voice.log" "$$HOME/Library/Logs/PipecatEdge/worker.log" "$$HOME/Library/Logs/PipecatEdge/host-observability.log"
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

grafana-password:
	@test -s deploy/secrets/grafana-admin-password || { echo "Run make up first" >&2; exit 1; }
	@printf 'Grafana user: admin\nGrafana password: '
	@cat deploy/secrets/grafana-admin-password

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

blackbox-e2e:
	./tests/e2e/blackbox-e2e.sh

playwright-voice:
	./tests/e2e/playwright-voice.sh

host-preflight:
	./scripts/host-preflight.sh

install-host-services:
	./scripts/install-launch-agents.sh

db-init:
	./scripts/db-init.sh

broker:
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker python -m voice_agent.speech.presentation.http

worker:
	PYTHONPATH=apps/worker/src:packages/tasking/src uv run --project apps/worker python -m voice_worker.main

pull-model:
	ollama pull qwen3.5:9b-mlx

check:
	pnpm --dir ../.. --filter @agent-workload-platform/gondolin-session check
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent check
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent test
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
	PYTHONPATH=apps/worker/src:packages/tasking/src uv run --project apps/worker pytest apps/worker/tests
	uv sync --project apps/edge --python 3.13
	cd apps/edge && PYTHONPATH=.:../../packages/telemetry/src uv run ruff check . && uv run pyright
	cd apps/edge && PYTHONPATH=.:../../packages/telemetry/src uv run python -m unittest discover -p 'test_*.py'
	cd apps/web && npm run lint
	cd apps/web && npm test
	cd apps/web && npm run build
	$(COMPOSE) config --quiet
	for script in scripts/*.sh; do bash -n "$$script"; done
	for script in tests/e2e/*.sh deploy/launchd/run-*.sh; do bash -n "$$script"; done
	for plist in deploy/launchd/*.plist; do plutil -lint "$$plist"; done
