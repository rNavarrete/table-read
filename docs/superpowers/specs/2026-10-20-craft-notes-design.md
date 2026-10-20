# Craft notes: a screenplay "linter" in Plan

Status: design, 2026-10-20. Owner conversation in the session that built T10.11/T10.12.

## Intent

The owner, in their words: high-level craft guidelines from writers like Guillermo del Toro are "very good insight", and "hard to lose track of when you're writing a screenplay". They want something like linting in a code editor. If the story's thesis or themes get heavy-handed or start to sound preachy, the app raises a warning that says so and links to articles, or to a del Toro interview, that make the same point.

Del Toro's points that prompted it (from a talk the owner watched):
- never say what the film is about; let the theme emerge from action and drama;
- characters should never talk about what they're doing;
- never give the audience answers it hasn't asked for.

## Where and when (owner decisions)

- **Where:** in Plan, while the writer reviews the board of scenes. Never in Write: AI stays quiet in Write mode (CLAUDE.md rule 8, design doc §4.3).
- **Dismissing:** the owner isn't worried about occasional false positives "as long as we have a good way to dismiss the alert". So dismiss must be one click, and a dismissed note must stay dismissed.
- **Tone:** these are warnings, and the owner wants the app to say "this is a bit heavy-handed". That departs, for this feature only, from Plan's "findings stated, never graded" rule (redesign spec §4.5: no nags). It's the owner's call, and the notes stay advisory: always dismissable, never blocking, and labelled as the AI's reading.
- **When notes appear:** the owner accepted "generated during import, with a re-check button". This design ships the button first (phase 1) and the import-time run second (phase 2); see Phases.

## Goals

1. **Theme said out loud** (`theme_stated`): a line where a character states the episode's theme or central argument outright, or moralizes it. This is the owner's main ask: heavy-handed and preachy.
2. **Saying what they're doing** (`on_the_nose`): a character announces their own action, intention or feeling instead of playing it ("I'm so angry with you", "I'm going to find out what you're hiding").
Each note shows:
- the check's plain-language name;
- the exact line it's about;
- one sentence on why;
- a "Read more" link to a vetted source;
- **Dismiss**.

## Non-goals

- Rewriting or suggesting replacement lines. A note points; the writer fixes it in Write, or uses Review's existing Change Set flow.
- Scores, grades or a "craft health" number.
- Live linting while typing, or any check in Write mode.
- Grammar, style or formatting rules.
- Checks the board or ledger already show live. A scene with no counterpoint shows through the Clashes and Turns lenses (T10.12). An answer given before the question (del Toro's third point) shows on Plan's fact rows ("arrives n scenes before it's needed", `story.expositionLine`) and in Ledger's Exposition lens. Neither becomes a note: a stored note would go stale the moment a scene moves.

## Anti-goals (what would make this a failure even if it works)

- **Noise.** A board covered in craft notes gets ignored. Cap the notes per check run (at most 12 for the episode, strongest first) and prefer silence when unsure.
- **Invented evidence.** A quote not in the script, or a link that doesn't exist or doesn't say what the note claims.
- **Notes that come back after being dismissed**, or that can't be dismissed in one click.
- **Writer text in logs.** Excerpts are script text, so they must never be logged (rule 5).

## How it works

### Triggering

- **Phase 1:** a **Check craft** button in Plan's Episode view. It's the first control there that calls the model (today the view only has links and selectors), so update `EpisodeView.tsx`'s docstring to say that this button, an explicit gesture, is the one exception. It calls `POST /api/v1/projects/{pid}/craft-check`, which follows the structure-check pattern (`routes.py` `check_structure`):
  - an `If-Match` stale-head guard;
  - `SCHEMA_INVALID_LLM` → 502 and `LLM_UNAVAILABLE` → 503;
  - one snapshot via `snapshots.mutate` (rule 4);
  - the endpoint returns the project's craft notes (open, plus dismissed ones so the UI can count them).
- **Phase 2:** the same check runs once during import, inside the existing `checking_consistency` stage, so `ProjectImportStageName` doesn't change. Its notes join that stage's flags in the import's single snapshot, so undoing the import removes them too. The step is non-fatal: if it fails or times out, the import still completes, and Plan's button is how to retry.

Nothing runs on mount, select, hover or highlight change (redesign spec rule).

### The model call (`review_craft`, new LLM op)

- **Role:** `import_analyst` (Opus 5.5, effort `medium`), the same role as the other story-wide reads.
- **Input**, all through `render.source_data`:
  - the episode's story overview: logline, dramatic question, central argument, anti-theme;
  - the cast (names only);
  - every scene in board order: its `sceneId`, and each beat's `beatId` with that beat's dialogue lines (cue plus line, from `scriptText`).
  - Action lines are left out: these checks are about what characters say. This also keeps the input to roughly the dialogue share of the script.
- **Output:** a strict tool schema, kept small:
  `notes: [{ check: "theme_stated" | "on_the_nose", sceneId, beatId, excerpt, why }]`.
  - `excerpt` is the line copied verbatim from the beat, at most about 200 characters.
  - `why` is one plain sentence, e.g. "Marta says the episode's argument (loyalty costs more than it pays) in so many words."
  - The prompt asks for at most 12 notes, strongest first. Returning none is a valid answer.
- **Before merge:** probe the tool schema against the real API (a `max_tokens: 1` call, no script text). T10.11 showed that a grammar-size refusal only shows up on a real call.
- **Rules:** a prompt change bumps `PROMPT_VERSION` and needs the owner's substitute sign-off while `make evals` is on hold (rule 7). Every schema home is updated (rule 3). Rule 9's single retry applies.

### Server-side checks before anything is stored

- A model note's `excerpt` must appear in the cited beat's `scriptText`. Use `ledger_policy.locate_quote` (`apps/api/drama_manager/ledger_policy.py`), which evens out typography, whitespace, HTML entities and page furniture, but not case. Don't use `verify_source_text`: it needs model line numbers, which this op doesn't return. Matching stays case-sensitive; the prompt asks for verbatim copies. An unverified note is dropped and counted.
- The `beatId` must belong to the cited `sceneId` in this episode.
- Duplicates (same check, same beat, same normalized excerpt) collapse into one.
- Logs carry counts only: notes by check, dropped unverified, dropped duplicate, kept. Never excerpts.

### Storage: reuse consistency flags (no contract change)

Each note is a `ConsistencyFlag`:
- `objectType: "beat"`, `objectId: beatId`;
- `factId`: null;
- `severity: "tension"`, `status: "open"`;
- `sourceChange`: the id of the check's snapshot;
- `explanation`: `[craft_<check>] “<excerpt>” — <why>`.

The `[code]` prefix is the pattern import notes already use, which Plan parses with `story.flagKind`. Plan's `flagKind` gains a `craft` kind for `[craft_*]` codes. That test must run **before** the import-code test, because `IMPORT_CODE` (`story.ts`) matches any `[snake_case]` prefix and would otherwise file craft notes as import notes. With that, craft notes ride the existing machinery:
- the ⚑ badge on cards;
- the notes strip;
- N / Shift+N to the next note;
- `POST /consistency-flags/{fid}/dismiss`, with Undo.

**Dismissed stays dismissed.** A re-check replaces the episode's *open* craft notes. A dismissal covers a **check on a beat**: no new note with the same check on the same beat is filed while a dismissed one exists. That holds even when the model quotes a different span or the writer fixes a typo. The cost: a second, real problem of the same kind in that beat stays hidden, which is acceptable at a 12-note cap. Dismissed notes are kept, never deleted.

**A fixed line clears its note.** Plan hides an open craft note whose excerpt `locate_quote` can no longer find in the beat's current `scriptText`; the web needs an equivalent normalization in `story.ts`. The next check marks such notes `resolved`.

**Last checked:** each check stamps `episode.craftCheckedAt` (ISO time, null until the first check), following the precedent of `structureChecks[].checkedAt`. The Episode view reads it from the project it already has, so "No craft notes · checked 2 min ago" survives a reload. This is one small contract field. Snapshot history was the first idea, but `GET /snapshots` lists only ancestors of the current head (it leaves out the head and caps at 20), so a "Craft check" snapshot that is the head never shows up.

**The why sentence** never names a scene as "scene n": `story.linkifyNote` turns "scene 11" into a link to the id `scene-11`, which is the wrong scene once scenes move. Name characters and lines, not scene numbers.

### What Plan shows

- **Notes strip:** a "Craft notes · n" group, collapsed like "From the import · n". Each note shows:
  - its check name: "Says the theme out loud" or "Says what they're doing";
  - the excerpt in the script font;
  - the why sentence;
  - **Read more: <source title> ↗**, opening in a new tab, shown only when the check has a vetted source;
  - **Dismiss**, with the existing Undo.
- **Board:** craft notes count toward a card's ⚑ and beat ticks like story notes. Use the import-note tick style (hollow), so a card with only craft notes doesn't read as a continuity problem; the builder may adjust within existing tokens.
- **Episode view:**
  - the **Check craft** button;
  - "n craft notes · m dismissed", and when the last check ran;
  - after a check: "No craft notes" when there are none, otherwise a short summary that links to the first one.

### Sources ("Read more")

- **Where they live:** a static, reviewed list in the web app, e.g. `apps/web/src/plan/craftSources.ts`. Each check has one or two entries of `{ title, by, url, gist }`.
  - `gist` is a one-line paraphrase in our own words. No quotes longer than about 15 words.
  - The model never produces links.
- **Vetting:** every URL is opened and read before it's added, and its gist must match what the page says. The PR lists each source and what was checked.
- **If no source passes vetting** for a check, that check's notes ship without "Read more".
- **Pre-vetted 2026-10-20** (pages read; the owner had no link to the talk they watched):
  - **`on_the_nose`: Guillermo del Toro, BFI**, "Guillermo del Toro's advice for young filmmakers" (https://www.bfi.org.uk/features/guillermo-del-toros-advice-young-filmmakers-stay-untamed-irrational-stubborn). On subtext: "What is left unspoken is larger than what is said." Suggested gist: "del Toro on letting what's unsaid carry the scene."
  - **`on_the_nose`: David Mamet's memo to the writers of *The Unit*** (https://www.slashfilm.com/a-letter-from-david-mamet-to-the-writers-of-the-unit/). Tell the story through what characters do, not what they explain; any "as you know" line means the scene has failed. Suggested gist: "Mamet: show it through what the characters do."
  - **`theme_stated`:** no vetted source yet. Neither page above addresses stating the theme, and No Film School's del Toro interview (https://nofilmschool.com/guillermo-del-toro-writing-directing) supports neither check. Ship this check without "Read more" unless the builder finds and vets a source that does. If the owner later finds the link to the del Toro talk, it's the first choice for this check.

## Constraints

- The CLAUDE.md hard rules: 1 (mock LLM in tests), 3 (schema homes), 4 (snapshots), 5 (no writer text in logs), 7 (`PROMPT_VERSION`), 8 (quiet Write), 9 (one retry), 10 (no new dependencies without flagging).
- UI: tokens only; text no smaller than 11px; never color alone; keyboard reachable; the live region announces a finished check ("Craft check: 5 notes.").
- No contract or schema change for notes (flags reuse). The new op's schema is a contract change in the usual homes.

## Phases

1. **PR 1:**
   - `review_craft` op and prompt;
   - the endpoint and storage, with dismiss stickiness, fixed-line hiding and "last checked";
   - Plan's `craft` kind with the notes-strip group and Episode view button;
   - the vetted sources;
   - tests: mock LLM; server verification drops invented excerpts; a dismissed check on a beat doesn't come back on re-check; a fixed line hides its note; `[craft_*]` notes are not import notes; logs are counts only;
   - a real-API probe of the tool schema;
   - the owner's substitute sign-off on one real check.
2. **PR 2:** the import-time run, inside `checking_consistency`, in the import's single snapshot. It's non-fatal: a failure files nothing and doesn't fail the import.

## Left to the builder

- Exact prompt wording, and how to phrase "strongest first".
- Whether a very long episode's dialogue needs splitting into chunks.
- The button's exact placement in the Episode view, and the copy beyond the check names above.
- The tick and badge styling, within existing tokens.
- Test layout.
