# Design Document: "Table Read" — A Narrative Storytelling Sidekick for Episodic Series Writers

*A Fabula-inspired structural co-writing tool built on the Claude API*
*Version 1.3 — July 2026*

**Scope decision (v1):** this first iteration targets one writing type only — **episodic series** (TV/streaming drama and comedy). This is a deliberate narrowing: Fabula's research showed film/TV screenwriters scored highest on the Creativity Support Index, and "ideating on new episodes of an existing show" was a top writer request. Episodic writing is also the format that most rewards persistent structure — series bible, season arcs, and episode-to-episode continuity are exactly what flat chat tools cannot hold. Stage plays, features, and novels are explicitly deferred.

---

## 1. Vision and Design Philosophy

Table Read is not a story generator. It is a **formative AI** tool: the writer creates; the tool helps them explore, structure, and refine. The final script is the writer's — the tool manages structure, consistency, and candidate exploration.

Three principles drive every design decision:

1. **Persistent structure over flat text.** The story lives as a hierarchical, editable plan (series → season → episode → scene → beat), not as a chat transcript. Every generation request is grounded in this plan, so coherence survives edits to any part — including across episodes.
2. **Convergent iteration over one-shot generation.** The core loop is: AI presents multiple candidates → writer selects, locks, and edits → AI regenerates only what isn't locked. The writer converges on their story through repeated selection, not prompting from scratch.
3. **Writer agency at every level.** Anything the AI produces can be edited, locked, regenerated, or discarded — at story, scene, beat, or line granularity. The tool must never force a cascade the writer didn't ask for.

### Lessons inherited from Fabula's research (CHI 2026)

Fabula was co-designed with 42 professional writers. Their feedback directly shapes this spec:

| Fabula finding | Design consequence here |
|---|---|
| Writers found the three-column plan view "rigid" and "visually stressful" | Progressive disclosure: build plan elements step-by-step; full plan view is opt-in |
| "Every time I have it rewrite a thing, it rewrites the whole structure" | Locking is first-class; regeneration is always scoped; cascades require confirmation |
| Writers missed the fluidity of chat | Bottom command bar for natural-language instructions in Write mode; summonable dramaturg chat (v2) whose suggestions arrive as Change Sets |
| "It kept going back to screenplay format" when writing plays | v1 sidesteps this by committing to one format: episodic teleplay. Format templates per show type (drama/comedy, cold open/tag structure) |
| Writers wanted to rework existing material, not start from blank pages | Import is in from v1 — but scoped: Fountain/plain-text scenes only. PDF/FDX/bible import lands in v2 |
| Concerns about deskilling and "AI slop" | Feedback/dramaturg mode that critiques without writing; generation always optional |
| Audience-goal questions felt at odds with contemporary theatre ("Open Form") | Narrative-model components are modular and can be disabled per project |

---

## 2. Target Users

Primary: **TV/streaming series writers** — showrunners and staff writers breaking seasons and episodes, writers developing original pilots and series pitches, writers generating alternative episode directions for an existing show. Secondary: students learning episodic structure.

Key workflows to support:

- Developing a series: premise → series bible → season arc → episode grid
- Breaking an episode: episode premise → A/B/C storylines → beat sheet → draft scenes
- Reworking an existing episode draft: import → structural analysis → targeted regeneration
- Ideating new episodes of an existing show: import prior episodes/bible → generate candidate episode premises consistent with continuity
- Dramaturgical feedback: "what's the weakest character this season and why?"

Two writer archetypes, both supported — as workflows across the product's modes (§4.2), not as separate UIs:

- **Architects** (plotters): start in Plan mode, work top-down from the story canvas; edits propagate down to script via Review.
- **Gardeners** (pantsers): live in Write mode, generating one beat at a time; the plan quietly updates upstream (toggleable).

---

## 3. Core Concepts

### 3.1 The four-layer story model

Fabula's two layers (story plan → script) extend to four for episodic work:

- **Series Bible** (top layer): premise, world rules, main cast with arcs, relationships, thematic spine, tone/format (drama vs. comedy, runtime, act structure, cold open/tag conventions).
- **Season Plan**: the season's macro-arc (serialized spine), per-character season arcs, and an **episode grid** — one card per episode with its function in the season (e.g., "ep 4: midpoint reversal — Marta learns the truth").
- **Episode Plan**: per episode — an A-story and optional B/C-stories, each broken into scenes assigned to acts; what the audience learns/feels per storyline; how the episode advances the season arc.
- **Script** (bottom layer): formatted teleplay text generated or written beat-by-beat.

A **scene** is defined (per McKee) by a value-charged turn. Each scene plan captures: what happens, what the audience learns, how the audience feels, the social situation, location, time, and **which storyline (A/B/C) it belongs to**.

A **beat** is the smallest structural unit (per Stanislavsky's "unit"): a short section (~10 lines max) where character objectives remain constant. Beat boundaries: entrances/exits, location shifts, topic changes, emotional/power shifts, objective changes. Each beat plan captures: what happens, what the audience learns, how the audience feels.

### 3.2 The Drama Manager

The Drama Manager is the backend agent that owns all LLM interaction. It exposes four operations, each scoped to a level (series / season / episode / scene / beat / script):

1. **Plan Creation** — generate the initial hierarchical plan from a series premise or imported script(s).
2. **Content Generation** — produce script lines for a beat, in the project's medium format.
3. **Plan Evolution** — apply an edit ("the mentor betrays her in scene 4") and regenerate only affected, unlocked elements.
4. **Analysis** — narratological critique of plan or script without generating replacement text.

Drama Managers are **modular**: each narrative-theory component below can be enabled/disabled per project (this answers the "Open Form" theatre critique).

Narrative components (all optional, on by default for screenplay projects):

- **Existential question** — a unifying thematic question (e.g., "Is loyalty worth more than truth?"); each character's arc implicitly answers it.
- **Character depth** — for each character: embodiment of the theme, *presentation vs. reality* (public face vs. hidden truth), distinctive voice/behavior traits.
- **Relationships** — not labels but dynamics ("what the relationship is really like," including power imbalances).
- **Audience & narrator goals** — what the audience wants to learn/feel; explicit narrator instructions to satisfy or subvert those goals; world-building Q&A resolved before scene planning.
- **Narrative desiderata** — explicit planning targets: thematic unity, suspense, surprise, escalation, closure, intelligibility, emotional range.
- **Scene-level character motivations** — per character per scene: objective, stakes, obstacle. Scenes are driven by intent, not plot convenience.
- **Cliché avoidance** — before planning, the model lists well-known stories/tropes to avoid, kept in context during generation.
- **Continuity ledger** (episodic-specific) — a running, auto-maintained fact list per character and world element ("Dan arrested ep 3; Marta knows the secret from ep 4 sc 2"). Extracted after each accepted change; confirmed/high-confidence facts are injected into every generation prompt (integrity rules in §5) and form the basis of cross-episode consistency checks. This is the single biggest value-add of persistent structure for series writing.

### 3.3 Convergent iteration loop

For every generation request:

1. Drama Manager assembles scoped context (see §6.3).
2. Claude generates **3 candidates** (diverse sampling — each prompt includes prior candidates with "avoid these").
3. Candidates are shown side-by-side; embeddings-based dedup discards near-duplicates.
4. Writer picks one, picks-and-edits, or writes their own; optionally adds a revision note and regenerates.
5. Accepted content updates the plan; a **consistency check** flags (never silently rewrites) downstream contradictions.

An optional **"polish" mode** adds a generate→critique→select search loop: a critic prompt (expert-editor persona) lists pros/cons per candidate and picks the best. Higher quality, higher latency and cost — writer's choice per request.

### 3.4 Locking

Every plan element and script beat has `locked: boolean`. Locked elements are converted to hard constraints in regeneration prompts ("These beats must remain exactly as written; write around them"). Locking is the mechanism that makes convergence possible — writers pin what they love and let the rest churn.

---

## 4. User Experience

### 4.1 Visual design philosophy

**Core principle: Table Read should feel like a design-first creative workspace for writers — warm where writing happens, precise where structure happens, and explicit where AI proposes change.**

The strongest direction is a deliberate hybrid, not a single aesthetic: Write mode borrows from premium consumer product craft (warm, humane, tactile); Plan mode borrows from collaborative canvas tooling (structure as manipulable objects); Review and Ledger modes borrow from code-review culture (changes as inspectable artifacts, never magic).

**Negative direction — explicitly avoid:** chatbot-first UX; enterprise dashboards; sterile gray admin UI; generic AI sparkles; overwhelming cinematic darkness (heavy Hollywood software); retro screenwriting-software aesthetics; pure minimalist macOS utility.

**Theme direction:**

- **Light (default):** warm ivory and clay surfaces, charcoal text, muted coral for primary actions, with sage / sky blue / amber as status hues (e.g., confirmed / informational / needs-review).
- **Dark:** warm near-black and espresso charcoal, deep clay panels, ivory text; coral, sage, sky, and amber muted to sit comfortably on dark surfaces. Warm dark, not tech-noir.

Generous spacing throughout; candidate cards and canvas objects should feel tactile — things a writer picks up and places, not rows in a table.

### 4.2 Four product modes

Primary navigation is four modes, each answering a different question:

| Mode | Question | Character |
|---|---|---|
| **Write** | "What happens next on the page?" | Warm, script-first, AI quiet and adjacent |
| **Plan** | "What is the shape of this story?" | Canvas-like, structural, precise |
| **Review** | "What exactly is the AI about to change?" | Explicit, diff-based, consent-driven |
| **Ledger** | "What is true in this world so far?" | Inspectable source of truth |

Gardener and Architect survive as **writer archetypes, not navigation**: Gardeners live mostly in Write and visit Plan; Architects start in Plan and descend into Write. Both pass through Review for every AI-proposed structural change, and both trust Ledger to hold continuity. Progressive disclosure still applies: new projects begin in a stepwise setup (premise → characters → theme → scene skeleton), and the full Plan canvas appears only once a plan exists.

### 4.2a Project dashboard (entry point)

The app opens on a **project dashboard** at `/projects` (the "Story Launcher"), not a hardcoded seeded project. It answers "what are we writing?" with creation first and recent work second:

- Two creation paths — **Start from an idea** (guided setup: premise → format → optional characters/theme, then Plan scene-skeleton generation) and **Import a script** (Fountain/plain-text upload or paste).
- A short **Continue writing** list of recent projects, each showing an actionable status (`N facts to review`, `Continue setup`, or `Ready to write`) and reopening to its last local mode/scene; a stale scene falls back safely to the first scene.
- Every AI step stays explicit: creation and import never trigger the model until the writer confirms the source material.

**Deletion is a permanent purge, not a fiction.** A project's overflow menu offers Rename, Export Fountain, and **Permanently delete**; delete requires typing the project's exact title, then removes every project-scoped store (there is no Trash or archive to imply recoverability). A failed purge leaves the project in place and reports the error.

### 4.3 Write mode

The **script canvas is the hero**: a formatted teleplay page on a warm ivory surface for the **whole episode** (scenes stacked, continuously scrollable), with a left **scene outline** for jump navigation and an **active scene** that owns generation. Beats stay subtly delimited; maximum breathing room. Structural board work (reorder, acts, locks UI) stays in Plan — the outline is navigate-only.

- **Next Beat variants** dock on the right as tactile cards, each with a short interpretive label — *"Tense refusal," "Quiet reveal," "Power shift"* — so the writer scans intents, not walls of text. Card actions: **Accept** (coral primary), **Tune** (adjust with a short instruction), **Skip**. Generation always targets the active scene.
- A **bottom command bar** takes writer instructions in natural language ("she refuses the offer, but softer") — command-palette feel, not a chat thread.
- The AI stays quiet and adjacent, never dominant: no sparkle buttons, no assistant persona in the writing surface, no generation without a writer gesture. When the writer is typing, the AI is invisible.

### 4.4 Plan mode

An **infinite canvas** planning workspace — story structure as manipulable objects, borrowing interaction grammar from collaborative design tools:

- **Story Layers panel (left):** the hierarchy as layers — series bible, season arc, episodes, storylines, scenes, beats. Selecting a layer focuses the canvas; visibility toggles declutter.
- **Acts and episodes as frames**; **scenes and beats as structured cards/components** placed inside them — selectable, draggable to reorder, color-coded by storyline (A/B/C).
- **Connector lines** overlay relationships: setup → payoff, continuity dependencies (from ledger facts), character-arc threads across scenes. Toggleable per relationship type.
- **Inspector panel (right):** properties of the selected scene/beat — storyline, act, location, the turn (what changes), audience learns/feels, per-character objective/stakes/obstacle, affected ledger facts, and lock state. Edits here are structural edits; anything requiring regeneration routes through Review.

The season board (episode grid with arc lanes) is this same canvas zoomed out — episodes as frames, arcs as horizontal threads (v2).

### 4.5 Review mode

Every AI-proposed change beyond a single accepted beat arrives as a **Change Set** — inspectable, partial-applicable, never a magical rewrite:

- **Impacted objects list:** every scene, beat, character, and ledger fact the change touches, each with a checkbox — the writer controls exactly what applies.
- **Locked rows** appear disabled with the lock visible: the writer sees what the AI was *not allowed* to touch.
- **Before/after snippets** per object — plan-level diffs and script-level diffs side by side.
- **Confidence labels** per proposed edit (sage = high-confidence direct consequence, amber = speculative ripple) and **continuity flags** where a proposed change contradicts a ledger fact.
- Actions: **Apply selected** (coral), **Create branch** (apply on a snapshot fork), **Flag only** (record concerns as annotations without changing anything).
- **Comments** on change-set rows are v2 (collaboration), but the layout reserves the affordance — each row is a discussable object.

This is the blast-radius confirmation flow (§6.2) elevated to a first-class surface — the single most important trust mechanism in the product.

### 4.6 Ledger mode

Continuity facts as an **inspectable source-of-truth layer**, not a flat list. Each fact is a card carrying: fact text; source span (click to jump to the establishing beat); `establishedIn` (episode/scene); `knownBy` (which characters know it — critical for dramatic irony); linked characters and world elements; confidence; status (active/superseded); supersedes/supersededBy chain; and writer confirmation state (inferred vs. confirmed vs. writer-authored).

Workflows: **accept / edit / reject** queued inferred facts (amber until resolved); filter by character, episode, storyline, or status; trace a supersede chain; see which upcoming scenes depend on a fact before changing it. Ledger facts also surface contextually elsewhere — in the Plan inspector ("affected facts") and as Review continuity flags — but Ledger mode is where the writer audits the world.

*(Dramaturg chat, v2, becomes a summonable panel available in any mode — its suggestions arrive as Change Sets, never silent mutations.)*

### 4.7 Show format settings

Output format is fixed to **teleplay** (Fountain-style sluglines, ACTION, CHARACTER/dialogue, transitions). Project-level settings shape structure, not medium: genre (drama / comedy / dramedy), episode runtime and act count (e.g., 5-act network hour, actless streaming hour, 2-act half-hour), cold open and tag on/off, serialization dial (procedural ↔ heavily serialized — controls how strongly episode plans must advance the season arc vs. stand alone). These settings drive both formatting templates and prompt guidance, enforced in every generation call.

### 4.8 Script and bible import

**v1:** Fountain, plain-text, and PDF episode scripts — single episode, parsed into scenes/beats. PDF import first extracts editable plain text on the server with pypdf/Tesseract (no LLM/token spend), then requires the writer to confirm or edit that source before the existing Create & analyze path runs as `format: "text"`. **v2:** FDX, multi-episode, and series-bible documents. Full pipeline (v2 target):

1. Parse each script into scenes (via sluglines/headings) and segment scenes into beats: the LLM proposes typed segment starts with metadata attached, while the server derives and normalizes the total source partition so no line can be dropped or duplicated; assign scenes to storylines.
2. Reverse-engineer the series bible and season plan: characters, relationships, theme, arcs, per-scene audience-learns/feels, motivations — and build the initial continuity ledger from everything imported.
3. Writer reviews/corrects the inferred plan, then can: get structural feedback, generate candidate next-episode premises, generate alternative continuations, or regenerate selected scenes.

This makes the tool useful for the dominant professional workflow — extending an existing show — not just filling blank pages.

**Import is the one explicit exception to "review before any AI-authored structural change."** The writer's single trigger is **Create & analyze script**; for PDF, that trigger is available only after the extract → confirm-source step. Once pressed, the v1 pipeline (deterministic verbatim scene split + model-proposed beat boundaries) persists the imported scenes/beats atomically as the project's one root snapshot. The trade is deliberate and bounded: no model-generated text ever replaces the source (coverage is server-validated and byte-identical), the imported structure remains fully reviewable and reversible afterward in Plan/Undo, and every imported fact still enters the Ledger as `pending_review`. This preserves the existing v1 import contract rather than forcing a second full-script preview/apply copy.

### 4.9 Inspiration affordances

- 3 diverse logline/scene-instruction suggestions at any decision point (embedding-deduplicated against the project's suggestion history).
- "Inspire me" button on any empty plan field, generating a suggestion consistent with everything already locked.
- Scratchpad: a per-project freeform notes area, ignored by generation unless the writer drags a note into a prompt.

### 4.10 Snapshots and undo

Every accepted change writes an immutable **project snapshot** (full plan + script + ledger + flags, plus the instruction that caused it). This gives: unlimited undo that restores a consistent world (facts and flags never outlive the content that established them), a browsable timeline, and **branching** ("fork from the snapshot three steps back"). Storage mechanics live in the data contract (MVP: fully materialized per snapshot; delta compression is a v2 optimization).

---

## 5. Data Model

Single source of truth: a versioned JSON document per project.

```json
{
  "project": {
    "id": "uuid",
    "title": "…",
    "format": {
      "genre": "drama | comedy | dramedy",
      "runtimeMinutes": 60, "actCount": 5,
      "coldOpen": true, "tag": false,
      "serialization": 0.8
    },
    "enabledComponents": ["existential_question", "audience_goals", "motivations", "desiderata", "continuity_ledger"],
    "premise": "…"
  },
  "seriesBible": {
    "existentialQuestion": { "text": "…", "locked": false },
    "worldRules": [{ "text": "…", "locked": false }],
    "storiesToAvoid": ["…"],
    "characters": [{
      "id": "char-1", "name": "…", "locked": false,
      "embodiment": "how their actions answer the existential question",
      "presentation": "public face", "hiding": "inner secret",
      "traits": "distinctive speech/behavior", "seriesArc": "…"
    }],
    "relationships": [{
      "between": ["char-1", "char-2"], "label": "…",
      "reallyLike": "power dynamics, unspoken tensions", "locked": false
    }],
    "audienceGoals": ["…"], "narratorGoals": ["…"],
    "worldQA": [{ "q": "…", "a": "…", "locked": false }]
  },
  "seasons": [{
    "id": "season-1", "index": 0, "locked": false,
    "seasonArc": "the serialized spine",
    "characterArcs": [{ "characterId": "char-1", "arc": "…", "locked": false }],
    "episodes": [{
      "id": "ep-1", "index": 0, "locked": false,
      "title": "…", "premise": "…",
      "seasonFunction": "what this episode does for the season arc",
      "storylines": [{ "id": "A", "summary": "…", "characterIds": ["char-1"] }],
      "scenes": [{
        "id": "scene-1", "index": 0, "act": 1, "storyline": "A", "locked": false,
        "location": "…", "time": "…", "socialSituation": "…",
        "whatHappens": "…", "audienceLearns": "…", "audienceFeels": "…",
        "motivations": [{ "characterId": "char-1", "objective": "…", "stakes": "…", "obstacle": "…" }],
        "beats": [{
          "id": "beat-1-1", "index": 0, "locked": false,
          "whatHappens": "…", "audienceLearns": "…", "audienceFeels": "…",
          "scriptText": "formatted teleplay lines for this beat",
          "scriptLocked": false
        }]
      }]
    }]
  }],
  "continuityLedger": [{
    "id": "fact-17",
    "fact": "Dan is arrested",
    "factType": "event | state | knowledge | relationship | world_rule",
    "sourceSpan": { "episodeId": "ep-3", "sceneId": "scene-4", "beatId": "beat-4-2" },
    "knownBy": ["char-2"],
    "provenance": "inferred | writer_confirmed | writer_authored",
    "confidence": 0.93,
    "status": "active | superseded",
    "supersedes": null, "supersededBy": null
  }]
}
```

Notes: `locked` on any node locks all children (locking episode 3 protects it from season-level regeneration); `scriptText` and beat plan lock independently (a writer may lock dialogue they hand-wrote while letting the beat's plan description regenerate, or vice versa).

**Separate stores (not embedded in the project document):**

- **Snapshots** — an append-only tree keyed by project ID (`{id, parentId, instruction, doc, ledger, flags, ts}`), enabling undo, timeline, and branching. The project doc holds only a `headSnapshotId` pointer. (This section is conceptual — the data contract is authoritative for storage mechanics: MVP snapshots are fully materialized; delta compression is a v2 optimization behind the same interface.)
- **Suggestion history + embeddings** — its own table (pgvector), queried at suggestion time, never loaded with the project.

**Continuity ledger integrity rules** (one bad inferred fact poisons every later prompt, so):

- Every fact carries a `sourceSpan` linking to the beat that established it; clicking a fact jumps to its source.
- `provenance` distinguishes machine-inferred from writer-confirmed facts; inferred facts below a confidence threshold are queued for writer review and **excluded from generation prompts until confirmed or auto-validated** by a second extraction pass agreeing.
- Contradicting facts are never overwritten: the new fact `supersedes` the old, preserving the chain for debugging and for writer reversal.
- Extraction re-runs on every accepted change; facts whose source beat was regenerated or deleted are flagged stale for review.

---

## 6. LLM Architecture (Claude API)

### 6.1 Model routing

| Task | Model | Rationale |
|---|---|---|
| Beat script generation, plan candidates | Claude Sonnet | Quality/latency balance for the interactive loop |
| Polish-mode critique & selection, full-plan creation, import analysis | Claude Opus-tier | Depth matters, latency tolerated |
| Beat segmentation, consistency flagging, suggestion generation | Claude Haiku | Cheap, structured, high-volume |

All calls use **structured outputs / tool-use JSON schemas** matching the data model — plan objects are never free text. Claude handles dark themes, violence, and morally complex material in clear fiction contexts well, which matters for professional drama; the system prompt establishes the fiction-writing context explicitly.

### 6.2 Prompt architecture

A shared **system prompt** per project establishes: role ("expert TV dramaturg and co-writer, collaborating with a professional writer whose authorship is paramount"), the show's format settings and teleplay conventions, the narratology framework (definitions of scene/beat/storyline, enabled components), and output schema instructions.

Each operation then has a **task prompt template**. The critical ones:

**Plan creation** (chained, mirroring Dramatron's chain but with converge checkpoints between stages):
series premise → stories-to-avoid → existential question → characters → relationships → world Q&A → season arc + character arcs → episode grid → per-episode storylines and scene skeleton → per-scene beats. Each stage's accepted output feeds the next; the writer can stop, edit, and lock between stages. Writers never have to plan a whole season to break one episode — the season layer can hold a single episode card.

**Beat generation** context bundle:

- Series premise, existential question, relevant character sheets (only characters in scene)
- Episode premise + this scene's storyline summary and season function
- This scene's plan + motivations (objective/stakes/obstacle per character)
- Relevant continuity-ledger facts (filtered by characters/world elements in scene)
- Script text of the previous ~2 beats (continuity) and the next beat's plan if it exists (landing constraint)
- Locked constraints, format rules, writer's instruction
- Previous candidates to avoid (for diversity)

This fits comfortably in a few thousand tokens — no need to ship a whole season per call. The continuity ledger is what keeps context small: facts, not full scripts.

**Plan evolution (partial regeneration):**

1. Classify the edit's blast radius: which scenes/beats/characters are affected (Haiku call returning element IDs).
2. Assemble a **Change Set** and present it in Review mode (§4.5): impacted objects with checkboxes, before/after diffs, confidence labels, locked rows shown disabled — the writer shrinks the selection to exactly what they approve.
3. Regenerate only approved, unlocked elements, with locked siblings as constraints.
4. Run a consistency scan over untouched scenes; surface contradictions with ledger facts ("Scene 6 still shows Dan free, but he was arrested in scene 3") as continuity flags in the Change Set, never auto-fixes.

Step 2 is the direct fix for Fabula's biggest complaint (whole-structure rewrites destroying writer agency).

**Analysis/dramaturg mode:** critique prompts with a bank of narratology-focused questions (character believability, escalation, intelligibility, emotional range, scene purpose). Output is feedback + optionally a one-click "apply as regeneration instruction."

### 6.3 Diversity and dedup

Candidate diversity via sequential sampling with "avoid these prior candidates" (better than temperature alone). All suggestions/candidates embedded (Voyage or similar); cosine-similarity threshold discards near-duplicates against both the current batch and project history.

### 6.4 Bias countermeasures

Fabula's writers documented LLMs defaulting to white/Western/cisgender characters and flattening cultural specificity. Mitigations: never include Western canon examples in prompts; when the writer leaves demographics unspecified, instruct the model not to infer defaults and to keep descriptions neutral until the writer decides; when the writer specifies cultural context, treat their wording as authoritative and instruct against sanitizing character voice ("sassy" must stay sassy). Surface a note encouraging writers to review cultural representation — the tool cannot own this responsibility, but it must not fight the writer.

---

## 7. System Architecture

```
Frontend (React + TypeScript)
  ├─ Four modes: Write (script canvas) · Plan (story canvas) · Review (change sets) · Ledger (continuity inspector)
  ├─ Teleplay renderer (screenplay CSS layout; Fountain export) · Canvas engine for Plan mode
  ├─ Theming: warm light (default) + warm dark, shared semantic tokens (coral/sage/sky/amber)
  └─ State: project JSON via optimistic updates + server reconciliation

API server (Python / FastAPI)
  ├─ Drama Manager service (operation orchestration, prompt assembly, blast-radius calc)
  ├─ Claude client (Anthropic SDK; structured outputs; streaming for script text)
  ├─ Embeddings service (dedup)
  └─ Import pipeline (Fountain/plain-text/PDF extract + LLM typed segment starts + server partition)

Storage (PostgreSQL; SQLite for local/MVP)
  ├─ projects (current JSON doc)
  ├─ snapshots (materialized tree — see data contract)
  └─ suggestion_history (+ pgvector for embeddings)
```

Non-functional targets: beat generation streamed, first token < 2s; 3 candidates in parallel < 15s total; plan-evolution blast-radius classification < 3s.

### 7.1 Data ownership and privacy

This audience works with unproduced, contractually sensitive IP — often material they don't fully own (staffing on an existing show). Weak answers here kill adoption regardless of product quality:

- **Ownership**: the writer owns all input and output; the product claims no rights. Stated plainly in the ToS and in the UI.
- **No training**: writer material is never used to train models — true under standard Anthropic API commercial terms today; surface this in-product, not just in policy pages. Zero-data-retention (ZDR) is a separate contractual agreement, not a default: pursue an executed ZDR agreement before any beta with professional writers, and don't claim it in product copy until then.
- **Retention controls**: per-project export-everything (full JSON + Fountain) and delete-everything (including snapshots, embeddings, and ledger) that actually purge.
- **Local-first option**: the SQLite storage path (§7) is not just a dev convenience — offer a desktop/local mode where scripts never leave the machine except for LLM calls, with a clear indicator of exactly what text each call sends.
- **Existing-show caution**: when a writer imports third-party IP, that's their legal call — the product's job is to guarantee it isn't stored beyond their control or seen by anyone else.

---

## 8. MVP and Roadmap

**MVP — deliberately thin, single-user only. It exists to answer one question: *can a writer converge on an episode without losing authorship?***

All four modes ship, each in its simplest honest form:

1. **Write mode** — script canvas, Next Beat variants (3 labeled candidates: Accept / Tune / Skip), bottom command bar
2. **Plan mode** — simplified canvas/board: one episode's scenes and beats as cards with locks and the right-side inspector; no infinite canvas, no connector lines yet
3. **Review mode** — one scoped rewrite flow as a Change Set: "change this scene premise" → impacted beats with checkboxes and diffs → apply selected
4. **Ledger mode** — single-episode continuity: fact cards with source spans, confidence, accept/edit/reject queue
5. Single episode only (series bible minimal: premise, characters, theme); manual entry or Fountain/plain-text/PDF import only
6. Fountain export; plain undo (snapshot data model in place, no timeline UI)

Cut from MVP (designed above, built later): A/B/C storyline tagging, chained full plan creation with checkpoints, connector lines, dark theme.

**Deferred beyond MVP:** real-time collaboration; comments and cursors; full multiplayer canvas; branch comparison UI; full season canvas.

**v2 (the season):** full season canvas with episode frames and arc lanes; connector lines (setup/payoff, continuity, arcs); storyline tagging; chained plan creation; cross-episode continuity checks; FDX/bible/multi-episode import + structural analysis; candidate next-episode premises; dramaturg chat (suggestions as Change Sets); polish mode (critique-and-select); snapshot timeline + branch comparison; Change Set comments; dark theme.

**v3:** collaboration (writers' rooms — multiplayer canvas, comments/cursors, multiple writers converging on one season plan); multi-season projects; education mode (component-hiding for teaching, per Fabula's instructor feedback); FDX round-trip. Only after episodic is proven: expand to other writing types (features, stage plays, novels) as new format templates + Drama Manager variants on the same core.

**Explicit non-goals (v1):** one-click full-episode generation; multiple mediums; auto-publishing; anything that positions the tool as the author.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Cascading regeneration destroys writer trust (Fabula's #1 complaint) | Blast-radius confirmation + locking + snapshots; never rewrite silently |
| UI complexity alienates writers | Write mode is the warm, script-first default; Plan/Review/Ledger are visited, not inhabited; progressive disclosure on setup |
| Reviewing candidates costs more than writing ("high cognitive load") | Polish mode pre-filters via critic; candidate count configurable down to 1 |
| Stylistic homogenization / "same generation path" for all users | Diversity sampling + dedup against history; writer text always primary context |
| Latency of multi-call pipelines | Model routing (Haiku for classification), parallel candidate calls, streaming |
| Continuity ledger drifts from the actual script (wrong or stale facts poison every prompt) | Integrity rules in §5: source spans, provenance/confidence gating, supersede chains, staleness flags on regeneration |
| IP-sensitive material deters professional adoption | §7.1: no-training API terms surfaced in-product, purge-capable deletion, local-first mode |
| Deskilling concerns / market perception as an "AI slop" tool | Position analysis and feedback features first; generation is assistive and always writer-initiated |

---

## 10. Sources

- Fabula paper: Mirowski et al., *Fabula: Building a Narrative Storytelling Sidekick with the Writers' Community* (arXiv:2606.14411, CHI 2026)
- Predecessor: Dramatron (Mirowski & Mathewson, CHI 2023) — prompt-chained hierarchical script generation
- Narrative theory basis: Nick Lowe (*The Classical Plot*), Robert McKee (*Story*), John Yorke (*Into the Woods*), Stanislavsky (units/objectives)
