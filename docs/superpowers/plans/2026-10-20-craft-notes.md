# Craft Notes (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Check craft** button in Plan's Episode view runs one model call that finds lines stating the theme outright or characters saying what they're doing, and files them as dismissable craft notes on their beats.

**Architecture:** New LLM op `review_craft`, with a strict, small schema. `drama_manager/craft.py` verifies each excerpt against the beat's script, dedupes and caps the notes, keeps dismissals sticky, and writes them as `ConsistencyFlag`s with `[craft_<check>]` explanation codes in one snapshot. That gives no contract change for notes. Plan reads the `craft` kind from the code and shows the notes in a notes-strip group with vetted "Read more" links.

**Tech Stack:** FastAPI + Pydantic + SQLAlchemy (apps/api), React 18 + TS + Tailwind tokens (apps/web), Zod (packages/contract).

**Spec:** `docs/superpowers/specs/2026-10-20-craft-notes-design.md`

## Global Constraints

- **Checks:** exactly two, `theme_stated` and `on_the_nose`. Labels: "Says the theme out loud" and "Says what they're doing".
- **Cap:** at most **12** notes per check run, strongest first, as the model ranks them.
- **Explanation format:** `[craft_<check>] “<excerpt>” — <why>`, with curly quotes and an em dash with spaces.
- **Snapshot instruction:** `Craft check`.
- **Model:** role `import_analyst`, effort `medium`, `stream_response=True`, `call_timeout_seconds=600.0`, `max_tokens=16_384`.
- **Excerpts:** at most **200** characters.
- **Never in logs:** excerpts or why text (rule 5). Logs carry counts only.
- **Prompt version:** `PROMPT_VERSION` 0.62.0 → **0.63.0**, plus the owner's substitute sign-off in the PR (rule 7, evals on hold).
- **Write stays quiet:** nothing calls the model except the explicit button (rule 8).
- **Styling:** existing `--tr-*` tokens only; no text below 11px; no new dependencies.
- **Sources:** `on_the_nose` gets the BFI del Toro piece and Mamet's memo (URLs and gists as in the spec). `theme_stated` has no source, so it shows no "Read more".
- **Commands:** run checks directly (`apps/api/.venv/bin/pytest`, `npx --no-install vitest|tsc|eslint|prettier`), never through `make`, which would rebuild the shared venv.

## Review Focus

1. **Excerpt typography differs from the script** (curly vs straight quotes, extra spaces): the note is still verified, because `locate_quote` folds typography. Test in Task 3.
2. **No story overview yet** (an old import, or the overview step skipped): the prompt omits the About block rather than sending empty strings, and the check still runs. Test in Task 2.
3. **Locked episode or beats:** the check still runs, the doc stays unchanged, and notes can sit on locked beats. Test in Task 3.
4. **The writer edits the line after a check:** Plan hides the note right away, and the next check marks it `resolved`. Tests in Tasks 3 and 4.
5. **Another tab saved first:** stale `If-Match` returns 409 `CONFLICT_STALE_HEAD` and nothing is saved. Test in Task 3.

---

### Task 1: The `review_craft` op in every schema home

**Files:**
- Modify: `packages/contract/src/index.ts`, after `SceneMotivations`. Add:
  ```ts
  CraftCheck = z.enum(['theme_stated','on_the_nose'])
  CraftReview = z.object({ notes: z.array(z.object({ check: CraftCheck, sceneId: Id, beatId: Id, excerpt: z.string(), why: z.string() })) })
  ```
- Modify: `apps/api/schemas.py`. Add `CraftCheck` (`StrEnum`), `InferredCraftNote` and `CraftReview(notes: list[InferredCraftNote])`.
- Modify: `apps/api/llm/ops.py`. Add `LlmOp("review_craft", "CraftReview", CraftReview, "import_analyst", <description>, max_tokens=16_384, call_timeout_seconds=600.0, stream_response=True, effort="medium")`.
- Modify: `apps/api/llm/protocol.py`, `llm/anthropic_client.py` and `llm/mock.py`. Add the `review_craft(*, system, user_message, prompt_version) -> CraftReview` method. The mock's default response is one `on_the_nose` note on `scene-3` / `beat-3-1`, with an excerpt copied from the fixture's beat-3-1 `scriptText`.
- Modify: `packages/contract/scripts/export-json-schema.ts` and `scripts/check_contract.py`. Add `'CraftReview'`.
- Generate: `config/tool_schemas/review_craft.json`, via `apps/api/.venv/bin/python scripts/generate_tool_schemas.py`.
- Modify: `docs/tableread-data-contract.md` §2a (the `CraftReview` block) and `docs/tableread-prompt-spec.md` (new §5d `review_craft`: purpose, input, output, server rules).
- Test: `packages/contract/src/index.test.ts`, `apps/api/tests/test_llm_ops.py` (`EXPECTED_OPS["review_craft"] = "import_analyst"`), `apps/api/tests/test_llm_anthropic_client.py` (`_fixture_valid_input_for` gets `"review_craft": {"notes": []}`).

**Interfaces:**
- Produces: `CraftReview`, `InferredCraftNote{check, scene_id, beat_id, excerpt, why}`, `CraftCheck`, and `LlmClient.review_craft`.

- [ ] **Step 1: Write the failing tests.**
  - The Zod round-trip `CraftReview.parse({notes:[{check:'on_the_nose',sceneId:'scene-1',beatId:'beat-1-1',excerpt:'I am so angry.',why:'…'}]})` equals its input.
  - An unknown `check` throws.
  - Add `EXPECTED_OPS` and the fake-SDK input entry.
- [ ] **Step 2:** Run `npm test --workspace=packages/contract` and `apps/api/.venv/bin/pytest -q tests/test_llm_ops.py tests/test_llm_anthropic_client.py`. Expected: FAIL (no `CraftReview` / `review_craft`).
- [ ] **Step 3:** Implement the files listed, then regenerate the tool schemas.
- [ ] **Step 4:** Run the Step 2 commands plus `apps/api/.venv/bin/python scripts/check_contract.py`. Expected: PASS, and `check-contract: OK (78 schemas …)`.
- [ ] **Step 5:** Commit: `contract: add the review_craft op (craft notes)`.

### Task 2: The craft prompt

**Files:**
- Modify: `apps/api/drama_manager/render.py`.
  - Add `build_craft_prompt(project: dict, overview: dict, cast: list[str], scenes: list[dict], nonce: str) -> tuple[str, str]`.
  - Bump `PROMPT_VERSION = "0.63.0"`, with a history line.
- Create: `apps/api/drama_manager/craft.py` with only `dialogue_lines(script_text: str) -> list[str]` for now: each cue line plus its dialogue lines, parentheticals dropped. Reuse `promises._CHARACTER_CUE` and `_PARENTHETICAL` by importing them, not copying.
- Test: `apps/api/tests/test_render.py` and `apps/api/tests/test_craft.py`.

**Interfaces:**
- Consumes: nothing from Task 1 except the op name.
- Produces:
  - `craft.dialogue_lines`;
  - `craft.craft_spine(episode: dict) -> list[dict]`, shaped `[{sceneId, beats: [{beatId, dialogue: [str]}]}]` in board order, leaving out beats with no dialogue;
  - `render.build_craft_prompt`.

- [ ] **Step 1: Write the failing tests.**
  - `test_dialogue_lines_keeps_cue_and_speech_drops_action`: `"INT. BAR\nMarta wipes the bar.\nMARTA\n(quiet)\nI know what you did."` → `["MARTA", "I know what you did."]`.
  - `test_craft_prompt_carries_overview_cast_and_spine`: the user turn contains `source_data` blocks of kind `story_overview`, `known_cast` and `craft_spine`, plus the instruction text "at most 12" and both check names.
  - `test_craft_prompt_without_overview_omits_it` (Review Focus 2): with `overview={}`, there's no `kind="story_overview"` block.
- [ ] **Step 2:** Run `apps/api/.venv/bin/pytest -q tests/test_render.py tests/test_craft.py -k craft`. Expected: FAIL.
- [ ] **Step 3:** Implement. The prompt text must:
  - define both checks in the spec's words;
  - ask for the excerpt copied verbatim from one beat's dialogue, at most 200 characters;
  - ask for one plain why sentence that never says "scene n";
  - ask for at most 12 notes, strongest first, and say returning none is fine;
  - use names only, never ids.
- [ ] **Step 4:** Run the Step 2 command. Expected: PASS.
- [ ] **Step 5:** Commit: `prompt: craft review prompt (PROMPT_VERSION 0.63.0)`.

### Task 3: Run the check and store the notes

**Files:**
- Modify: `apps/api/drama_manager/craft.py`. Add:
  - `run_craft_check(session, project, llm, *, expected_head_snapshot_id: str) -> dict` (returns the project wire dict);
  - `class CraftCheckNotReady(Exception)`;
  - `craft_flags(review: CraftReview, episode: dict, existing_flags: list[dict]) -> tuple[list[dict], list[dict]]`, returning `(new_flags, next_existing_flags)`.
- Modify: `apps/api/routes.py`. Add `POST /{pid}/craft-check`, modeled on `check_structure`:
  - `If-Match` guard → 409 `CONFLICT_STALE_HEAD`;
  - `CraftCheckNotReady` → 409 `CRAFT_CHECK_NOT_READY` ("The script has no beats to check yet.");
  - `SchemaInvalidLlmError` → 502;
  - `anthropic.APIError` / `LlmTimeoutError` → 503 `LLM_UNAVAILABLE`.
- Modify: `docs/tableread-data-contract.md` §4. Add the endpoint line, and `CRAFT_CHECK_NOT_READY` to the code list.
- Test: `apps/api/tests/test_craft.py`.

**Rules `craft_flags` applies, in order:**
1. **Drop a note** when its `beatId` isn't a beat of `sceneId` in the episode, or when `ledger_policy.locate_quote(beat.scriptText, excerpt, 1, n_lines)` returns `(None, None)`.
2. **Dedupe** by `(check, beatId)`, keeping the first, and **cap at 12**.
3. **Skip a note** whose `(check, beatId)` matches an existing *dismissed* craft flag.
4. **Existing open craft flags:**
   - one whose excerpt no longer locates in its beat becomes `resolved`;
   - every other open craft flag is removed, replaced by this run's notes.
5. **Leave non-craft flags untouched.**
6. **New flags:**
   - `id` minted with `IdMinter(existing ids, "flag-")`;
   - `objectType: "beat"`, `objectId: beatId`, `factId: None`;
   - `severity: "tension"`, `status: "open"`;
   - `sourceChange`: the snapshot id, stamped in the mutator;
   - `explanation`: `f"[craft_{check}] “{excerpt}” — {why}"`, with the excerpt trimmed to 200 characters.

**Logging:** one line, `craft_check project=%s snapshot=%s notes=%d kept=%d unverified=%d duplicate=%d dismissed_skip=%d resolved=%d prompt_version=%s`.

**Interfaces:**
- Consumes: `CraftReview` (Task 1), `craft_spine` / `build_craft_prompt` (Task 2).
- Produces:
  - the HTTP endpoint `POST /api/v1/projects/{pid}/craft-check` → `Project`;
  - the flag explanation format above, which Task 4 parses.

- [ ] **Step 1: Write the failing tests** (mock LLM via `set_response("review_craft", …)`):
  - `test_check_files_verified_notes_as_craft_flags`: one valid note → one open flag with the exact explanation format, on the beat; the snapshot instruction is `Craft check`.
  - `test_invented_excerpt_and_foreign_beat_are_dropped`.
  - `test_curly_quotes_still_verify` (Review Focus 1): the excerpt uses “ ” where the script has `"`.
  - `test_duplicates_collapse_and_cap_is_12`: 15 notes on distinct beats → 12 flags.
  - `test_dismissed_check_on_a_beat_is_not_refiled`: dismiss, re-check with a different excerpt span on the same beat → no new flag.
  - `test_recheck_replaces_open_craft_notes_and_leaves_other_flags`.
  - `test_fixed_line_resolves_on_recheck` (Review Focus 4).
  - `test_locked_episode_runs_and_doc_unchanged` (Review Focus 3): `project.doc` before equals after, apart from the head.
  - `test_stale_if_match_is_409_and_saves_nothing` (Review Focus 5).
  - `test_no_beats_is_409_not_ready`.
  - `test_logs_never_carry_excerpts`: `caplog.text` doesn't contain the excerpt or the why text.
- [ ] **Step 2:** Run `apps/api/.venv/bin/pytest -q tests/test_craft.py`. Expected: FAIL.
- [ ] **Step 3:** Implement `craft.py` and the route.
- [ ] **Step 4:** Run `apps/api/.venv/bin/pytest -q` (the full suite). Expected: PASS.
- [ ] **Step 5:** Commit: `craft: run a craft check and keep its notes as dismissable flags`.

### Task 4: Plan reads craft notes

**Files:**
- Modify: `apps/web/src/plan/story.ts`.
  - `FlagKind` gains `'craft'`. `flagKind` tests `/^\[craft_(theme_stated|on_the_nose)\]/` **before** `importCode`.
  - Add `craftNote(flag): { check: CraftCheck; excerpt: string; why: string } | null`, which parses the explanation format.
  - Add `excerptInBeat(excerpt, scriptText): boolean`, a case-sensitive match after folding curly quotes and dashes and collapsing whitespace.
  - `notesForScene` drops an open craft note whose excerpt is no longer in its beat.
  - Sort order: story notes, then craft, then import.
  - In `boardModel`, a beat whose only notes are craft notes gets the hollow `'import'` tick, not the amber `'story'` one (spec: a card with only craft notes must not read as a continuity problem). Craft notes still count as story notes for ⚑, N / Shift+N and the None lens.
- Create: `apps/web/src/plan/craftSources.ts`:
  - `export type CraftCheck = 'theme_stated' | 'on_the_nose'`, defined here. The web never parses a `CraftReview`, so it doesn't need the contract type;
  - `CRAFT_LABELS: Record<CraftCheck, string>`;
  - `CRAFT_SOURCES: Record<CraftCheck, {title, by, url, gist}[]>`, with `on_the_nose` holding the two vetted entries and `theme_stated: []`.
- Modify: `apps/web/src/api/client.ts`. Add `checkCraft(projectId, opts?: IfMatchOpts): Promise<Project>` → `POST /projects/{pid}/craft-check`.
- Modify: `apps/web/src/plan/panel/NotesStrip.tsx`. Add a "Craft notes · n" `<details>` group (`data-testid="notes-craft-group"`) between the story notes and the import group. Each note shows:
  - the label;
  - the excerpt in `font-script`;
  - the why sentence;
  - "Read more: {title} ↗" (`target="_blank" rel="noreferrer"`) for each source;
  - `dismissButton(note, 'Dismiss')`.
  The summary counts craft notes the same way as import notes ("· m craft").
- Test: `story.test.ts` and `panel/NotesStrip.test.tsx`.

**Interfaces:**
- Consumes: the explanation format (Task 3) and the endpoint (Task 3).
- Produces: `checkCraft`, `craftNote`, `CRAFT_LABELS`, `CRAFT_SOURCES`, and `FlagKind 'craft'`.

- [ ] **Step 1: Write the failing tests.**
  - `flagKind` of `[craft_on_the_nose] “x” — y` is `'craft'`, not `'import'`.
  - `craftNote` parses the check, excerpt and why.
  - `notesForScene` hides a craft note whose excerpt left the beat (Review Focus 4) and orders story, then craft, then import.
  - `boardModel` ticks a craft-only beat `'import'`.
  - NotesStrip renders the group with the label, the excerpt, a "Read more" link with the BFI URL for `on_the_nose`, no link for `theme_stated`, and a Dismiss that calls `onDismiss(flagId)`.
- [ ] **Step 2:** Run `cd apps/web && npx --no-install vitest run src/plan/story.test.ts src/plan/panel/NotesStrip.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Step 2 command. Expected: PASS.
- [ ] **Step 5:** Commit: `plan: show craft notes in the notes strip with vetted sources`.

### Task 5: Check craft in the Episode view

**Files:**
- Modify: `apps/web/src/plan/panel/EpisodeView.tsx`.
  - Add a "Craft notes" section: a **Check craft** button, the line "n craft notes · m dismissed", and "Checked <relative time>" or "Not checked yet".
  - Update the docstring: this button is the one explicit model call.
  - New props: `craft: { open: number; dismissed: number; checkedAt: string | null; busy: boolean; error: string | null }` and `onCheckCraft: () => void`.
- Modify: `apps/web/src/plan/PlanScreen.tsx`.
  - `runCraftCheck` calls `checkCraft(pid, {ifMatch: head})`, then `setProject`, then `getConsistencyFlags(pid)` (all statuses) to set open flags and counts, then reads `listProjectSnapshots(pid)` for the latest `instruction === 'Craft check'` `ts`.
  - Announce in `plan-live`: "Craft check: n notes." or "Craft check: no notes."
  - On error, set `craft.error` to the API message, with nothing else changed.
  - Load `checkedAt` and the counts once with the project load (GETs only, no model).
- Test: `panel/EpisodeView.test.tsx` and `PlanScreen.test.tsx`, with `api/client` mocked as those tests already do.

**Interfaces:**
- Consumes: `checkCraft` (Task 4), `listProjectSnapshots` and `getConsistencyFlags` (existing).

- [ ] **Step 1: Write the failing tests.**
  - The Episode view shows the button and "Not checked yet"; clicking it calls `onCheckCraft` once.
  - The busy state disables it, and the error text renders.
  - PlanScreen: clicking Check craft calls `checkCraft` with `ifMatch`, refreshes flags, and announces "Craft check: 1 note.".
  - Nothing calls `checkCraft` on mount or on scene select.
- [ ] **Step 2:** Run `cd apps/web && npx --no-install vitest run src/plan/panel/EpisodeView.test.tsx src/plan/PlanScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cd apps/web && npx --no-install vitest run && npx --no-install tsc -b`. Expected: PASS.
- [ ] **Step 5:** Commit: `plan: a Check craft button in the Episode view`.

### Task 6: Docs, a real-API probe, and the full gate

**Files:**
- Modify: `docs/tableread-build-plan.md`. Add **T10.13 Craft notes (PR 1)** with the spec's acceptance criteria.
- Modify: `docs/superpowers/specs/2026-10-13-plan-redesign-design.md` §4.6 (the craft group in the notes strip) and §4.7 (the Check craft section).

- [ ] **Step 1:** Probe `config/tool_schemas/review_craft.json` against the real API with the scratchpad `probe_versions.py` (`max_tokens: 1`, no script text), run in the owner's terminal where the key lives. Expected: `ACCEPTED`. If it's refused, shrink the schema before anything else.
- [ ] **Step 2: Run the full gate.**
  - `apps/api/.venv/bin/python scripts/check_contract.py` → OK.
  - `apps/api/.venv/bin/pytest -q` → all pass.
  - `ruff check .` and `ruff check --config pyproject.toml ../../scripts` → clean.
  - `npm test --workspaces`, `npm run lint --workspaces` (0 errors), `npm run format:check --workspaces` and `cd apps/web && npx --no-install tsc -b` → clean.
  - `python3 scripts/check_design_gaps.py` → OK.
  - Playwright e2e with the temporary `local-browser.config.ts` (ports 8211/5311, deleted after) → all pass.
- [ ] **Step 3:** Commit the docs (`docs: craft notes in the build plan and Plan spec`), push, and open the PR. Its body quotes the acceptance criteria with pass/fail, includes the probe result, lists the sources and what was vetted, asks for the owner's substitute sign-off (one real Check craft on *Lisa's Substitute*), and notes no new dependencies.
