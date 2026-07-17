# Import Story Overview — Design

**Date:** 2026-07-17  
**Status:** Approved — product decisions locked; implement T7.27–T7.30  
**Parent:** design doc §4.8 (import reverse-engineers plan) + continuity-layer roadmap (adjacent; not covered by P0–P2)  
**Build-plan:** T7.27–T7.30  
**Plan:** `docs/superpowers/plans/2026-07-17-import-story-overview.md`

## Problem

Writers who **Import a script** get a strong scene/beat partition, a continuity ledger, cast/entities, and narrative threads — but **no episode-level story overview**. After analyze, Plan’s episode premise is empty, scene `whatHappens` is empty, storylines are empty, and Ledger has no place to read “what is this episode about?” before diving into hundreds of facts.

Requested artifacts:

1. Script **logline**
2. **General outline** of the script
3. **Beat sheet** for the script
4. **Two-paragraph summary** of the story  
…surfaced in the **Ledger**.

## Authority scan (what exists today)

| Source | Finding |
|---|---|
| Design doc §2 / §3 | Workflow names “episode premise → A/B/C storylines → **beat sheet** → draft scenes”; “logline” appears only as **inspiration suggestions** (A4), not as a stored import field. |
| Design doc §4.8 | Import should reverse-engineer plan + ledger. Does **not** name logline / outline / synopsis as first-class import outputs. |
| Data contract / Zod `Episode` | `premise`, storylines, scenes, threads, timeline/relationship/object state. **No** overview object until T7.27. |
| Import pipeline | Leaves `episode.premise = ""`; beat `whatHappens` filled from segmentation; no overview stage. |
| Ledger UI | Atlas · Knowledge Web · Threads · Cast. No Story overview surface. |

**Verdict:** Extend §4.8 with a first-class `Episode.storyOverview` + one import classifier op. Contract package is authoritative for executable shapes; this doc defines product intent.

## Craft research (citations)

### Logline

Industry guides converge on a **one-sentence** pitch (~**25–40 words**, sometimes up to ~50) naming **protagonist + goal + obstacle**, ideally with **stakes** and a flash of **irony/hook**. Classic template: *When [inciting incident], a [protagonist] must [goal] before/or [stakes].* Avoid subplot laundry lists; for a **TV episode** logline, emphasize this episode’s contained dramatic engine (series-engine loglines are a different artifact).

Sources:

- [Storyflow — What is a Logline?](https://storyflow.so/blog/what-is-a-logline-complete-guide) (25–50 words; protagonist/goal/obstacle/stakes/irony)
- [ScreenCraft — TV series logline](https://screencraft.org/blog/how-to-craft-the-perfect-tv-series-logline/) (25–50 words; When… must… before…)
- [Final Draft — How to write a logline](https://www.finaldraft.com/blog/how-to-write-a-logline-for-big-break) (feature vs pilot: contained conflict vs ongoing engine)
- [Plotwell — Logline that sells](https://plotwell.co/blog/how-to-write-a-logline) (specific stakes; irony)
- [Celtx — How to write a logline](https://blog.celtx.com/how-to-write-a-logline/) (~25–30 words; protagonist + want + obstacle)

**Prompt bar:** one sentence, prefer **25–40 words**, include protagonist + want + obstacle; stakes and irony when supported by the script.

### Outline vs beat sheet

Craft usage separates:

- **Beat sheet** — lean bullet list of **major emotional/structural turns** (not every micro-beat). Blake Snyder / Save the Cat popularized a **15-beat feature** template; TV rooms more often use **act-structured** beat sheets (hook → launch → midpoint → low point → climax → button), sometimes Shonda-style five-act skeletons.
- **Outline** — **scene-by-scene** (or sequence) roadmap: denser than a beat sheet; slugline-aware “what happens” per scene.

Sources:

- [Save the Cat — Beats and beat sheets](https://savethecat.com/tips-and-tactics/a-screenwriters-guide-to-beats-and-beat-sheets)
- [WeScreenplay — What is a beat sheet?](https://www.wescreenplay.com/blog/what-is-a-beat-sheet/) (TV act skeleton; bullets of important moments)
- [WeScreenplay — Script outline](https://www.wescreenplay.com/blog/what-is-a-script-outline-and-should-you-use-one/) (scene-by-scene vs beat sheet)
- [Erick Mertz — TV writing fundamentals](https://erickmertzwriting.com/tv-writing-fundamentals/) (beat sheet lean; outline story-rich)
- [Script Magazine — TV outline](https://scriptmag.com/features/your-tv-guide-to-setting-up-a-successful-outline)

**Product fit for episodic Table Read:** do **not** force Snyder’s 15 feature labels. Prefer a **TV-shaped named beat sheet** (hook / inciting / midpoint / climax / etc. as labels when they fit) with **grounded `beatId` (+ optional `sceneId`)** anchors from the imported partition. Outline is **ordered scene rows** `{sceneId, summary}` — not freeform prose — so the Ledger can jump to Write.

### Two-paragraph synopsis

Pitch/synopsis craft: **third person, present tense**; cover beginning → turn → end (**spoilers included** — not a back-cover teaser). Two-paragraph cut: ¶1 setup/world/inciting; ¶2 escalation/climax/resolution. Tone should match the script; omit subplot laundry lists.

Sources:

- [MasterClass — Movie synopsis](https://www.masterclass.com/articles/how-to-write-a-movie-synopsis-to-sell-your-screenplay) (present tense; spoil ending)
- [NFI — Movie synopsis](https://www.nfi.edu/movie-synopsis/10/) (act-aware paragraphs; present tense)
- [Drake — Pitch synopsis](https://maxwellalexanderdrake.substack.com/p/structuring-the-perfect-pitch-synopsis) (full arc; third-person present)
- [Freelance Video Collective — Film synopsis](https://www.freelancevideocollective.com/how-to-write-a-film-synopsis/) (present tense; spoil ending)

**Prompt bar:** exactly **two paragraphs**, present tense, third person, spoil the episode ending when the script has one.

## Locked product decisions

| # | Decision |
|---|---|
| 1 | **Approach B:** new `Episode.storyOverview` object — do **not** overload `premise` as the storage home for all four artifacts. |
| 2 | **Outline:** structured ordered `{sceneId, summary}[]` only. No separate prose outline field (research prefers scene-by-scene lists for this artifact; prose belongs in `summary`). |
| 3 | **Beat sheet:** structured LLM list `{beatId, label, summary, sceneId?}` — not only client aggregation of beat `whatHappens`. Merge may drop unknown ids; UI may still cross-check coverage vs segmented beats. |
| 4 | **Premise backfill:** when `Project.premise` and/or `Episode.premise` are empty/whitespace after overview merge, set them from `storyOverview.logline`. Never overwrite a non-empty premise. |
| 5 | **Ledger:** Overview panel (Threads-style FilterRail entry + raised panel) + optional header logline teaser under “What’s true in this story.” |
| 6 | **Pipeline slot:** `inferring_overview` **after** `inferring_promises`, **before** `extracting_facts`. |
| 7 | **Locks:** `storyOverview.locked === true` → re-import must not overwrite overview. Episode-level lock also blocks overwrite (same spirit as locked episode content). |
| 8 | **Review queue:** trusted-enough prose with edit-in-place later; v1 is import-inferred + Ledger display (no `pending_review` fact). |
| 9 | **Writer regen / PATCH:** out of scope for v1 UI (Write-mode quiet). Schema carries `provenance` + `locked` for later. |
| 10 | **Idea-path Generate:** import-only for v1. |

## Schema (conceptual — contract package is executable authority)

```ts
StoryOverviewOutlineItem = { sceneId: Id, summary: string }
StoryOverviewBeatItem = {
  beatId: Id,
  label: string,          // named turn e.g. "Inciting Incident"; may be ""
  summary: string,
  sceneId: Id | null,     // optional scene anchor
}
StoryOverview = {
  logline: string,
  outline: StoryOverviewOutlineItem[],
  beatSheet: StoryOverviewBeatItem[],
  summary: string,        // exactly two paragraphs
  provenance: "inferred" | "writer_authored",
  locked: boolean,
}
// Episode.storyOverview: StoryOverview | null  (default null)
// §2a InferredStoryOverview: logline + outline + beatSheet + summary (no locked/provenance)
```

## Ledger surface

1. **FilterRail** — **Overview** under Threads; optional present cue when non-null.  
2. **OverviewPanel** — logline → two-paragraph summary → outline → beat sheet (collapsible); scene/beat jumps → Write.  
3. **Header teaser** — one-line logline under the Ledger subtitle when overview exists; click opens panel.

Empty state: “Import a script to generate a story overview.”

## Locks, snapshots, prompts

| Concern | Rule |
|---|---|
| Snapshots | Overview is part of project doc → single import root snapshot. |
| Locks | Locked overview (or locked episode) preserved on re-import. |
| Atomicity | Schema-invalid after one retry → `SCHEMA_INVALID_LLM`, zero rows. |
| PROMPT_VERSION | Bump with new template; tool schema regen; **`make evals` not run until authorized**. |
| Untrusted text | Via `drama_manager/render.py` + `<source_data_{nonce}>`. |
| Logging | Stage/ids/token counts / PROMPT_VERSION only — never overview prose. |

## Cost

+1 synchronized classifier call per import (episode-scoped; compact scene/beat summaries — same input shape family as promises/acts). Prefer one call; avoid chunking.

## Build-plan tasks

**T7.27** Story overview contract.  
**T7.28** Import `infer_story_overview` (+ premise backfill + locks).  
**T7.29** Ledger Overview panel + header teaser.  
**T7.30** Planted eval fixture + dry-run wiring (no real `make evals`).

## Self-review

- Research cited; open questions closed with locked table.  
- Outline has no prose twin (documented).  
- Beat sheet is TV-shaped named turns grounded to ids, not forced STC-15.  
- Contract package remains executable authority for shapes.
