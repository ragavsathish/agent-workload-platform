.DEFAULT_GOAL := help

WASM_COMPONENTS := arxiv-rs tasking-ts personal-knowledge-ts
WASM_ACTIONS := setup build check install clean

.PHONY: help setup build check up start deployment-prepare logs down recreate verify cycle-test
.PHONY: $(WASM_ACTIONS:%=wasm-%) FORCE
.PHONY: automation-setup automation-check automation-verify automation-cycle automation-preflight
.PHONY: automation-digital-twin-e2e automation-playwright automation-blackbox-e2e
.PHONY: automation-blackbox-voice automation-observability
.PHONY: login status grafana-password grafana-mcp-token warm-models benchmark-mlx publish-workspace
.PHONY: blackbox-voice blackbox-e2e blackbox-personal-knowledge
.PHONY: playwright-voice playwright-diagnostics playwright-grafana host-preflight host-services-env install-host-services
.PHONY: config-init config-check
.PHONY: grafana-c4-dashboard digital-twin-image-build digital-twin-load digital-twin-query
.PHONY: digital-twin-validate digital-twin-test digital-twin-identify-skills
.PHONY: digital-twin-capture-journal digital-twin-eval digital-twin-judge-calibration
.PHONY: digital-twin-judge-report digital-twin-pull-judge digital-twin-load-judge
.PHONY: db-init gitea-sync broker worker pull-model

COMPOSE = docker compose --env-file deploy/.env -f deploy/compose.yml
ANSIBLE = ANSIBLE_CONFIG=automation/ansible.cfg uvx --from ansible-core --with requests --with 'psycopg[binary]' ansible-playbook
ANSIBLE_GALAXY = uvx --from ansible-core ansible-galaxy

help:
	@printf '%s\n' \
		'Voice Agent' \
		'' \
		'  make setup          Install development dependencies' \
		'  make build          Build apps, images, dashboards, and WASM components' \
		'  make check          Run all static checks and tests' \
		'  make start|up|down  Operate the deployment' \
		'  make verify         Verify deployed infrastructure' \
		'  make wasm-ACTION    Run setup, build, check, install, or clean for all components' \
		'  make wasm-ACTION-COMPONENT' \
		'                      Run one action for arxiv-rs, tasking-ts, or personal-knowledge-ts'

setup: automation-setup wasm-setup
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
	$(MAKE) config-init

build: wasm-build grafana-c4-dashboard
	cd apps/client && npm run build
	cd apps/diagnostics && npm run build
	$(COMPOSE) build

up:
	$(MAKE) start
	$(MAKE) logs

start: deployment-prepare
	$(COMPOSE) build
	$(COMPOSE) up -d --wait --force-recreate postgres s3mock gitea
	$(MAKE) db-init
	$(MAKE) install-host-services
	$(COMPOSE) up -d --wait --force-recreate
	$(MAKE) automation-verify

deployment-prepare: config-check
	uv sync --project apps/broker --python 3.13 --frozen
	uv sync --project apps/gateway --python 3.13 --frozen
	uv sync --project apps/worker --python 3.13 --frozen
	npm --prefix apps/client ci
	npm --prefix apps/client run build
	npm --prefix apps/diagnostics ci
	npm --prefix apps/diagnostics run build
	$(MAKE) grafana-c4-dashboard
	cp -n apps/edge/.env.example apps/edge/.env || true

config-init:
	uv run --project apps/gateway python tools/config/init_secrets.py .

config-check:
	@test -s deploy/.env || { echo "Missing deploy/.env; run make setup" >&2; exit 1; }
	@test -s apps/edge/.env || { echo "Missing apps/edge/.env; run make setup" >&2; exit 1; }
	@for name in broker-token agent-gateway-token digital-twin-reader-token digital-twin-writer-token postgres-password database-url habitat-database-password approval-secret grafana-admin-password grafana-mcp-caller-token; do \
		test -s "deploy/secrets/$$name" || { echo "Missing deploy/secrets/$$name; run make config-init" >&2; exit 1; }; \
	done

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
	$(MAKE) automation-verify

verify: automation-verify

cycle-test: automation-cycle

automation-setup:
	$(ANSIBLE_GALAXY) collection install --upgrade -r automation/requirements.yml

automation-check:
	$(ANSIBLE) --syntax-check automation/playbooks/preflight.yml
	$(ANSIBLE) --syntax-check automation/playbooks/verify.yml
	$(ANSIBLE) --syntax-check automation/playbooks/lifecycle.yml
	$(ANSIBLE) --syntax-check automation/playbooks/digital_twin_e2e.yml
	$(ANSIBLE) --syntax-check automation/playbooks/playwright_e2e.yml -e playwright_project=voice
	$(ANSIBLE) --syntax-check automation/playbooks/blackbox_voice.yml
	$(ANSIBLE) --syntax-check automation/playbooks/install_host_services.yml
	ANSIBLE_CONFIG=automation/ansible.cfg uvx --from ansible-lint ansible-lint automation/playbooks automation/roles

automation-verify:
	$(ANSIBLE) automation/playbooks/verify.yml

automation-cycle:
	$(ANSIBLE) automation/playbooks/lifecycle.yml

automation-preflight:
	$(ANSIBLE) automation/playbooks/preflight.yml

automation-digital-twin-e2e:
	$(ANSIBLE) automation/playbooks/digital_twin_e2e.yml

automation-playwright:
	@test -n "$(PLAYWRIGHT_PROJECT)" || { echo "Set PLAYWRIGHT_PROJECT" >&2; exit 2; }
	$(ANSIBLE) automation/playbooks/playwright_e2e.yml -e playwright_project=$(PLAYWRIGHT_PROJECT)

automation-blackbox-e2e:
	$(ANSIBLE) automation/playbooks/blackbox_voice.yml

automation-blackbox-voice:
	$(ANSIBLE) automation/playbooks/blackbox_voice.yml -e blackbox_full_e2e=false

automation-observability:
	$(ANSIBLE) automation/playbooks/verify.yml --tags observability

login:
	uv run --project apps/gateway python tools/ops/login.py

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
	uv run --project apps/gateway python tools/ops/warm_models.py

benchmark-mlx:
	uv run --project apps/gateway python tools/ops/warm_models.py >/dev/null
	uv run --project apps/broker python apps/broker/benchmark.py $(ARGS)

publish-workspace:
	@test -n "$(WORKSPACE_ID)" -a -n "$(REPOSITORY)" || { echo "Set WORKSPACE_ID and REPOSITORY" >&2; exit 2; }
	cd apps/gateway && PYTHONPATH=src:../../packages/tasking/src uv run --env-file ../../deploy/.env python -m voice_gateway.publish_workspace "$(WORKSPACE_ID)" "$(REPOSITORY)"

blackbox-voice:
	BLACKBOX_UTTERANCE="$(UTTERANCE)" $(MAKE) automation-blackbox-voice

blackbox-e2e: blackbox-personal-knowledge
	$(MAKE) automation-blackbox-e2e

blackbox-personal-knowledge: wasm-install-personal-knowledge-ts
	uv run --project apps/gateway python tests/e2e/personal-knowledge-regression.py

playwright-voice:
	$(MAKE) automation-playwright PLAYWRIGHT_PROJECT=voice

playwright-diagnostics:
	$(MAKE) automation-playwright PLAYWRIGHT_PROJECT=diagnostics

playwright-grafana:
	$(MAKE) automation-playwright PLAYWRIGHT_PROJECT=grafana

host-preflight: automation-preflight

host-services-env:
	uv run --project apps/gateway python tools/config/host_env.py .

install-host-services: wasm-install digital-twin-image-build host-services-env
	$(ANSIBLE) automation/playbooks/install_host_services.yml

wasm-setup: $(WASM_COMPONENTS:%=wasm-setup-%)
wasm-build: $(WASM_COMPONENTS:%=wasm-build-%)
wasm-check: $(WASM_COMPONENTS:%=wasm-check-%)
wasm-install: $(WASM_COMPONENTS:%=wasm-install-%)
wasm-clean: $(WASM_COMPONENTS:%=wasm-clean-%)

wasm-setup-% wasm-build-% wasm-check-% wasm-install-% wasm-clean-%: FORCE
	$(MAKE) -C components/$* $(word 2,$(subst -, ,$@))

FORCE:

grafana-c4-dashboard:
	node deploy/observability/generate-c4-heatmap.mjs

digital-twin-image-build:
	$(MAKE) gitea-sync
	pnpm --dir ../.. --filter @agent-workload-platform/gondolin-session build
	PYTHONPATH=packages/tasking/src uv run --project apps/worker python scripts/install-digital-twin-image.py

digital-twin-load:
	uv run --project apps/gateway python tools/ops/digital_twin.py load

digital-twin-query:
	uv run --project apps/gateway python tools/ops/digital_twin.py query $(QUERY)

digital-twin-validate:
	uv run --with 'pyshacl>=0.30,<1' python apps/pi-agent/digital-twin/runtime/scripts/validate.py \
		--shapes apps/pi-agent/digital-twin/runtime/rdf/shapes/profile.shacl.ttl \
		$(or $(DATA),apps/pi-agent/digital-twin/runtime/rdf/private)

digital-twin-test:
	$(MAKE) automation-digital-twin-e2e

digital-twin-identify-skills:
	pnpm --dir apps/pi-agent digital-twin:skills

digital-twin-capture-journal:
	uv run --project apps/gateway python tools/ops/digital_twin.py capture

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
	uv run --project apps/gateway --env-file deploy/.env python tools/ops/db_init.py

gitea-sync:
	uv run --project apps/gateway python tools/ops/gitea_sync.py

broker:
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker python -m voice_agent.speech.presentation.http

worker:
	PYTHONPATH=apps/worker/src:packages/tasking/src:packages/telemetry/src uv run --project apps/worker python -m voice_worker.main

pull-model:
	ollama pull qwen3.5:9b-mlx

check: wasm-check automation-check
	node --test deploy/observability/c4-dashboard.test.mjs
	pnpm --dir ../.. --filter @agent-workload-platform/otel test
	pnpm --dir ../.. --filter @agent-workload-platform/gondolin-session check
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent check
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent test
	pnpm --dir apps/pi-agent exec promptfoo validate config -c digital-twin/eval/promptfooconfig.mjs
	uv sync --project apps/broker --python 3.13
	uv run --project apps/broker ruff check --config apps/broker/pyproject.toml apps/broker packages/telemetry
	uv run --project apps/broker pyright --project apps/broker/pyproject.toml apps/broker packages/telemetry
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker pytest apps/broker/tests packages/telemetry/tests
	PYTHONPATH=. uv run --project apps/gateway pytest tests/tools
	uv sync --project apps/gateway --python 3.13
	uv run --project apps/gateway ruff check --config apps/gateway/pyproject.toml apps/gateway packages/tasking scripts/*.py tools/config/*.py tools/ops/*.py tests/tools/*.py apps/pi-agent/digital-twin/runtime/scripts/*.py
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
	for script in deploy/habitat/*.sh deploy/observability/*.sh; do sh -n "$$script"; done
	for plist in deploy/launchd/*.plist; do plutil -lint "$$plist"; done
