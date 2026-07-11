# Competitive Analysis: Google DeepMind Fabula

*Field-tested July 2026, four hands-on sessions with early-access build at deepmind.google.com/frontiers/fabula. Companion to the Table Read design doc; each finding cross-references the Table Read mechanism it validates or motivates. All failure cases below were reproduced live and are described with repro steps.*

## 1. What Fabula is

Invite-only research prototype (Gemini-based) for AI-assisted fiction writing: screenplay, theatre play, and novel formats. Gardener (script-first) and Architect (three-column: Story Plan / Beat Plan / Script) views, chosen at story creation. Three user-selectable engines: Default ("simplest fastest"), Richer Story Plan (adds characters/relationships), Expensive Story Planning ("best but slowest"). Story creation from a prompt or by pasting a draft; user pre-specifies scene count and beats-per-scene. Dark, monospace, tech-styled UI throughout.

## 2. Capability inventory (verified by hand)

Story plan built stepwise via element chips (Characters, World, Goals, Emotions, Plot); the richer engine populates the full narratology stack — thematic question, world-building Q&A, audience/narrator goals, suspense, surprise, escalation, closure, distinctive feature, emotional range — each section individually lockable. Per-scene controls: insert, delete, lock, edit (full scene-plan form: audience learns/feels, what happens, situation, where, when, character motivations). Beat plans (~7/scene) with per-beat edit/reimagine/retry/delete. Script generation beat-by-beat (single take, streamed into script) or full-scene; manual beat writing; "Prompt" steering ("type what you want to happen next, and the rest of the story will be guided to match"); suggestion carousels at every decision point. Read-only chatbot with five canned feedback reports + freeform Q&A. Scene illustrations (~30s, scene-faithful). Labeled undo/redo timeline. Import via paste (text preserved 100%, scenes/beats parsed, plan reverse-engineered, continuation scenes auto-planned). Share: read-only links, **forking**, JSON export, plain-text export. Keyboard shortcuts in Gardener mode. Tutorial catalog.

## 3. What Fabula does well (adopt or match)

- **Scene-plan schema.** Their scene form matches Table Read's `Scene` fields nearly one-to-one — independent convergent evolution; keep ours.
- **Import extraction quality.** Scene summaries accurate, beat segmentation correct, and it *inferred* the sibling relationship from a photo of "their father" — never stated in the text. High bar for our parse + extraction ops.
- **Lock-aware narrative repair.** With a scene locked, a contradicting update produced "Marta discovers a stray casino chip and realizes the true nature of the hidden 'cash'" — it treated the locked text as a character's mistaken perception rather than violating it. Prompt-craft worth stealing for `regenerate_elements`.
- **Engine tiers as a user choice** (speed vs. quality). Mirrors our model-routing/polish-mode split; consider surfacing it.
- **Theatre formatting is fixed.** SETTING blocks, parenthetical stage directions, no camera language. The paper-era "screenplay-ness" leak is resolved — don't count on format sloppiness as a differentiator.
- **Labeled undo timeline, JSON export, forkable share links.** Baseline expectations for our snapshot timeline and export.
- **Honest critique on demand.** Asked directly ("be brutally honest"), the chatbot produced sharp, cited, actionable criticism. The capability exists; their product framing suppresses it (see 4.6).

## 4. Reproduced failures (Table Read's wedge)

**4.1 Knowledge-state amnesia — the killer.** Hand-wrote a beat where Elias confesses everything (took the $40k, owed to loan sharks). The very next generated beat: Elias denies again, and Marta ends by asking "Where did it go?" — answered one beat earlier. No structure tracks who knows what. → Table Read: ledger `knownBy`/`audienceKnows`; facts injected into every generation prompt.

**4.2 No preview, no scoped approval.** Every plan mutation offers only blunt choices ("Update this scene" vs "Update this & all other scenes"; "Update plans" vs "Update and restart story") with no diff, no impacted-object list, no partial accept. → Change Sets: blast-radius list, before/after diffs, per-object checkboxes, `PREVIEW_STALE` guard.

**4.3 Silent edit loss.** A scene edit + "Update this & all other scenes" spun for ~4 minutes (no progress, no cancel, whole UI locked), then reverted the edit with no error. Writer work vanished silently. → explicit `candidate_failed`/error surfacing; never silently discard; SSE abort semantics.

**4.4 Scoped edits with unscoped blast radius.** A character rename/delete request also rewrote the synopsis (absorbing prior inventions into canon), scrambled an unrelated scene's beat plan with another scene's content, and skipped half the request (never applied the names). → server-enforced "only requested IDs may change," lock filter, 409 on violations.

**4.5 Locks don't cover children; deletions don't stick.** A locked scene's summary survived regeneration, but its *beat plan* was rewritten underneath the lock. A deleted character (Julian Vane) resurrected two updates later via prose residue. → locks cascade to children per contract; ledger supersede/tombstone semantics make removals durable.

**4.6 Sycophantic consistency reports.** The canned "Settings, closure and consistency" report rated a one-beat draft "award-winning… rigorously consistent," praised unwritten scenes as "satisfying conclusions," and found zero issues while visible contradictions existed. A checker that always passes launders false confidence. → `scan_consistency` returns object-linked, severity-scoped flags; graders adversarially framed and calibrated against planted-flaw fixtures (test plan).

**4.7 Invention presented as extraction.** Import hallucinated a third character ("benevolent hometown hero") not present in the pasted draft and immediately wove him into the relationship graph, indistinguishable from genuinely extracted facts; continuation scenes silently retconned the protagonist into "an informant with a handler." → import facts land `pending_review` with verbatim `sourceText` provenance; extraction vs. invention is machine-checkable.

**4.8 Plan/script desync without flags.** After a manually written script beat, the beat plan and story plan were never updated and never flagged as stale; generated content then followed neither cleanly. The paper's claimed bottom-up propagation is absent in practice. → consistency scan after every accepted change, including manual writes ("Save field only" still scans).

**4.9 Single-take generation.** Script beats generate one take directly into the script; convergence is only retroactive (reimagine/regenerate). → labeled 3-candidate loop (Accept/Tune/Skip) before anything touches the script.

**4.10 Friction & trust details.** Whole-app lock during any generation (multi-minute worst case); scene/beat counts demanded up front (their own study's complaint, unfixed); characters generated nameless ("Character 1/2/3") while relationship entries use names — cross-section drift visible at creation time; colon-style dialogue in screenplay mode (not true screenplay format); undo history contains unlabeled "(unknown)" entries.

## 5. Strategic summary

Fabula validates the category (structured plans, locks, engines, import, formative-AI framing) and ships good ingredients — but it cannot be trusted with a writer's accumulated work: state mutates wholesale, invisibly, sometimes destructively, and nothing durable represents the story's facts. Table Read's four trust mechanisms — child-inclusive locks, the continuity ledger, previewed Change Sets, and honest object-linked consistency flags — each map to a failure reproduced here in the flagship competitor. The warm, writer-first visual identity remains uncontested; Fabula stayed dark-tech despite its own study feedback. Positioning line: *Fabula demos what AI story structure could be; Table Read is built so a writer can keep their show inside it.*

## 6. Repro appendix

(1) Confession test: write beat where a secret is fully revealed → generate next beat → check for denial/re-asking. (2) Cascade test: edit scene premise → "Update this & all other scenes" → time it, check locked scenes' beat plans and edit survival. (3) Purge test: delete an invented character via Reimagine → run two more updates → grep plans for the name. (4) Import test: paste known script → diff extracted characters/relationships against ground truth; look for uninvited additions. (5) Sycophancy test: run canned consistency report on a deliberately contradictory one-beat draft; then ask the chat directly for brutal honesty; compare.
