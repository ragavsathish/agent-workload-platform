.PHONY: setup build up down recreate verify cycle-test login status grafana-password warm-models benchmark-mlx publish-workspace blackbox-voice blackbox-e2e host-preflight install-host-services db-init broker worker pull-model check

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
	docker compose --env-file deploy/.env -f deploy/compose.yml build

up:
	./scripts/compose-up.sh

down:
	./scripts/compose-down.sh

recreate:
	docker compose --env-file deploy/.env -f deploy/compose.yml up -d --wait --force-recreate
	./scripts/compose-verify.sh

verify:
	./scripts/compose-verify.sh

cycle-test:
	./scripts/compose-cycle-test.sh

login:
	./scripts/compose-login.sh

status:
	./scripts/compose-status.sh

grafana-password:
	@test -s deploy/secrets/grafana-admin-password || { echo "Run make up first" >&2; exit 1; }
	@printf 'Grafana user: admin\nGrafana password: '
	@cat deploy/secrets/grafana-admin-password

warm-models:
	./scripts/edge-warm-models.sh

benchmark-mlx:
	./scripts/benchmark-mlx.sh

publish-workspace:
	./scripts/publish-workspace.sh "$(WORKSPACE_ID)" "$(REPOSITORY)"

blackbox-voice:
	./scripts/blackbox-voice.sh "$(UTTERANCE)"

blackbox-e2e:
	./scripts/blackbox-e2e.sh

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
	uv run --project apps/broker ruff check --config apps/broker/pyproject.toml apps/broker packages/telemetry deploy/test_prepare_compose.py scripts/benchmark_mlx.py
	uv run --project apps/broker pyright --project apps/broker/pyproject.toml apps/broker packages/telemetry scripts/benchmark_mlx.py
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker pytest apps/broker/tests packages/telemetry/tests deploy/test_prepare_compose.py
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
	docker compose --env-file deploy/.env -f deploy/compose.yml config --quiet
	for script in scripts/*.sh; do bash -n "$$script"; done
	for plist in deploy/launchd/*.plist; do plutil -lint "$$plist"; done
