.PHONY: setup build up down recreate verify cycle-test login lan-up lan-down lan-iphone-setup lan-password status grafana-password warm-models benchmark-mlx publish-workspace blackbox-voice blackbox-e2e host-preflight install-host-services db-init broker worker pull-model check

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

lan-up:
	./scripts/lan-up.sh

lan-down:
	./scripts/lan-down.sh

lan-iphone-setup:
	./scripts/lan-iphone-setup.sh

lan-password:
	@test -s deploy/secrets/lan-password || { echo "Run make lan-up first" >&2; exit 1; }
	@printf 'LAN user: lan\nLAN password: '
	@cat deploy/secrets/lan-password

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
	LAN_BIND_IP=192.168.1.10 LAN_ORIGIN=https://192.168.1.10:8443 LAN_BASIC_AUTH_HASH=dummy LAN_IDENTITY=user@example.com docker compose --env-file server/.env -f deploy/compose.yml -f deploy/compose.lan.yml config --quiet
	for script in scripts/*.sh; do bash -n "$$script"; done
	for plist in deploy/launchd/*.plist; do plutil -lint "$$plist"; done
