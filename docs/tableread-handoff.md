# Table Read — Handoff Brief

*Orientation for a fresh implementing agent. Read this first, then follow the reading order below. State as of July 2026.*

## 1. What this project is, in three sentences

Table Read is a structural co-writing tool for episodic TV writers, built on the Claude API: the story lives as a persistent hierarchical plan (series bible → season → episode → scene → beat) plus a machine-maintained **continuity ledger** of facts (who knows what, what's true, where it was established). AI proposes; the writer disposes — every AI change beyond an accepted beat arrives as a previewed, partial-applicable **Change Set**, locks are inviolable, and every mutation is an undoable snapshot. The design was hardened against a hands-on field test of Google DeepMind's Fabula, whose reproduced failures (knowledge-state amnesia, silent edit loss, unscoped cascades) define exactly what this product must never do.

## 2. Current state

- **Docs:** complete for MVP + Quiet Tool + new-project flow + Fabula adoption PRD (`tableread-adoption-prd.md`). Competitive analysis and this handoff live under `docs/`.
- **Code:** MVP milestones through Write/Plan/Review/Ledger, Quiet Tool chrome, Story Launcher / idea+import wizards, guided scene-skeleton Change Sets, and T7.10 typed segment-start normalization are implemented. T7.13 adds markerless import act inference plus Plan correction at `PROMPT_VERSION` 0.11.0: compact post-segmentation summaries produce validated act starts, every scene receives one derived act, Analyze reports `inferring_acts` and nominal `2N+2`, and writers can move scenes into empty format-valid acts without an LLM call. T7.12 parallel import progress is separately tracked and must remain intact when these branches integrate.
- **Merge gate:** T7.13's non-billable tests/checks and dry harness pass, but the prompt/tool-schema change is **not merge-ready until an explicitly authorized full real eval** includes `infer_act_breaks` schema validity, the hard `act-boundary-validity = 1.0` semantic gate, and the soft `act-boundary-quality ≥ 0.80` transition review. No paid eval has been run for `PROMPT_VERSION` 0.11.0.
- **Open work:** T7.11 import-job checkpoint/cache infrastructure remains queued; distinct TAG representation/inference and explicit act-heading parsing remain deferred; adoption A-items continue per the build plan.
- The product was renamed Beatwright → **Table Read** mid-design; if any stray "beatwright"/"--bw-" string survives anywhere, it's a bug — fix to "tableread"/"--tr-".
- The fixture (`tableread-fixture.json`, "The Long Pour") is a persisted-state envelope: project + ledger + root snapshot + empty flags/changeSets/suggestionHistory. It is referenced by name (fact-04, beat-1-2, scene-3…) throughout the prompt spec, build plan, and test plan — those IDs are load-bearing; don't regenerate the fixture casually.

## 3. Reading order

1. `AGENTS.md` — rules of engagement (5 min)
2. `narrative-sidekick-design-doc.md` — product intent, four modes, trust mechanics (20 min)
3. `tableread-data-contract.md` — types, LLM op schemas (§2a), storage transactions, API (20 min)
4. `tableread-prompt-spec.md` — every LLM call: templates, escaping (§8b), streaming (§8a), scan (§8c) (20 min)
5. `tableread-build-plan.md` — your task list; then `tableread-adoption-prd.md` for the A-items slotted into it (10 min)
6. `tableread-ui-spec.md` + `tableread-test-plan.md` — pull in as tasks demand
7. `tableread-competitive-analysis.md` — context/motivation; skim §4 to understand why the trust rules are non-negotiable

## 4. Decision log (settled — do not relitigate without flagging)

| Decision | Rationale (short) |
|---|---|
| Episodic TV only in v1; teleplay format fixed | Narrow wedge; continuity is the differentiator; multi-format deferred to v3 |
| Four modes (Write/Plan/Review/Ledger); Gardener/Architect are archetypes, not navigation | Fabula's binary mode choice + three-column rigidity tested poorly |
| Claude API backend; model *roles* (`writer`/`classifier`) pinned to exact IDs in `config/models.toml` per PROMPT_VERSION | Regression bisection; no wildcard model names |
| Strict tool use (`strict: true`) + provisional streaming (cards actionable only after validated `candidate_done`) | Fine-grained streaming emits invalid partial JSON; trust boundary explicit |
| `<source_data_{nonce}>` wrapping + JSON/entity escaping via single renderer | Injection boundary must survive adversarial script text |
| Materialized snapshots (doc + ledger + flags together); undo restores all three; root snapshot at project creation | Undo must restore a consistent world; deltas are a v2 optimization |
| Ledger facts carry sourceSpan + verbatim sourceText + line/char offsets, `knownBy` + `audienceKnows`, provenance/confidence gating (`isPromptEligibleFact`, prompt spec §8), supersede-not-overwrite | One bad inferred fact poisons prompts; dramatic irony = knownBy/audienceKnows gap |
| Import: deterministic scene split + LLM typed segment starts; compact summaries then yield format-constrained act starts; server derives/normalizes both total partitions; 100% text coverage and exactly one act per scene; ALL import facts `pending_review` | LLM never controls text/scene coverage; omitted acts may be empty; nobody vouched for whole-script inferences |
| Import act correction is a format-constrained Plan selector; it snapshots once, obeys locks, and makes zero LLM/scan calls | Writers need a correction path into empty acts that have no drag target; changing grouping alone does not alter story text or continuity facts |
| Change Sets: server-annotated `applyMode` (scene/beat=regenerate, character/ledgerFact=flag_only), stored typed preview, apply = stored payload verbatim (zero LLM calls), `PREVIEW_STALE` guard | UI never offers approvals the backend can't execute; apply is deterministic |
| Locks cascade to children; lock violations are a zero-tolerance eval gate | Fabula's scene lock didn't protect beat plans — reproduced failure |
| `scan_consistency` after every apply, accepted beat, and structural PATCH ("Save field only" never skips flagging) | Contradictions flagged, never silently left behind |
| Privacy language: "not used for training" (standard API terms); ZDR only after executed agreement | Exact legal tiers; audience is professional writers with third-party IP |
| Warm light theme default; no AI sparkles; AI quiet in Write mode | Product identity vs. Fabula's dark-tech; writers' stated preference |

## 5. Environment bootstrap (T0.1 companion)

- **Toolchain:** Node ≥ 20 + npm workspaces (or pnpm — agent's choice, flag it), Python 3.12, SQLite (bundled). Monorepo: `apps/web`, `apps/api`, `packages/contract`, `config/`, `docs/`, `fixtures/`.
- **Secrets:** `ANTHROPIC_API_KEY` via env / `.env` (gitignored). No key → app boots with `MockLlmClient` and a visible "mock mode" badge. Never commit keys; never log them.
- **Anthropic client:** Messages API; tool-forced JSON (`tool_choice` named + `strict: true`); fine-grained tool streaming beta for candidate ops only; one schema-retry. Pin exact model IDs in `config/models.toml` at first implementation (see open questions).
- **CI:** any runner; must execute `make lint`, `make test`, `make check-contract`, the DESIGN-GAP grep, and (nightly / on prompt change, gated by a secret) `make evals`.

## 6. Open questions — decide at build time and record in this file

1. **Exact model IDs** for `writer` and `classifier` roles in `models.toml` (docs name roles, not IDs — pin current best Sonnet/Haiku-class models and eval).
2. **Embeddings provider** for suggestion dedup (spec says "Voyage or similar"; MVP could even use cheap local cosine over API embeddings — flag choice).
3. **Package manager / monorepo tooling** (npm vs pnpm vs turbo).
4. **Fountain parser library** (JS: `fountain-js` assumed in tests — verify it's maintained; else vendor a minimal parser).
5. **Desktop/local-first packaging** (design doc §7.1 promises a local mode eventually — out of MVP, but don't architect it out: keep the API stateless over SQLite).
6. **Product name clearance** — "Table Read" trademark/domain search still pending (business task, not code).

## 7. Definition of success for the MVP

One writer completes one full scene start-to-finish using only the app: converges on beats via labeled candidates, locks what they love, makes one scoped rewrite through a Change Set preview, watches the ledger accumulate confirmed facts, undoes one mistake — **and at no point does the system rewrite, lose, or contradict anything they didn't approve.** All PR suites green; lock-violation and injection evals at zero; purge verified. (Build plan M6 release gate is the formal checklist.)
