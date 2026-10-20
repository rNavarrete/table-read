# Plan redesign: the board that tells you if the episode works

**Date:** 2026-10-13 · **Status:** owner-approved direction ("that's really cool… lets implement it"), decisions below answered by the owner on 2026-10-13.

**Base:** the "Story Health" concept from a four-concept design study (Room Board, Scene Dossier, Story Health, Zoom Cards), chosen by the owner, with the judge panel's fixes and grafts applied. The study's clickable mockups and full write-up live outside the repo in the owner's `reports/Plan redesign/` folder, because they are built on a copyrighted script. This spec uses generic examples only.

## 1. What Plan is for

**Plan shows the shape of the episode at a glance — the acts, what each scene is for, and what connects to what — and is where the writer fixes that shape and sets the intent that Write's Next Beat aims at.**

The writer comes to Plan for four jobs:

1. **Read the shape.** Do the act outs escalate? What is set up and paid off? Where is the secret kept? Who is in which scene? Readable from the board without opening anything.
2. **Correct and arrange.** Fix the importer's act split and scene order (the dominant workflow after an import), reorder scenes, lock what works.
3. **Set each scene's intent.** What happens, who wants what, what the audience learns and feels. These fields steer every Next Beat prompt (prompt spec §1), so they lead the panel.
4. **Triage what is open.** After an import or an apply: read the continuity notes, jump to the scene, dismiss, or take the note to Write or Review.

**Plan is not for:** writing script (Write), applying AI changes (Review), auditing facts (Ledger), scores or dashboards, or running AI on its own — nothing in Plan calls a model on mount, select, hover, focus or highlight change.

## 2. The problem being fixed

- With a scene selected, today's right inspector is ~5,160px tall: the side panels stretch to the board's height and the whole document scrolls. Who wants what and the affected facts sit far below the fold, under plain form fields (location, time, social situation, disabled storyline).
- The 296px inspector squeezes the four-column motivations table.
- Plan already has, but doesn't show: flag explanations (only a dot), beat-level flags, threads (setups/payoffs), the episode secret, `statedObjective` / `concealed` on motivations, fact status, beat-sheet landmarks, `timelineAnchors`, `relationshipStates`, the logline, and `beat.whatHappens` (beat cards show the first script line instead).
- Story Layers (left, 232px) duplicates the board and its Bible node is a dead end.

## 3. Owner decisions (2026-10-13)

| # | Question | Decision |
|---|---|---|
| 1 | Story Layers column | **Retire it** (Phase 2). Its jobs move to the episode chart, act headers and the Episode view. The right panel grows to **400px** — new token `--tr-panel-plan: 400px` approved. |
| 2 | Drag semantics | **Insert where dropped** (Phase 4), after a lock-violation test. Swap stays until then, with a visible target and the order prediction. |
| 3 | "Draft a fix in Review…" on notes | **Yes, in the last phase**, hidden on locked scenes, lock-violation test first. |
| 4 | Storyline A/B/C | **Stay hidden** while `episode.storylines` is empty (no select, colours or lanes). |
| 5 | Suggestion chips on what-happens | **Behind an explicit "Suggest…" button.** No model call on focus (Phase 1). |
| — | Scene "turn" field | Not added. The beat-sheet landmark callout and the scene's last beat ("lands") are the proxies. |

## 4. The design

### 4.1 Layout

```
┌ AppShell (unchanged): title · Write | Plan | Review | Ledger · Undo Export Settings ┐
├──────────── board column (1fr) ─────────────────────┬──────── panel 400px ──────────┤
│ STICKY: Highlight bar · Episode chart · legend/keys │ STICKY: ← Episode · n of N ‹ › │
│                                                     │ title · jump bar with counts   │
├─────────────────────────────────────────────────────┼────────────────────────────────┤
│ ⌄ ACT ONE · 7 scenes · ≈43% · ↗8 set up · ↘4 paid   │ slug · [Act ▾] [Lock] [Write ↗]│
│   [card][card][card][card][card][card]  150×106     │ notes strip (only if notes)    │
│ ⌄ ACT TWO …                                         │ ⌄ What the scene does          │
│ ⌄ ACT THREE … ⚑ act-split note                      │ ⌄ Who wants what               │
│   (board scrolls on its own)                        │ ⌄ What it touches · ⌄ Beats    │
│                                                     │ › Details (panel scrolls)      │
└─────────────────────────────────────────────────────┴────────────────────────────────┘
```

- **The board and the panel scroll independently** inside a fixed-height Plan screen. Clicking a card anywhere updates a panel that is already on screen.
- Story Layers is removed in Phase 2: Bible/Episode → Episode view; act eye toggles → a persisted collapse chevron per act frame; scene list → board + chart; the dead "Connectors" checkbox → chart arcs.

### 4.2 Scene card (the import board's index card)

- Size `--tr-card-board-w/h` (150×106), the import board's `IndexCard` face: ruled paper, number · INT/EXT dot · cleaned place title (full slug in the peek and panel), 4-line `whatHappens` reading, bottom row of beat ticks (amber = beat with a story note, hollow = import note), ↗ set up / ↘ paid off counts, ◆ secret, `TURN` / `ACT OUT` tags.
- Chips: amber **⚑n** for story notes, a quiet neutral chip for import-only notes (same `consistency-flag-badge` testid), lock glyph, coral unsaved dot.
- At most one **tape** above the card: its relation to the selection ("↘ pays off 12", amber "⚠ order with 15") or the active highlight's label. No callout boxes on cards.
- Selected: coral-soft fill + inset coral ring. Related to selection: dashed sky outline + tape. Focus: separate 2px sky outline offset 4px, visible on a selected card too.
- Double-click opens the scene in Write (unchanged). Beat cards leave the board; beats live in the panel.
- **Peek** (T10.14; owner request: cards truncate and must be readable in full). The card read in full beside it — number · place, the whole slug (script font), the whole `whatHappens`, and the T10.12 readings (Turns, Clash, Who knows) when the scene has them. It opens after resting the pointer on a card for 400 ms, or at once when a card takes keyboard focus (arrows/Home/End), never from a click (which selects) or during a drag. It closes on leaving the card and the peek (120 ms grace, so the pointer can move onto it), blur, scroll or Esc. Esc on a hover peek only closes it; on a focus peek it closes and goes on to Plan (back to the Episode view), so keyboard users never press twice. It sits right of the card, or left where the window ends, in a portal so the board's scroll box can't clip it. Visual only (`aria-hidden`; the card's label already names the scene), no request. It replaces the native `title` tooltip.

### 4.3 Act frames

- Header: name · scene count · ≈ share bar with an even-share tick · ↗ set up · ↘ paid off counts · chips only for beat-sheet landmarks that are actually marked (`tvActStages`; no "not marked" nags) · collapse chevron (persisted).
- An act-split flag on a scene in the act shows as a note on the header with "Open scene n".
- An empty act shows "No scenes yet. Drag a card here, or use the Act control" and is a drop target (an act change).

### 4.4 Episode chart (sticky, ~84px)

- One block per scene in act bands; block width ≈ the scene's share of the script text (6–12px minimum, equal widths when there is no script), so ~70 scenes fit.
- Sky arcs join setups to payoffs (`episode.threads`); the selected scene's arcs are bold; an arc turns amber when its payoff now plays first; open threads are a dashed amber arc ending in "?".
- Secret lane (`episode.secrets`): ◆ set · dots kept · ◇ out.
- Amber top rule on blocks with a story note; coral dot for unsaved drafts. Click a block to select.
- `aria-hidden` with a one-sentence screen-reader summary beside it; the board is the accessible structure. SVG, no dependency.

### 4.5 Highlight bar (story questions, neutral counts)

| Highlight | Matches | Tape on matching cards |
|---|---|---|
| None (default) | — | — |
| Setups & payoffs | scenes that set up or pay off a thread | "↗ sets up n", "↘ pays off n", amber "↗ never paid off" |
| The secret | scenes where the secret is set, kept or out | "◆ set / ◆ kept / ◇ out" |
| Continuity | story continuity notes + live order problems | "⚑ continuity" / "⚠ order" |
| Act shape | act outs, landmarks, act-split notes | "ACT OUT", landmark name, "ACT SPLIT?" |
| Turns (T10.12) | scenes whose charges were read | "Value − → +" (accent); sky "Value holds at +" when the charge doesn't change, stated, never graded |
| Clashes (T10.12) | scenes where two characters' wants collide: both want something there, and one's obstacle names the other or each acts on the other in its beats (derived in `story.ts`, no request) | "Bergstrom vs Skinner" (short names, "+n" for more) |
| Who knows (T10.12) | scenes with dramatic irony or a mystery (`knowledgeModes`) | "Name +n in the dark", or "Audience in the dark" for a mystery (secret tone) |
| Who's in it ▾ | a character's scenes (dialogue cues + recorded wants, labelled as such) | "NAME · wants" |

- Every count means "scenes that match". Import-gap measures ("missing wants", "unconfirmed facts") are not highlights; facts are audited in Ledger.
- Matches get a 2px ring in the highlight's hue plus a tape; non-matches go quiet (flat, no shadow) **at full opacity with AA text** — never dimmed.
- **Fold the rest** collapses runs of non-matches into stubs. **N / Shift+N** jump to the next/previous scene with a story note, or the next match while a highlight is on.

### 4.6 Panel: the scene first (`data-testid="inspector"`, 400px)

**Sticky header:** "← Episode" · "Scene n of N" with ‹ › · title "n · Place" with lock glyph and *unsaved* chip when they apply · jump bar with counts (Notes · Scene · Wants · Touches · Beats · Details) with scroll-spy.

**Top of body:** full slug (Courier) · controls row: **Act** select (combobox name "Act" kept; lists empty acts; immediate PATCH, one snapshot, no AI) · **Lock** switch (`lock-toggle`) · **Open in Write ↗**. Locked: banner "Locked — unlock to edit. Review will never change this scene."

**Notes strip** (renders only when the scene has notes): collapsed ≈70px — "⚑ n notes · m from the import", a two-line peek at the first story note, **Show**. Expanded, note cards:
- **Continuity:** full explanation; "Scene n" references become links that select that scene; fact ids become "a Ledger fact" links; the linked fact is quoted. Verbs: Show beat · Open in Write · Dismiss (with Undo).
- **Act split:** Change the act · Looks right — dismiss.
- **Order (computed, §4.8):** cannot be dismissed; clears when fixed. Go to scene n · Undo the move. A new order problem opens the strip.
- **From the import · n** (collapsed group): plain-language text ("The import couldn't place script lines a–b and kept them in beat n"), never the raw `[model_unassigned]` marker. Open beat in Write · Looks right — dismiss.

**At a glance** (T10.12; `data-testid="at-a-glance"`, renders only when the scene has one of its readings): the scene's answers to the craft checks before any section, read-only and derived with no request — **The turn** (value at stake and charges, the glyphs larger in accent ink, spoken as words), **Why now**, **Clash** (each colliding pair as two stacked "Name wants …" boxes with a "vs" chip between, labelled "From their wants and beats"), **Who knows** (a Dramatic irony / Mystery chip, then ● for who knows and ○ for who is in the dark, with a spoken sentence). The turn and Why now live only here.

**Sections** (native `<details>`, open/closed persisted per viewer):
1. **What the scene does** (steers Next Beat): what happens (15px, marked structural, auto-grow) with today's structural footer (**Open Review** / Save field only / Discard) and an explicit **Suggest…** button for the A4 chips; the landmark callout where the beat sheet marks one; **The audience** — Learns / Feels as a compact grid, each editable in place.
2. **Who wants what (n)** (steers Next Beat): one card per character — Wants · Says (`statedObjective`, italic, only when it differs) · Up against · At stake · **◆ Hidden agenda** chip when `concealed`. "Also in the scene: … · from dialogue cues". No recorded wants → one quiet line. Read-only (editing is later).
3. **What it touches:** threads (↗/↘, summary, "Pays off in n →" or "Never paid off"); the secret as a **dramatic-irony callout** (who is in the dark in this scene; links to where it is set and comes out); **facts established here** — active and pending only, type chip, neutral *Unconfirmed* chip, ◆ hidden-from-audience, Known by, "Show n retired", "Open in Ledger →"; relationship moments.
4. **Beats (n):** the beat ladder — rows show `beat.whatHappens` (not the first script line), ⚑/import marker, lock, landmark tag, "lands" on the last beat; "↷ time jump" dividers from `timelineAnchors`. Expanding a row: learns/feels, **Beat lock** (`beat.locked`, new toggle), Script lock, **Script text** disclosure, Open beat in Write ↗.
5. **Details** (closed by default): Location, Time, Social situation (auto-grow).

Storyline is hidden while `episode.storylines` is empty.

### 4.7 Episode view (nothing selected: Esc or "← Episode")

Title and logline · format line · **Acts, side by side** (≈ share bar, scene count, marked landmarks, act-out scene with learns/feels; footnote "Length is a share of the script text, not pages") · **Threads** (open ones with their setup scene; "See all n in Ledger → Threads") · **The secret** (set · kept in n scenes · out, hidden from, "Highlight on the board") · **Notes** grouped by scene with **From the import** collapsed · **Who's in it** chips that switch the highlight · **Premise** (collapsed, today's structural footer). No tiles, no scores.

### 4.8 Live order check (computed client-side, no AI)

After any reorder or act change, and as a prediction on the drag target before dropping:
- a thread's payoff scene now plays before its setup scene;
- the secret is revealed before it is established;
- the secret is kept after it is out, or kept before it is established.

Each produces an Order note on the affected scenes (not dismissable; clears when fixed), turns the chart arc / secret lane amber, and offers **Undo the move** (shell undo when the move is the head snapshot).

### 4.9 Drafts

Edits persist per scene while browsing: a coral dot on the card and chart block, editor restored on return. Leaving Plan with drafts opens a native `<dialog>` (Stay in Plan / Discard and leave). No blocking guard inside Plan, no silent discard.

### 4.10 Keyboard and accessibility

- The board is **one tab stop** (roving tabindex): ← → previous/next scene, ↑ ↓ card above/below, Home/End, Enter → panel heading, Esc in the panel → back to the card.
- Outside text fields: J/K step · N/Shift+N next/previous note or match · Esc Episode view · ⌘↵ Open in Write.
- Live region announces selection ("Scene n, Place. 1 note.") and highlight changes ("Highlight: Setups and payoffs. 19 scenes match.").
- Visible focus ring everywhere; no text below 11px; identifying text meets AA.

### 4.11 States

- **Locked scene:** lock glyph, not draggable, not a drop target; panel read-only with banner; Act select disabled; beat locks shown as cascaded; Open in Write and notes still work.
- **Idea-born project** (no threads, secret, overview or script): each empty section shows one quiet line; highlights with no data show 0 and do nothing; chart blocks use equal widths; Guided setup gate unchanged.
- **60–70 scenes:** chart fits ~70 blocks; board 6 across at 1440 (5 at 1280); act collapse persisted; Fold the rest + N for triage.
- **2–6 acts + cold open:** frames from `actNumbersForBoard`; narrow chart bands shorten labels.
- **Projects with hundreds of import flags:** the import group stays collapsed; chart shows presence, not counts.

### 4.12 Where every current inspector field goes

| Today | New home |
|---|---|
| Scene lock toggle / LockBanner | Panel controls row (`lock-toggle`) / banner under it; lock glyph on card and chart |
| Location, Time, Social situation | Details (closed); the cleaned place is the card and panel title |
| Act select | Panel controls row (combobox "Act") + drop onto an empty act |
| Storyline (disabled "A") | Hidden while `episode.storylines` is empty |
| What happens / Audience learns / feels | What the scene does (first) |
| Motivations table | Who wants what cards (+ `statedObjective`, `concealed`) |
| Affected facts | What it touches → Facts (status-filtered, "Show n retired") |
| Episode / series premise | Episode view → Premise |
| Beat inspector | Beat ladder row (+ `beat.locked` toggle; Script stays a disclosure) |
| Flag dot | ⚑ chip, beat ticks, chart rule, notes strip with the flag text |
| Story Layers | Episode view, act chevrons, board, chart |

### 4.13 Stable test ids

Kept: `act-frame-{n}`, `scene-card-{id}` (+ `data-locked`), `consistency-flag-badge`, `inspector`, `lock-toggle`, combobox "Act", `mode-switcher`. `beat-card-{id}` moves to the beat row in the panel (`plan.spec.ts` updates to select the scene first). `story-layers-panel` is removed in Phase 2. The lock-and-regenerate recipe (`scene-card-scene-3`, `lock-toggle`) is unchanged.

## 5. What is cut or moved

- Import-gap counts and any dashboard tiles, scores or grades: not in Plan.
- Page counts, minutes and "runs short" verdicts: never; only a relative "≈ n% of the script".
- Dimming non-matches: replaced by rings + quiet cards at full contrast.
- Storyline UI: hidden (decision 4).
- Beat cards on the board: moved to the panel's beat ladder.
- Threads, Structure and Overview stay in Ledger (owner decision 2026-10-11); Plan surfaces them in context and links out.
- The beat Script textarea stays as a disclosure. Write now saves its own edits (T2.5), so removing it from Plan is a later, separate call.

## 6. Constraints (CLAUDE.md)

- **No contract change, no new endpoint, no new LLM operation, no PROMPT_VERSION bump in Phases 1–3.** All derivations are pure client functions in one module, `apps/web/src/plan/story.ts` (flag kind, order issues, highlight matchers, script share, cast, note text), unit-tested.
- **Rule 2 (locks):** insert reorder (Phase 4) refuses client-side any move that would shift a locked scene, keeps the server's 409 `LOCKED_OBJECT` as the backstop, and lands its lock-violation test before the feature. "Draft a fix in Review…" goes through the existing Change Set path (which routes through the lock filter), is hidden on locked scenes, and also lands a lock-violation test first.
- **Rule 4:** every edit stays a single direct-edit PATCH that snapshots once; Undo the move uses the shell's undo.
- **Rule 6 (tokens):** one new token, `--tr-panel-plan: 400px` (owner-approved). `--tr-panel-inspector` stays (the import board's reading panel uses it). `--tr-panel-story-layers` and `--tr-card-scene` become unused after Phase 2 and are removed then. No other new tokens, no hex outside `:root`.
- **Rule 8 / quiet AI:** nothing in Plan calls a model without an explicit, verb-labelled click (decision 5).
- **Heuristics are labelled:** cast from dialogue cues is always marked "from dialogue cues"; the flag-kind text match carries a `ponytail:` note until a `flag.kind` field exists.
- **No new dependencies.**

## 7. Phases (one build-plan task per PR)

**Phase 1 — Panel first (T3.3, T3.4).** The direct fix for "the useful stuff gets lost".
- T3.3 Panel restructure: fixed-height layout with independent scrolling; 400px panel; sticky header with jump bar and scroll-spy; notes strip; sections in the new order with persisted `<details>`; auto-grow fields; Who wants what cards; What it touches (threads, secret callout, status-filtered facts, retired toggle); beat ladder with `beat.locked` toggle and Script disclosure; Suggest… button replaces chips-on-focus. Story Layers stays for now.
- T3.4 Notes and drafts: flag text with linkified scene/fact references, quoted Ledger fact, Dismiss with Undo (`dismissConsistencyFlag`), the flag-kind helper and "From the import" group; per-scene drafts, unsaved dot and the leave-Plan dialog.

**Phase 2 — The board (T3.5, T3.6).**
- T3.5 Index cards and act headers: the import-board card in Plan, act headers with share bar, set-up/paid-off counts, landmark chips and act-split notes, empty-act drop target, roving tabindex, focus ring, live region.
- T3.6 Highlights, Episode view and Story Layers retirement: the highlight bar with rings/tapes and Who's in it, Fold the rest, N/Shift+N, the Episode view as the nothing-selected state, removal of Story Layers and its tokens, e2e and recipe updates.

**Phase 3 — Shape and order (T3.7).** The sticky episode chart (SVG) and the live order check with drag prediction, "Undo the move", visible drop targets and "Locked — can't swap".

**Phase 4 — Owner-approved additions (T3.8, T3.9).**
- T3.8 Insert reorder with ⌥←/⌥→ — lock-violation test first; confirm the patch applier accepts multiple `/index` replaces in one PATCH.
- T3.9 "Draft a fix in Review…" on continuity notes (owner decision 2026-10-14: act-split and Order notes keep their own verbs) — existing Change Set path, hidden on locked scenes, lock-violation test first.

**Not scheduled:** Read mode (linear outline), `flag.kind` contract field, motivation editing, storyline tagging, scene turn field, a Plan entry point for the paid structure check.

## 8. Testing

- Unit (Vitest): `story.ts` — flag kind, linkify, order issues (all three cases, including drag prediction), highlight matchers and counts, script share, cast helper noise filtering; facts status filter; draft persistence; roving tabindex; highlight announcements.
- Component: panel section order and jump bar; notes strip collapsed/expanded and Dismiss with Undo; locked scene read-only; Suggest… makes no request until clicked; Episode view; empty act drop target.
- E2E: `plan.spec.ts` updated (select a scene, find beat rows in the panel, motivations, facts, lock banner, Act combobox); the lock-and-regenerate recipe unchanged; new: highlight + N, order check after an act change with Undo the move; Phase 4 lock-violation tests before their features.
- Docs per PR: UI spec §5 rewritten to this design (Phase 1 updates the inspector part, Phase 2 the board and Story Layers), build-plan T3.3–T3.9, test-plan entries, handoff decision-log row.

## 9. Open items to track

- Scene "turn" field (design doc promise; `Scene` has no field) — proxies for now.
- Flag kind encoded in text — `flag.kind` contract field later.
- Motivations/characters not editable anywhere — later task.
- App shell contrast (pre-existing: muted shell actions ~2.8:1) — separate fix.
