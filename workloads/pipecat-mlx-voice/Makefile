.PHONY: setup build up down recreate verify cycle-test login status warm-models benchmark-mlx publish-workspace blackbox-voice blackbox-e2e host-preflight install-host-services db-init broker worker pull-model check

setup:
	cd server && uv sync --python 3.13
	cd edge && uv sync --python 3.13
	cd client && npm ci
	cp -n server/.env.example server/.env || true
	cp -n edge/.env.example edge/.env || true

build:
	cd client && npm run build
	docker compose --env-file server/.env -f deploy/compose.yml build

up:
	./scripts/compose-up.sh

down:
	./scripts/compose-down.sh

recreate:
	docker compose --env-file server/.env -f deploy/compose.yml up -d --wait --force-recreate
	./scripts/compose-verify.sh

verify:
	./scripts/compose-verify.sh

cycle-test:
	./scripts/compose-cycle-test.sh

login:
	./scripts/compose-login.sh

status:
	./scripts/compose-status.sh

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
	cd server && uv run python inference_broker.py

worker:
	cd server && uv run python -m orchestrator.worker

pull-model:
	ollama pull qwen3.5:9b-mlx

check:
	cd server && uv sync --python 3.13
	cd server && uv run ruff check .
	cd server && uv run pyright
	cd server && uv run pytest
	cd server && uv run ruff check ../scripts/benchmark_mlx.py
	cd server && uv run pyright ../scripts/benchmark_mlx.py
	cd edge && uv sync --python 3.13 && uv run ruff check . && uv run pyright
	cd client && npm run lint
	cd client && npm run build
	docker compose --env-file server/.env -f deploy/compose.yml config --quiet
	for script in scripts/*.sh; do bash -n "$$script"; done
	for plist in deploy/launchd/*.plist; do plutil -lint "$$plist"; done
