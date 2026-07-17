# Table Read UI Spec (MVP)

Implements design doc §4. Light theme only in MVP (dark is v2, but every color goes through a token — no hardcoded hex in components).

## 1. Design tokens

Quiet Tool visual language: cool paper neutrals, slate-blue accent (`--tr-coral*` names retained), Instrument Sans for UI and display type.

```css
:root {
  /* Surfaces — cool paper */
  --tr-surface-page:    #F6F6F3; /* app background, Write mode page area */
  --tr-surface-raised:  #FFFFFF; /* cards, script canvas sheet */
  --tr-surface-sunken:  #F0F0EC; /* panels, rails, command bar */
  --tr-surface-clay:    #EBEBE6; /* frames on Plan canvas, hover fills */
  --tr-border:          #E8E8E2;
  --tr-border-strong:   #D9D9D2;

  /* Text — charcoal, never pure black */
  --tr-text-primary:    #26272B;
  --tr-text-secondary:  #84857D;
  --tr-text-muted:      #9a9b92;

  /* Primary action — slate-blue (--tr-coral* names retained) */
  --tr-coral:           #5B79A6;
  --tr-coral-hover:     #4A6690;
  --tr-coral-soft:      #DEE5EE; /* selected/active tints */
  --tr-accent-ink:      #33445E; /* text on soft accent fill (selected pills) */

  /* Status hues */
  --tr-sage:            #7D9678; /* confirmed, high-confidence, success */
  --tr-sage-soft:       #E7EEE4;
  --tr-sky:             #41608A; /* informational, links, setup/payoff connectors */
  --tr-sky-soft:        #E4EBF2;
  --tr-amber:           #8A6120; /* needs review, speculative, pending */
  --tr-amber-soft:      #FBF4E6;
  --tr-danger:          #B0503C; /* destructive, errors only — not for AI content */

  /* Type */
  --tr-font-ui:     "Instrument Sans", system-ui, sans-serif;
  --tr-font-script: "Courier Prime", "Courier New", monospace; /* teleplay */
  --tr-font-display:"Instrument Sans", system-ui, sans-serif; /* headings, mode titles */

  /* Scale: 11/12/13/15/17/22/28. 11px = secondary chrome; script canvas 12pt Courier. */
  /* Spacing: 4-base — 4/8/12/16/24/32/48/64. Generous: default section pad 24. */
  /* Radius: cards 12px, chips 999px, canvas frames 12px. */
  /* Shadow: 0 1px 2px rgb(38 39 43 / 0.04), lift: 0 4px 16px rgb(38 39 43 / 0.08) */
  /* Motion: 160ms ease-out standard; streaming text has no animation. */
  /* Layout: --tr-script-col 600px; --tr-panel-candidate-dock 332px; Plan panels 232/296/214px; Ledger rail 198px; shell 52px. */
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

1. **Add the script** — Upload (`.fountain`/`.txt`/`.pdf`, filename + detected format shown) / Paste tabs. Selecting or pasting Fountain/text never uploads or analyzes it. Selecting a PDF uploads only to the non-LLM extract endpoint (`POST /projects/import/extract-pdf`) and fills editable text; an unsupported extension or empty file fails locally with plain-language guidance.
2. **Confirm source** — editable textarea containing pasted text, locally read Fountain/text, or server-extracted PDF text. PDF results show a muted method badge (`Text layer` / `OCR`), page count, and warning codes; writer edits here before any analysis.
3. **Confirm basics** — title (prefilled from the filename when uploaded, editable) + the same `ShowFormat` presets as the idea path.
4. **Review source** — source type/filename, byte/char/line counts, a deterministic detected-scene count (informational only — the server's own split during analysis is authoritative), plus the preflight estimate line: `N scene(s) detected · ~2N+2 model calls · Est. $low–$high`. The nominal total is segmentation `N` + act inference `1` + fact extraction `N` + consistency scan `1`; segmentation or act-inference repair may add calls. The trust note states the estimate uses the classifier model, actual usage may vary, and **Create & analyze script** is the only action that sends the source to the model.
5. **Analyze** — before starting, and again after a failed attempt, repeats the same scene count / model-call / estimated-cost line so the writer can see expected classifier usage before retrying. The named stages stream over SSE (`POST /projects/import`, data contract §9.3) as truthful text rows with a status word each (Pending / In progress / Done — never a spinner-only wait, `aria-live="polite"` announces the current stage): parsing scenes → segmenting beats → **inferring act structure** → extracting facts → checking consistency → saving project. Scene-level analysis stages may complete scenes in parallel, but the UI shows ordered source results only after the terminal success. During analysis, stage rows show counters from progress frames (`done / total`) that only increase; a stage becomes **Done** only once all scenes for that stage have completed and the next stage begins (or the terminal result arrives for saving). Act inference is a singleton stage after all scene summaries exist; it uses normal stage start/completion semantics and no per-scene progress. The footer shows elapsed time immediately. ETA stays hidden until at least five scene completions have been observed, then appears as `ETA ~Xm`; if no new completion arrives for a long gap, hide the stale ETA and keep elapsed visible. PDF reaches this endpoint as the writer-confirmed `format: "text"` source. On the terminal `complete`, the draft clears and the writer lands in Plan with the imported scenes/beats and the Ledger pending-review badge. On `failed`, nothing was created — the draft (source + basics) stays intact and the step offers **Retry**, **Edit source** (jumps back to step 1 without losing the draft), and **Return to dashboard**.

## 3. App shell

Top bar (52px, `--tr-shell-height`, `--tr-surface-sunken`): project title (Instrument Sans display font, 17px / 600) · mode switcher (clay segmented control: **Write · Plan · Review · Ledger**, active segment uses `--tr-coral-soft` + `--tr-accent-ink`) · undo (with history ▾) · export · settings. **Undo** reverts one step (`POST /undo`). The adjacent history control opens a dropdown of up to ~20 ancestor snapshots (`GET /snapshots`: instruction + relative time); choosing an entry restores that ancestor (`POST /restore`) and reloads — multi-step undo without a full branching UI (adoption A5). Review segment shows an amber dot when a draft Change Set exists. Ledger segment shows amber count badge when the review queue is non-empty. Keyboard: `⌘1–4` switch modes. Settings opens a privacy panel stating writing is not used for training (prompt spec §8); do not claim ZDR in product copy. When a project is loaded, Settings also offers **Export project JSON** (`GET /projects/{pid}/export.json` — adoption A6), downloading the full persisted-state envelope (distinct from the top-bar Fountain export), and a **Craft level** default (`fast` / `standard` / `considered`) on `Project.defaultCraftLevel` (adoption A3). Write candidate dock and Change Set preview share that default and can override per request.

## 4. Write mode

Layout (T2.4 script home): left **scene outline** (232px, `--tr-panel-story-layers`, sunken, own scroll) · center **continuous episode script** in a scrollport · right dock (~332px, `--tr-panel-candidate-dock`) for candidates · bottom command bar (floating pill, 56px, max 600px). The script sheet is `--tr-surface-raised` with a subtle shadow — the hero. Structure edits (reorder, acts, locks UI) stay in Plan; the outline is navigate-only.

- **Scene outline:** `Scenes · {n}`; each row = index + slug (location/time) + one-line whatHappens clamp. Active row uses coral-soft / accent ink (same selection language as Plan scene cards). Click sets the **active scene**, updates `?scene=`, saves resume, and scrolls that scene into view. Scroll spy (while not typing in a beat) keeps the outline in sync with the topmost visible scene.
- **Script canvas:** Fountain rendered in `--tr-font-script` with teleplay indents (scene headings/action full-width; character ~22ch; dialogue ~10ch / 35ch measure; parentheticals ~16ch; transitions right-aligned). Lone PDF element labels (`ACTION`, etc.) are ignored. Click a beat to edit as plain Fountain text; blur returns to the formatted view. Locked beats stay formatted and non-editable. **All episode scenes are stacked** in document order inside one raised sheet; each scene has an in-flow header (slug + `whatHappens` in solid primary — never muted ghost copy) and its beats. Beats separated by faint 1px `--tr-border` rules with beat labels in the left gutter (11px, muted, visible on hover only). **Planned-but-unwritten beats** (empty `scriptText`, non-empty `whatHappens` — typical after scene-skeleton apply) show a **Beat plan** block in solid 15px primary (plus audience learns/feels when present) above an editable script area; the sheet must not look blank. **Direct typing is allowed only in unlocked ranges**: beats with `locked` or `scriptLocked` render read-only (lock glyph in the gutter; caret placement inside shows a brief "Locked — click the lock to edit" hint), while the insertion points immediately before and after a locked beat remain writable — you can write around locked material, never inside it. Unlocking is a one-click writer action on the gutter glyph (locks bind the AI *and* casual edits; they are the writer's own pins, so undoing one is deliberate, not accidental). This mirrors the data-contract guarantee: no mutation path, human or machine, writes into a locked range while the lock holds. Focus/caret inside a beat sets the active scene (wins over scroll spy).
- **Active scene:** drives Next Beat, command-bar generate, and Accept insert. Changing active scene resets an in-flight candidate session. Deep links (`?scene=`, Ledger `highlightBeat`) set active scene and scroll/highlight the target.
- **Candidate cards:** stacked in right dock. Card = label (15px display font, e.g. "Tense refusal") + beat plan summary (13px secondary) + script preview (script font, 12px, max 8 lines, fade-out). Streaming: text appears token-by-token, no spinner-only state. Actions per card: **Accept** (coral, solid; shortcut label `[↵]`) · **Tune** (ghost; opens inline one-line input) · **Skip** (text button). Accepting animates the card content into the script canvas (160ms). **Next Beat** shows `[Q]`. Dock header includes a **Craft level** segmented control (Fast / Standard / Considered — adoption A3); changing it updates `defaultCraftLevel` and the next generate request.
- **Command bar:** raised white floating pill with placeholder *"Tell the scene where to go…"* (`[/]` / `[W]`). Submit = generate candidates with instruction for the **active scene**. `/` and `W` focus it. Not a chat: no history thread, no assistant bubbles. When empty and focused, three muted `~` suggestion chips appear below (adoption A4); click inserts text only — never auto-generates. Tune and empty scene what-happens fields use the same chip pattern.
- **Keyboard (adoption A8):** `Q` Next Beat · `W`/`/` focus command bar · `[` / `]` previous/next scene · `1`/`2`/`3` select candidate · `Tab`/`Shift-Tab` cycle cards · `Enter` accept focused card · `Esc` dismiss dock. All disabled while the script canvas has focus (AI-quiet) or while typing in a text field.
- **Quiet AI rule (enforced):** while the script canvas has focus and the writer is typing, the dock dims to 40% opacity and never updates; no proactive generation ever.

**States:** *Empty scene* (no beats) — scene slug + pitch when present, clear "No beats in this scene yet" copy, single coral **Next Beat** in the dock. *Planned beats, no script yet* — solid beat-plan copy on the sheet (see above). *Streaming* — cards fill sequentially; command bar disabled with subtle progress shimmer on the dock border. *Error* — dock card with `--tr-danger` left border, message + Retry; script canvas untouched. *Continuity conflict on a candidate* — amber callout "May conflict with the Ledger" with a short cleaned explanation (no raw `fact-…` ids or `audienceKnows` jargon) and a clear **I understand — unlock Accept** control; Accept stays disabled until that acknowledgment. After acknowledge, copy confirms Accept is unlocked and points to Tune if they want to resolve first.

## 5. Plan mode (MVP: simplified board)

Layout: left Story Layers panel (232px, sunken) · center board (page surface, pannable, not yet infinite/zoomable) · right inspector (296px, raised).

- **Story Layers panel:** tree — Bible (premise, characters, theme) / Episode / Acts / Scenes. Selecting focuses the board; eye toggles collapse acts. MVP has no free placement — the "canvas" is a structured board whose grammar (frames, cards, selection, inspector) upgrades to the real canvas in v2 without relearning.
- **Acts as frames:** horizontal bands in `--tr-surface-clay` with act labels ("COLD OPEN", "ACT ONE"…) in display font.
- **Scene cards** (raised, 12px radius, 214px): index + location (13px strong) · whatHappens (2-line clamp) · chips: storyline letter (v2, hidden), beat count, lock. Selected = `--tr-coral-soft` fill with accent ink. Drag to reorder within/between acts; drop targets highlight clay. Expand (⌥click or chevron) reveals **beat cards** nested (sunken, script-font first line of scriptText). **Double-click** opens Write mode on that scene (`/?project=…&scene=…`) — single-click still only selects for the inspector.
- **Connector lines:** v2. Reserve a toggle row in the panel footer, disabled with tooltip "Setup/payoff threads — v2".
- **Inspector (right):** for selected scene — location, time, socialSituation, an editable **Act** selector, storyline (disabled, v2), whatHappens, audienceLearns, audienceFeels; motivations table (character / objective / stakes / obstacle); **Affected facts** list (ledger facts whose sourceSpan is this scene — click → Ledger mode); **lock toggle** as a pill switch (accent when locked; locks children, per data contract). The Act selector lists exactly the project's format-valid labels (`COLD OPEN` plus numbered acts when `coldOpen` is true; numbered acts beginning at `ACT ONE` otherwise), including empty destination acts that have no drag target. It is disabled for effectively locked scenes/episodes and while a save is pending. A change uses the normal optimistic scene-field PATCH, moves the card to the selected act frame, persists after reload, and rolls back on failure; it creates one snapshot and no LLM or consistency call. For selected beat — beat fields + scriptLocked toggle. Premise-level field edits show footer bar: *"Structural change — review impact?"* → **Open Review** (coral) / *Save field only* (text). **Save field only** means exactly that: the field is written as a direct PATCH with **no regeneration of anything else** — but the post-save consistency scan still runs (the flagging promise holds even when the writer skips Review), so any contradictions it creates surface as amber flags rather than silently persisting.

**States:** *Nothing selected* — inspector shows episode summary + premise. *Drag* — card lifts (shadow token), siblings gap-animate. *Locked selection* — inspector fields read-only with lock banner "Locked — unlock to edit".

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

**States:** *Classifying* — skeleton rows + "Mapping impact…" (boring, factual). *Previewing* — per-row shimmer on `after` pane only. *Applied* — rows collapse to sage check summary + "Undo all" (one snapshot revert), followed by a **post-apply consistency section**: any `scan_consistency` flags render as amber rows ("Scene 5 still stages the argument around the bar's finances") with actions *Open Change Set* / *Go to scene* / *Dismiss* — never auto-fixed. *409 lock conflict* — danger toast "A locked element was included — nothing was changed", selection preserved. Open consistency flags also badge the affected scene cards in Plan mode (small amber dot).

## 7. Ledger mode

Ledger is a **story bible** — writers open it to understand what is true in the story world. Two swappable views share the same filters, review queue, and mutation paths. Visual language: **Editorial Quiet Tool** (cool paper, slate-blue accent, soft ambient shadows) — craft elevation over the dual-view + browse-clarity base; see `docs/superpowers/specs/2026-07-17-ledger-creative-polish-design.md`.

| View | Job |
|---|---|
| **Story Atlas** (default) | Compact expandable rows grouped by storytelling meaning |
| **Knowledge Web** | Character- or Audience-focused who-knows-what (ranked list + detail) |

Layout: left **filter rail** (198px, `--tr-panel-ledger-filters`, sunken) · main column on page surface with page header + active view body · **review queue** pinned at top when non-empty in **both** views.

### 7a. Page chrome

- **Title:** display font — "What's true in this story" (`font-display`, 22px) with a one-line secondary subtitle (“Your story bible — browse truths, or focus who knows what.”).
- **View switcher:** segmented control **Atlas · Web** in the header (`LedgerViewSwitcher`); clay track, active segment `--tr-coral-soft` + `--tr-accent-ink` + `--tr-shadow-raised` (match ModeSwitcher). Choice persists per project in `localStorage` (`tr.ledger.view.{projectId}`).
- **Pending chip:** amber-soft when `pending_review` count > 0 ("N to review"); click scrolls to / focuses the review queue; focus-visible uses `--tr-outline-selected` + `--tr-coral`.
- **Motion:** Atlas ↔ Web body uses a brief fade/rise enter (`.tr-ledger-view-enter`, `--tr-motion-duration-standard` / `--tr-motion-ease-standard`; disabled under `prefers-reduced-motion`).

### 7b. Filter rail (shared filters)

Same `LedgerFilters` model (`status`, `characterId`, `factType`); writer-facing labels only. Browse-first order (Atlas organization research 2026-07-17):

| Control | Options / chrome |
|---|---|
| **People** | All · characters with knownBy count `> 0` and `(n)` badges (also sets Knowledge Web focus when Web is active). Zero-count cast (unused / slugline junk) lives under a collapsed **No linked facts (N)** disclosure — expandable, not removed. Manage cast link |
| **Browse** | All truths · Events · States · Knowledge · Relationships · World rules — chapter/`factType` filter with `(n)` counts (replaces the former “Lenses” label) |
| **Threads** | Setups & payoffs entry (when wired) |
| **Status** | Collapsed by default when All; summary shows pending “N to review” in amber. Expand for All · Needs review · Active · Superseded · Stale · Rejected |
| **As of** | Compact raised `<select>`: Latest (all) · episode scenes in doc order (not a full radio list); focus-visible outline |

Section legends: 11px uppercase muted (`text-11`, `tracking-wide`). Accent-tint active pills (`--tr-coral-soft` / `--tr-accent-ink`) on the sunken rail; option hover uses `--tr-surface-clay`; color transitions use standard motion. Filters affect both Atlas and Web.

### 7c. Review queue (both views)

Unchanged mutation semantics; presentation polish only.

- Amber-soft raised section with a left amber edge when pending non-empty; display title "N facts awaiting review".
- **Accept all high-confidence (n)** (sage, facts ≥0.8 in one batch snapshot).
- Per-scene grouping with **Accept scene** / **Reject scene**; scene labels prefer resolvable location from the project, not raw `scene-38`.
- Queue cards use the same detail actions as expanded Atlas rows (see §7f).

### 7d. Story Atlas

Filtered non-queue facts (pending stay in the queue unless status filter is Needs review) group into **chapters** by `factType`; empty chapters omitted:

| Chapter | `factType` |
|---|---|
| People & knowledge | `knowledge` |
| Events | `event` |
| States | `state` |
| Relationships | `relationship` |
| World rules | `world_rule` |

**Chapter chrome:** display 17px title + muted count; light hairline under the chapter header; chevron toggle (button, `aria-expanded`) collapses/expands the chapter body. Default **expanded**; collapsing is session-only. When a fact is selected / expanded, its chapter (and knower subhead, if any) force-open. Knower subheads (when ≥20 facts): 11px uppercase muted, same chevron collapse pattern, default expanded.

**Collapsed row:** discriminating knower/irony cue (not the chapter’s redundant `factType` pill) · fact text (15px primary, 1–2 line clamp, snug leading) · trailing muted knower initials when useful · scene link label. Rows are raised sheets (`--tr-shadow-raised`); hover lifts (`--tr-shadow-lift` + clay fill). Focus-visible: selected outline.

Cue mapping (existing fields only — no parallel tag taxonomy):

| Condition | Collapsed chip |
|---|---|
| `knownBy` empty | **Audience** (sky) |
| knowers + `audienceKnows === false` | **Secret** (amber) |
| single knower, audience knows | knower initials (neutral) |
| multiple knowers, audience knows | **N knowers** (neutral) |

Full `factType` remains on expanded detail. Inside a chapter with ≥20 facts, rows group under knower subheads: **Audience** (empty `knownBy`), each single knower (cast order), **Shared** (multi-knower — no card duplication).

**Expanded row:** accent outline + lift on the collapsed control; detail below reuses `FactCard` with the same brief enter motion as view switch. Click toggles expand; **one row expanded globally** at a time.

**Empty:** raised quiet panel; *Empty ledger* — "Facts appear as you write…"; *Filtered empty* — "No facts match." plus a short filter-clear nudge.

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

**States:** *Empty ledger* — "Facts appear as you write. Table Read tracks what's true so you don't have to." *Filtered empty* — "No facts match." (+ Atlas filter nudge).

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
