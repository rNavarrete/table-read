# Import board ("Breaking the Board") — design

**Date:** 2026-10-12 · **Status:** approved by owner 2026-10-12 ("lets implement that")

**Replaces:** the "Check & start" progress list in `ImportWizard.tsx`

**Prototype:** `docs/superpowers/prototypes/2026-10-12-breaking-the-board.html`. Open it in a browser and use **Replay**. It sets the look, motion and copy, and implementations should match it.

## Why

Today the import page is nine grey progress bars for 5 to 25 minutes, and three of them lie:

- The story-threads step shows "1 of 2" and a half bar for its whole wait. The server sends that before the call starts (`pipeline.py:594`).
- A failed step keeps saying "In progress" and keeps sweeping.
- The ETA ignores the long single-call steps, which are about 52% of the wall time.

**The owner's choice.** A design studio compared four directions. The owner chose **Breaking the Board** as the most useful of them, then approved a polished prototype of it. While the import runs, the page builds the episode's writers'-room board from real results:

- an index card for every scene
- the act breaks taped up
- the cast on the wall
- pinned string from each setup to its payoff.

The writer catches a misread scene while the import is still running, and ends with the board they would have spent a week building.

**Owner decisions (2026-10-12):**

- **Live results.** Results appear live while the import runs. This amends UI spec §2a, which said scene results show "only after the terminal success".
- **Hold at the end.** The page holds on the finished board ("The board is up.") with **Open your story** (focused; it goes to the Ledger Story tab, as today) and **See it in Plan**. It no longer jumps away the instant the import completes.

## What the writer sees

The prototype is the reference. Stage by stage:

1. **Before start (client only):** the headline reads "N scenes found in your pages" (the client slugline count, labelled approximate), with "Usually X–Y minutes for a script this size. Keep this tab open."
2. **Parsing:** a short deck of cards deals into an **In script order** frame. There is one card per server scene, with the scene number, an INT/EXT dot, the slugline (Courier Prime) and "Not read yet", tilted slightly.
3. **Segmenting beats:** cards fill **out of order**, as results land. The body becomes `~ <whatHappens>` (Newsreader) and gains one pencil-mark tick per beat. The card squares up, the newest card lifts, and a soft lamp glides to it. A failed scene turns amber: "Couldn't break into beats. Kept whole; flagged for you."
4. **Acts:** the headline reads "Finding the act breaks", with a step clock ("0:08 on this step · usually 10–20 s") and a thin activity sweep. When acts land, the headline reads "The breaks go up":
   - the board pulls back slightly, every card lifts, and the cards fly into **act frames** (clay) on a stagger
   - masking-tape labels ("ACT ONE") drop on
   - the Format card fills (genre · runtime · acts · cold open/tag).
5. **Cast:** Polaroid-style cast cards drop into the rail, sized by nothing, tilted, each with its name and scene count. The heading reads "Cast · N speaking parts". Each finished chunk draws a faint underline on the cards it covered.
6. **Threads:** a quiet step clock. When the threads land:
   - numbered pushpins pop onto setup and payoff cards
   - gently sagging strings draw between them; the first thread is drawn strongest, the rest faint
   - the rail lists each thread with its status (Paid off · Open · Dropped).
7. **Overview:** a step clock, then the logline appears whole in the Logline card. It fades in and is never typed out.
8. **Facts:** a "N facts" stamp lands on each card, out of order, with ◆ when a fact is hidden from the audience. The header total counts up.
9. **Continuity:** a step clock, then amber text chips: "N contradictions · N tensions".
10. **Finale:** the headline reads "The board is up.", and the counts are reconciled once against the `complete` payload. **Open your story** is focused, with **See it in Plan** beside it. Nothing auto-navigates.

**Throughout:**

- The headline narrates, cross-fading between stage titles in Newsreader 40.
- A step spine shows the nine steps; the current one pulses.
- Elapsed time is shown top right.

**Dead time:** nothing moves on its own during single-call steps. The only motion is the step clock, the sweep and the dimmed, breathing lamp. "While you wait, every card is open to read." Every card is focusable, and a focused card shows its reading in the rail's Notes.

**Leaving the page.** Copy is honest: "Keep this tab open. Leaving pauses the import; finished work is saved." Retry continues from saved work, as today.

**Big scripts.** Every script uses the same card (150×106: number, dot and heading on one line, the reading in up to four lines of 13px serif, ticks and facts), because a smaller card that dropped the reading made 54-scene boards unreadable (owner, 2026-10-12). The full heading and reading show on hover. In the 1280px running column that is about 7 cards a row: 54 scenes fit in about one screen, 120 in about two.

**Reduced motion.** No tilt, flight, lamp or count-up; everything simply appears.

**Accessibility:**

- The board is a list of scenes with text states ("Not read yet", "Read, 5 beats", "Couldn't be read").
- Status is never shown by color alone.
- Announcements are throttled: stage starts, the act result, and every 10th scene.

## Data: one additive SSE event

The page needs per-unit results, which the stream does not carry today. Add one event to `ProjectImportProgressEvent` (rule 3: Zod, the Pydantic mirror, data contract §9.3, test plan):

```ts
{ type: 'found', stage: ProjectImportStageName, cached: boolean /* default false */, data: ProjectImportFound }

ProjectImportFound = discriminated on `kind`:
  { kind: 'scenes',   scenes: { index, slugline, lineCount, intExt: 'int'|'ext'|'other' }[] }  // after parsing
  { kind: 'scene',    index, beatCount, whatHappens, failed: boolean }                         // per segmented scene
  { kind: 'acts',     format: ShowFormat, sceneActs: number[] }                                // after acts merge
  { kind: 'castRead', sceneIndexes: number[] }                                                 // per entity chunk
  { kind: 'cast',     total, characters: { name, sceneCount }[] /* top 12 by sceneCount */ }   // after entities merge
  { kind: 'threads',  threads: { label, status: 'open'|'paid_off'|'abandoned', setupSceneIndex: number|null, payoffSceneIndex: number|null }[] }
  { kind: 'overview', logline, beatSheet: { label, sceneIndex: number|null }[] }
  { kind: 'facts',    index, factCount, secretCount, failed: boolean }                         // per extracted scene
  { kind: 'flags',    contradictions, tensions, other }                                        // after consistency
```

**Field rules:**

- Indexes are 0-based positions in the server's scene split; `scene-{index+1}` is the eventual id.
- `whatHappens` is the segmenter's scene reading.
- Cast `sceneCount` is the number of scenes where the character speaks (cue lines resolved to that character, using the whole-script shooting-script decision).
- All data is post-merge where a merge exists. No `scriptText` ever appears in a frame.

**Resume.** Units reused from checkpoints are re-emitted with `cached: true`, so a returning writer's board rebuilds. The client applies a cached burst without animation.

**Server costs nothing extra.** Payloads come from data already in memory, with no LLM calls and no database writes. `create_import` logs each `found` frame as stage, kind and counts only (rule 5).

Old clients ignore unknown event types, so the change is additive. It's not an LLM op schema, so there is no `PROMPT_VERSION` bump and no evals.

## Honesty fixes (ship with the board)

- **Single-call steps are indeterminate everywhere:** acts, threads, overview, consistency and saving. Threads' server-sent "1 of 2" is ignored by the client; the server's frames stay unchanged, because tests pin them.
- **A failed step freezes** and reads **Stopped**, its sweep stops, and the clock stops.
- **ETA:**
  - It uses per-scene priors for every step, from a constant table built from real runs.
  - It ignores a resume's cached burst.
  - It shows "about N–M min left", hides after 30 s with no news, and is labelled typical, not promised. Every stage start and progress frame is news. A single-call step sends nothing until it ends, so its news is due by the high end of its usual time, and the time it has already run comes off its prior.
- **Elapsed** survives a resume within the same page.

## Visual tokens (rule 6)

New tokens go in `apps/web/src/styles/tokens.css` and UI spec §1, using the prototype's values:

- **Card paper and rules:** `--tr-board-paper #FFFEFB`, `--tr-board-rule`, `--tr-board-rule-top`.
- **Shadows:** `--tr-shadow-card-board`, `--tr-shadow-card-lift`.
- **Motion:**
  - `--tr-motion-spring cubic-bezier(.34,1.42,.64,1)`, `--tr-motion-settle cubic-bezier(.2,0,0,1)`
  - durations: deal 620 ms, act-break flight 760 ms, string draw 700 ms
  - stagger: `min(28 ms, 600 ms / N)`.
- **Sizes:** card 118×88 full and 92×64 compact.

Everything else reuses existing tokens: desk (`--tr-write-desk`), clay frames, sky (string and pins), sage, amber, accent, and the three fonts. All motion uses CSS or the Web Animations API, with no new dependency (rule 10).

## Not in this build

- A server-owned background import that survives a closed tab. Until then the copy says "pauses".
- A "paused import" card on the dashboard.
- Sound.
- Carrying the board into the Ledger.

## Testing

- **Server (pytest):**
  - `found` frames arrive with correct kinds, indexes and post-merge data
  - cached units re-emit with `cached: true`
  - a failed segment emits `failed: true`
  - no frame contains `scriptText`
  - log lines hold counts only
  - existing progress frames are unchanged.
- **Contract:** `check-contract`.
- **Web (Vitest):**
  - the pure board reducer: every kind, out-of-order indexes, cached bursts, and reconciling against `complete`
  - honesty fixes: indeterminate singletons, Stopped on failure, ETA burst
  - components render each state with text alternatives
  - the reduced-motion path
  - the finale buttons and focus.
- **e2e:** update `zz-newproject-import-success` and `newproject-import-failure` to the board. The mock LLM finishes in under a second, so the board must reach the finale without animations blocking it.
