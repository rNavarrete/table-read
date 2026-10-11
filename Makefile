PYTHON := python3.12
API_DIR := apps/api
WEB_DIR := apps/web
CONTRACT_DIR := packages/contract
VENV_BIN := $(CURDIR)/$(API_DIR)/.venv/bin
NODE_MARKER := node_modules/.installed

# PDF OCR bootstrap for local/dev machines: install system Tesseract with
# English data before testing scanned PDFs (`brew install tesseract` on macOS;
# `apt install tesseract-ocr tesseract-ocr-eng` on Debian/Ubuntu). PR-path
# tests inject OCR engines and do not require Tesseract.

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

.PHONY: dev test lint check-contract check-gaps test-api test-js lint-api lint-js seed e2e evals evals-dry

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
	@if [ -n "$$ANTHROPIC_API_KEY" ]; then \
		echo "note: ANTHROPIC_API_KEY is set — real Anthropic client (mock flag ignored). For mock smoke: env -u ANTHROPIC_API_KEY make dev"; \
	else \
		echo "note: no ANTHROPIC_API_KEY — serving MockLlmClient"; \
	fi
	@trap 'kill 0' EXIT INT TERM; \
	TABLEREAD_ALLOW_MOCK_LLM=1 $(VENV_BIN)/uvicorn --app-dir $(API_DIR) main:app --reload --port 8000 & \
	npm run dev --workspace=$(WEB_DIR) & \
	wait

test: test-api test-js

test-api: $(VENV_BIN)/activate
	cd $(API_DIR) && $(VENV_BIN)/pytest

test-js: $(NODE_MARKER)
	env npm test --workspaces --if-present

lint: lint-api lint-js typecheck check-gaps

lint-api: $(VENV_BIN)/activate
	cd $(API_DIR) && $(VENV_BIN)/ruff check .
	$(VENV_BIN)/ruff check --config $(API_DIR)/pyproject.toml scripts

# DESIGN-GAP CI grep (T6.1, CLAUDE.md convention): fail unless every DESIGN-GAP
# in shipped source references a task id (DESIGN-GAP(T<id>)). Pure stdlib, so it
# runs standalone on the PR path via `lint` without the venv.
check-gaps:
	$(PYTHON) scripts/check_design_gaps.py

lint-js: $(NODE_MARKER)
	env npm run lint --workspaces --if-present
	env npm run format:check --workspaces --if-present

# `npm run build` runs `tsc -b` before `vite build`; vitest strips types without
# checking them, so this is the only PR-path gate that catches type errors.
.PHONY: typecheck
typecheck: $(NODE_MARKER)
	cd $(WEB_DIR) && npx tsc -b

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

# LLM eval suite (T6.1, test plan §3). Constructs the real AnthropicClient via
# the sanctioned factory (hard rule 1 permits this for `make evals`) plus a
# grader judge; requires ANTHROPIC_API_KEY. Runs against an isolated temp DB,
# prints per-eval scores + PROMPT_VERSION + pinned model ids, writes a report
# artifact under apps/api/evals/reports/, and exits nonzero on any hard-gate
# failure (lock-violation = 0, schema-validity, act-validity, continuity). Gates every
# PROMPT_VERSION / model-id change (hard rules 3 & 7). **Never run without being
# asked; costs money.** Default = core hard gates only (schema/act-validity/
# lock/continuity, N=5) ≈108 nominal calls; `--full` adds soft families (~+50,
# incl. T7.22's narrative-promises + narrative-promises-merge);
# `--runs 1` smoke ≈24. `make evals-dry` runs the full harness offline on
# MockLlmClient.
evals: $(VENV_BIN)/activate
	cd $(API_DIR) && PYTHONUNBUFFERED=1 $(VENV_BIN)/python -m evals.run

evals-dry: $(VENV_BIN)/activate
	cd $(API_DIR) && PYTHONUNBUFFERED=1 $(VENV_BIN)/python -m evals.run --dry-run --full
