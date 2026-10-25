.DEFAULT_GOAL := help

WASM_COMPONENTS := arxiv-rs tasking-ts personal-knowledge-ts
WASM_ACTIONS := setup build check install clean

.PHONY: help setup build check up start deployment-prepare logs down recreate verify cycle-test
.PHONY: $(WASM_ACTIONS:%=wasm-%) FORCE
.PHONY: automation-setup automation-check automation-verify automation-cycle automation-preflight automation-deploy-edge
.PHONY: automation-digital-twin-e2e automation-playwright automation-blackbox-e2e
.PHONY: automation-blackbox-voice automation-observability
.PHONY: login status grafana-password grafana-mcp-token warm-models benchmark-mlx publish-workspace
.PHONY: blackbox-voice blackbox-e2e blackbox-personal-knowledge blackbox-remote-session
.PHONY: playwright-voice playwright-diagnostics playwright-diagnostics-c2-mock playwright-knowledge-base playwright-knowledge-c2-mock playwright-knowledge-live playwright-durable-c2-mock playwright-task-diagram playwright-durable playwright-grafana playwright-readme-demo playwright-tailnet-voice test-voice-edge-c2-mock test-broker-pi-stream-c2-mock
.PHONY: allure-knowledge-review allure-voice-agent allure-durable allure-publish allure-c4-coverage
.PHONY: playwright-tailnet-diagnostics host-preflight install-host-services storage-collector-build
.PHONY: native-start native-stop native-restart native-status
.PHONY: config-init config-check
.PHONY: grafana-c4-dashboard require-babashka digital-twin-image-build digital-twin-load digital-twin-query
.PHONY: digital-twin-validate digital-twin-test digital-twin-identify-skills
.PHONY: digital-twin-capture-journal digital-twin-eval digital-twin-journal-export digital-twin-journal-finalize
.PHONY: digital-twin-journal-eval digital-twin-judge-calibration
.PHONY: digital-twin-judge-report digital-twin-pull-judge digital-twin-load-judge
.PHONY: digital-twin-artifact-store digital-twin-artifact-add digital-twin-artifact-push
.PHONY: digital-twin-artifact-pull digital-twin-artifact-status digital-twin-artifact-verify
.PHONY: digital-twin-mlflow-up digital-twin-mlflow-verify
.PHONY: db-init gitea-sync broker pi-durable-owner pull-model
.PHONY: test-pi-durable-mcp

COMPOSE = docker compose --env-file deploy/.env -f deploy/compose.yml
MLFLOW_COMPOSE = $(COMPOSE) -f deploy/compose.mlflow.yml
ANSIBLE = ANSIBLE_CONFIG=automation/ansible.cfg uvx --from ansible-core --with requests --with 'psycopg[binary]' ansible-playbook
ANSIBLE_GALAXY = uvx --from ansible-core ansible-galaxy
DVC_ROOT = apps/pi-agent/digital-twin
DVC = AWS_ACCESS_KEY_ID="$${ARTIFACT_ACCESS_KEY:-local-test}" AWS_SECRET_ACCESS_KEY="$${ARTIFACT_SECRET_KEY:-local-test}" AWS_DEFAULT_REGION="$${AWS_DEFAULT_REGION:-us-east-1}" AWS_S3_ADDRESSING_STYLE=path uvx --from dvc==3.67.1 --with dvc-s3==3.3.0 dvc --cd $(DVC_ROOT)
DVC_SCHEMA_CHECK = uvx --from check-jsonschema==0.38.2 check-jsonschema --schemafile $(DVC_ROOT)/artifact-bundle.schema.json $(DVC_ROOT)/artifacts/manifest.json

help:
	@printf '%s\n' \
		'Voice Agent' \
		'' \
		'  make setup          Install development dependencies' \
		'  make build          Build apps, images, dashboards, and WASM components' \
		'  make check          Run all static checks and tests' \
		'  make test-pi-durable-mcp' \
		'                      Test Pi Durable MCP, host, Gondolin, and task follow-up' \
		'  make start|up|down  Operate the full deployment' \
		'  make native-start|native-stop|native-restart|native-status' \
		'                      Manage all eight macOS services' \
		'  make digital-twin-artifact-verify' \
		'                      Verify DVC artifacts through local S3Mock' \
		'  make digital-twin-mlflow-verify' \
		'                      Verify MLflow model versioning through local S3Mock' \
		'  make playwright-readme-demo' \
		'                      Rebuild the narrated README product tour locally' \
		'  make allure-knowledge-review' \
		'                      Run knowledge and MCP tests with a local Allure report' \
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
	cd apps/knowledge-base && npm ci
	pnpm --dir ../.. --filter @agent-workload-platform/voice-pi-agent install
	cp -n deploy/.env.example deploy/.env || true
	cp -n apps/edge/.env.example apps/edge/.env || true
	@mkdir -p deploy/host-env
	@for file in deploy/host-env.example/*.env; do cp -n "$$file" "deploy/host-env/$$(basename "$$file")" || true; done
	@chmod 700 deploy/host-env
	@chmod 600 deploy/host-env/*.env
	$(MAKE) config-init

build: wasm-build grafana-c4-dashboard
	cd apps/client && npm run build
	cd apps/diagnostics && npm run build
	cd apps/knowledge-base && VITE_OXIGRAPH_QUERY_URL=/oxigraph/query npm run build
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
	npm --prefix apps/knowledge-base ci
	VITE_OXIGRAPH_QUERY_URL=/oxigraph/query npm --prefix apps/knowledge-base run build
	$(MAKE) grafana-c4-dashboard
	cp -n apps/edge/.env.example apps/edge/.env || true

config-init:
	uv run --project apps/gateway python tools/config/init_secrets.py .

config-check:
	@test -s deploy/.env || { echo "Missing deploy/.env; run make setup" >&2; exit 1; }
	@test -s apps/edge/.env || { echo "Missing apps/edge/.env; run make setup" >&2; exit 1; }
	@for name in broker pi-voice listener worker image-builder wassette-tasking; do \
		test -s "deploy/host-env/$$name.env" || { echo "Missing deploy/host-env/$$name.env; run make setup" >&2; exit 1; }; \
	done
	@if rg -q '=replace-with-' deploy/host-env/*.env; then \
		echo "Replace placeholder credentials in deploy/host-env before installation" >&2; exit 1; \
	fi
	@for name in broker-token agent-gateway-token digital-twin-reader-token digital-twin-writer-token postgres-password database-url approval-secret grafana-admin-password grafana-mcp-caller-token; do \
		test -s "deploy/secrets/$$name" || { echo "Missing deploy/secrets/$$name; run make config-init" >&2; exit 1; }; \
	done

logs:
	@mkdir -p "$$HOME/Library/Logs/PipecatEdge"
	@touch "$$HOME/Library/Logs/PipecatEdge/broker.log" "$$HOME/Library/Logs/PipecatEdge/pi-voice.log" "$$HOME/Library/Logs/PipecatEdge/worker.log" "$$HOME/Library/Logs/PipecatEdge/image-builder.log" "$$HOME/Library/Logs/PipecatEdge/host-observability.log" "$$HOME/Library/Logs/PipecatEdge/digital-twin-listener.log"
	@touch "$$HOME/Library/Logs/PipecatEdge/music-generation.log"
	@chmod 600 "$$HOME/Library/Logs/PipecatEdge/"*.log
	@interrupted=0; \
	tail -n 100 -F "$$HOME/Library/Logs/PipecatEdge/"*.log & tail_pid=$$!; \
	trap 'interrupted=1' INT TERM; \
	$(COMPOSE) logs -f --tail=100 agent-gateway voice-edge tailscale traefik gitea; status=$$?; \
	kill "$$tail_pid" 2>/dev/null || true; \
	wait "$$tail_pid" 2>/dev/null || true; \
	if [[ "$$interrupted" == 1 || "$$status" == 130 ]]; then exit 0; fi; \
	exit "$$status"

down:
	$(MAKE) native-stop
	$(COMPOSE) down

native-start:
	$(ANSIBLE) automation/playbooks/native_services.yml -e native_action=start

native-stop:
	$(ANSIBLE) automation/playbooks/native_services.yml -e native_action=stop

native-restart:
	$(ANSIBLE) automation/playbooks/native_services.yml -e native_action=restart

native-status:
	$(ANSIBLE) automation/playbooks/native_services.yml -e native_action=status

recreate:
	$(COMPOSE) up -d --wait --force-recreate
	$(MAKE) native-start
	$(MAKE) automation-verify

verify: automation-verify

cycle-test: automation-cycle

automation-setup:
	$(ANSIBLE_GALAXY) collection install --upgrade -r automation/requirements.yml

automation-check:
	@for playbook in automation/playbooks/*.yml; do \
		$(ANSIBLE) --syntax-check "$$playbook" || exit 1; \
	done
	ANSIBLE_CONFIG=automation/ansible.cfg uvx --from ansible-lint ansible-lint automation/playbooks automation/roles

automation-verify:
	$(ANSIBLE) automation/playbooks/verify.yml

automation-deploy-edge:
	$(ANSIBLE) automation/playbooks/deploy_edge.yml

automation-deploy-gateway:
	$(ANSIBLE) automation/playbooks/deploy_gateway.yml

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
	$(MAKE) native-status

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

blackbox-remote-session:
	BLACKBOX_REQUIRE_REMOTE_ATTACH=true \
	BLACKBOX_UTTERANCES_JSON='["Propose a task in the default workspace to inspect the README and architecture documentation and explain remote durable Pi session listening without changing files.","Approve that pending task now.","Attach to the task you just approved.","What are you doing, what have you learned so far, and are you still running?"]' \
	$(MAKE) automation-blackbox-voice

blackbox-e2e: blackbox-personal-knowledge
	$(MAKE) automation-blackbox-e2e

blackbox-personal-knowledge: wasm-install-personal-knowledge-ts
	uv run --project apps/gateway python tests/e2e/personal-knowledge-regression.py

playwright-voice:
	tests/e2e/run-playwright-local voice

playwright-diagnostics:
	tests/e2e/run-playwright-local diagnostics

playwright-knowledge-base:
	tests/e2e/run-playwright-local knowledge-base

playwright-knowledge-live:
	node tests/e2e/run-knowledge-live.mjs

playwright-knowledge-c2-mock:
	VITE_OXIGRAPH_QUERY_URL=/oxigraph/query npm --prefix apps/knowledge-base run build
	tests/e2e/run-c2-mock knowledge-c2-mock

playwright-diagnostics-c2-mock:
	npm --prefix apps/diagnostics run build
	tests/e2e/run-c2-mock diagnostics-c2-mock

playwright-durable-c2-mock:
	tests/e2e/run-c2-mock durable-c2-mock

test-voice-edge-c2-mock:
	PYTHONPATH=apps/edge:packages/telemetry/src uv run --project apps/edge python -m unittest apps.edge.test_c2_broker_mock

test-broker-pi-stream-c2-mock:
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker pytest -q apps/broker/tests/presentation/test_c2_pi_stream.py

playwright-task-diagram:
	tests/e2e/run-playwright-local task-diagram

playwright-durable:
	$(MAKE) automation-playwright PLAYWRIGHT_PROJECT=durable

allure-durable:
	VOICE_RUN_DURABLE_E2E=true $(MAKE) allure-voice-agent

allure-voice-agent:
	node tests/allure/run-knowledge-review.mjs

allure-c4-coverage:
	node tests/allure/refresh-c4-coverage.mjs

allure-knowledge-review: allure-voice-agent

allure-publish:
	node tests/allure/publish-latest.mjs

playwright-grafana:
	$(MAKE) automation-playwright PLAYWRIGHT_PROJECT=grafana

playwright-readme-demo:
	node scripts/build-readme-demo.mjs

playwright-tailnet-voice:
	$(MAKE) automation-playwright PLAYWRIGHT_PROJECT=voice

playwright-tailnet-diagnostics:
	$(MAKE) automation-playwright PLAYWRIGHT_PROJECT=diagnostics

host-preflight: automation-preflight

install-host-services: wasm-install digital-twin-image-build storage-collector-build config-check
	$(ANSIBLE) automation/playbooks/install_host_services.yml

storage-collector-build: apps/host-observability/storage-collector/dist/storage-collector

apps/host-observability/storage-collector/dist/storage-collector: $(wildcard apps/host-observability/storage-collector/*.go) apps/host-observability/storage-collector/go.mod apps/host-observability/storage-collector/go.sum
	mkdir -p apps/host-observability/storage-collector/dist
	docker run --rm --platform linux/arm64 -v "$(CURDIR)/apps/host-observability/storage-collector:/src" -w /src -e GOOS=darwin -e GOARCH=arm64 -e CGO_ENABLED=0 golang:1.27.1-alpine go build -trimpath -o dist/storage-collector .

wasm-setup: $(WASM_COMPONENTS:%=wasm-setup-%)
wasm-build: $(WASM_COMPONENTS:%=wasm-build-%)
wasm-check: $(WASM_COMPONENTS:%=wasm-check-%)
wasm-install: $(WASM_COMPONENTS:%=wasm-install-%)
wasm-clean: $(WASM_COMPONENTS:%=wasm-clean-%)

wasm-setup-% wasm-build-% wasm-check-% wasm-install-% wasm-clean-%: FORCE
	$(MAKE) -C components/$* $(word 2,$(subst -, ,$@))

FORCE:

grafana-c4-dashboard: require-babashka
	bb deploy/observability/generate-c4-heatmap.clj

require-babashka:
	@command -v bb >/dev/null || { echo "Install Babashka (bb) to run the Clojure tooling." >&2; exit 1; }

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

digital-twin-journal-export:
	pnpm --dir apps/pi-agent eval:journal-export -- $(ARGS)

digital-twin-journal-finalize:
	pnpm --dir apps/pi-agent eval:journal-finalize -- $(ARGS)

digital-twin-journal-eval:
	pnpm --dir apps/pi-agent eval:journal-reviewed -- $(ARGS)

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

digital-twin-artifact-store:
	$(MLFLOW_COMPOSE) up -d --wait s3mock

digital-twin-artifact-add:
	@test -f "$(DVC_ROOT)/artifacts/manifest.json" || { echo "Missing $(DVC_ROOT)/artifacts/manifest.json" >&2; exit 1; }
	$(DVC_SCHEMA_CHECK)
	python3 $(DVC_ROOT)/tools/validate-artifact-bundle.py $(DVC_ROOT)/artifacts
	$(DVC) add artifacts

digital-twin-artifact-push: digital-twin-artifact-store
	@test -f "$(DVC_ROOT)/artifacts.dvc" || { echo "Run make digital-twin-artifact-add first" >&2; exit 1; }
	$(DVC) push artifacts.dvc

digital-twin-artifact-pull: digital-twin-artifact-store
	@test -f "$(DVC_ROOT)/artifacts.dvc" || { echo "Missing $(DVC_ROOT)/artifacts.dvc" >&2; exit 1; }
	$(DVC) pull artifacts.dvc

digital-twin-artifact-status:
	@test -f "$(DVC_ROOT)/artifacts.dvc" || { echo "Run make digital-twin-artifact-add first" >&2; exit 1; }
	$(DVC) status --cloud artifacts.dvc

digital-twin-artifact-verify: digital-twin-artifact-store
	bash $(DVC_ROOT)/tools/verify-dvc-s3mock

digital-twin-mlflow-up:
	$(MLFLOW_COMPOSE) up -d --wait s3mock mlflow

digital-twin-mlflow-verify: digital-twin-mlflow-up
	MLFLOW_TRACKING_URI=http://127.0.0.1:$${MLFLOW_PORT:-5001} MLFLOW_DISABLE_AGENT_HINT=1 uv run --with mlflow==3.17.1 python $(DVC_ROOT)/tools/verify-mlflow-registry.py

db-init:
	uv run --project apps/gateway --env-file deploy/.env python tools/ops/db_init.py

gitea-sync:
	uv run --project apps/gateway python tools/ops/gitea_sync.py

broker:
	PYTHONPATH=apps/broker/src:packages/telemetry/src uv run --project apps/broker python -m voice_agent.speech.presentation.http

pi-durable-owner:
	@test -s deploy/host-env/worker.env
	PI_DURABLE_OWNER_TOKEN_FILE="$$PWD/deploy/secrets/agent-gateway-token" \
	PI_DURABLE_TASK_WORKDIR="$$PWD/apps/worker" \
	PYTHONPATH="$$PWD/apps/worker/src:$$PWD/packages/tasking/src:$$PWD/packages/telemetry/src" \
		dotenvx run --quiet --strict -f deploy/host-env/worker.env -- \
		node ../../platform/agent-execution/pi-durable-task/dist/owner-server.js

test-pi-durable-mcp:
	pnpm --dir ../../platform/agent-execution/pi-durable-task build
	cd tests/e2e && npx playwright test --config playwright.config.ts --project pi-durable-mcp-integration

pull-model:
	ollama pull qwen3.5:9b-mlx

check: require-babashka wasm-check automation-check
	bb deploy/observability/c4-dashboard_test.clj
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
	cd apps/client && npm run test:mock
	cd apps/client && npm run build
	cd apps/diagnostics && npm run lint
	cd apps/diagnostics && npm run build
	cd apps/knowledge-base && npm run lint
	cd apps/knowledge-base && npm run build
	$(MAKE) grafana-c4-dashboard
	$(COMPOSE) config --quiet
	for script in deploy/observability/*.sh; do sh -n "$$script"; done
	for plist in deploy/launchd/*.plist; do plutil -lint "$$plist"; done
