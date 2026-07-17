# Continuity Layer Roadmap — Design

**Date:** 2026-07-16
**Status:** Approved direction; each phase ships behind its own spec + plan
**Supersedes:** the "no automatic bible reverse-engineering" non-goal in
`2026-07-10-new-project-flow-design.md` §3 — that non-goal scoped the Story
Launcher milestone, not the platform. Design doc §4.8 step 2 (reverse-engineer
the bible from import) is the north star; this roadmap phases it.
**Resolves:** DESIGN-GAP(T7.14).

## Problem

The platform's value is extracting and organizing the full detail of a story
world from scripts. Today import produces: scenes/beats (strong), ledger facts
(good volume, `pending_review`), a cue-minted cast (T7.14, names only). It does
not produce: aliases/entity resolution, relationships, locations/objects as
entities, time-aware state, knowledge transitions, threads/setups/payoffs,
motivations, or arcs. Ledger views and generation prompts are only as good as
this substrate.

## Principles (carried from CLAUDE.md / AGENTS.md — restated, not new)

- Every inferred assertion carries source evidence and enters review
  (`pending_review`); nothing silently becomes canon.
- Schema changes touch every home or none; new LLM ops get strict §2a schemas,
  one retry, `PROMPT_VERSION` bumps, and real-eval sign-off before merge.
- All mutations snapshot; locks are filtered before any generation.
- Extraction quality is measured, not assumed: labeled fixtures with
  recall/precision gates per entity and fact type.

## Phases

### P0 — Import Continuity MVP (next; plan: `docs/superpowers/plans/2026-07-16-import-continuity-mvp.md`)

Make character identity and core entities trustworthy on every import.

- `infer_story_entities` LLM op (classifier): characters with aliases + role,
  relationships, locations, notable objects — all with source evidence.
- Merge into `seriesBible` during import (cue heuristic becomes the fallback
  and recall check, not the only source).
- `knownBy` normalization upgraded to alias-aware resolution.
- Cast review surface: writer merges duplicates, renames, deletes.
- Eval fixture with planted aliases, a non-speaking character, and implied
  relationships; recall/precision gates wired into `make evals`.

Exit: an imported script yields a reviewable cast with aliases, relationship
rows, and ≥90% of extracted facts attached to resolved character ids.

### P1 — Time-aware story state — **complete**

- Facts gain temporal anchors: `establishedAt` (already implicit via
  `sourceSpan`) plus `validFrom`/`invalidatedBy` semantics via the existing
  supersede chain; relative time markers ("three days later") extracted as
  timeline anchors. — `sourceSpan`/supersede-chain temporal semantics and
  the `asOfScene` filter shipped as T7.18 (`facts_as_of`); timeline anchors
  shipped as T7.24 (`Episode.timelineAnchors`, `fountain.timeline.
  merge_timeline_anchors` — deterministic slugline scan, no LLM).
- Knowledge transitions: who learns what, when (scene-anchored `knownBy`
  changes rather than a single flat list). — shipped as T7.23
  (`LedgerFact.knowledgeEvents` + `knowers_as_of` / `GET /ledger?asOfScene=`
  `knownByAsOf`; Knowledge Web prefers it when set).
- Relationship state history (scene-anchored state rows, not one label). —
  shipped as T7.25 (`Episode.relationshipStates`, sourced from
  `infer_story_entities`'s own evidence citations — no new classifier call;
  `latest_relationship_state` as-of helper for a later Ledger/Web surface).
- Object custody / location continuity checks. — shipped as T7.26
  (`Episode.objectStates` + a deterministic conflict pass surfacing open
  `tension` `ConsistencyFlag`s — "simpler MVP" path, no new LLM call).

Exit: the ledger can answer "what was true, and who knew it, as of scene N"
— **met** (T7.18 + T7.23). T7.24–T7.26 round out the remaining P1 bullets at
MVP/display-only scope: `timelineAnchors`/`relationshipStates`/
`objectStates` store + `GET /projects/{pid}` only, no dedicated endpoint or
UI beyond the Knowledge Web `knownByAsOf` change; a Ledger/Plan surface for
them is future work, not blocking P1 exit. Plan/spec:
`docs/superpowers/plans/2026-07-16-time-aware-p1-remainder.md`,
`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`.
P2 (narrative promises, below) stays parked on its own branch
(`narrative-promises-p2`) until picked up next.

### P2 — Narrative promises

- Thread entity: setup → escalation → reveal → payoff/abandoned lifecycle,
  with owner, establishing span, and status. Powers honest "unresolved setup"
  and "weak payoff" reporting (design doc §4.4 connector lines land here).
- Motivation/arc extraction on import (schema fields exist; fill them).
- Structured world rules: rule + limit + cost + exception + evidence.

### P3 — Story compiler

- On-demand "Compile Story": full-episode audit across continuity, knowledge
  leaks, timeline violations, unresolved threads — findings list with
  jump-to-source. Only after P0–P2 data exists; a compiler over thin data
  produces confident nonsense.

## Sequencing rationale

Each phase is a prerequisite for honest results in the next. Entity identity
(P0) precedes temporal state (P1) because a knowledge transition without a
resolved knower is noise. Threads (P2) need both. The compiler (P3) is a view
over all three.

## Validation strategy (every phase)

- Labeled import fixtures per entity/fact type; recall, entity-resolution
  precision, unsupported-claim rate, duplicate rate measured in `make evals`.
- Writer corrections (merge/rename/reject) tracked as the ground-truth signal.
- Contract checks (`make check-contract`) on every schema change; e2e journeys
  assert the Ledger surfaces (PEOPLE, Knowledge Web focus) light up from a
  fresh import.

## Existing-project policy

Platform fixes apply to future imports. Already-imported projects adopt them
by re-import (or a versioned migration if re-import is destructive to writer
edits). No per-project ad-hoc repair scripts.
