#!/usr/bin/env bash
# Starts the real api (uvicorn) against a disposable, fixture-seeded SQLite
# database, for the Playwright e2e suite (apps/web/e2e/). This is the
# "real api + seeded DB with MockLlmClient" harness described in the task
# report: e2e drives the actual FastAPI app and SSE/accept/tune endpoints,
# not a hand-rolled fixture server, so a regression in the real request/
# response wiring shows up here too.
#
# CLAUDE.md hard rule 1 ("never call the Anthropic API in tests") applies to
# e2e as much as to pytest/vitest: ANTHROPIC_API_KEY is explicitly unset
# below regardless of what the calling shell exports, and
# TABLEREAD_ALLOW_MOCK_LLM=1 explicitly opts in to MockLlmClient
# (apps/api/llm/dependency.py — the mock is never a silent fallback), so
# this process can never reach the real network.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../api" && pwd)"
DB_FILE="$(mktemp -u -t tableread-e2e).db"

export DATABASE_URL="sqlite:///$DB_FILE"
export TABLEREAD_ALLOW_MOCK_LLM=1
unset ANTHROPIC_API_KEY

cd "$API_DIR"
.venv/bin/python -m storage.seed
exec .venv/bin/uvicorn --app-dir . main:app --port 8000
