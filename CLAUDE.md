# CLAUDE.md — Table Read

Table Read is a structural co-writing tool for episodic TV writers. Read `docs/narrative-sidekick-design-doc.md` for product intent. Start with `docs/tableread-handoff.md` if this is your first session in this repo.

**Authority split:** the docs in `docs/` are authoritative for *product intent and behavior*; `packages/contract` (Zod, with its Pydantic mirror and generated tool schemas) is authoritative for *executable schemas* — code must follow the contract package, never a schema transcribed from a doc. If the docs and the contract package disagree, or code needs behavior the docs don't define, stop and flag it — don't silently pick one.

## Doc map

| Question | Doc |
|---|---|
| First session? Orientation, decisions, open questions | `docs/tableread-handoff.md` |
| Why does this feature exist / how should it behave? | `docs/narrative-sidekick-design-doc.md` |
| What are the types / endpoints? | `docs/tableread-data-contract.md` |
| What exactly goes in an LLM prompt? | `docs/tableread-prompt-spec.md` |
| What do I build next, and when is it done? | `docs/tableread-build-plan.md` (+ `docs/tableread-adoption-prd.md` for A-items) |
| What should it look like? | `docs/tableread-ui-spec.md` |
| What must tests cover? | `docs/tableread-test-plan.md` |
| Sample data | `docs/tableread-fixture.json` ("The Long Pour") |
| What the competition does / fails at | `docs/tableread-competitive-analysis.md` |
| Agent rules (also mirrored here) | `AGENTS.md` |

## Commands

- `make dev` — run web (5173) + api (8000)
- `make test` — all PR-path tests (mock LLM)
- `make e2e` — Playwright e2e (real api + seeded temp DB + MockLlmClient + real browser); not part of `make test` (slower, different failure mode) — run before merging UI-touching PRs
- `make lint` — ruff + eslint + prettier check
- `make check-contract` — Zod↔Pydantic diff, fixture validation, OpenAPI snapshot
- `make seed` — load fixture into dev DB
- `make evals` — real-API evals. **Never run without being asked; costs money.**

## Layout

`apps/web` (React 18 + TS + Vite + Tailwind) · `apps/api` (FastAPI, Python 3.12, SQLAlchemy/SQLite) · `packages/contract` (Zod source of truth; Pydantic mirrors in `apps/api/schemas.py`)

## Hard rules

1. **Never call the Anthropic API in tests.** Use `MockLlmClient`. The real client is constructed only in app startup and `make evals`.
2. **Locks are sacred.** Any code path that regenerates content MUST route through the lock filter (`drama_manager/locks.py`). If you write a new generation path, add a lock-violation test before the feature test. The lock-violation eval gate is zero, not "low".
3. **Schema changes touch every home or none:** Zod (`packages/contract`), Pydantic (`schemas.py`), and the data-contract doc — plus, for LLM operation schemas (data contract §2a), the prompt-spec summary (`docs/tableread-prompt-spec.md`) and the regenerated `config/tool_schemas/`. `make check-contract` enforces Zod↔Pydantic↔tool-schemas and is required before merging any schema change; you update the docs. A tool-schema diff triggers the `make evals` requirement (rule 7).
4. **Every mutation snapshots.** No direct doc writes outside the snapshot transaction helper (`storage/snapshots.py`).
5. **No writer text in logs.** Log IDs, hashes, token counts, PROMPT_VERSION — never script or plan content.
6. **No hardcoded colors/spacing in components.** Tokens only (`--tr-*`). If a value isn't in the UI spec tokens, ask.
7. **Prompt changes bump PROMPT_VERSION** in the template file and require `make evals` sign-off before merge.
8. **AI stays quiet in Write mode.** No proactive generation, no polling, no suggestion popups. Generation happens on explicit writer gesture only (design doc §4.3).
9. LLM structured output that fails validation gets exactly one retry with the error appended; then surface `SCHEMA_INVALID_LLM`. Never fabricate a fallback response.
10. Don't add dependencies without flagging it in the PR description with a one-line justification.

## Conventions

- IDs: kebab strings (`scene-3`, `beat-3-1`, `fact-04`, `char-marta`). Server assigns; clients never mint IDs.
- Wire format camelCase; Python snake_case with camel aliases.
- Errors: `{error: {code, message, details?}}` — codes listed in data contract §4.
- Frontend state: server is source of truth; optimistic updates must roll back on 4xx/5xx.
- Tests live beside code (`foo.test.ts`, `test_foo.py`); e2e in `apps/web/e2e/`.
- Commit style: `area: imperative summary` (`review: reject locked ids in apply`).

## Working style

- Pick tasks from the build plan in order; respect the M-milestone dependencies (M4 needs T2.2).
- Each build-plan task = one PR-sized change. Acceptance criteria are the review checklist; quote them in the PR description with pass/fail.
- When a design question isn't answered by the docs, don't improvise product behavior — leave a `// DESIGN-GAP:` comment and ask. **DESIGN-GAPs never linger:** a PR containing one either blocks merge until the question is answered, or ships only with an explicit tracking task added to the build plan (and a test-plan entry if the gap touches locks, snapshots, ledger, or Change Sets). CI greps for `DESIGN-GAP` and fails unless each occurrence references a task id (`// DESIGN-GAP(T4.5): ...`).
