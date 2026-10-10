.PHONY: setup build dev server broker worker pull-model run check db-up db-init db-down tailscale-serve host-preflight edge-create edge-provision edge-verify edge-cycle-test edge-warm-models edge-tunnel edge-login edge-status edge-install-services

setup:
	cd server && uv sync --python 3.13
	cd client && npm install
	cp -n server/.env.example server/.env || true

build:
	cd client && npm run build

server:
	cd server && uv run bot.py -t websocket --host 127.0.0.1 --port 7860

broker:
	cd server && uv run python inference_broker.py

worker:
	cd server && uv run python -m orchestrator.worker

db-up:
	docker compose --env-file server/.env -f deploy/compose.yml up -d postgres

db-init:
	cd server && uv run dotenv -f .env run -- uvx absurdctl init
	cd server && uv run dotenv -f .env run -- uvx absurdctl create-queue agents
	cd server && uv run python -m orchestrator.schema

db-down:
	docker compose --env-file server/.env -f deploy/compose.yml down

tailscale-serve:
	./scripts/tailscale-serve.sh

host-preflight:
	./scripts/host-preflight.sh

edge-create:
	./scripts/podman-edge-create.sh

edge-provision:
	./scripts/podman-edge-provision.sh

edge-verify:
	./scripts/podman-edge-verify.sh

edge-cycle-test:
	./scripts/podman-edge-cycle-test.sh

edge-warm-models:
	./scripts/edge-warm-models.sh

edge-tunnel:
	./scripts/podman-edge-tunnel.sh

edge-login:
	./scripts/podman-edge-login.sh

edge-status:
	./scripts/podman-edge-status.sh

edge-install-services:
	./scripts/install-launch-agents.sh

dev:
	@echo "Run 'make server' and 'cd client && npm run dev' in separate terminals."

pull-model:
	ollama pull qwen3.5:9b-mlx

run: build server

check:
	cd server && uv sync --python 3.13
	cd server && uv run ruff check .
	cd server && uv run pyright
	cd server && uv run pytest
	cd edge && uv sync --python 3.13 && uv run ruff check . && uv run pyright
	cd client && npm run lint
	cd client && npm run build
