PYTHON := python3.12
API_DIR := apps/api
WEB_DIR := apps/web
CONTRACT_DIR := packages/contract
VENV_BIN := $(CURDIR)/$(API_DIR)/.venv/bin
NODE_MARKER := node_modules/.installed

# nvm installs node/npm outside the PATH Make inherited at startup. Resolve
# nvm's default Node install from its alias file and export it. No-op
# (falls through to the ambient PATH) if nvm isn't in use on this machine.
NVM_NODE_VERSION := $(shell cat $(HOME)/.nvm/alias/default 2>/dev/null)
ifneq ($(NVM_NODE_VERSION),)
export PATH := $(HOME)/.nvm/versions/node/v$(NVM_NODE_VERSION)/bin:$(PATH)
endif

# GNU Make execs recipe lines with no shell metacharacters directly, using a
# PATH it cached before the export above ran — so plain `npm ...` lines still
# fail to resolve even though PATH is correct. `env` forces a real lookup.

.PHONY: dev test lint check-contract test-api test-js lint-api lint-js seed e2e

$(VENV_BIN)/activate: $(API_DIR)/requirements.txt $(API_DIR)/requirements-dev.txt
	$(PYTHON) -m venv $(API_DIR)/.venv
	$(VENV_BIN)/pip install --quiet --upgrade pip
	$(VENV_BIN)/pip install --quiet -r $(API_DIR)/requirements-dev.txt
	touch $(VENV_BIN)/activate

$(NODE_MARKER): package.json $(WEB_DIR)/package.json $(CONTRACT_DIR)/package.json
	env npm install
	touch $(NODE_MARKER)

# TABLEREAD_ALLOW_MOCK_LLM=1 opts in to MockLlmClient when no
# ANTHROPIC_API_KEY is exported (llm/dependency.py) — dev works keyless, but
# a real key in the environment still wins and selects the real client.
dev: $(VENV_BIN)/activate $(NODE_MARKER)
	@trap 'kill 0' EXIT INT TERM; \
	TABLEREAD_ALLOW_MOCK_LLM=1 $(VENV_BIN)/uvicorn --app-dir $(API_DIR) main:app --reload --port 8000 & \
	npm run dev --workspace=$(WEB_DIR) & \
	wait

test: test-api test-js

test-api: $(VENV_BIN)/activate
	cd $(API_DIR) && $(VENV_BIN)/pytest

test-js: $(NODE_MARKER)
	env npm test --workspaces --if-present

lint: lint-api lint-js

lint-api: $(VENV_BIN)/activate
	cd $(API_DIR) && $(VENV_BIN)/ruff check .
	$(VENV_BIN)/ruff check --config $(API_DIR)/pyproject.toml scripts

lint-js: $(NODE_MARKER)
	env npm run lint --workspaces --if-present
	env npm run format:check --workspaces --if-present

check-contract: $(VENV_BIN)/activate $(NODE_MARKER)
	$(VENV_BIN)/python scripts/check_contract.py

seed: $(VENV_BIN)/activate
	cd $(API_DIR) && $(VENV_BIN)/python -m storage.seed

# Playwright e2e (T2.3): the real api (uvicorn), a disposable fixture-seeded
# SQLite DB, and MockLlmClient (apps/web/e2e/start-api.sh), plus the real
# Vite dev server — both started and torn down by Playwright itself
# (apps/web/e2e/playwright.config.ts's `webServer`). Deliberately NOT part
# of `test`: it drives a real browser and two real server processes, which
# is slower and a different failure mode than the mock-LLM unit/integration
# suite `test` runs on every save; run it before merging UI-touching PRs.
e2e: $(VENV_BIN)/activate $(NODE_MARKER)
	env npm exec --workspace=$(WEB_DIR) -- playwright install chromium
	env npm run e2e --workspace=$(WEB_DIR)
