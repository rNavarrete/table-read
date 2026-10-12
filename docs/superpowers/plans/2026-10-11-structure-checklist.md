# Structure Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Ledger **Structure** tab. It checks the script against TV act structure (no AI), the Hero's Journey, Story Circle and Save the Cat (AI, writer-triggered), and shows every stage as Hit, Thin, Missing or Couldn't verify, linked to the beat in Write.

**Architecture:**

- **TV act structure:** derived in the browser from the import's existing beat sheet.
- **AI structures:**
  - One synchronous `POST` per structure runs one Opus call (`check_structure`) over a compact spine of the import's breakdown.
  - Server-side validation follows, with one retry.
  - One Sonnet call (`verify_structure_check`) then judges each cited stage against its beat; unsupported stages are downgraded, never dropped.
  - The result is saved in `episode.structureChecks` with one snapshot.
- **Staleness:** a SHA-256 fingerprint of scene/beat ids plus `scriptText`, computed identically in Python and TypeScript.

**Tech Stack:** FastAPI + Pydantic (Python 3.12), Zod 4 contract, React 18 + TS + Tailwind, Vitest, Playwright, `MockLlmClient`.

**Spec:** `docs/superpowers/specs/2026-10-11-structure-checklist-design.md`. Read it first; this plan argues from it.

**Code patterns:** `/private/tmp/claude-501/-Users-rolandonavarrete-Documents-tableread/e01f6f26-992e-40b8-b7ce-ce2105b26759/scratchpad/structure-patterns.md` holds verbatim excerpts, with file:line, of every existing pattern this plan copies. When a step says "copy the pattern for X", it is there.

## Execution shape (parallel)

```
Task 1 (contract + LLM ops + prompts)          ← one agent, first
        ├── Task 2 (backend domain + route)    ← agent A ┐ in parallel,
        └── Task 3 (web Structure tab)         ← agent B ┘ separate worktrees
Task 4 (merge, e2e, docs, gates, PR)           ← last
```

Tasks 2 and 3 share only what Task 1 produces, plus the interfaces fixed below. Neither may edit a file the other owns.

## Global Constraints

- **Never touch the live checkout.**
  - Never edit `/Users/rolandonavarrete/Documents/tableread`: its dev API runs `uvicorn --reload` and restarts on any `.py` change.
  - Work only in your assigned worktree under `/private/tmp/claude-501/-Users-rolandonavarrete-Documents-tableread/e01f6f26-992e-40b8-b7ce-ce2105b26759/scratchpad/`.
- **Do not run `make` in a worktree.** It would try to rebuild the venv. Run tools directly:
  - Python: `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/python` (also `/pytest`, `/ruff` in the same `bin`).
  - Prefix with `PYTHONDONTWRITEBYTECODE=1` and pass `-p no:cacheprovider` to pytest.
  - JS: `npx …` from the worktree root. `node_modules` is pre-built there and resolves `contract` to the worktree's own `packages/contract`.
- **Rule 1:** never call the Anthropic API in tests; use `MockLlmClient`.
- **Never run `make evals`.** The owner put evals on hold; sign-off is a hand check (Task 4).
- **Rule 3:** schema changes go to every home: Zod, Pydantic, `docs/tableread-data-contract.md`, `docs/tableread-prompt-spec.md`, regenerated `config/tool_schemas/`.
- **Rule 4:** all doc writes go through `storage/snapshots.mutate`.
- **Rule 5:** logs carry ids, lens, stage counts and `PROMPT_VERSION` only, never reasons, quotes or script text.
- **Rule 6:** no hardcoded colors or spacing in components. Use tokens (`--tr-*` via Tailwind theme classes) and the `Chip` hues `sage | sky | amber | neutral` only.
- **Rule 7:** `PROMPT_VERSION` → `"0.51.0"`, with a newest-first history line.
- **Rule 8:** nothing runs in Write and nothing runs on mount. The AI check starts only from the **Check structure** click.
- **Rule 10:** no new dependencies.
- **Contract package:** imported as `'contract'` (`import type { … } from 'contract'`). `tsconfig` has `verbatimModuleSyntax`, so type-only imports use `import type`.
- **Formatting:** prettier (no semicolons, single quotes); ruff line length 100.
- **Vitest:** any file that renders declares `// @vitest-environment jsdom`. There are no jest-dom matchers; assert with `.not.toBeNull()` and `textContent`.
- **No Zod in the web:** never write `z.object(` under `apps/web/src`; check_contract's grep gate fails on it.
- **Structure ids are fixed:**
  - `StructureLens = 'heros_journey' | 'story_circle' | 'save_the_cat'`
  - the web-only pick adds `'tv_act_structure'`
  - Story Circle stage ids are prefixed `circle_`.
- **Copy (exact):**
  - button: `Check structure`
  - cost line: `About 25¢, under a minute.`
  - doesn't-fit button: `Check TV act structure instead`
  - stale line: `The script changed since this check.`, with button `Check again`
  - status labels: `Hit`, `Thin`, `Missing`, `Couldn't verify`.
- **Commits:** `area: imperative summary`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **No beat sheet** (`storyOverview` null, as on the seeded fixture): TV act structure lists every stage as Missing and does not crash. Pinned in Task 3 (`tvActStructure.test.ts`).
2. **No format yet** (`project.format` null): the panel says `The show format isn't known yet.` instead of a list. Pinned in Task 3 (`StructurePanel.test.tsx`).
3. **A cited beat with empty `scriptText`** (fixture `beat-5-1`): the stage saves with `evidenceQuote: null` and the row renders without a quote. Pinned in Task 2 (`test_empty_beat_text_saves_null_quote`) and Task 3.
4. **The script edited after a check:** the stale line appears, and **Check again** replaces that structure's entry instead of adding a second. Pinned in Task 2 (`test_rerun_replaces_the_lens_entry`) and Task 3 (`stale line` test).
5. **Double click or a moved head:** the button is disabled while a check runs, and a 409 `CONFLICT_STALE_HEAD` shows `The script changed while checking. Reload and try again.`. Pinned in Task 3 (`busy` and `error` tests).

## Fixed interfaces (all tasks)

**Python, Task 1 → Task 2:**

```python
# apps/api/drama_manager/structure_stages.py
STRUCTURE_STAGES: dict[str, tuple[tuple[str, str], ...]]  # lens -> ((stage_id, label), ...) canonical order
STRUCTURE_NAMES: dict[str, str]  # lens -> display name used in prompts

# apps/api/drama_manager/render.py
def build_structure_check_prompt(
    project: dict, lens: str, spine: dict, nonce: str, diagnostics: list[dict] | None = None
) -> tuple[str, str]: ...
def build_structure_verification_prompt(
    project: dict, lens: str, claims: list[dict], nonce: str
) -> tuple[str, str]: ...

# llm client (protocol / anthropic / mock), keyword-only like every op
def check_structure(self, *, system: str, user_message: str, prompt_version: str) -> InferredStructureCheck: ...
def verify_structure_check(self, *, system: str, user_message: str, prompt_version: str) -> StructureCheckVerification: ...
```

**Spine dict** (Task 2 builds it; Task 1's prompt and mock read it):

```python
{
  "storyOverview": {"logline": str, "summary": str,
                    "beatSheet": [{"beatId": str, "label": str, "sceneId": str | None, "act": int | None}]},
  "threads": [{"id": str, "label": str, "summary": str, "status": str,
               "setupBeatId": str | None, "payoffBeatId": str | None}],
  "scenes": [{"sceneId": str, "act": int, "heading": str, "whatHappens": str, "audienceLearns": str,
              "beats": [{"beatId": str, "whatHappens": str}]}],
}
```

**Prompt blocks** (`render.source_data(kind, value, nonce)`). The check prompt emits:

- `show_format`
- `story_overview`, from `spine["storyOverview"]`
- `story_threads`, from `spine["threads"]`
- `scene_spine`, from `spine["scenes"]`
- `required_stages`: `[{"stage", "label"}]`
- on retry, also `structure_check_repairs`, the diagnostics.

The verification prompt emits `claims`: `[{"stage", "label", "status", "claim", "beatId", "excerpt"}]`.

**HTTP, Task 2 → Task 3:** `POST /api/v1/projects/{pid}/structure-checks/{lens}`

- Request: empty JSON body `{}`, header `If-Match: <headSnapshotId>`.
- Responses:
  - **200:** the updated `Project`.
  - **400 `VALIDATION`:** unknown lens, `tv_act_structure` included.
  - **404 `NOT_FOUND`.**
  - **409:** `CONFLICT_STALE_HEAD` or `STRUCTURE_CHECK_NOT_READY`.
  - **502:** `SCHEMA_INVALID_LLM`.
  - **503:** `LLM_UNAVAILABLE`.

**Fingerprint (Python and TS must agree):**

- Concatenate, over `episode.scenes` in order and each scene's `beats` in order: `sceneId + "\x1f" + beatId + "\x1f" + (scriptText or "") + "\x1e"`.
- Take the SHA-256 of the UTF-8 string, as lowercase hex.
- **Test vector:** scenes `[{id:'scene-1', beats:[{id:'beat-1-1', scriptText:'INT. BAR - NIGHT\nMarta pours.'}, {id:'beat-1-2', scriptText:'Café — “ok”'}]}, {id:'scene-2', beats:[]}, {id:'scene-3', beats:[{id:'beat-3-1'}]}]` → `b9c534c0bc4d1db690a5d82bb4c0e4a9f87ec02be3119977227131d62c27735f`. No beats at all → `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

---

### Task 1: Contract, LLM ops, prompts and mock

**Files:**

- Modify:
  - `packages/contract/src/index.ts` (types after `NarrativeMapRun` ends ~:503; `Episode.structureChecks` last field ~:540; op schemas after `NarrativeMapVerification` ~:1409)
  - `packages/contract/src/index.test.ts`
  - `packages/contract/scripts/export-json-schema.ts` (`SCHEMA_NAMES`)
  - `scripts/check_contract.py` (`SCHEMA_NAMES` :51-127)
  - `apps/api/schemas.py` (persisted classes before `class Episode` :474; `structure_checks` last Episode field; op classes near :1291)
  - `apps/api/llm/ops.py` (`_OPS` + imports)
  - `apps/api/llm/protocol.py`
  - `apps/api/llm/anthropic_client.py` (methods + schemas import :42-59)
  - `apps/api/llm/mock.py` (static defaults :520-526, methods, dynamic builders)
  - `apps/api/drama_manager/render.py` (`PROMPT_VERSION` :147 + history comment :27-28; two builders)
  - tests that enumerate ops: `apps/api/tests/test_llm_ops.py:5-23`, `apps/api/tests/test_llm_mock.py`
  - the 9 web test files that build full `Episode` literals ending in `narrativeMap: null`. Add `structureChecks: [],` to each:
    - `apps/web/src/write/projectTree.test.ts:71`
    - `apps/web/src/plan/useProjectPatch.test.ts:164`
    - `apps/web/src/plan/needsGuidedSetup.test.ts:78`
    - `apps/web/src/plan/Inspector.test.tsx:75`
    - `apps/web/src/plan/StoryLayersPanel.test.tsx:45`
    - `apps/web/src/plan/flaggedScenes.test.ts:82`
    - plus any others `npx tsc -b` reports
  - `docs/tableread-data-contract.md` (§1 types near the narrative map types :151-262; §2a op schemas, fence closes ~:1096; §4 error codes ~:1195: add `STRUCTURE_CHECK_NOT_READY`)
  - `docs/tableread-prompt-spec.md` (line 3 version → 0.51.0; add `### 5e. Structure check` after §5d ~:524)
- Create:
  - `apps/api/drama_manager/structure_stages.py`
  - `config/tool_schemas/check_structure.json`, `config/tool_schemas/verify_structure_check.json` (generated)
  - `apps/api/tests/test_structure_prompts.py`

**Interfaces:**

- Consumes: nothing new.
- Produces: everything in "Fixed interfaces / Python", the Zod and Pydantic types below, and the dynamic mock that e2e relies on.

- [ ] **Step 1: Add the stage table.** Create `apps/api/drama_manager/structure_stages.py`:

```python
"""Canonical stage order and labels for the AI structure checks (spec 2026-10-11).

The web keeps its own copy for display (apps/web/src/ledger/structure/stages.ts);
both follow the spec's lists, and tests on each side pin the order.
"""

from __future__ import annotations

STRUCTURE_NAMES: dict[str, str] = {
    "heros_journey": "the Hero's Journey",
    "story_circle": "Dan Harmon's Story Circle",
    "save_the_cat": "Save the Cat (Blake Snyder's beat sheet)",
}

STRUCTURE_STAGES: dict[str, tuple[tuple[str, str], ...]] = {
    "heros_journey": (
        ("ordinary_world", "Ordinary world"),
        ("call_to_adventure", "Call to adventure"),
        ("refusal", "Refusal of the call"),
        ("meeting_the_mentor", "Meeting the mentor"),
        ("crossing_the_threshold", "Crossing the threshold"),
        ("tests_allies_enemies", "Tests, allies, enemies"),
        ("approach", "Approach to the inmost cave"),
        ("ordeal", "Ordeal"),
        ("reward", "Reward"),
        ("road_back", "The road back"),
        ("resurrection", "Resurrection"),
        ("return_with_elixir", "Return with the elixir"),
    ),
    "story_circle": (
        ("circle_you", "You (comfort zone)"),
        ("circle_need", "Need"),
        ("circle_go", "Go"),
        ("circle_search", "Search"),
        ("circle_find", "Find"),
        ("circle_take", "Take"),
        ("circle_return", "Return"),
        ("circle_change", "Change"),
    ),
    "save_the_cat": (
        ("opening_image", "Opening image"),
        ("theme_stated", "Theme stated"),
        ("set_up", "Set-up"),
        ("catalyst", "Catalyst"),
        ("debate", "Debate"),
        ("break_into_two", "Break into two"),
        ("b_story", "B story"),
        ("fun_and_games", "Fun and games"),
        ("midpoint", "Midpoint"),
        ("bad_guys_close_in", "Bad guys close in"),
        ("all_is_lost", "All is lost"),
        ("dark_night_of_the_soul", "Dark night of the soul"),
        ("break_into_three", "Break into three"),
        ("finale", "Finale"),
        ("final_image", "Final image"),
    ),
}
```

- [ ] **Step 2: Zod types.** In `packages/contract/src/index.ts`, after `NarrativeMapRun`:

```ts
// Structure checklist (spec 2026-10-11). TV act structure is derived in the
// web and never stored, so it is not a lens here.
export const StructureLens = z.enum(['heros_journey', 'story_circle', 'save_the_cat'])
export type StructureLens = z.infer<typeof StructureLens>

export const StructureStageName = z.enum([
  ...HeroJourneyStageName.options,
  'circle_you',
  'circle_need',
  'circle_go',
  'circle_search',
  'circle_find',
  'circle_take',
  'circle_return',
  'circle_change',
  'opening_image',
  'theme_stated',
  'set_up',
  'catalyst',
  'debate',
  'break_into_two',
  'b_story',
  'fun_and_games',
  'midpoint',
  'bad_guys_close_in',
  'all_is_lost',
  'dark_night_of_the_soul',
  'break_into_three',
  'finale',
  'final_image',
])
export type StructureStageName = z.infer<typeof StructureStageName>

export const StructureStageStatus = z.enum(['hit', 'thin', 'missing', 'unverified'])
export type StructureStageStatus = z.infer<typeof StructureStageStatus>

export const StructureStage = z.object({
  stage: StructureStageName,
  status: StructureStageStatus,
  beatId: Id.nullable(),
  sceneId: Id.nullable(),
  reason: z.string(),
  evidenceQuote: z.string().min(1).max(200).nullable(),
})
export type StructureStage = z.infer<typeof StructureStage>

export const StructureCheck = z.object({
  lens: StructureLens,
  applies: z.boolean(),
  rationale: z.string(),
  stages: z.array(StructureStage),
  sourceHash: z.string().min(1),
  checkedAt: z.string(),
  promptVersion: z.string(),
})
export type StructureCheck = z.infer<typeof StructureCheck>
```

Add as the last `Episode` field: `structureChecks: z.array(StructureCheck).default([]),`, with a comment: `// At most one per lens; a new check replaces that lens's entry.`

In the §2a block, after `NarrativeMapVerification`:

```ts
const InferredStructureStage = z.object({
  stage: StructureStageName,
  status: z.enum(['hit', 'thin', 'missing']),
  beatId: Id.nullable(),
  reason: z.string(),
})

export const InferredStructureCheck = z.object({
  applies: z.boolean(),
  rationale: z.string(),
  stages: z.array(InferredStructureStage),
})
export type InferredStructureCheck = z.infer<typeof InferredStructureCheck>

// `supported` is declared LAST so the model reasons before it answers (same
// decoding-order argument as NarrativeMapVerification.excerptCarriesClaim).
export const StructureCheckVerification = z.object({
  stages: z.array(
    z.object({
      stage: StructureStageName,
      reason: z.string(),
      supported: z.boolean(),
    }),
  ),
})
export type StructureCheckVerification = z.infer<typeof StructureCheckVerification>
```

- [ ] **Step 3: Pydantic mirrors.**
  - In `apps/api/schemas.py`, follow the `HeroJourney*` pattern: subclass `_Base`, use snake_case fields, and give `StrEnum`s identical values.
  - `StructureStageName` must list all 35 values explicitly.
  - Before `class Episode`:

```python
class StructureLens(StrEnum):
    heros_journey = "heros_journey"
    story_circle = "story_circle"
    save_the_cat = "save_the_cat"


class StructureStageName(StrEnum):
    ordinary_world = "ordinary_world"
    call_to_adventure = "call_to_adventure"
    refusal = "refusal"
    meeting_the_mentor = "meeting_the_mentor"
    crossing_the_threshold = "crossing_the_threshold"
    tests_allies_enemies = "tests_allies_enemies"
    approach = "approach"
    ordeal = "ordeal"
    reward = "reward"
    road_back = "road_back"
    resurrection = "resurrection"
    return_with_elixir = "return_with_elixir"
    circle_you = "circle_you"
    circle_need = "circle_need"
    circle_go = "circle_go"
    circle_search = "circle_search"
    circle_find = "circle_find"
    circle_take = "circle_take"
    circle_return = "circle_return"
    circle_change = "circle_change"
    opening_image = "opening_image"
    theme_stated = "theme_stated"
    set_up = "set_up"
    catalyst = "catalyst"
    debate = "debate"
    break_into_two = "break_into_two"
    b_story = "b_story"
    fun_and_games = "fun_and_games"
    midpoint = "midpoint"
    bad_guys_close_in = "bad_guys_close_in"
    all_is_lost = "all_is_lost"
    dark_night_of_the_soul = "dark_night_of_the_soul"
    break_into_three = "break_into_three"
    finale = "finale"
    final_image = "final_image"


class StructureStageStatus(StrEnum):
    hit = "hit"
    thin = "thin"
    missing = "missing"
    unverified = "unverified"


class StructureStage(_Base):
    stage: StructureStageName
    status: StructureStageStatus
    beat_id: Id | None
    scene_id: Id | None
    reason: str
    evidence_quote: str | None = Field(min_length=1, max_length=200)


class StructureCheck(_Base):
    lens: StructureLens
    applies: bool
    rationale: str
    stages: list[StructureStage]
    source_hash: str = Field(min_length=1)
    checked_at: str
    prompt_version: str
```

Add `structure_checks: list[StructureCheck] = []` as the last `Episode` field. Near the narrative-map op classes (~:1291):

```python
class InferredStructureStage(_Base):
    stage: StructureStageName
    status: Literal["hit", "thin", "missing"]
    beat_id: Id | None
    reason: str


class InferredStructureCheck(_Base):
    applies: bool
    rationale: str
    stages: list[InferredStructureStage]


class StructureCheckVerdict(_Base):
    stage: StructureStageName
    reason: str
    supported: bool


class StructureCheckVerification(_Base):
    stages: list[StructureCheckVerdict]
```

Register `StructureCheck`, `InferredStructureCheck` and `StructureCheckVerification` (plus `StructureStage`, `StructureLens`, `StructureStageName` and `StructureStageStatus`, wherever the existing lists name nested persisted types) in **both** `SCHEMA_NAMES` lists. If `check_contract` reports a mismatch on the inline `status` enum, export a named enum on both sides (`InferredStructureStageStatus`) and use it. Don't hand-edit the schema JSON.

- [ ] **Step 4: Contract test.** Append to `packages/contract/src/index.test.ts`, following its existing `describe` / `safeParse` style:

```ts
describe('StructureCheck', () => {
  const stage = {
    stage: 'circle_you',
    status: 'hit',
    beatId: 'beat-1-1',
    sceneId: 'scene-1',
    reason: 'Marta at the bar.',
    evidenceQuote: 'Marta pours.',
  }
  const check = {
    lens: 'story_circle',
    applies: true,
    rationale: 'Fits.',
    stages: [stage],
    sourceHash: 'abc',
    checkedAt: '2026-10-11T00:00:00Z',
    promptVersion: '0.51.0',
  }
  it('accepts a check and a missing stage with null beat and quote', () => {
    expect(StructureCheck.safeParse(check).success).toBe(true)
    expect(
      StructureStage.safeParse({ ...stage, status: 'missing', beatId: null, sceneId: null, evidenceQuote: null }).success,
    ).toBe(true)
  })
  it('rejects tv_act_structure as a stored lens and an unknown stage', () => {
    expect(StructureCheck.safeParse({ ...check, lens: 'tv_act_structure' }).success).toBe(false)
    expect(StructureStage.safeParse({ ...stage, stage: 'you' }).success).toBe(false)
  })
  it('defaults Episode.structureChecks to []', () => {
    // reuse this file's existing minimal Episode builder
  })
})
```

The third `it` must use the file's existing minimal-Episode fixture (see `index.test.ts:58-103` in the patterns file) and assert `Episode.parse(minimalEpisode).structureChecks` equals `[]`. Run `npx vitest run --root packages/contract` and expect PASS.

- [ ] **Step 5: Ops.** In `apps/api/llm/ops.py`, import `InferredStructureCheck` and `StructureCheckVerification`, then add to `_OPS`:

```python
    LlmOp(
        "check_structure",
        "InferredStructureCheck",
        InferredStructureCheck,
        "import_analyst",
        "Judge each stage of one story structure against the script's breakdown.",
        max_tokens=16_384,
        call_timeout_seconds=150,
        adaptive_thinking=True,
        effort="medium",
    ),
    LlmOp(
        "verify_structure_check",
        "StructureCheckVerification",
        StructureCheckVerification,
        "writer",
        "Judge whether each cited excerpt shows the claimed structure stage.",
        max_tokens=8_192,
        call_timeout_seconds=90,
        adaptive_thinking=True,
        effort="low",
    ),
```

Leave `retry_schema_once` at its default (`True`): rule 9 gives both ops one retry. Do **not** copy the narrative-map `False`.

- [ ] **Step 6: Client methods.** Add `check_structure` and `verify_structure_check` to `apps/api/llm/protocol.py` (`LlmClient`) and `apps/api/llm/anthropic_client.py`. Copy the `verify_narrative_map` method shape verbatim, changing the op name and return type.

- [ ] **Step 7: Prompt builders.** In `apps/api/drama_manager/render.py`:
  - Set `PROMPT_VERSION = "0.51.0"`.
  - Add a newest-first history sentence: `0.51.0 adds check_structure and verify_structure_check (structure checklist).`
  - Add the two builders:

```python
def build_structure_check_prompt(
    project: dict, lens: str, spine: dict, nonce: str, diagnostics: list[dict] | None = None
) -> tuple[str, str]:
    """One structure check over the import's own breakdown (spec 2026-10-11)."""
    name = STRUCTURE_NAMES[lens]
    stages = [{"stage": stage, "label": label} for stage, label in STRUCTURE_STAGES[lens]]
    user = (
        source_data("show_format", project.get("format") or {}, nonce)
        + "\n"
        + source_data("story_overview", spine["storyOverview"], nonce)
        + "\n"
        + source_data("story_threads", spine["threads"], nonce)
        + "\n"
        + source_data("scene_spine", spine["scenes"], nonce)
        + "\n"
        + source_data("required_stages", stages, nonce)
        + f"\nCheck this episode against {name}. For every stage in required_stages, "
        "decide one status: hit (the stage clearly happens; cite the one beatId where it "
        "lands), thin (it happens only partly or weakly; cite the beatId and say what is "
        "missing), or missing (it does not happen; beatId null). Judge only from "
        "scene_spine, story_overview and story_threads, and cite only beatIds that appear "
        "in scene_spine. Each reason is one plain sentence about this story, naming its "
        "characters and events. If the structure does not fit this script at all (for "
        "example an ensemble with no single protagonist for the Hero's Journey), set "
        "applies to false, explain why in rationale, and return no stages. Otherwise set "
        "applies to true and give one sentence in rationale on how the script uses it."
    )
    if lens == "save_the_cat":
        user += (
            " Save the Cat is a feature-film template; a TV episode may compress or skip "
            "beats. Judge what is on the page, and set applies to false if the episode "
            "does not follow it."
        )
    if diagnostics:
        user += (
            "\nYour previous answer failed these checks:\n"
            + source_data("structure_check_repairs", diagnostics, nonce)
            + "\nReturn one corrected answer covering every required stage exactly once."
        )
    return build_system_prompt(project, nonce), user


def build_structure_verification_prompt(
    project: dict, lens: str, claims: list[dict], nonce: str
) -> tuple[str, str]:
    """Per-stage evidence check: does each excerpt show its claimed stage?"""
    user = (
        source_data("claims", claims, nonce)
        + f"\nEach claim says a stage of {STRUCTURE_NAMES[lens]} happens at the cited "
        "beat. Using only that claim's excerpt, decide whether the excerpt shows it. Give "
        "a one-sentence reason first, then supported true or false. Return one verdict per "
        "claim, using the claim's stage."
    )
    return build_system_prompt(project, nonce), user
```

(Import `STRUCTURE_NAMES` and `STRUCTURE_STAGES` from `drama_manager.structure_stages`.)

- [ ] **Step 8: Mock.** In `apps/api/llm/mock.py`:
  - Add static defaults for both ops to `_default_responses()`. `MockLlmClient.__init__` asserts the keys equal `OP_REGISTRY`.
    - `check_structure`: `InferredStructureCheck(applies=True, rationale="Mock.", stages=[])`
    - `verify_structure_check`: `StructureCheckVerification(stages=[])`
  - Add methods copying the `infer_narrative_map_synthesis` queue → explicit → dynamic → static shape, with these dynamic builders:

```python
def _mock_structure_check(user_message: str) -> InferredStructureCheck:
    """Deterministic, prompt-derived answer so e2e (no set_response hook) renders
    every status: stage i is hit / thin / missing by i % 3, citing beats in order."""
    stages = _source_data_value(user_message, "required_stages")
    scenes = _source_data_value(user_message, "scene_spine")
    if not stages or scenes is None:
        raise ValueError("structure blocks missing")
    beats = [beat["beatId"] for scene in scenes for beat in scene.get("beats") or []]
    out = []
    for index, item in enumerate(stages):
        status = ("hit", "thin", "missing")[index % 3]
        beat_id = beats[index % len(beats)] if beats and status != "missing" else None
        if beat_id is None:
            status = "missing"
        out.append(
            {"stage": item["stage"], "status": status, "beatId": beat_id,
             "reason": f"Mock {status} for {item['label']}."}
        )
    return InferredStructureCheck.model_validate(
        {"applies": True, "rationale": "Mock structure check.", "stages": out}
    )


def _mock_structure_verification(user_message: str) -> StructureCheckVerification:
    claims = _source_data_value(user_message, "claims")
    if claims is None:
        raise ValueError("claims block missing")
    return StructureCheckVerification.model_validate(
        {"stages": [{"stage": c["stage"], "reason": "Mock supported.", "supported": True}
                    for c in claims]}
    )
```

  - Update the op-enumerating tests (`tests/test_llm_ops.py`, `tests/test_llm_mock.py`) to include the two ops.
  - `test_effort_is_explicit…` requires `effort` on `import_analyst` ops; it is set.

- [ ] **Step 9: Prompt and mock tests.** Create `apps/api/tests/test_structure_prompts.py`:

```python
"""Structure check prompts and the prompt-derived mock (spec 2026-10-11)."""

from __future__ import annotations

from drama_manager import render
from drama_manager.structure_stages import STRUCTURE_STAGES
from llm.mock import MockLlmClient

SPINE = {
    "storyOverview": {"logline": "L", "summary": "S", "beatSheet": []},
    "threads": [],
    "scenes": [
        {"sceneId": "scene-1", "act": 0, "heading": "INT. BAR - NIGHT", "whatHappens": "W",
         "audienceLearns": "A", "beats": [{"beatId": "beat-1-1", "whatHappens": "B"}]},
    ],
}
PROJECT = {"format": {"actCount": 4, "coldOpen": True, "tag": False}}


def test_check_prompt_carries_every_stage_and_the_spine():
    _, user = render.build_structure_check_prompt(PROJECT, "story_circle", SPINE, "n1")
    for stage, _label in STRUCTURE_STAGES["story_circle"]:
        assert f'"stage": "{stage}"' in user
    assert 'kind="scene_spine"' in user and '"beatId": "beat-1-1"' in user
    assert "structure_check_repairs" not in user


def test_retry_prompt_lists_the_problems():
    _, user = render.build_structure_check_prompt(
        PROJECT, "story_circle", SPINE, "n1", diagnostics=[{"code": "missing_stage", "stage": "circle_go"}]
    )
    assert 'kind="structure_check_repairs"' in user and "circle_go" in user


def test_only_save_the_cat_gets_the_feature_film_note():
    _, stc = render.build_structure_check_prompt(PROJECT, "save_the_cat", SPINE, "n1")
    _, hj = render.build_structure_check_prompt(PROJECT, "heros_journey", SPINE, "n1")
    assert "feature-film template" in stc and "feature-film template" not in hj


def test_mock_answers_every_required_stage_from_the_prompt():
    _, user = render.build_structure_check_prompt(PROJECT, "heros_journey", SPINE, "n1")
    result = MockLlmClient().check_structure(system="s", user_message=user, prompt_version="v")
    assert [str(s.stage) for s in result.stages] == [s for s, _ in STRUCTURE_STAGES["heros_journey"]]
    assert {str(s.status) for s in result.stages} >= {"hit", "missing"}


def test_mock_verifier_supports_every_claim():
    claims = [{"stage": "circle_you", "label": "You", "status": "hit", "claim": "c",
               "beatId": "beat-1-1", "excerpt": "e"}]
    _, user = render.build_structure_verification_prompt(PROJECT, "story_circle", claims, "n1")
    result = MockLlmClient().verify_structure_check(system="s", user_message=user, prompt_version="v")
    assert [(str(v.stage), v.supported) for v in result.stages] == [("circle_you", True)]
```

Run it: `cd apps/api && PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -q -p no:cacheprovider tests/test_structure_prompts.py`. Expect PASS once Steps 1–8 are in. (`render.source_data` dumps with default separators, so assertions use `": "`.)

- [ ] **Step 10: Regenerate tool schemas and run the contract gate.** From the worktree root:

```bash
PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/python scripts/generate_tool_schemas.py
PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/python scripts/check_contract.py
```

Expect: `config/tool_schemas/check_structure.json` and `verify_structure_check.json` are created, and `check-contract: OK`. Commit the generated files.

- [ ] **Step 11: Docs.**
  - `docs/tableread-data-contract.md`:
    - §1: add `StructureLens`, `StructureStageName`, `StructureStageStatus`, `StructureStage`, `StructureCheck`, and `Episode.structureChecks` (default `[]`, one per lens, replaced on re-run), copied from the Zod.
    - §2a: add `InferredStructureCheck` and `StructureCheckVerification`, each with a one-line purpose.
    - §4: add the `STRUCTURE_CHECK_NOT_READY` (409) code: "the episode has no beats to check".
  - `docs/tableread-prompt-spec.md`:
    - Line 3: set the version to `0.51.0`.
    - New `### 5e. Structure check`, covering:
      - the ops and their roles/effort
      - the blocks listed in "Fixed interfaces"
      - validation and the one retry
      - the verifier rule (unsupported or no verdict → `unverified`; missing stages never verified)
      - the Save the Cat note.

- [ ] **Step 12: Full gate for this task, then commit.**

```bash
cd apps/api && PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -q -p no:cacheprovider
/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/ruff check . && cd ../..
npx vitest run --root packages/contract && npx tsc -b apps/web && npx prettier --check packages/contract apps/web/src
```

Expect all of it green.

```bash
git add -A packages/contract apps/api config/tool_schemas scripts docs apps/web/src
git commit -m "contract: add structure check types, ops, prompts and mock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Backend domain and route (parallel with Task 3)

**Files:**

- Create:
  - `apps/api/drama_manager/structure_checks.py`
  - `apps/api/tests/test_structure_checks.py`
- Modify: `apps/api/routes.py` (new route beside `generate_narrative_map` ~:563)

**Interfaces:**

- Consumes: Task 1's `STRUCTURE_STAGES`, the two builders, `llm.check_structure` / `llm.verify_structure_check`, `InferredStructureCheck`, `StructureCheckVerification`, `render.PROMPT_VERSION`, and the dynamic mock.
- Produces: the HTTP contract in "Fixed interfaces / HTTP", plus `structure_source_hash(episode) -> str`.

- [ ] **Step 1: Write the failing tests.** Create `apps/api/tests/test_structure_checks.py`:
  - Copy the module header, `client = TestClient(app)` and the `mock_llm` fixture verbatim from `tests/test_suggest.py:1-24` (patterns file).
  - Use the shared `seeded_project` fixture (proj-longpour). Its `beat-5-1` has empty `scriptText`, and `beat-1-2` is locked.

```python
import copy
import logging

from drama_manager.structure_checks import structure_source_hash
from drama_manager.structure_stages import STRUCTURE_STAGES
from schemas import InferredStructureCheck, StructureCheckVerification

from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from storage import snapshots
from storage.models import ProjectRow

CIRCLE = [stage for stage, _ in STRUCTURE_STAGES["story_circle"]]
PID = "proj-longpour"


def _doc(db_session) -> dict:
    db_session.expire_all()
    return copy.deepcopy(db_session.get(ProjectRow, PID).doc)


def _episode(doc: dict) -> dict:
    return doc["seasons"][0]["episodes"][0]


def _edit(db_session, change) -> None:
    """Test setup through the snapshot helper (pattern: test_narrative_map_stale_head.py:33-62)."""

    def mutator(state):
        doc = copy.deepcopy(state.doc)
        change(_episode(doc))
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags,
                                       snapshot_id=state.snapshot_id)

    snapshots.mutate(db_session, PID, "test setup", mutator)


def _post(lens: str, head: str | None = None):
    return client.post(f"/api/v1/projects/{PID}/structure-checks/{lens}", json={},
                       headers={"If-Match": head} if head else {})


def _inferred(cited: dict[str, tuple[str, str | None]], applies: bool = True):
    stages = [
        {"stage": s, "status": cited.get(s, ("missing", None))[0],
         "beatId": cited.get(s, ("missing", None))[1], "reason": f"{s} reason"}
        for s in CIRCLE
    ]
    return InferredStructureCheck.model_validate(
        {"applies": applies, "rationale": "Fits.", "stages": stages if applies else []}
    )


def _verdicts(**supported: bool):
    return StructureCheckVerification.model_validate(
        {"stages": [{"stage": s, "reason": f"{s} verdict", "supported": ok}
                    for s, ok in supported.items()]}
    )


def test_a_check_changes_nothing_but_structure_checks_even_when_locked(
    seeded_project, db_session, mock_llm
):
    """Rule 2 first: lock the episode, check, and diff everything else."""
    _edit(db_session, lambda ep: ep.update(locked=True))
    before = _doc(db_session)
    assert _post("story_circle").status_code == 200
    after = _doc(db_session)
    assert len(_episode(after).pop("structureChecks")) == 1
    _episode(before).pop("structureChecks", None)
    before.pop("headSnapshotId"), after.pop("headSnapshotId")
    assert before == after


def test_saves_quotes_scenes_hash_and_version(seeded_project, db_session, mock_llm):
    mock_llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-1-1"),
                                                         "circle_need": ("thin", "beat-2-1")}))
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True, circle_need=True))
    body = _post("story_circle").json()
    (check,) = body["seasons"][0]["episodes"][0]["structureChecks"]
    assert [s["stage"] for s in check["stages"]] == CIRCLE
    you = check["stages"][0]
    assert (you["status"], you["sceneId"]) == ("hit", "scene-1") and you["evidenceQuote"]
    assert check["stages"][2]["status"] == "missing" and check["stages"][2]["beatId"] is None
    assert check["sourceHash"] == structure_source_hash(_episode(_doc(db_session)))
    assert check["promptVersion"] == "0.51.0" and check["lens"] == "story_circle"


def test_unsupported_and_unanswered_stages_become_unverified(seeded_project, mock_llm):
    mock_llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-1-1"),
                                                         "circle_need": ("thin", "beat-2-1"),
                                                         "circle_go": ("hit", "beat-3-1")}))
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True, circle_need=False))
    stages = _post("story_circle").json()["seasons"][0]["episodes"][0]["structureChecks"][0]["stages"]
    by = {s["stage"]: s for s in stages}
    assert by["circle_you"]["status"] == "hit"
    assert (by["circle_need"]["status"], by["circle_need"]["reason"]) == ("unverified", "circle_need verdict")
    assert (by["circle_go"]["status"], by["circle_go"]["reason"]) == ("unverified", "Not verified")


def test_an_invalid_answer_is_retried_once_with_the_problems(seeded_project, mock_llm):
    bad = InferredStructureCheck.model_validate({"applies": True, "rationale": "x", "stages": []})
    mock_llm.set_responses("check_structure", [bad, _inferred({})])
    assert _post("story_circle").status_code == 200
    assert mock_llm._invocations["check_structure"] == 2


def test_two_invalid_answers_return_502_and_save_nothing(seeded_project, db_session, mock_llm):
    bad = InferredStructureCheck.model_validate({"applies": True, "rationale": "x", "stages": []})
    mock_llm.set_responses("check_structure", [bad, bad])
    head = _doc(db_session)["headSnapshotId"]
    res = _post("story_circle")
    assert (res.status_code, res.json()["error"]["code"]) == (502, "SCHEMA_INVALID_LLM")
    assert _doc(db_session)["headSnapshotId"] == head


class _VerifyFails(MockLlmClient):
    def verify_structure_check(self, **kwargs):
        raise SchemaInvalidLlmError("verify_structure_check")


def test_a_verifier_failure_saves_nothing(seeded_project, db_session):
    llm = _VerifyFails()
    llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-1-1")}))
    app.dependency_overrides[get_llm_client] = lambda: llm
    try:
        head = _doc(db_session)["headSnapshotId"]
        res = _post("story_circle")
        assert (res.status_code, res.json()["error"]["code"]) == (502, "SCHEMA_INVALID_LLM")
        assert _doc(db_session)["headSnapshotId"] == head
    finally:
        app.dependency_overrides.pop(get_llm_client, None)


def test_doesnt_fit_stores_the_rationale_only_and_skips_verification(seeded_project, mock_llm):
    mock_llm.set_response("check_structure", _inferred({}, applies=False))
    check = _post("story_circle").json()["seasons"][0]["episodes"][0]["structureChecks"][0]
    assert (check["applies"], check["stages"], check["rationale"]) == (False, [], "Fits.")
    assert mock_llm._invocations.get("verify_structure_check", 0) == 0


def test_empty_beat_text_saves_null_quote(seeded_project, mock_llm):
    mock_llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-5-1")}))
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True))
    stage = _post("story_circle").json()["seasons"][0]["episodes"][0]["structureChecks"][0]["stages"][0]
    assert stage["evidenceQuote"] is None


def test_rerun_replaces_the_lens_entry(seeded_project, mock_llm):
    _post("story_circle")
    checks = _post("story_circle").json()["seasons"][0]["episodes"][0]["structureChecks"]
    assert [c["lens"] for c in checks] == ["story_circle"]


def test_stale_if_match_is_409(seeded_project):
    res = _post("story_circle", head="snap-not-the-head")
    assert (res.status_code, res.json()["error"]["code"]) == (409, "CONFLICT_STALE_HEAD")


def test_unknown_and_tv_lenses_are_400(seeded_project):
    for lens in ("tv_act_structure", "nope"):
        res = _post(lens)
        assert (res.status_code, res.json()["error"]["code"]) == (400, "VALIDATION")


def test_an_episode_without_beats_is_not_ready(seeded_project, db_session):
    _edit(db_session, lambda ep: [scene.update(beats=[]) for scene in ep["scenes"]])
    res = _post("story_circle")
    assert (res.status_code, res.json()["error"]["code"]) == (409, "STRUCTURE_CHECK_NOT_READY")


def test_source_hash_matches_the_shared_vector():
    episode = {"scenes": [
        {"id": "scene-1", "beats": [{"id": "beat-1-1", "scriptText": "INT. BAR - NIGHT\nMarta pours."},
                                    {"id": "beat-1-2", "scriptText": "Café — “ok”"}]},
        {"id": "scene-2", "beats": []},
        {"id": "scene-3", "beats": [{"id": "beat-3-1"}]},
    ]}
    assert structure_source_hash(episode) == "b9c534c0bc4d1db690a5d82bb4c0e4a9f87ec02be3119977227131d62c27735f"
    assert structure_source_hash({"scenes": []}) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_logs_carry_no_writer_text(seeded_project, mock_llm, caplog):
    mock_llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-1-1")}))
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True))
    with caplog.at_level(logging.INFO, logger="drama_manager.structure_checks"):
        assert _post("story_circle").status_code == 200
    assert "0.51.0" in caplog.text and "lens=story_circle" in caplog.text
    for writer_text in ("circle_you reason", "circle_you verdict", "Fits."):
        assert writer_text not in caplog.text
```

The `mock_llm` fixture from `test_suggest.py` installs the override that `_post` uses. Check the fixture's beat and scene ids (`beat-2-1` in `scene-2` and so on) against `docs/tableread-fixture.json`, and adjust the ids if they differ. Run the file and expect FAIL (module missing).

- [ ] **Step 2: Domain module.** Create `apps/api/drama_manager/structure_checks.py`:

```python
"""Writer-triggered structure checks (spec 2026-10-11).

One check = one `check_structure` call over the import's own breakdown, server
validation with one retry, one `verify_structure_check` call over the cited
beats, then one snapshot. Nothing is saved unless every step succeeds.
"""

from __future__ import annotations

import copy
import hashlib
import logging
from collections import Counter
from datetime import UTC, datetime

from drama_manager import render
from drama_manager.narrative_map import _evidence_quote  # ponytail: move with step 4's Story Map deletion
from drama_manager.structure_stages import STRUCTURE_STAGES
from llm.errors import SchemaInvalidLlmError
from storage import snapshots

_logger = logging.getLogger("drama_manager.structure_checks")
_TEXT_CAP = 300
_EXCERPT_CAP = 520


class StructureCheckNotReady(Exception):
    """The episode has no beats to check."""


class StructureCheckInvalid(ValueError):
    def __init__(self, diagnostics: list[dict]) -> None:
        super().__init__("structure check failed validation")
        self.diagnostics = diagnostics


def _episode(doc: dict) -> dict | None:
    return next(
        (e for season in doc.get("seasons") or [] for e in season.get("episodes") or []), None
    )


def structure_source_hash(episode: dict) -> str:
    text = "".join(
        f"{scene['id']}\x1f{beat['id']}\x1f{beat.get('scriptText') or ''}\x1e"
        for scene in episode.get("scenes") or []
        for beat in scene.get("beats") or []
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_spine(episode: dict) -> dict:
    overview = episode.get("storyOverview") or {}
    return {
        "storyOverview": {
            "logline": overview.get("logline", ""),
            "summary": overview.get("summary", ""),
            "beatSheet": [
                {"beatId": r["beatId"], "label": r.get("label", ""),
                 "sceneId": r.get("sceneId"), "act": r.get("act")}
                for r in overview.get("beatSheet") or []
            ],
        },
        "threads": [
            {"id": t["id"], "label": t.get("label", ""), "summary": t.get("summary", ""),
             "status": t.get("status"), "setupBeatId": t.get("setupBeatId"),
             "payoffBeatId": t.get("payoffBeatId")}
            for t in episode.get("threads") or []
        ],
        "scenes": [
            {"sceneId": s["id"], "act": s.get("act"), "heading": s.get("location", ""),
             "whatHappens": (s.get("whatHappens") or "")[:_TEXT_CAP],
             "audienceLearns": (s.get("audienceLearns") or "")[:_TEXT_CAP],
             "beats": [{"beatId": b["id"], "whatHappens": (b.get("whatHappens") or "")[:_TEXT_CAP]}
                       for b in s.get("beats") or []]}
            for s in episode.get("scenes") or []
        ],
    }


def validate_check(lens: str, inferred, beat_scene: dict[str, str]) -> list[dict]:
    """Stages in canonical order, or StructureCheckInvalid with diagnostics (codes/ids only)."""
    if not inferred.applies:
        return []
    order = [stage for stage, _ in STRUCTURE_STAGES[lens]]
    diagnostics: list[dict] = []
    by_stage: dict[str, dict] = {}
    for item in inferred.stages:
        stage, status = str(item.stage), str(item.status)
        if stage not in order:
            diagnostics.append({"code": "stage_wrong_structure", "stage": stage})
        elif stage in by_stage:
            diagnostics.append({"code": "duplicate_stage", "stage": stage})
        elif status != "missing" and item.beat_id is None:
            diagnostics.append({"code": "beat_required", "stage": stage})
        elif status != "missing" and item.beat_id not in beat_scene:
            diagnostics.append({"code": "unknown_beat", "stage": stage, "beatId": item.beat_id})
        else:
            beat_id = item.beat_id if status != "missing" else None  # a beat on a missing stage is dropped
            by_stage[stage] = {"stage": stage, "status": status, "beatId": beat_id,
                               "sceneId": beat_scene.get(beat_id) if beat_id else None,
                               "reason": item.reason}
    flagged = {d["stage"] for d in diagnostics}
    diagnostics += [{"code": "missing_stage", "stage": s}
                    for s in order if s not in by_stage and s not in flagged]
    if diagnostics:
        raise StructureCheckInvalid(diagnostics)
    return [by_stage[s] for s in order]


def apply_verdicts(stages: list[dict], verification) -> list[dict]:
    verdicts: dict[str, object] = {}
    for verdict in verification.stages:
        verdicts.setdefault(str(verdict.stage), verdict)
    out = []
    for stage in stages:
        verdict = verdicts.get(stage["stage"])
        if stage["status"] not in ("hit", "thin") or (verdict and verdict.supported):
            out.append(stage)
        else:
            reason = verdict.reason if verdict else "Not verified"
            out.append({**stage, "status": "unverified", "reason": reason})
    return out


def run_structure_check(session, project, lens: str, llm, *, expected_head_snapshot_id: str) -> dict:
    doc = project.doc
    episode = _episode(doc) or {}
    scenes = {s["id"]: s for s in episode.get("scenes") or []}
    beats = {b["id"]: (s, b) for s in scenes.values() for b in s.get("beats") or []}
    if not beats:
        raise StructureCheckNotReady()
    beat_scene = {beat_id: scene["id"] for beat_id, (scene, _) in beats.items()}
    spine, nonce = build_spine(episode), render.new_nonce()

    def ask(diagnostics: list[dict] | None):
        system, user = render.build_structure_check_prompt(doc, lens, spine, nonce, diagnostics)
        return llm.check_structure(system=system, user_message=user, prompt_version=render.PROMPT_VERSION)

    inferred = ask(None)
    try:
        stages = validate_check(lens, inferred, beat_scene)
    except StructureCheckInvalid as first:
        inferred = ask(first.diagnostics)
        try:
            stages = validate_check(lens, inferred, beat_scene)
        except StructureCheckInvalid as second:
            raise SchemaInvalidLlmError("check_structure") from second

    labels = dict(STRUCTURE_STAGES[lens])
    claims = [
        {"stage": s["stage"], "label": labels[s["stage"]], "status": s["status"], "claim": s["reason"],
         "beatId": s["beatId"], "excerpt": (beats[s["beatId"]][1].get("scriptText") or "")[:_EXCERPT_CAP]}
        for s in stages if s["status"] in ("hit", "thin")
    ]
    if claims:
        system, user = render.build_structure_verification_prompt(doc, lens, claims, nonce)
        stages = apply_verdicts(stages, llm.verify_structure_check(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION))
    for stage in stages:
        scene_beat = beats.get(stage["beatId"]) if stage["beatId"] else None
        stage["evidenceQuote"] = (_evidence_quote(*scene_beat) or None) if scene_beat else None

    check = {"lens": lens, "applies": inferred.applies, "rationale": inferred.rationale,
             "stages": stages, "sourceHash": structure_source_hash(episode),
             "checkedAt": datetime.now(UTC).isoformat(), "promptVersion": render.PROMPT_VERSION}

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        new_doc = copy.deepcopy(state.doc)
        target = _episode(new_doc)
        target["structureChecks"] = [
            c for c in target.get("structureChecks") or [] if c.get("lens") != lens
        ] + [check]
        return snapshots.MutationState(doc=new_doc, ledger=state.ledger, flags=state.flags,
                                       snapshot_id=state.snapshot_id)

    snap = snapshots.mutate(session, project.id, f"Structure check: {lens}", mutator,
                            expected_head_snapshot_id=expected_head_snapshot_id)
    counts = Counter(s["status"] for s in stages)
    _logger.info(
        "structure_check project=%s snapshot=%s lens=%s applies=%s hit=%d thin=%d missing=%d "
        "unverified=%d prompt_version=%s",
        project.id, snap.id, lens, inferred.applies, counts["hit"], counts["thin"],
        counts["missing"], counts["unverified"], render.PROMPT_VERSION,
    )
    return snap.doc
```

If `_evidence_quote`'s signature differs from `(scene, beat)`, follow the patterns file (narrative_map.py:154-176).

- [ ] **Step 3: Route.** In `apps/api/routes.py`, beside `generate_narrative_map`. Use the existing imports (`anthropic`, `LlmTimeoutError`, `SchemaInvalidLlmError`, `snapshots`, `Project`) and add `from drama_manager.structure_checks import StructureCheckNotReady, run_structure_check` and `from drama_manager.structure_stages import STRUCTURE_STAGES`:

```python
@router.post("/{pid}/structure-checks/{lens}", response_model=Project)
def check_structure(
    pid: str,
    lens: str,
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Run one writer-triggered structure check and save it (spec 2026-10-11)."""
    if lens not in STRUCTURE_STAGES:
        raise ApiError(400, "VALIDATION", f"unknown structure {lens!r}")
    project = _get_project_or_404(session, pid)
    expected_head = _expected_head(if_match) or project.head_snapshot_id
    if expected_head != project.head_snapshot_id:
        raise ApiError(
            409,
            "CONFLICT_STALE_HEAD",
            f"expected headSnapshotId {expected_head!r} but project head is "
            f"{project.head_snapshot_id!r}",
        )
    try:
        return run_structure_check(session, project, lens, llm, expected_head_snapshot_id=expected_head)
    except StructureCheckNotReady as exc:
        raise ApiError(409, "STRUCTURE_CHECK_NOT_READY", "The script has no beats to check yet.") from exc
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    except SchemaInvalidLlmError as exc:
        raise ApiError(502, "SCHEMA_INVALID_LLM", str(exc)) from exc
    except (anthropic.APIError, LlmTimeoutError) as exc:
        raise ApiError(503, "LLM_UNAVAILABLE", "the language model is unavailable") from exc
```

The `projects` router may already have a function named `check_structure`. If ruff or FastAPI complains, rename the function to `post_structure_check`; the path stays the same.

- [ ] **Step 4: Run the tests, the full suite and lint.**

```bash
cd apps/api && PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -q -p no:cacheprovider tests/test_structure_checks.py
PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -q -p no:cacheprovider
/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/ruff check .
```

Expect all of it PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/drama_manager/structure_checks.py apps/api/routes.py apps/api/tests/test_structure_checks.py
git commit -m "api: run and save writer-triggered structure checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web Structure tab (parallel with Task 2)

**Files:**

- Create, all in `apps/web/src/ledger/structure/`:
  - `stages.ts`
  - `tvActStructure.ts` + `tvActStructure.test.ts`
  - `sourceHash.ts` + `sourceHash.test.ts`
  - `StructurePanel.tsx` + `StructurePanel.test.tsx`
  - `StructureStrip.tsx`
- Modify:
  - `apps/web/src/ledger/viewPreference.ts` (union + `VIEWS`)
  - `apps/web/src/ledger/LedgerViewSwitcher.tsx` (`OPTIONS`: add `{ value: 'structure', label: 'Structure' }` after Threads)
  - `apps/web/src/ledger/LedgerScreen.tsx` (view-body branch ~:818-866; handler beside `handleGenerateNarrativeMap` ~:430)
  - `apps/web/src/api/client.ts` (`checkStructure` beside `generateNarrativeMap` ~:182)
  - `apps/web/src/shell/modeNavigation.ts` (+ test)
  - the viewPreference/switcher tests, if they enumerate views.

**Interfaces:**

- Consumes:
  - Task 1's contract types: `StructureLens`, `StructureStageName`, `StructureCheck`, `StructureStage`, `Project`, `Scene`, `ShowFormat`, `StoryOverview`.
  - The HTTP contract.
  - The fingerprint definition.
- Produces (used by Task 4's e2e):
  - testids:
    - `structure-panel`
    - `structure-pick`: a native `<select>` whose option values are the `StructurePick` ids
    - `structure-row-<key>`: `TvStage.key` such as `cold-open` or `act-one-turn`, or the stage id such as `circle_you`
    - `structure-check-button`, `structure-stale`, `structure-doesnt-fit`
  - `navigateToWriteBeat(sceneId: string, beatId: string): void`.

- [ ] **Step 1: Stage table.** Create `apps/web/src/ledger/structure/stages.ts`:

```ts
import type { StructureLens, StructureStageName } from 'contract'

export type StructurePick = StructureLens | 'tv_act_structure'

export const STRUCTURE_PICKS: { value: StructurePick; label: string }[] = [
  { value: 'tv_act_structure', label: 'TV act structure' },
  { value: 'heros_journey', label: "Hero's Journey" },
  { value: 'story_circle', label: 'Story Circle' },
  { value: 'save_the_cat', label: 'Save the Cat' },
]

export const STAGE_ORDER: Record<StructureLens, StructureStageName[]> = {
  heros_journey: [
    'ordinary_world', 'call_to_adventure', 'refusal', 'meeting_the_mentor',
    'crossing_the_threshold', 'tests_allies_enemies', 'approach', 'ordeal', 'reward',
    'road_back', 'resurrection', 'return_with_elixir',
  ],
  story_circle: [
    'circle_you', 'circle_need', 'circle_go', 'circle_search', 'circle_find', 'circle_take',
    'circle_return', 'circle_change',
  ],
  save_the_cat: [
    'opening_image', 'theme_stated', 'set_up', 'catalyst', 'debate', 'break_into_two', 'b_story',
    'fun_and_games', 'midpoint', 'bad_guys_close_in', 'all_is_lost', 'dark_night_of_the_soul',
    'break_into_three', 'finale', 'final_image',
  ],
}

export const STAGE_LABELS: Record<StructureStageName, string> = {
  ordinary_world: 'Ordinary world',
  call_to_adventure: 'Call to adventure',
  refusal: 'Refusal of the call',
  meeting_the_mentor: 'Meeting the mentor',
  crossing_the_threshold: 'Crossing the threshold',
  tests_allies_enemies: 'Tests, allies, enemies',
  approach: 'Approach to the inmost cave',
  ordeal: 'Ordeal',
  reward: 'Reward',
  road_back: 'The road back',
  resurrection: 'Resurrection',
  return_with_elixir: 'Return with the elixir',
  circle_you: 'You (comfort zone)',
  circle_need: 'Need',
  circle_go: 'Go',
  circle_search: 'Search',
  circle_find: 'Find',
  circle_take: 'Take',
  circle_return: 'Return',
  circle_change: 'Change',
  opening_image: 'Opening image',
  theme_stated: 'Theme stated',
  set_up: 'Set-up',
  catalyst: 'Catalyst',
  debate: 'Debate',
  break_into_two: 'Break into two',
  b_story: 'B story',
  fun_and_games: 'Fun and games',
  midpoint: 'Midpoint',
  bad_guys_close_in: 'Bad guys close in',
  all_is_lost: 'All is lost',
  dark_night_of_the_soul: 'Dark night of the soul',
  break_into_three: 'Break into three',
  finale: 'Finale',
  final_image: 'Final image',
}
```

- [ ] **Step 2: TV act structure, test first.** Create `tvActStructure.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ShowFormat, StoryOverview } from 'contract'
import { tvActStageLabels, tvActStages } from './tvActStructure'

const format = (over: Partial<ShowFormat> = {}): ShowFormat => ({
  genre: 'drama', runtimeMinutes: 60, actCount: 4, coldOpen: true, tag: false, serialization: 0.5, ...over,
})
const overview = (rows: { label: string; beatId: string; sceneId: string }[]): StoryOverview => ({
  logline: '', summary: '', outline: [], provenance: 'inferred', locked: false,
  beatSheet: rows.map((r) => ({ ...r, summary: `${r.label} summary`, act: null })),
})

describe('tvActStageLabels', () => {
  it('follows the import beat sheet grammar', () => {
    expect(tvActStageLabels(format())).toEqual([
      'Cold Open', 'Act One Turn', 'Act One Out', 'Act Two Turn', 'Act Two Out',
      'Act Three Turn', 'Act Three Out', 'Act Four Out', 'Climax',
    ])
    expect(tvActStageLabels(format({ coldOpen: false, actCount: 2, tag: true }))).toEqual([
      'Act One Turn', 'Act One Out', 'Act Two Out', 'Climax', 'Tag',
    ])
  })
})

describe('tvActStages', () => {
  it('is null without a format', () => {
    expect(tvActStages(null, null)).toBeNull()
  })
  it('marks every stage missing without a beat sheet', () => {
    const stages = tvActStages(format(), null)!
    expect(stages).toHaveLength(9)
    expect(stages.every((s) => s.status === 'missing' && s.beatId === null)).toBe(true)
  })
  it('matches labels case-insensitively, takes the first row, and accepts Teaser', () => {
    const stages = tvActStages(
      format(),
      overview([
        { label: 'teaser', beatId: 'beat-1-1', sceneId: 'scene-1' },
        { label: 'ACT  ONE  TURN', beatId: 'beat-2-1', sceneId: 'scene-2' },
        { label: 'Act One Turn', beatId: 'beat-3-1', sceneId: 'scene-3' },
      ]),
    )!
    expect(stages[0]).toMatchObject({ label: 'Cold Open', status: 'hit', beatId: 'beat-1-1' })
    expect(stages[1]).toMatchObject({ label: 'Act One Turn', status: 'hit', beatId: 'beat-2-1' })
    expect(stages[2]).toMatchObject({ label: 'Act One Out', status: 'missing' })
  })
})
```

Run `npx vitest run apps/web/src/ledger/structure/tvActStructure.test.ts` and expect FAIL. Then create `tvActStructure.ts`:

```ts
import type { ShowFormat, StoryOverview } from 'contract'

export type TvStage = {
  key: string
  label: string
  status: 'hit' | 'missing'
  beatId: string | null
  sceneId: string | null
  summary: string
}

const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']
const norm = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
const slug = (label: string) => norm(label).replace(/ /g, '-')

/** The import beat sheet's own label list for this format (render.py beatSheet rules). */
export function tvActStageLabels(format: ShowFormat): string[] {
  const labels = format.coldOpen ? ['Cold Open'] : []
  for (let act = 1; act <= format.actCount; act++) {
    const word = WORDS[act - 1]
    if (act < format.actCount) labels.push(`Act ${word} Turn`)
    labels.push(`Act ${word} Out`)
  }
  labels.push('Climax')
  if (format.tag) labels.push('Tag')
  return labels
}

export function tvActStages(
  format: ShowFormat | null | undefined,
  overview: StoryOverview | null | undefined,
): TvStage[] | null {
  if (!format) return null
  const rows = overview?.beatSheet ?? []
  return tvActStageLabels(format).map((label) => {
    const wanted = label === 'Cold Open' ? ['cold open', 'teaser'] : [norm(label)]
    const row = rows.find((r) => wanted.includes(norm(r.label)))
    return row
      ? { key: slug(label), label, status: 'hit', beatId: row.beatId, sceneId: row.sceneId, summary: row.summary }
      : { key: slug(label), label, status: 'missing', beatId: null, sceneId: null, summary: '' }
  })
}
```

Run again and expect PASS.

- [ ] **Step 3: Fingerprint, test first.** `sourceHash.test.ts` runs in the default node environment (no jsdom pragma), so `crypto.subtle` exists:

```ts
import { describe, expect, it } from 'vitest'
import type { Scene } from 'contract'
import { structureSourceHash } from './sourceHash'

const scene = (id: string, beats: { id: string; scriptText?: string }[]) =>
  ({ id, beats }) as unknown as Scene

describe('structureSourceHash', () => {
  it('matches the Python vector', async () => {
    const scenes = [
      scene('scene-1', [
        { id: 'beat-1-1', scriptText: 'INT. BAR - NIGHT\nMarta pours.' },
        { id: 'beat-1-2', scriptText: 'Café — “ok”' },
      ]),
      scene('scene-2', []),
      scene('scene-3', [{ id: 'beat-3-1' }]),
    ]
    expect(await structureSourceHash(scenes)).toBe(
      'b9c534c0bc4d1db690a5d82bb4c0e4a9f87ec02be3119977227131d62c27735f',
    )
    expect(await structureSourceHash([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
```

`sourceHash.ts`:

```ts
import type { Scene } from 'contract'

/** Same fingerprint as structure_checks.structure_source_hash (spec: Source hash). */
export async function structureSourceHash(scenes: Scene[]): Promise<string> {
  const text = scenes
    .flatMap((scene) => (scene.beats ?? []).map((beat) => `${scene.id}\x1f${beat.id}\x1f${beat.scriptText ?? ''}\x1e`))
    .join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 4: Navigation and client.**
  - In `apps/web/src/shell/modeNavigation.ts`, add `navigateToWriteBeat(sceneId, beatId)`. It mirrors `navigateToWriteScene` but sets `highlightBeat` instead of deleting it; match how `LedgerScreen.handleSourceSpanClick` (:552-559) builds `?project&scene&highlightBeat`.
  - Add a `modeNavigation.test.ts` case using that file's `window.location` stub: assert the URL has `scene=scene-2` and `highlightBeat=beat-2-1`.
  - In `apps/web/src/api/client.ts`:

```ts
export function checkStructure(
  projectId: string,
  lens: StructureLens,
  opts?: IfMatchOpts,
): Promise<Project> {
  return postJson<Project>(`/projects/${projectId}/structure-checks/${lens}`, {}, opts)
}
```

  - Add the matching `client.test.ts` case, following that file's fetch-stub pattern: assert the path and the `If-Match` header.

- [ ] **Step 5: Panel tests first.** Create `StructurePanel.test.tsx` (`// @vitest-environment jsdom`; copy the render/cleanup pattern from `NarrativeMapCard.test.tsx:1-38`). Props are:

```ts
type Props = {
  project: Project
  busy: boolean
  error: string | null
  onCheck: (lens: StructureLens) => void
  onOpenBeat: (sceneId: string, beatId: string) => void
  hashScenes?: (scenes: Scene[]) => Promise<string> // defaults to structureSourceHash; tests inject
}
```

Write these tests. Each builds a minimal `Project` with one season and one episode; the `Episode` literal needs `structureChecks`.

1. **TV act structure is the default pick, with no API call on mount.** It renders `structure-row-cold-open` … `structure-row-climax` with text `Missing`, and `onCheck` is not called.
2. **`project.format` null** shows `The show format isn't known yet.`
3. **Choosing Story Circle with no saved check** shows the `Check structure` button and `About 25¢, under a minute.`; clicking calls `onCheck('story_circle')`.
4. **`busy` true** disables `structure-check-button`.
5. **`error`** text is rendered.
6. **A saved Story Circle check** renders `Hit` / `Thin` / `Missing` / `Couldn't verify` labels, each stage's label from `STAGE_LABELS`, its reason, and the quote when `evidenceQuote` is non-null (and none when null). Clicking a row with a beat calls `onOpenBeat(sceneId, beatId)`. The header reads `1 of 8 stages hit · 1 thin · 5 missing · 1 couldn't verify` for that fixture.
7. **A saved check with `applies: false`** shows `structure-doesnt-fit` with the rationale and a `Check TV act structure instead` button that switches the pick.
8. **Stale line.** With `hashScenes` resolving to a value different from `sourceHash`, `structure-stale` shows `The script changed since this check.` and `Check again` calls `onCheck`. With an equal value, no stale line.
9. **The pick is remembered per project** in `localStorage` key `tr.ledger.structure.<projectId>`, wrapped in try/catch like `viewPreference.ts`.

Run and expect FAIL.

- [ ] **Step 6: Panel and strip.** Implement `StructurePanel.tsx` to those tests:
  - The picker is a native `<select data-testid="structure-pick">`, not a custom control.
  - Status → `Chip` hue: hit `sage`, thin `amber`, missing `neutral`, unverified `sky`, always with the text label.
  - Rows are bordered list rows (not cards), using token classes only; copy the class vocabulary from `NarrativeMapCard.tsx` and the patterns file's token section.
  - The evidence quote renders like `NarrativeMapCard.tsx:259-286`.
  - `StructureStrip.tsx` draws one tick per stage that has a `sceneId`, placed at `index / (sceneCount - 1)` of the episode's scenes in order, with act boundaries from `groupScenesByAct` (`plan/planTree.ts:350`). Do **not** reuse or copy `SceneStrip`, which has rule-6 violations.
  - The TV pick shows the same row layout using `TvStage` (Hit/Missing, its beat-sheet summary as the reason), with no button.

Run the panel tests and expect PASS.

- [ ] **Step 7: Wire the Ledger.**
  - Add `'structure'` to `LedgerViewId` **and** `VIEWS` in `viewPreference.ts`; without both, `loadLedgerView` silently falls back to `'atlas'`.
  - Add the switcher option after Threads.
  - In `LedgerScreen.tsx`, add the view-body branch rendering `<StructurePanel project={project} busy={structureBusy} error={structureError} onCheck={handleCheckStructure} onOpenBeat={navigateToWriteBeat} />`, with this handler:

```ts
const [structureBusy, setStructureBusy] = useState(false)
const [structureError, setStructureError] = useState<string | null>(null)

async function handleCheckStructure(lens: StructureLens) {
  if (!project || structureBusy) return
  setStructureBusy(true)
  setStructureError(null)
  try {
    const updated = await checkStructure(project.id, lens, { expectedHeadSnapshotId: project.headSnapshotId })
    // apply `updated` the same way handleGenerateNarrativeMap / getProject refreshes the screen's project (LedgerScreen.tsx:381-387)
  } catch (err) {
    setStructureError(structureErrorMessage(err))
  } finally {
    setStructureBusy(false)
  }
}
```

  - `structureErrorMessage` maps `ApiError.code` (see `api/errors.ts`):
    - `CONFLICT_STALE_HEAD` → `The script changed while checking. Reload and try again.`
    - `SCHEMA_INVALID_LLM` → `The check came back malformed twice. Nothing was saved; try again.`
    - `LLM_UNAVAILABLE` → `The AI service is unavailable right now. Nothing was saved.`
    - `STRUCTURE_CHECK_NOT_READY` → `This script has no beats to check yet.`
    - anything else → `The check failed. Nothing was saved.`
  - Unit-test it in `StructurePanel.test.tsx` or a small `structureErrors.test.ts`.
  - If `LedgerScreen.test.tsx` mounts the Structure view, add `checkStructure` to its `vi.mock('../api/client', …)` factory.

- [ ] **Step 8: Gate and commit.**

```bash
npx vitest run --root apps/web
npx tsc -b apps/web
npx eslint apps/web/src
npx prettier --check apps/web/src
git add apps/web/src
git commit -m "ledger: add the Structure tab and checklist panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expect all of it green.

---

### Task 4: Merge, e2e, docs, gates, PR (last)

**Files:**

- Create: `apps/web/e2e/zz-structure.spec.ts`. It sorts after the other `zz-` spec because it advances the seeded project's head.
- Modify:
  - `docs/tableread-ui-spec.md` (Ledger §7a: the Structure tab and its states)
  - `docs/tableread-test-plan.md` (entries for the lock-violation, verifier-downgrade and fingerprint tests)
  - `docs/tableread-handoff.md` (decision log rows, 2026-10-11: Story Map replaced by the structure checklist; evals on hold, hand-check sign-off)

- [ ] **Step 1: Merge.** Merge Task 2's and Task 3's branches into the feature branch. They touch disjoint files, so expect no conflicts. Run the full gate from the merged worktree:

```bash
cd apps/api && PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -q -p no:cacheprovider && /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/ruff check . && cd ../..
PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/python scripts/check_contract.py
npx vitest run --root apps/web && npx vitest run --root packages/contract && npx tsc -b apps/web && npx eslint apps/web/src && npx prettier --check apps/web/src packages/contract
```

- [ ] **Step 2: e2e.** Create `apps/web/e2e/zz-structure.spec.ts`. Open the Ledger and switch view the same way `ledger.spec.ts:1-71` does (it clicks the `Story` switcher option):

```ts
import { expect, test } from '@playwright/test'

test('structure tab: TV act structure from the beat sheet, then a Story Circle check', async ({ page }) => {
  await page.goto('/ledger?project=proj-longpour')
  await page.getByText('Structure', { exact: true }).click()
  const panel = page.getByTestId('structure-panel')
  await expect(panel).toBeVisible()
  // Seeded fixture: no beat sheet; actCount 4, cold open, no tag -> 9 rows, all Missing.
  await expect(panel.locator('[data-testid^="structure-row-"]')).toHaveCount(9)
  await expect(page.getByTestId('structure-row-cold-open')).toContainText('Missing')
  await expect(page.getByTestId('structure-row-climax')).toContainText('Missing')

  await page.getByTestId('structure-pick').selectOption('story_circle')
  await page.getByTestId('structure-check-button').click()
  await expect(panel.locator('[data-testid^="structure-row-circle_"]')).toHaveCount(8)
  // The prompt-derived mock makes stage 0 Hit; clicking it opens Write at its beat.
  await page.getByTestId('structure-row-circle_you').click()
  await expect(page).toHaveURL(/highlightBeat=/)
})
```

  Match the selector for the switcher to whatever `ledger.spec.ts` uses, if `getByText` is ambiguous. Run with port overrides so the dev app on 5173/8001 is untouched:

```bash
cd apps/web && E2E_API_PORT=8100 E2E_WEB_PORT=5180 npx playwright test --config=e2e/playwright.config.ts e2e/zz-structure.spec.ts e2e/ledger.spec.ts
```

  Expect PASS. If `start-api.sh` needs `apps/api/.venv`, symlink it in the worktree to `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv` for this run only; never pip-install.

- [ ] **Step 3: Docs.** Update the three docs above, then commit:

```bash
git commit -am "docs: structure checklist in ui spec, test plan and handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand-check sign-off (rule 7 substitute; owner approves the spend first).**
  - With the owner's OK (about $1), run each AI structure once on *Field of Dreams* and once on the West Wing pilot, in the owner's local app after the branch is checked out there.
  - Record in the PR:
    - per run: statuses, a few evidence lines, cost and time
    - whether Hero's Journey applies on *Field of Dreams*
    - whether it doesn't fit the West Wing pilot
    - that no stage was lost to verification.

- [ ] **Step 5: PR.**
  - Push the feature branch and open one PR.
  - The body quotes the spec's acceptance points with pass/fail, notes no new dependencies, and states that sign-off is the hand check above.
  - End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
