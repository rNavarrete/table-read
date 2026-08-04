# Narrative Map Design

Date: 2026-07-23

## Goal

Give a writer one evidence-grounded reading of an imported episode at three
levels without turning a familiar structure model into a false diagnosis:

- Macro: the dramatic question, central conflict, controlling idea, themes,
  and the pressure/turn of each imported act.
- Character: each meaningful character's want, need, internal conflict,
  external pressure, and on-page changes.
- Micro: the dramatic function, conflict, stakes, focal perspective, and turn
  of every scene, plus the movements of every established story thread.

## Product Decisions

1. The map is analysis, never a rewrite and never a source of continuity
   facts. It is stored on `Episode.narrativeMap` and surfaced in Ledger.
2. Claims are inspectable. The model selects a beat ID for every theme, act,
   Hero's Journey stage, character turning point, scene turn, and thread
   movement; the server attaches a short exact excerpt from that beat. Ledger
   evidence opens the cited scene.
3. Coverage is total where a writer needs a reliable map: exactly one act row
   per populated imported act and exactly one scene-turn row per imported
   scene. A response with partial coverage is rejected, not quietly saved.
4. Hero's Journey is an optional lens. The model sets `applies: false` for
   ensemble, procedural, anti-hero, fragmentary, or otherwise unsupported
   material. When it applies, each stage must be grounded; the product never
   forces a 12-stage reading.
5. Character references enter the model as names and persist only after
   alias-aware resolution to existing character IDs. Thread movement may only
   cite an existing episode thread ID.
6. A locked episode or locked narrative map wins over a re-import. No map
   refresh can overwrite writer-approved analysis.

## Map Flow

`POST /projects/{pid}/narrative-map` creates or resumes a durable run keyed by
the exact saved source snapshot, a hash of its raw screenplay text, and the
analysis version. The request returns `202` immediately; browser refreshes or
repeat clicks cannot create another paid run for the same source version.

1. Readiness requires raw `scriptText` for every saved beat. Blank import-time
   summaries are measured, but never treated as missing story evidence.
2. Opus 5 analyzes one raw-screenplay scene per request. Each response must
   cover that exact scene and include exact per-beat quotes; one failed
   evidence check receives a diagnostic-only repair attempt for that scene.
3. Opus 5 synthesizes only from validated scene packets, resolved cast,
   established threads, and the saved overview.
4. A separate Sonnet 5 verifier audits the candidate against the raw screenplay
   and packets. It must explicitly approve, report no unsupported paths, and
   report no missing scenes.
5. The server applies the existing beat/scene/act/character/thread checks,
   derives stored excerpts from the authoritative source, then writes one
   snapshot only if the source head is unchanged.

Scene packets are checkpointed after every successful scene using fresh JSON
assignments so SQLite persists nested packet changes. A failure leaves
the source import unchanged and retains completed work. Timeout retries pause
for ten minutes because a local timeout cannot prove the provider stopped;
this prevents blind overlapping retries from charging twice. Evidence failures
get one targeted scene repair and one targeted synthesis repair, then are
rejected rather than published. Privacy-safe run, scene, repair, checkpoint,
and rejection metadata is written to the rotating diagnostics log.

## Non-goals

- It does not infer new facts, edit script text, or make character psychology
  claims beyond the page.
- It does not treat an absent Hero's Journey as a structural defect.
- It does not silently invent threads missing from the established-thread
  model; thread discovery remains the preceding narrative-promises operation.

## Verification

Mock-path tests cover raw-source recovery, quote ownership, placeholder
rejection, total coverage, verifier rejection, timeout preservation,
idempotent runs, stale-source protection, and Ledger progress states. The
schema eval exercises each new map operation with the production prompt
builders. Before a production prompt/model change, a paid evaluation must also
review evidence precision and structural usefulness on a labeled script set;
schema validity alone is not an accuracy claim.
