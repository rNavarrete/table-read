# Table Read — Fabula Adoption PRD / Implementation Guide

*Requirements distilled from the Fabula field test (`tableread-competitive-analysis.md` §3). Written for an implementing agent.*

## How to use this document

Each item below is a self-contained requirement: what to build, where it fits in the existing Table Read architecture, what docs to update, and acceptance criteria. **Prerequisites:** the Table Read doc set (`narrative-sidekick-design-doc.md`, `tableread-data-contract.md`, `tableread-prompt-spec.md`, `tableread-build-plan.md`, `tableread-ui-spec.md`, `tableread-test-plan.md`, `tableread-fixture.json`, `CLAUDE.md`) is authoritative; nothing here overrides its hard rules (locks, snapshots, source_data escaping, schema single-source, PROMPT_VERSION). Where this PRD says "update doc §X," that update is part of the task's definition of done — schema changes follow CLAUDE.md rule 3 (every home or none).

Priorities: **P-MVP** (add to current MVP milestones), **P-v2**, **P-v3**. Task IDs continue the build plan's numbering as milestone-suffixed additions (e.g., T2.4).

---

## A1. Lock-aware narrative repair (prompt-craft) — P-MVP

**Requirement:** When regeneration must coexist with locked content that contradicts the writer's new direction, the model should be explicitly instructed to *reinterpret* locked text as in-world truth rather than avoid or contradict it (Fabula: a locked "bag of cash" became a character's mistaken perception of casino chips — elegant, non-violating repair).

**Implementation:** Add to the prompt-spec system prompt HARD RULES: "When a WRITER INSTRUCTION conflicts with LOCKED content, do not alter or ignore the locked text — write so that both are true, e.g., by treating the locked text as a character's limited or mistaken perspective. Report the tension in continuityConflicts." Applies to `generate_beat_candidates`, `tune_beat`, `regenerate_elements`. Bump PROMPT_VERSION.

**Docs:** prompt-spec §0 + worked example in §4. **Tests:** new eval "Lock repair quality": fixture case — lock beat-2-1 (cash in ice machine), approve an edit making the hidden item casino chips, regenerate scene 4; grader checks (a) zero lock violations (existing hard gate), (b) the new text *acknowledges and reframes* rather than ignores the locked fact; ≥80%, human-reviewed.

**Acceptance:** eval added and passing at gate; prompt template diff reviewed via `make evals`.

## A2. Import inference-quality bar — P-MVP (eval only)

**Requirement:** Extraction should infer unstated-but-implied facts (Fabula inferred siblinghood from "a dusty photo of their father"). We don't change the pipeline — we pin the quality bar so regressions surface.

**Implementation:** Add a golden import fixture (`fixtures/import-inference.fountain`) containing ≥3 implied-only facts (a relationship, a location fact, a knowledge state), none stated literally.

**Docs:** test-plan §3 new eval row "Import inference": run import ×10; extraction must propose all planted implied facts (as `pending_review`, per contract) with recall ≥ 0.8, and propose **zero facts with no textual basis** (hallucination guard — Fabula failed this; the eval checks both directions).

**Acceptance:** fixture committed; eval wired into `make evals`.

## A3. Craft-level picker (engine tiers surfaced) — P-v2

**Requirement:** Expose generation quality/latency as one writer-facing choice, per generation surface (not buried in settings). Three levels: **Fast draft** (single candidate, `writer` role), **Standard** (3 candidates — current MVP default), **Considered** (candidates + critique-and-select, i.e., polish mode).

**Implementation:** UI: small segmented control in the Write-mode candidate dock header and on Change Set preview; per-project default in settings; honest sublabels ("slower, costs more"). API: `craftLevel: "fast"|"standard"|"considered"` param on candidate/preview endpoints (contract §4); maps to existing model-role + polish-mode plumbing — no new LLM ops.

**Docs:** contract (param + enum), UI spec §3/§5, design doc §6.1 note. **Tests:** e2e — level persists per project; "considered" runs the critic pass (mock verifies extra op call); "fast" returns one candidate.

**Acceptance:** all three levels reachable from Write mode; defaults to standard; no whole-app lock at any level (generation stays per-surface, per our existing spec).

## A4. Context-aware suggestion carousels — P-MVP (extend existing)

**Requirement:** Every empty writer input gets contextual suggestions — not just plan fields. Surfaces: command bar (empty state), scene-premise field, Tune input, and (v2) episode premise. Suggestions must reflect *current* story state including unsaved script (Fabula's suggestion referenced a confession written seconds earlier).

**Implementation:** Reuse `suggest_instructions` op; add `surface` to its context assembly so the bundle includes the latest accepted beat + current scene plan. UI: carousel of 3 chips below the focused input (UI spec pattern: chips, muted, `~` AI-origin glyph); click inserts into the input — never auto-executes. Dedup via existing embedding history.

**Docs:** prompt-spec §6 (context bundle per surface), UI spec §3 states. **Tests:** unit — suggestion context includes last accepted beat; e2e — chip click fills input without firing generation.

**Acceptance:** carousels on command bar + scene premise + Tune in MVP; zero auto-execution paths.

## A5. Undo timeline dropdown — P-MVP (pull forward from v2)

**Requirement:** Undo control opens a labeled history (Fabula's strongest trust surface), not just single-step undo. Labels come from snapshot `instruction` — which our contract already requires, so **no "(unknown)" entries are possible**; enforce non-empty instruction at snapshot creation (validation error otherwise).

**Implementation:** Dropdown on the top-bar undo control listing last ~20 snapshots (`instruction` + relative time); clicking an entry restores that snapshot via the existing undo transaction generalized to "restore to ancestor" (walk parents; one transaction; doc+ledger+flags per contract §3). Full timeline UI/branching stays v2 — this is only a flat recent-history list.

**Docs:** contract (POST `/projects/{pid}/restore` `{snapshotId}` — ancestor-of-head only in MVP, else 409), UI spec §2, build plan T1.1 acceptance extended. **Tests:** restore-to-ancestor is byte-identical across all three stores; non-ancestor → 409; empty instruction → `VALIDATION`.

**Acceptance:** writer can jump back 3 steps in one action; every entry human-readable.

## A6. JSON export + read-only share — P-MVP (JSON) / P-v3 (share+fork)

**Requirement (MVP):** `GET /projects/{pid}/export.json` returning the persisted-state envelope exactly as the fixture shape (project, ledger, snapshots, consistencyFlags, changeSets, suggestionHistory) — data portability and the privacy promise ("export-everything") made real.

**Requirement (v3):** read-only share links and forking (Fabula has both; ours should wait for auth/multi-user).

**Docs:** contract §4 (endpoint), design doc §7.1 note. **Tests:** export → purge → re-seed from export → byte-identical project doc and ledger (round-trip test).

**Acceptance:** round-trip test green; export linked from settings UI.

## A7. Scene auto-illustration — P-v3 (backlog)

**Requirement:** Optional per-scene illustration for mood/pitch use. Explicitly out of MVP/v2 (cost, scope, and our AI-quiet principle). Record as backlog item with two constraints when built: writer-initiated only (no auto-generate on scene creation), and images regenerate-flagged when their scene's plan changes (avoid Fabula's stale-image complaint from the paper).

**Docs:** design doc §8 v3 list. **Acceptance:** backlog entry only; no implementation now.

## A8. Keyboard-first writing surface — P-MVP (extend existing)

**Requirement:** Complete the Write-mode keyboard path: existing spec has `⌘1–4` (modes), `/` (command bar), `1/2/3` (candidate select when dock focused). Add: `Q` generate candidates, `W` focus command bar (alias of `/`), `Tab`/`Shift-Tab` cycle candidate cards, `Enter` accept focused card, `Esc` dismiss dock. Shortcuts visible in button labels (Fabula's `[Q]` pattern) and disabled while the script canvas has focus (AI-quiet rule — typing must never trigger generation).

**Docs:** UI spec §3 + §8. **Tests:** e2e — full beat cycle (generate → cycle → accept) with keyboard only; keypresses inside the script textarea never fire shortcuts.

**Acceptance:** keyboard-only beat writing demonstrated in e2e.

## A9. Workflow-recipe onboarding — P-v2

**Requirement:** Onboarding as 6–8 task-shaped recipes ("Break your first scene," "Lock what you love, regenerate the rest," "Review a change before it lands," "Audit your story's facts"), each a 3–5 step guided overlay on the real UI with the fixture project preloaded — not feature documentation.

**Implementation:** `?tour=<recipe>` deep links; overlay component highlights real controls; recipes defined as data (JSON steps), not code.

**Docs:** UI spec new §9; build plan v2 task. **Tests:** e2e — each recipe completes against the seeded fixture.

**Acceptance:** first-run screen offers recipes; all recipes runnable end-to-end.

## A10. Subtext fidelity (presentation/hiding drive generation) — P-MVP (eval only)

**Requirement:** Character `presentation` vs `hiding` fields must demonstrably shape generated script — secrets surface as *subtext* (behavior, evasion, props), never stated outright by the narrator (Fabula's schema visibly drove its output; ours must too, and better).

**Implementation:** No pipeline change (fields are already in context bundles). Add one system-prompt line: "A character's 'hiding' content may only surface through behavior and subtext unless the writer's instruction explicitly reveals it." Bump PROMPT_VERSION.

**Docs:** prompt-spec §0. **Tests:** eval "Subtext fidelity": generate scene-1 beats ×10 with fixture characters (Dan hiding the theft); grader checks the secret is never narrated outright and ≥1 behavioral tell appears; ≥80%, calibrated grader per test-plan rules.

**Acceptance:** eval at gate.

---

## Sequencing

| Milestone (build plan) | Items |
|---|---|
| M2 (Write mode) | A4 (carousels), A8 (keyboard) |
| M4 (Review) | A1 (lock repair — lands with regenerate_elements) |
| M1/M6 (core + hardening) | A5 (undo timeline), A6-MVP (JSON export), A2 + A10 (evals) |
| v2 | A3 (craft levels), A9 (onboarding recipes) |
| v3 / backlog | A6-share/fork, A7 (illustrations) |

**Non-negotiables carried from the doc set:** every LLM-touching item obeys strict schemas from contract §2a, source_data escaping, the lock filter, snapshot-per-mutation, and the zero lock-violation gate. Nothing in this PRD introduces a new path that mutates project state without a snapshot, or generation without an explicit writer gesture.
