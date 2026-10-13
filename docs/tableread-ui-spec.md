# Table Read UI Spec (MVP)

Implements design doc §4. Light theme only in MVP (dark is v2, but every color goes through a token — no hardcoded hex in components).

## 1. Design tokens

Quiet Tool visual language: cool paper neutrals, slate-blue accent (`--tr-coral*` names retained), Instrument Sans for UI and display type.

```css
:root {
  /* Surfaces — cool paper */
  --tr-surface-page: #f6f6f3; /* app background, Write mode page area */
  --tr-surface-raised: #ffffff; /* cards, script canvas sheet */
  --tr-surface-sunken: #f0f0ec; /* panels, rails, command bar */
  --tr-surface-clay: #ebebe6; /* frames on Plan canvas, hover fills */
  --tr-border: #e8e8e2;
  --tr-border-strong: #d9d9d2;

  /* Text — charcoal, never pure black */
  --tr-text-primary: #26272b;
  --tr-text-secondary: #84857d;
  --tr-text-muted: #9a9b92;

  /* Primary action — slate-blue (--tr-coral* names retained) */
  --tr-coral: #5b79a6;
  --tr-coral-hover: #4a6690;
  --tr-coral-soft: #dee5ee; /* selected/active tints */
  --tr-accent-ink: #33445e; /* text on soft accent fill (selected pills) */

  /* Status hues */
  --tr-sage: #7d9678; /* confirmed, high-confidence, success */
  --tr-sage-soft: #e7eee4;
  --tr-sky: #41608a; /* informational, links, setup/payoff connectors */
  --tr-sky-soft: #e4ebf2;
  --tr-amber: #8a6120; /* needs review, speculative, pending */
  --tr-amber-soft: #fbf4e6;
  --tr-danger: #b0503c; /* destructive, errors only — not for AI content */

  /* Type */
  --tr-font-ui: 'Instrument Sans', system-ui, sans-serif;
  --tr-font-script: 'Courier Prime', 'Courier New', monospace; /* teleplay */
  --tr-font-display:
    'Instrument Sans', system-ui, sans-serif; /* headings, mode titles */
  --tr-font-ledger-display:
    'Newsreader', 'Instrument Sans', Georgia, serif; /* Ledger story-bible titles */

  /* Write redesign (T2.4 script home) — toned desk, paper sheet, slugline dots */
  --tr-write-desk: #f1eeea; /* surface behind the script sheet */
  --tr-write-panel: #f7f5f2; /* ON THE PAGE outline rail */
  --tr-write-selected: #e6ebf5; /* active scene row in the outline */
  --tr-write-dot-int: #6f93d6; /* INT. slugline marker */
  --tr-write-dot-ext: #4fa877; /* EXT. slugline marker */
  --tr-write-dot-other: #c4c0b8; /* neither INT. nor EXT. */

  /* Ledger redesign — story-bible surfaces + secret/concealment accents */
  --tr-ledger-content: #f3f1ee;
  --tr-ledger-selected: #e8e4df;
  --tr-ledger-secret-surface: #f8f2e8; /* secret card fill */
  --tr-ledger-secret-border: #e9dcc6;
  --tr-ledger-secret-badge: #f0e2c8;
  --tr-ledger-secret-ink: #9a6b2f;

  /* Overview panel accents */
  --tr-overview-expand-bg: #f6f4f1;
  --tr-overview-icon-bg: #e6ebf5;
  --tr-overview-ready-bg: #e8f5ec;
  --tr-overview-ready-ink: #3d8a5a;

  /* Import board (§2a "Breaking the Board") — index-card paper, rules, card shadows, motion, card sizes */
  --tr-board-paper: #fffefb; /* index card and tape paper */
  --tr-board-rule: rgb(65 96 138 / 0.1); /* card rules */
  /* card header rule, cast underline */
  --tr-board-rule-top: rgb(91 121 166 / 0.55);
  --tr-shadow-card-board:
    0 1px 1px rgb(38 39 43 / 0.05), 0 3px 8px rgb(38 39 43 / 0.06);
  --tr-shadow-card-lift:
    0 2px 4px rgb(38 39 43 / 0.06), 0 16px 32px rgb(38 39 43 / 0.16);
  --tr-motion-spring: cubic-bezier(0.34, 1.42, 0.64, 1);
  --tr-motion-settle: cubic-bezier(0.2, 0, 0, 1);
  --tr-motion-deal: 620ms; /* cards out of the deck; stagger min(28ms, 600ms / N) */
  --tr-motion-flight: 760ms; /* act-break FLIP */
  --tr-motion-string: 700ms; /* setup→payoff string draw */
  --tr-card-board-w: 150px; /* one size for every script: the reading must stay readable */
  --tr-card-board-h: 106px;

  /* Scale: 11/12/13/15/17/22/28, plus 30 for Ledger display titles. 11px = secondary chrome; script canvas 12pt Courier. */
  /* Spacing: 4-base — 4/8/12/16/24/32/48/64. Generous: default section pad 24. */
  /* Radius: cards 12px, chips 999px, canvas frames 12px, controls 9px, Ledger cards 15px. */
  /* Shadow: 0 1px 2px rgb(38 39 43 / 0.04), lift: 0 4px 16px rgb(38 39 43 / 0.08) */
  /* Write/Ledger elevation: --tr-shadow-write-page/-card/-bar/-cta, --tr-shadow-ledger-card, --tr-shadow-overview-card. */
  /* Motion: 160ms ease-out standard; streaming text has no animation. */
  /* Layout: --tr-script-col 600px; --tr-panel-candidate-dock 392px (CO-WRITER dock, §3); --tr-panel-write-outline 296px; --tr-command-bar 560px; --tr-script-page 680px; Plan panels 232/296/214px; Ledger CAST rail 236px (--tr-panel-ledger-filters); shell 56px (§2). */
}
```

**Dark theme (v2, reserve tokens now):** page `#211D1A` (warm near-black), raised `#2A2522` (espresso), sunken/panels `#332B24` (deep clay), text `#F3EDE3` (ivory); coral/sage/sky/amber shift ~10% desaturated, soft variants become translucent overlays. Warm dark, not tech-noir.

**Status hue semantics (consistent everywhere):** sage = confirmed/high-confidence · sky = informational/relational · amber = pending/speculative/needs-review · coral (`--tr-coral*`) = the one primary action per surface (slate-blue values). No purple "AI" gradients, no sparkle icons; AI-origin content is marked by a small `~` glyph chip in `--tr-text-muted`.

## 2. Dashboard / Story Launcher

`/projects` is the app home. `/` redirects to `/projects`. The dashboard uses a Quiet Tool top bar with the Table Read wordmark on the left and a `--tr-coral` `+ New project` pill on the right, plus Settings and user/avatar affordances. The current Task 1 shell links `+ New project` and the launcher cards to the future wizard routes (`/projects/new/idea`, `/projects/new/import`).

Centered content: eyebrow **BEGIN**, heading **What are we writing?**, subcopy **Shape a new idea, or bring in a script you already have.**, two launcher cards (**Start from an idea**, **Import a script**), then **Continue writing** with lightweight title search.

Recent projects show at most five `ProjectSummary` rows ordered by server `updatedAt` descending. Each row displays title, format metadata (genre, runtime, act count), actionable status, relative last-edited time, and an overflow menu. Status priority is:

1. `N facts to review` when `pendingReviewCount > 0`.
2. `Continue setup` when `setupState === "incomplete"`.
3. `Ready to write` otherwise.

The row overflow menu contains **Rename**, **Export Fountain**, and **Permanently delete** (design doc §4.2a). Rename edits the title via `PATCH /projects/{pid}` (`/title`); Export Fountain downloads `GET /projects/{pid}/export.fountain`. **Permanently delete** opens a confirmation modal that requires typing the project's **exact title** before the destructive button enables, then calls the canonical full-purge `DELETE /projects/{pid}`. There is no Trash/archive: the copy says so, and deletion cannot be undone. A failed purge leaves the row visible and reports the error (design spec §11); on success the row disappears from the list.

States: loading skeleton matching the list geometry; empty state preserving both creation cards; populated list; no-search-results message with Clear search; API error with Retry. The dashboard never substitutes seeded fixture data on error.

## 2a. New project wizard

Both creation paths (`/projects/new/idea`, `/projects/new/import`) share `WizardShell`: visible step labels, Back/Continue/Cancel, the quiet trust note under the step body, browser-local drafts (`tr.wizard.v1.*`), and focus-first-invalid on a blocked Continue.

**Import a script** (design doc §7) is the one wizard path with an explicit product exception to "review before AI-authored structural mutation": the writer's only trigger is the last step's **Create & analyze script** button, and once pressed the deterministic/verbatim scene split plus model-proposed beat and act boundaries persist atomically — reviewable afterward in Plan/Ledger/Undo, never before.

1. **Add the script** — Upload (`.fountain`/`.txt`/`.pdf`, filename + detected format shown) / Paste tabs. Selecting or pasting Fountain/text never uploads or analyzes it. Selecting a PDF uploads only to the non-LLM extract endpoint (`POST /projects/import/extract-pdf`) and fills editable text, with Continue disabled until extraction finishes; an unsupported extension or empty file fails locally with plain-language guidance.
2. **Check & start** (owner decision 2026-10-11: two steps, not five) — one screen holding everything the writer confirms before the only AI trigger:
   - **Title**, prefilled from the filename when uploaded, editable.
   - **No format question** (owner decision 2026-10-11): the import works the format out from the script in its act stage — the printed act breaks decide the act count and cold open, and the model reads the genre, runtime, tag and serialization (data contract §4 import step 2). The request carries no `format`.
   - The source line: filename (or "Pasted text") · `N scene(s) detected · ~(2N+⌈N/10⌉+4) model calls · Est. $low–$high`. The detected-scene count is informational (the server's own split is authoritative). The nominal total is import_worker (Sonnet) calls `N+⌈N/10⌉` (segment per scene + entity chunks), import_analyst (Opus) calls `3` (acts + promises + overview) and classifier (Haiku) calls `N+1` (extract per scene + consistency scan); repair retries may add calls. The cost uses per-call token figures measured on real imports, written down in `importCostEstimate.ts` (the cached script prefix is written once per cached stage and read by every call at the cache-read rate), with rates from `config/llm_pricing.json`; the range is −15%/+35% around that point estimate (about $2.20–$3.50 for a 68-scene, ~37k-character script, which cost ~$2.64). Narrative Map is an explicit saved-project action, so it is not included in the estimate and a timeout cannot undo the import. Actual usage may vary.
   - **Review the script text**, a disclosure holding the editable source (pasted text, locally read Fountain/text, or server-extracted PDF text). PDF results show a muted method badge (`Text layer` / `OCR`) in the disclosure's summary, plus page count and warning codes; the writer fixes OCR mistakes here before analysis.
   - A line stating that **Create & analyze script** (the step's final action) is the only action that sends the script to the model.

   Once analysis starts, the form gives way to the **import board** ("Breaking the Board", spec `docs/superpowers/specs/2026-10-12-import-board-design.md`, prototype `docs/superpowers/prototypes/2026-10-12-breaking-the-board.html`); it is not shown before then, because a board of unread cards read as a stuck import. It replaces the old stage list. **Live results (owner decision 2026-10-12, amending "ordered source results only after the terminal success"):** the board builds from the stream's `found` frames (data contract §9.3) while the import runs:
   - A headline narrates each step (Newsreader 40, cross-fading); a nine-step spine says each step's status in words (done / in progress / waiting / **Stopped**); elapsed time sits top right with "typically about N–M min left" (per-scene priors for every step, the current single-call step's run time taken off its prior, a resume's cached burst ignored, hidden after 30 s with no news; every stage start and progress frame is news, and a single-call step's news is due by the high end of its usual time). While the import runs and holds its finale, the wizard column widens from 768px to 1280px (the prototype's), so a 120-scene board stays within about two screens; the form's steps and a failed import keep the narrow column.
   - Before the server's split, the headline reads "About N scenes found in your pages" (the client slugline count) with "Usually X–Y minutes for a script this size. Keep this tab open." The parse deals one index card per scene into an **In script order** frame (number, INT/EXT dot, slugline, "Not read yet", slightly tilted).
   - Cards fill out of order as scenes are read: `~ <reading>`, one pencil tick per beat, squared up; the newest lifts and a soft lamp glides to it. A scene the model couldn't break turns amber: "Couldn't break into beats. Kept whole; flagged for you."
   - Single-call steps (acts, threads, logline, continuity, saving) are indeterminate: a step clock ("0:08 on this step · usually 10–20 s") and a thin sweep, never a fraction. When the acts land the cards fly into clay act frames with masking-tape labels and the Format card fills; then the cast (Polaroids, "Cast · N speaking parts"), numbered pins and sagging strings from setup to payoff with the threads listed (Paid off / Open / Dropped), the logline (faded in whole), a fact stamp per card (◆ when a fact is hidden from the audience) and, last, amber chips for contradictions and tensions. Model-written text carries `~`.
   - Every card is focusable and shows its reading in the rail's Notes; the act break keeps a focused card focused (the cards stay one list, the act frames are drawn behind them). Above 40 scenes cards go compact (number, slug, ticks). Frames that arrive more than 8 to an animation frame, or cached (a resume), land without motion; reduced motion turns off tilt, flight, lamp, count-up and sweep. `aria-live="polite"` announces stage starts, the act result and every 10th scene.
   - Copy is honest about leaving: "Keep this tab open. Leaving pauses the import; finished work is saved."

   On the terminal `complete`, the draft clears and the board reconciles once against the payload, then **holds** (owner decision 2026-10-12): "The board is up." with a one-line summary, **Open your story** (focused; saves the Ledger **Story** view and lands there — story overview, Narrative Map card, the review queue — owner decision 2026-10-11) and **See it in Plan**. Nothing navigates on its own. On `failed`, nothing was created: the board freezes where it got to and the step reads **Stopped** (its sweep and clock stop), the form returns with the draft (source + basics) intact, and the step offers **Retry** (continues from saved work; elapsed keeps counting in the same page), **Edit source** (opens and focuses the script text in place), and **Return to dashboard**. PDF reaches this endpoint as the writer-confirmed `format: "text"` source.

## 3. App shell

Top bar (56px, `--tr-shell-height`, `--tr-surface-raised`, bottom border): project title (mono / script font, 14px / 500) · mode tabs (**Write · Plan · Review · Ledger** — freestanding `<button role="tab">` pills; **active = soft `--tr-ledger-selected`** so coral stays for primary actions) · undo (with history ▾) · export · settings. Interactive chrome must be real buttons with focus-visible outlines and `aria-selected` / `aria-pressed` — never `div`/`span` click handlers. **Undo** reverts one step (`POST /undo`). The adjacent history control opens a dropdown of up to ~20 ancestor snapshots (`GET /snapshots`: instruction + relative time); choosing an entry restores that ancestor (`POST /restore`) and reloads — multi-step undo without a full branching UI (adoption A5). Review segment shows an amber dot when a draft Change Set exists. Ledger segment shows amber count badge when the review queue is non-empty. Keyboard: `⌘1–4` switch modes. Settings opens a privacy panel stating writing is not used for training (prompt spec §8); do not claim ZDR in product copy. When a project is loaded, Settings also offers **Export project JSON** (`GET /projects/{pid}/export.json` — adoption A6), downloading the full persisted-state envelope (distinct from the top-bar Fountain export), and a **Craft level** default (`fast` / `standard` / `considered`) on `Project.defaultCraftLevel` (adoption A3). Write candidate dock and Change Set preview share that default and can override per request.

## 4. Write mode

Layout (T2.4 script home / Write redesign handoff): left **ON THE PAGE** scene outline (296px, `--tr-panel-write-outline`, `--tr-write-panel`) · center **continuous episode script** on a toned desk (`--tr-write-desk`) · right **CO-WRITER** dock (392px, `--tr-panel-candidate-dock`) · floating command bar anchored to the **editor column** (560px, `--tr-command-bar`, bottom 26px — not viewport-centered). Script sheet: max-width 680px (`--tr-script-page`), page padding ~64×76, `--tr-shadow-write-page`. Structure edits stay in Plan; the outline is navigate-only.

- **Scene outline:** `Scenes · {n}`; each row = index + slug (location/time) + one-line whatHappens clamp. Active row uses coral-soft / accent ink (same selection language as Plan scene cards). Click sets the **active scene**, updates `?scene=`, saves resume, and scrolls that scene into view. Scroll spy (while not typing in a beat) keeps the outline in sync with the topmost visible scene.
- **Script canvas:** Fountain rendered in `--tr-font-script` with teleplay indents (scene headings/action full-width; character ~22ch; dialogue ~10ch / 35ch measure; parentheticals ~16ch; transitions right-aligned). Lone PDF element labels (`ACTION`, etc.) are ignored. Click a beat to edit as plain Fountain text; blur returns to the formatted view. Locked beats stay formatted and non-editable. **All episode scenes are stacked** in document order inside one raised sheet; each scene has an in-flow header (slug + `whatHappens` in solid primary — never muted ghost copy) and its beats. Beats separated by faint 1px `--tr-border` rules with beat labels in the left gutter (11px, muted, visible on hover only). **Planned-but-unwritten beats** (empty `scriptText`, non-empty `whatHappens` — typical after scene-skeleton apply) show a **Beat plan** block in solid 15px primary (plus audience learns/feels when present) above an editable script area; the sheet must not look blank. **Direct typing is allowed only in unlocked ranges**: beats with `locked` or `scriptLocked` render read-only (lock glyph in the gutter; caret placement inside shows a brief "Locked — click the lock to edit" hint), while the insertion points immediately before and after a locked beat remain writable — you can write around locked material, never inside it. Unlocking is a one-click writer action on the gutter glyph (locks bind the AI _and_ casual edits; they are the writer's own pins, so undoing one is deliberate, not accidental). This mirrors the data-contract guarantee: no mutation path, human or machine, writes into a locked range while the lock holds. Focus/caret inside a beat sets the active scene (wins over scroll spy).
- **Active scene:** drives Suggest next beat, command-bar generate, and Accept insert. Changing active scene resets an in-flight candidate session. Deep links (`?scene=`, Ledger `highlightBeat`) set active scene and scroll/highlight the target.
- **Outline rows:** scene index (mono) · INT/EXT type dot (`--tr-write-dot-*`) · slug (semibold) · preview line. Selected: `--tr-write-selected` + coral left accent.
- **Candidate cards:** stacked in CO-WRITER dock. Card = Beat N chip + craft context · Newsreader title (label) · description · script preview (Courier, fade) · **Accept** (coral + ↵ keycap) · **Tune** (outline) · **Skip** (text, right-aligned). Streaming: token-by-token, no spinner-only. **Suggest next beat** full-width CTA with `Q` keycap. Dock header: **CO-WRITER** + craft segmented control (Fast draft / Standard / Considered — A3).
- **Command bar:** raised bar over the editor column; placeholder _"Whisper the next move…"_; keycaps `/` · `W`; submit **Write it**. Not a chat. Empty-focus chips insert text only (A4).
- **Keyboard (adoption A8):** `Q` Suggest next beat · `W`/`/` focus command bar · `[` / `]` previous/next scene · `1`/`2`/`3` select candidate · `Tab`/`Shift-Tab` cycle cards · `Enter` accept focused card · `Esc` dismiss dock. All disabled while the script canvas has focus (AI-quiet) or while typing in a text field.
- **Quiet AI rule (enforced):** while the script canvas has focus and the writer is typing, the dock dims to 40% opacity and never updates; no proactive generation ever.

**States:** _Empty scene_ (no beats) — scene slug + pitch when present, clear "No beats in this scene yet" copy, single coral **Next Beat** in the dock. _Planned beats, no script yet_ — solid beat-plan copy on the sheet (see above). _Streaming_ — cards fill sequentially; command bar disabled with subtle progress shimmer on the dock border. _Error_ — dock card with `--tr-danger` left border, message + Retry; script canvas untouched. _Continuity conflict on a candidate_ — amber callout "May conflict with the Ledger" with a short cleaned explanation (no raw `fact-…` ids or `audienceKnows` jargon) and a clear **I understand — unlock Accept** control; Accept stays disabled until that acknowledgment. After acknowledge, copy confirms Accept is unlocked and points to Tune if they want to resolve first.

## 5. Plan mode (MVP: simplified board)

Layout: left Story Layers panel (232px, sunken) · center board (page surface, pannable, not yet infinite/zoomable) · right inspector (296px, raised).

- **Story Layers panel:** tree — Bible (premise, characters, theme) / Episode / Acts / Scenes. Selecting focuses the board; eye toggles collapse acts. MVP has no free placement — the "canvas" is a structured board whose grammar (frames, cards, selection, inspector) upgrades to the real canvas in v2 without relearning.
- **Acts as frames:** horizontal bands in `--tr-surface-clay` with act labels ("COLD OPEN", "ACT ONE"…) in display font.
- **Scene cards** (raised, 12px radius, 214px): index + location (13px strong) · whatHappens (2-line clamp) · chips: storyline letter (v2, hidden), beat count, lock. Selected = `--tr-coral-soft` fill with accent ink. Drag to reorder within/between acts; drop targets highlight clay. Expand (⌥click or chevron) reveals **beat cards** nested (sunken, script-font first line of scriptText). **Double-click** opens Write mode on that scene (`/?project=…&scene=…`) — single-click still only selects for the inspector.
- **Connector lines:** v2. Reserve a toggle row in the panel footer, disabled with tooltip "Setup/payoff threads — v2".
- **Inspector (right):** for selected scene — location, time, socialSituation, an editable **Act** selector, storyline (disabled, v2), whatHappens, audienceLearns, audienceFeels; motivations table (character / objective / stakes / obstacle); **Affected facts** list (ledger facts whose sourceSpan is this scene — click → Ledger mode); **lock toggle** as a pill switch (accent when locked; locks children, per data contract). The Act selector lists exactly the project's format-valid labels (`COLD OPEN` plus numbered acts when `coldOpen` is true; numbered acts beginning at `ACT ONE` otherwise), including empty destination acts that have no drag target. It is disabled for effectively locked scenes/episodes and while a save is pending. A change uses the normal optimistic scene-field PATCH, moves the card to the selected act frame, persists after reload, and rolls back on failure; it creates one snapshot and no LLM or consistency call. For selected beat — beat fields + scriptLocked toggle. Premise-level field edits show footer bar: _"Structural change — review impact?"_ → **Open Review** (coral) / _Save field only_ (text). **Save field only** means exactly that: the field is written as a direct PATCH with **no regeneration of anything else** — but the post-save consistency scan still runs (the flagging promise holds even when the writer skips Review), so any contradictions it creates surface as amber flags rather than silently persisting.

**States:** _Nothing selected_ — inspector shows episode summary + premise. _Drag_ — card lifts (shadow token), siblings gap-animate. _Locked selection_ — inspector fields read-only with lock banner "Locked — unlock to edit".

### 5a. Guided Plan setup

Shown on Plan instead of the (otherwise empty) board while `setupState: "incomplete"` (no scene contains a beat yet — new-project-flow design spec §6/§9.4). Centered card: eyebrow "Guided Plan setup" · heading "Let's open your first episode." · a compact foundation strip (premise / characters / theme when present) · one explicit, verb-labelled **Generate scene skeleton** button (never auto-triggered — CLAUDE.md rule 8) with a one-line description of what will be sent and what comes back, plus **Skip for now** and the trust note.

- **Generating:** button becomes "Generating…", disabled; no partial results render.
- **Three candidates** render side by side (the product-wide convergent loop): each a raised card with a label, scene-count chip (`1 scene` / `N scenes`), and its proposed scenes as a compact list — location (+ time when useful), what happens, who (motivation character names), audience learns/feels, and beat-plan seeds when present (plan text only — no scriptText). Each card ends in a **Choose this** button.
- **Choosing:** creates the `initial_scene_skeleton` Change Set and hands off to Review mode (§6) — the AI proposal never writes the plan directly. Review uses the eyebrow **Review proposed scenes**, labels each add-row with the scene heading (not the raw `proposalId`), shows a **New scene** chip instead of Before→After, and expands into the full scene summary from `preview.sceneAdditions`. **Preview selected** is hidden for this Change Set kind (the chosen candidate already is the preview).
- **Skip:** local dismiss of Guided setup so the writer can build by hand; no server write.
- **Error:** inline danger text below the generator/candidates, local inputs preserved; the writer may retry or leave the panel to build manually.

## 6. Review mode

Entered via mode switcher (lists draft Change Sets) or directly from Plan/Write triggers. One Change Set at a time.

Layout: quiet full-mode Review surface — compact header card with small instruction label, quoted instruction, target object chip, status chip, and (for regenerate Change Sets) a **Craft level** segmented control used by Preview (adoption A3). Below: impacted-object rows, full width. The open Change Sets picker uses raised white cards with hairline borders and hover accent borders.

- **Row anatomy:** checkbox (regenerate rows only) · object icon+id (scene/beat/character/fact) · reason (12.5–13px secondary) · compact before→after summary chips when collapsed · confidence chip (sage "direct" / amber "speculative") · continuity flags (amber chips, clickable → Ledger) · disclosure chevron.
- **Locked rows:** no checkbox — lock glyph; entire row at 55% opacity, tooltip "Locked — the AI could not touch this". They are shown, never hidden (seeing what was protected builds trust).
- **Flag-only rows** (`applyMode: "flag_only"` — characters and ledger facts): no checkbox — sky info glyph instead; tooltip "Affected, but not changed by this apply — review it yourself"; row links to the object in Plan/Ledger mode. Never included in the selected count.
- **Expanded row:** before/after panes side-by-side. Plan fields as word-level diff (del = strikethrough muted, ins = sage underline); scriptText as script-font block diff. Before preview exists, `after` pane shows "Preview to generate" ghost.
- **Footer bar (sticky):** count "4 of 6 selected" · **Preview selected** (outlined accent) → fills `after` panes · **Apply selected** (solid accent, disabled until previewed) · **Flag only** (text) · **Discard** (text, muted) · reassurance copy "Nothing changes until you confirm." · **Create branch** (disabled, tooltip "v2"). Comments affordance: each row reserves a 24px right-margin slot rendering nothing in MVP (v2: comment bubble).

**States:** _Classifying_ — skeleton rows + "Mapping impact…" (boring, factual). _Previewing_ — per-row shimmer on `after` pane only. _Applied_ — rows collapse to sage check summary + "Undo all" (one snapshot revert), followed by a **post-apply consistency section**: any `scan_consistency` flags render as amber rows ("Scene 5 still stages the argument around the bar's finances") with actions _Open Change Set_ / _Go to scene_ / _Dismiss_ — never auto-fixed. _409 lock conflict_ — danger toast "A locked element was included — nothing was changed", selection preserved. Open consistency flags also badge the affected scene cards in Plan mode (small amber dot).

## 7. Ledger mode

Ledger is a **story bible** — writers open it to understand what is true in the story world. Two swappable views share the same filters, review queue, and mutation paths. Visual language: **Editorial Quiet Tool** (cool paper, slate-blue accent, soft ambient shadows) elevated toward the Ledger redesign handoff (CAST rail + Atlas card grid); see `docs/superpowers/specs/2026-07-17-ledger-creative-polish-design.md` and the design handoff _Story Ledger Redesign_.

| View                      | Job                                                                        |
| ------------------------- | -------------------------------------------------------------------------- |
| **Story Atlas** (default) | Scannable two-column fact **card grid** (owner, secret treatment, knowers) |
| **Knowledge Web**         | Character- or Audience-focused who-knows-what (ranked list + detail)       |
| **Structure**             | The script against one story structure, stage by stage (§7a-ter)           |

Layout: left **CAST rail** (236px, `--tr-panel-ledger-filters`, raised) · main column on `--tr-ledger-content` (max-width 1040px, centered) with page header · **story overview card** · review queue (when non-empty) · active view body.

### 7a. Page chrome

- **Title:** Ledger display font — "What's true in this story" (`font-ledger-display` / Newsreader, 30px / 500) with a one-line secondary subtitle. Default: “Your story bible — browse truths, or focus who knows what.” When a CAST person is selected: “Showing what {name} knows, and facts they appear in.”
- **Secrets only:** pill toggle (`◆ Secrets only`) — filters to `audienceKnows === false`. Off: raised + border; on: secret badge fill/ink (`--tr-ledger-secret-*`). Combines with CAST / Status / As-of (AND).
- **View switcher:** segmented control **Story · Atlas · Web · Threads · Structure** in the header (`LedgerViewSwitcher`); clay track, active segment `--tr-coral-soft` + `--tr-accent-ink` + `--tr-shadow-raised`. Choice persists per project in `localStorage` (`tr.ledger.view.{projectId}`).
- **Threads:** header text link (not in the CAST rail); shows `(n)` when count > 0. Story overview is **not** a header button — see §7a-bis.
- **Pending chip:** amber-soft when `pending_review` count > 0 ("N to review"); click scrolls to / focuses the review queue; focus-visible uses `--tr-outline-selected` + `--tr-coral`.
- **Motion:** Atlas ↔ Web body uses a brief fade/rise enter (`.tr-ledger-view-enter`, `--tr-motion-duration-standard` / `--tr-motion-ease-standard`; disabled under `prefers-reduced-motion`).

### 7a-bis. Story overview card

Persistent card between the page header and the review queue / fact grid (`StoryOverviewCard`). Replaces the old underlined logline teaser and Overview modal entry.

- **Collapsed (default):** icon tile · “STORY OVERVIEW” · ● ready / ● not yet · meta chips (scenes / threads / facts) · logline always visible (Newsreader ~19px) · “Read summary & outline” expander when overview exists.
- **Expanded:** sunken band with two columns — **Summary** paragraphs · **Outline** scrollable scene rows (number · summary · slug · →). Row click jumps to that scene in Write. Optional **Beat sheet** disclosure below (same jump semantics as before).
- **Empty:** “Import a script to generate a story overview.”

### 7a-ter. Structure tab

The **Structure** view (`StructurePanel`, after Threads) checks the script against one story structure and lists every stage. Spec: `docs/superpowers/specs/2026-10-11-structure-checklist-design.md`.

- **Picker:** `Check against` select — **TV act structure** (default) · **Hero's Journey** · **Story Circle** · **Save the Cat**. Remembered per viewer and project in `localStorage` (`tr.ledger.structure.{projectId}`); never a doc mutation.
- **Header:** 11px "Structure" legend · structure name (display 22px) · summary line ("3 of 8 stages hit · 3 thin · 2 missing", plus "· N couldn't verify" when any). An applied AI check adds its one-line rationale, muted.
- **Timeline strip:** one tick per cited stage, placed by the cited scene's position and grouped by act.
- **Stage list,** in the structure's canonical order. Each row: stage name · status `Chip` with a text label — **Hit** (sage) · **Thin** (amber) · **Missing** (neutral) · **Couldn't verify** (sky) · one-line reason · for cited stages, the evidence line quoted from the beat (italic, muted; omitted when the beat has no text). A row with a beat is a whole-row button (`structure-row-{stage}`) that opens Write at that beat (`/?project=…&scene=…&highlightBeat=…`).
- **TV act structure** needs no AI and no button: it reads the import beat sheet's labels (Cold Open/Teaser when `format.coldOpen`; Act N Turn and Act N Out, the last act Out only; Climax; Tag when `format.tag`). Missing labels render **Missing**; with no beat sheet every stage is Missing. With no format the panel says "The show format isn't known yet."
- **States (AI structures):**
  - _Not run:_ **Check structure** (coral) with "About 25¢, under a minute." Nothing runs on mount or in Write (rule 8).
  - _Checking:_ button disabled, label "Checking…".
  - _Error:_ danger line (`role="alert"`). A 409 `CONFLICT_STALE_HEAD` reads "The script changed while checking. Reload and try again."
  - _Doesn't fit:_ clay box — "{Structure} doesn't fit this script." · the model's rationale · **Check TV act structure instead** (switches the picker).
  - _Stale:_ amber-soft line "The script changed since this check." with **Check again**, which replaces that structure's saved check. Shown when the browser's fingerprint of scene/beat ids plus `scriptText` differs from the check's `sourceHash`.

### 7b. CAST filter rail (shared filters)

Same `LedgerFilters` model (`status`, `characterId`, `factType`, `secretsOnly`); writer-facing labels only. CAST-first (Ledger redesign):

| Control    | Options / chrome                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cast**   | Legend + **Manage** link. Search input filters people live (case-insensitive substring). **All facts** row (✦ glyph + total count). People rows: 24px circular initials avatar (stable per-name oklch hue), name, count pill; sorted by fact count descending. Show top 10; **Show all N** / **Show fewer** when not searching. Selected row uses `--tr-ledger-selected`. Also sets Knowledge Web focus when Web is active. |
| **Status** | Collapsed by default when All; summary shows pending “N to review” in amber. Expand for All · Needs review · Active · Superseded · Stale · Rejected                                                                                                                                                                                                                                                                         |
| **As of**  | Compact `<select>`: Latest (all) · episode scenes in doc order; focus-visible outline                                                                                                                                                                                                                                                                                                                                       |

**Browse** (fact-type) is not on the rail in this pass (`factType` stays `'all'`). Threads live in the content header (§7a); overview is the persistent card (§7a-bis).

Section legends: 11px uppercase muted mono tracking. Selected / hover surfaces use `--tr-ledger-selected` / `--tr-surface-clay`; color transitions use standard motion. Filters affect both Atlas and Web.

### 7c. Review queue (both views)

Unchanged mutation semantics; presentation polish only.

- **Collapsed by default** (owner decision 2026-10-11: imports accept confident facts automatically, so what remains is optional): a quiet raised card with one line, "N unconfirmed facts — Not used for continuity or writing until you confirm them", and a **Review** / **Hide** toggle (`aria-expanded`). Opened, it becomes the amber-soft raised section with a left amber edge. The header's **N to review** chip opens it and scrolls to it.
- **Accept all high-confidence (n)** (sage, facts ≥0.8 in one batch snapshot).
- Per-scene grouping with **Accept scene** / **Reject scene**; scene labels prefer resolvable location from the project, not raw `scene-38`.
- Queue cards use the same detail actions as expanded Atlas rows (see §7f).

### 7d. Story Atlas

Filtered non-queue facts (pending stay in the queue unless status filter is Needs review) render as a **two-column card grid** (`gap` 16px; stacks to one column below `md`).

**Card anatomy** (`AtlasFactCard`, radius `--tr-radius-ledger-card`):

- **Header:** owner avatar + name — owner is the first `knownBy` character, or **Audience** when empty. Stable per-name oklch tint/ink (same helper as CAST).
- **Secret:** when `audienceKnows === false`, warm secret surface/border (`--tr-ledger-secret-*`) and a right-aligned **◆ Secret** badge.
- **Body:** full fact text at 15px primary (`text-pretty`).
- **Footer:** compact scene chip (`ep1 · sc3 · b2` via `formatSourceSpanChip`) · overlapping knower avatars (max 5) · label `"N knowers"` when `knownBy.length > 1`, else `"private"`.
- **Hover:** slight lift (`--tr-shadow-ledger-card` + translateY); focus-visible selected outline.

**Expanded card:** accent outline on the card; detail below reuses `FactCard` with the same brief enter motion as view switch. Click toggles expand; **one card expanded globally** at a time. Full `factType` / provenance / edit actions remain on expanded detail.

**Empty:** centered quiet state — serif “Nothing to show here” + secondary “No facts match the current filter.” (or the empty-ledger / as-of messages from the screen).

### 7e. Knowledge Web

Hybrid **focus strip + ranked fact list + detail** (research note `docs/superpowers/specs/2026-07-17-knowledge-web-graph-ux-research.md`). No graph library. Not a second Atlas — the job is focus-centric “what does this person / Audience know?”

- **Focus:** selected **People** filter, or **Audience** when All — audience overview shows facts with empty `knownBy` (respect `knownByAsOf` when the ledger was fetched as-of a scene).
- **Focus strip:** raised focus card (11px “Focus” legend + display 17px label) + light **type-cluster** chips (counts among visible facts: KNOWS / REL / …). Optional hub metaphor only — not full FactCards on an arc.
- **Ranked rows (cap 24):** scrollable list preferring `knowledge` / `relationship` when ranking (same `buildKnowledgeGraph` ranking). Each row: type cue · 1–2 line fact at **15px** · muted scene · knower count. Pending rows `--tr-amber-soft`; selected row accent outline + lift; related rows sky-soft highlight when a selection is active.
- **Overflow:** when more than 24 match, **+N more — open Atlas** chrome switches to Atlas.
- **Related cues:** fact–fact mini-edges are **hidden by default**. When a row is selected, related visible facts (shared knowers / relationship co-mentions from the capped edge model) get a subtle related highlight — not a hairball SVG graph.
- **Interaction:** click / keyboard-activate row → detail panel (`FactCard`, same fields/actions as Atlas expanded row) with enter motion. **Open in Atlas** switches to Atlas and expands that fact.
- **Empty / All-people cliff:** raised quiet panel — "No knowledge facts for {name} yet" (or Audience) + nudge to pick a person from People when focus is Audience / All yields little; Atlas switcher hint remains.

### 7f. Character profile (People filter)

When the People rail has a specific `characterId` selected (not All), a raised **profile card** appears above the Atlas / Web body (`CharacterProfile`, T7.31):

- **Chrome:** 11px “Profile” legend · display 17px character name · optional “Also known as …” aliases line (13px secondary).
- **Summary:** one-line brief (15px primary). Prefer stored `Character.summary`; else craft `traits`; else a short line derived from motivations / linked facts.
- **Bio:** short dossier (13px secondary, paragraph breaks preserved). Prefer stored `Character.bio`; else `presentation` / `hiding` / `embodiment`; else synthesized from that character’s knownBy facts + scene motivations.
- **Empty:** quiet secondary copy — “No profile yet — facts below are what we know so far.” Never invent biography when there is no evidence.
- **All people:** no profile card (Atlas/Web unchanged).

### 7g. Fact detail (shared)

Hairline-border raised card (`--tr-shadow-raised`, comfortable padding) with fact text (15px primary, snug leading) · type chip (sky) · `establishedIn` + source-span link ("ep 1 · sc 3 · beat 2" → jumps to beat in Write mode, highlighted 2s) · **Known by** avatars/initials chips (empty = "audience only", italic) · confidence bar (2px, sage fill on cool-paper track; muted fill when superseded) · provenance chip (`inferred` amber / `confirmed` sage / `writer-authored` sky) · status. Superseded facts: strikethrough text + "superseded by →" link; chain view expands inline as a vertical thread. Interactive controls use focus-visible selected outline.

- **Queue card actions:** separated by a hairline — **Accept** (sage) · **Edit** (opens inline form: text, knownBy, type → saves as `writer_authored`) · **Reject** (muted; fact becomes `rejected`, excluded from prompts). **Every ledger action is a versioned mutation**: accept/edit/reject/batch each commit through the standard snapshot transaction (ledger is snapshot-versioned state), so all of them are undoable via the global undo — a mistaken batch-accept is one undo away, and the undo control is enabled in Ledger mode like everywhere else.
- **Dependency hint:** card footer "referenced by 2 upcoming scenes" when other scenes' plans mention linked characters + this fact was injected into their last generation (best-effort, from prompt logs).

**States:** _Empty ledger_ — "Facts appear as you write. Table Read tracks what's true so you don't have to." _Filtered empty_ — "No facts match." (+ Atlas filter nudge).

## 8. Component inventory (build once, reuse)

`ModeSwitcher` · `Card` (raised/sunken variants) · `Chip` (status hues) · `LockToggle` · `ConfidenceBar` · `DiffPane` (plan + script variants) · `CandidateCard` · `CommandBar` · `InspectorField` (read-only-when-locked behavior built in) · `FactCard` · `CharacterProfile` · `LedgerViewSwitcher` · `StoryAtlas` · `KnowledgeWeb` · `ChangeSetRow` · `SsePane` (streaming text region) · `Toast`. Storybook story per component per state is part of each UI task's definition of done.

## 9. Workflow recipes (adoption A9)

Onboarding is task-shaped recipes on the real UI with **The Long Pour** fixture preloaded — not feature documentation.

- **Data:** `apps/web/src/onboarding/recipes.json` — 6–8 recipes, each 3–5 steps (`title`, `body`, `target` matching a real `data-testid`). Deep link: `?tour=<recipe-id>` on Write/Plan/Review/Ledger URLs that already include `?project=proj-longpour`.
- **Dashboard:** **Workflow recipes** section lists every recipe (the first-run offer). Starting a recipe opens the fixture route with the overlay.
- **Overlay:** bottom-right coach card (step N/M, Next / Back / Skip / Done). Active step's `target` scrolls into view and gets a sky outline (`.recipe-highlight`). Overlay never blocks clicks on the highlighted control (`pointer-events` only on the card).
- **Recipes (MVP set):** Break your first scene · Lock what you love, regenerate the rest · Review a change before it lands · Audit your story's facts · Steer with a one-line instruction · Undo more than one step.

## 10. Accessibility & feel

All status meaning doubled with text/icon (never color alone); focus rings 2px sky; full keyboard path for Accept/Tune/Skip (`1/2/3` when dock focused) and Review checkboxes; `prefers-reduced-motion` kills lift/collapse animations; streaming text is `aria-live="polite"`. Feel target: closer to a well-made writing app than a dev tool — if a surface looks like a database admin panel, it's wrong (design doc §4.1 negative direction).
