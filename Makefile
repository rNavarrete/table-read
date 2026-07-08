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

.PHONY: dev test lint check-contract test-api test-js lint-api lint-js

$(VENV_BIN)/activate: $(API_DIR)/requirements.txt $(API_DIR)/requirements-dev.txt
	$(PYTHON) -m venv $(API_DIR)/.venv
	$(VENV_BIN)/pip install --quiet --upgrade pip
	$(VENV_BIN)/pip install --quiet -r $(API_DIR)/requirements-dev.txt
	touch $(VENV_BIN)/activate

$(NODE_MARKER): package.json $(WEB_DIR)/package.json $(CONTRACT_DIR)/package.json
	env npm install
	touch $(NODE_MARKER)

dev: $(VENV_BIN)/activate $(NODE_MARKER)
	@trap 'kill 0' EXIT INT TERM; \
	$(VENV_BIN)/uvicorn --app-dir $(API_DIR) main:app --reload --port 8000 & \
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

lint-js: $(NODE_MARKER)
	env npm run lint --workspaces --if-present
	env npm run format:check --workspaces --if-present

check-contract:
	@echo "check-contract: stub — real Zod/Pydantic/tool-schema diff lands in T0.2"
