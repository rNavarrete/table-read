# Table Read UI Spec (MVP)

Implements design doc §4. Light theme only in MVP (dark is v2, but every color goes through a token — no hardcoded hex in components).

## 1. Design tokens

```css
:root {
  /* Surfaces — warm ivory & clay */
  --tr-surface-page:    #FAF6EF; /* app background, Write mode page area */
  --tr-surface-raised:  #FFFDF8; /* cards, script canvas sheet */
  --tr-surface-sunken:  #F1EAE0; /* panels, rails, command bar */
  --tr-surface-clay:    #E8DCCB; /* frames on Plan canvas, hover fills */
  --tr-border:          #DDD2C2;
  --tr-border-strong:   #C4B6A1;

  /* Text — charcoal, never pure black */
  --tr-text-primary:    #2B2724;
  --tr-text-secondary:  #6B615A;
  --tr-text-muted:      #988D83;

  /* Primary action — muted coral */
  --tr-coral:           #E0704F;
  --tr-coral-hover:     #C95E3F;
  --tr-coral-soft:      #F7DED4; /* selected/active tints */

  /* Status hues */
  --tr-sage:            #7E9B76; /* confirmed, high-confidence, success */
  --tr-sage-soft:       #E4ECE0;
  --tr-sky:             #6E93B8; /* informational, links, setup/payoff connectors */
  --tr-sky-soft:        #E1EAF2;
  --tr-amber:           #C9913B; /* needs review, speculative, pending */
  --tr-amber-soft:      #F5E8D2;
  --tr-danger:          #B0503C; /* destructive, errors only — not for AI content */

  /* Type */
  --tr-font-ui:     "Inter", system-ui, sans-serif;
  --tr-font-script: "Courier Prime", "Courier New", monospace; /* teleplay */
  --tr-font-display:"Fraunces", Georgia, serif; /* headings, mode titles */

  /* Scale: 12/13/15/17/22/28. Script canvas fixed 12pt Courier equivalent. */
  /* Spacing: 4-base — 4/8/12/16/24/32/48/64. Generous: default section pad 24. */
  /* Radius: cards 10px, chips 999px, canvas frames 14px. */
  /* Shadow: 0 1px 3px rgb(43 39 36 / 0.08), lift on drag: 0 8px 24px / 0.14 */
  /* Motion: 160ms ease-out standard; streaming text has no animation. */
}
```

**Dark theme (v2, reserve tokens now):** page `#211D1A` (warm near-black), raised `#2A2522` (espresso), sunken/panels `#332B24` (deep clay), text `#F3EDE3` (ivory); coral/sage/sky/amber shift ~10% desaturated, soft variants become translucent overlays. Warm dark, not tech-noir.

**Status hue semantics (consistent everywhere):** sage = confirmed/high-confidence · sky = informational/relational · amber = pending/speculative/needs-review · coral = the one primary action per surface. No purple "AI" gradients, no sparkle icons; AI-origin content is marked by a small `~` glyph chip in `--tr-text-muted`.

## 2. App shell

Top bar (56px, `--tr-surface-sunken`): project title (display font) · mode switcher (segmented control: **Write · Plan · Review · Ledger**) · undo · export · settings. Review segment shows an amber dot when a draft Change Set exists. Ledger segment shows amber count badge when the review queue is non-empty. Keyboard: `⌘1–4` switch modes. Settings opens a privacy panel stating writing is not used for training (prompt spec §8); do not claim ZDR in product copy.

## 3. Write mode

Layout: centered script column (max 720px) on `--tr-surface-page`; the script sheet itself is `--tr-surface-raised` with a subtle shadow — the hero. Right dock (320px) for candidates; bottom command bar (floating, 56px, max 720px).

- **Script canvas:** Fountain rendered in `--tr-font-script`; current scene's beats separated by faint 1px `--tr-border` rules with beat labels in the left gutter (11px, muted, visible on hover only). **Direct typing is allowed only in unlocked ranges**: beats with `locked` or `scriptLocked` render read-only (lock glyph in the gutter; caret placement inside shows a brief "Locked — click the lock to edit" hint), while the insertion points immediately before and after a locked beat remain writable — you can write around locked material, never inside it. Unlocking is a one-click writer action on the gutter glyph (locks bind the AI *and* casual edits; they are the writer's own pins, so undoing one is deliberate, not accidental). This mirrors the data-contract guarantee: no mutation path, human or machine, writes into a locked range while the lock holds.
- **Candidate cards:** stacked in right dock. Card = label (15px display font, e.g. "Tense refusal") + beat plan summary (13px secondary) + script preview (script font, 12px, max 8 lines, fade-out). Streaming: text appears token-by-token, no spinner-only state. Actions per card: **Accept** (coral, solid) · **Tune** (ghost; opens inline one-line input) · **Skip** (text button). Accepting animates the card content into the script canvas (160ms).
- **Command bar:** placeholder *"Tell the scene where to go…"*. Submit = generate candidates with instruction. `/` focuses it. Not a chat: no history thread, no assistant bubbles.
- **Quiet AI rule (enforced):** while the script canvas has focus and the writer is typing, the dock dims to 40% opacity and never updates; no proactive generation ever.

**States:** *Empty scene* — ghost text "Write, or press Next Beat" + single coral "Next Beat" button center-dock. *Streaming* — cards fill sequentially; command bar disabled with subtle progress shimmer on the dock border. *Error* — dock card with `--tr-danger` left border, message + Retry; script canvas untouched. *Continuity conflict on a candidate* — amber chip "conflicts with: Dan doesn't know (fact-04)" on the card; accepting requires a confirm click on the chip.

## 4. Plan mode (MVP: simplified board)

Layout: left Story Layers panel (240px, sunken) · center board (page surface, pannable, not yet infinite/zoomable) · right inspector (300px, raised).

- **Story Layers panel:** tree — Bible (premise, characters, theme) / Episode / Acts / Scenes. Selecting focuses the board; eye toggles collapse acts. MVP has no free placement — the "canvas" is a structured board whose grammar (frames, cards, selection, inspector) upgrades to the real canvas in v2 without relearning.
- **Acts as frames:** horizontal bands in `--tr-surface-clay` with act labels ("COLD OPEN", "ACT ONE"…) in display font.
- **Scene cards** (raised, 10px radius, 260px): index + location (13px strong) · whatHappens (2-line clamp) · chips: storyline letter (v2, hidden), beat count, lock. Selected = 2px coral outline. Drag to reorder within/between acts; drop targets highlight clay. Expand (⌥click or chevron) reveals **beat cards** nested (sunken, script-font first line of scriptText).
- **Connector lines:** v2. Reserve a toggle row in the panel footer, disabled with tooltip "Setup/payoff threads — v2".
- **Inspector (right):** for selected scene — location, time, socialSituation, act, storyline (disabled, v2), whatHappens, audienceLearns, audienceFeels; motivations table (character / objective / stakes / obstacle); **Affected facts** list (ledger facts whose sourceSpan is this scene — click → Ledger mode); **lock toggle** (locks children, per data contract). For selected beat — beat fields + scriptLocked toggle. Premise-level field edits show footer bar: *"Structural change — review impact?"* → **Open Review** (coral) / *Save field only* (text). **Save field only** means exactly that: the field is written as a direct PATCH with **no regeneration of anything else** — but the post-save consistency scan still runs (the flagging promise holds even when the writer skips Review), so any contradictions it creates surface as amber flags rather than silently persisting.

**States:** *Nothing selected* — inspector shows episode summary + premise. *Drag* — card lifts (shadow token), siblings gap-animate. *Locked selection* — inspector fields read-only with lock banner "Locked — unlock to edit".

## 5. Review mode

Entered via mode switcher (lists draft Change Sets) or directly from Plan/Write triggers. One Change Set at a time.

Layout: header — instruction quoted in display font ("Dan hides the money at the marina instead of the bar") + target object chip + status. Below: impacted-object rows, full width.

- **Row anatomy:** checkbox (regenerate rows only) · object icon+id (scene/beat/character/fact) · reason (13px secondary) · confidence chip (sage "direct" / amber "speculative") · continuity flags (amber chips, clickable → Ledger) · disclosure chevron.
- **Locked rows:** no checkbox — lock glyph; entire row at 55% opacity, tooltip "Locked — the AI could not touch this". They are shown, never hidden (seeing what was protected builds trust).
- **Flag-only rows** (`applyMode: "flag_only"` — characters and ledger facts): no checkbox — sky info glyph instead; tooltip "Affected, but not changed by this apply — review it yourself"; row links to the object in Plan/Ledger mode. Never included in the selected count.
- **Expanded row:** before/after panes side-by-side. Plan fields as word-level diff (del = strikethrough muted, ins = sage underline); scriptText as script-font block diff. Before preview exists, `after` pane shows "Preview to generate" ghost.
- **Footer bar (sticky):** count "4 of 6 selected" · **Preview selected** (ghost, coral border) → fills `after` panes · **Apply selected** (coral, disabled until previewed) · **Flag only** (text) · **Discard** (text, muted) · **Create branch** (disabled, tooltip "v2"). Comments affordance: each row reserves a 24px right-margin slot rendering nothing in MVP (v2: comment bubble).

**States:** *Classifying* — skeleton rows + "Mapping impact…" (boring, factual). *Previewing* — per-row shimmer on `after` pane only. *Applied* — rows collapse to sage check summary + "Undo all" (one snapshot revert), followed by a **post-apply consistency section**: any `scan_consistency` flags render as amber rows ("Scene 5 still stages the argument around the bar's finances") with actions *Open Change Set* / *Go to scene* / *Dismiss* — never auto-fixed. *409 lock conflict* — danger toast "A locked element was included — nothing was changed", selection preserved. Open consistency flags also badge the affected scene cards in Plan mode (small amber dot).

## 6. Ledger mode

Layout: left filter rail (200px: status, character, fact type) · fact card grid (center) · **review queue** pinned top when non-empty (amber header: "3 facts awaiting review").

- **Fact card:** fact text (15px primary) · type chip (sky) · `establishedIn` + source-span link ("ep 1 · sc 3 · beat 2" → jumps to beat in Write mode, highlighted 2s) · **Known by** avatars/initials chips (empty = "audience only", italic) · confidence bar (2px, sage ≥0.8 / amber below) · provenance chip (`inferred` amber / `confirmed` sage / `writer-authored` sky) · status. Superseded facts: strikethrough text + "superseded by →" link; chain view expands inline as a vertical thread.
- **Queue card actions:** **Accept** (sage) · **Edit** (opens inline form: text, knownBy, type → saves as `writer_authored`) · **Reject** (muted; fact becomes `rejected`, excluded from prompts). **Every ledger action is a versioned mutation**: accept/edit/reject/batch each commit through the standard snapshot transaction (ledger is snapshot-versioned state), so all of them are undoable via the global undo — a mistaken batch-accept is one undo away, and the undo control is enabled in Ledger mode like everywhere else.
- **Batch review (import case):** imports queue every extracted fact, so the queue header gains "Accept all high-confidence (n)" (sage, confirms facts ≥0.8 in one action; backed by the batch endpoint, one snapshot for the whole batch) and per-scene grouping with group accept/reject — reviewing 40 facts one card at a time is not acceptable UX after an import.
- **Dependency hint:** card footer "referenced by 2 upcoming scenes" when other scenes' plans mention linked characters + this fact was injected into their last generation (best-effort, from prompt logs).

**States:** *Empty ledger* — "Facts appear as you write. Table Read tracks what's true so you don't have to." *Filtered empty* — plain "No facts match."

## 7. Component inventory (build once, reuse)

`ModeSwitcher` · `Card` (raised/sunken variants) · `Chip` (status hues) · `LockToggle` · `ConfidenceBar` · `DiffPane` (plan + script variants) · `CandidateCard` · `CommandBar` · `InspectorField` (read-only-when-locked behavior built in) · `FactCard` · `ChangeSetRow` · `SsePane` (streaming text region) · `Toast`. Storybook story per component per state is part of each UI task's definition of done.

## 8. Accessibility & feel

All status meaning doubled with text/icon (never color alone); focus rings 2px sky; full keyboard path for Accept/Tune/Skip (`1/2/3` when dock focused) and Review checkboxes; `prefers-reduced-motion` kills lift/collapse animations; streaming text is `aria-live="polite"`. Feel target: closer to a well-made writing app than a dev tool — if a surface looks like a database admin panel, it's wrong (design doc §4.1 negative direction).
