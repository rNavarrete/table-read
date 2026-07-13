# Import Act Inference + Writer Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infer narrative act boundaries for markerless imported teleplays and let writers correct each scene's act directly in Plan.

**Architecture:** After existing per-scene beat segmentation, one classifier call receives compact ordered scene summaries and proposes typed act-start boundaries. A pure server normalizer validates those boundaries and expands them into a total scene-to-act partition before the existing atomic import write; Plan reuses the existing optimistic JSON-Patch path for manual correction.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, Zod, React 18, TypeScript, pytest, Vitest, Playwright, Anthropic strict tool use.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-07-12-import-act-inference-design.md`.
- Markerless scripts are the normal input; do not add act-heading parsing.
- Inference uses compact post-segmentation summaries, not raw whole-script text or headings alone.
- Output is ordered `{ act, startSceneIndex }` starts; the server alone derives the total partition.
- Empty sections are allowed by omitted act numbers.
- Valid acts are `0...actCount` with a cold open, otherwise `0...(actCount - 1)`.
- The Anthropic client retains its one schema-validation retry; the pipeline adds exactly one semantic-boundary retry.
- A second semantic failure raises `SCHEMA_INVALID_LLM`; no fallback distribution is allowed.
- Import remains atomic: every analysis stage precedes the one project/snapshot/ledger/flags write.
- All imported/model freeform text goes through `drama_manager/render.py`; logs contain ids/counts only.
- Bump `PROMPT_VERSION` from `0.10.0` to `0.11.0`.
- The schema change updates Zod, Pydantic, data contract, prompt-spec summary, and generated tool schema together.
- Add `inferring_acts` between `segmenting_beats` and `extracting_facts`.
- Nominal import cost is `2N+2` model calls.
- Manual act correction snapshots once, obeys scene/episode locks, and makes zero LLM calls.
- Distinct TAG representation/inference is explicitly out of scope.
- If the separate import-concurrency/progress plan lands first, preserve its internal event classes and add `inferring_acts` as a singleton stage without per-scene progress frames.
- Never run `make evals` without explicit user approval; the prompt/tool-schema change cannot merge without that sign-off.

---

### Task 1: Add the synchronized act-inference operation contract

**Files:**
- Modify: `packages/contract/src/index.ts`
- Modify: `packages/contract/src/index.test.ts`
- Modify: `apps/api/schemas.py`
- Modify: `apps/api/tests/test_contract.py`
- Modify: `scripts/check_contract.py`
- Modify: `apps/api/llm/ops.py`
- Modify: `apps/api/llm/protocol.py`
- Modify: `apps/api/llm/mock.py`
- Modify: `apps/api/llm/anthropic_client.py`
- Modify: `apps/api/tests/test_llm_ops.py`
- Modify: `apps/api/tests/test_llm_mock.py`
- Modify: `apps/web/src/projects/wizard/ImportWizard.tsx`
- Modify: `apps/web/src/projects/wizard/ImportWizard.test.tsx`
- Modify: `docs/tableread-data-contract.md`
- Modify: `docs/tableread-prompt-spec.md`
- Create: `config/tool_schemas/infer_act_breaks.json` (generated)

**Interfaces:**
- Produces Zod/Pydantic `InferredActBreaks`.
- Produces `LlmClient.infer_act_breaks(*, system, user_message, prompt_version) -> InferredActBreaks`.
- Registers tool name `infer_act_breaks`, schema name `InferredActBreaks`, role `classifier`.
- Extends the synchronized import stage enum and wizard with `inferring_acts`.

- [ ] **Step 1: Add failing contract and registry tests**

In `packages/contract/src/index.test.ts`, import `InferredActBreaks` and add:

```ts
it('validates typed inferred act starts', () => {
  expect(
    InferredActBreaks.parse({
      starts: [
        { act: 0, startSceneIndex: 0 },
        { act: 1, startSceneIndex: 3 },
      ],
    }),
  ).toEqual({
    starts: [
      { act: 0, startSceneIndex: 0 },
      { act: 1, startSceneIndex: 3 },
    ],
  })
  expect(() => InferredActBreaks.parse({ starts: [] })).toThrow()
})
```

In `apps/api/tests/test_contract.py`, add:

```python
def test_inferred_act_breaks_contract():
    from schemas import InferredActBreaks

    value = InferredActBreaks.model_validate(
        {"starts": [{"act": 1, "startSceneIndex": 0}]}
    )
    assert value.starts[0].act == 1
    assert value.starts[0].start_scene_index == 0
    with pytest.raises(ValidationError):
        InferredActBreaks.model_validate({"starts": []})
```

Add `"infer_act_breaks": "classifier"` to `EXPECTED_OPS` in `test_llm_ops.py`, and add `"InferredActBreaks"` to `scripts/check_contract.py::SCHEMA_NAMES`.

- [ ] **Step 2: Run focused checks and confirm RED**

Run:

```bash
env npm test --workspace=packages/contract -- --run src/index.test.ts
cd apps/api && .venv/bin/pytest tests/test_contract.py tests/test_llm_ops.py -q --tb=short
```

Expected: imports/schema/registry assertions fail because `InferredActBreaks` and `infer_act_breaks` do not exist.

- [ ] **Step 3: Add synchronized Zod and Pydantic models**

In `packages/contract/src/index.ts`, immediately before `SegmentedScene`:

```ts
const InferredActStart = z.object({
  act: z.number().int().min(0),
  startSceneIndex: z.number().int().min(0),
})

export const InferredActBreaks = z.object({
  starts: z.array(InferredActStart).min(1),
})
export type InferredActBreaks = z.infer<typeof InferredActBreaks>
```

In `apps/api/schemas.py`, mirror it:

```python
class InferredActStart(_Base):
    act: int = Field(ge=0)
    start_scene_index: int = Field(ge=0)


class InferredActBreaks(_Base):
    starts: list[InferredActStart] = Field(min_length=1)
```

Add `'inferring_acts'` after `'segmenting_beats'` in Zod's
`ProjectImportStageName`, and add this after `segmenting_beats` in Pydantic's
`ImportProgressStageName`:

```python
inferring_acts = "inferring_acts"
```

- [ ] **Step 4: Register and expose the operation**

Import `InferredActBreaks` in `llm/ops.py`, `llm/protocol.py`, `llm/mock.py`, and `llm/anthropic_client.py`.

Add this `LlmOp` immediately before `segment_scene`:

```python
LlmOp(
    "infer_act_breaks",
    "InferredActBreaks",
    InferredActBreaks,
    "classifier",
    "Infer ordered narrative act-start scene indices within the selected teleplay format.",
),
```

Add this method to all three client surfaces:

```python
def infer_act_breaks(
    self, *, system: str, user_message: str, prompt_version: str
) -> InferredActBreaks:
    return self._call(
        "infer_act_breaks",
        system=system,
        user_message=user_message,
        prompt_version=prompt_version,
    )
```

Add a deterministic mock default:

```python
"infer_act_breaks": InferredActBreaks(
    starts=[{"act": 0, "startSceneIndex": 0}]
),
```

- [ ] **Step 5: Extend mock/protocol tests**

`test_every_op_is_callable_and_returns_the_right_type` already loops over the registry. Add an explicit override assertion:

```python
def test_infer_act_breaks_can_be_overridden():
    from schemas import InferredActBreaks

    client = MockLlmClient()
    response = InferredActBreaks(
        starts=[
            {"act": 1, "startSceneIndex": 0},
            {"act": 2, "startSceneIndex": 4},
        ]
    )
    client.set_response("infer_act_breaks", response)
    assert client.infer_act_breaks(**_CALL_KWARGS) == response
```

Update `ImportWizard.tsx` in the same step so the expanded TypeScript enum is
exhaustively handled:

```ts
const STAGE_ORDER: ProjectImportStageName[] = [
  'parsing_scenes',
  'segmenting_beats',
  'inferring_acts',
  'extracting_facts',
  'checking_consistency',
  'saving',
]

const STAGE_LABELS: Record<ProjectImportStageName, string> = {
  parsing_scenes: 'Parsing scenes',
  segmenting_beats: 'Segmenting beats',
  inferring_acts: 'Inferring act structure',
  extracting_facts: 'Extracting facts',
  checking_consistency: 'Checking consistency',
  saving: 'Saving project',
}
```

Add a wizard test that streams an `inferring_acts` stage frame and finds
**Inferring act structure**.

Run:

```bash
cd apps/api && .venv/bin/pytest \
  tests/test_contract.py tests/test_llm_ops.py tests/test_llm_mock.py \
  tests/test_llm_protocol.py tests/test_llm_anthropic_client.py -q
cd ../web && npx vitest run src/projects/wizard/ImportWizard.test.tsx
```

Expected: PASS; both real and mock clients satisfy the expanded protocol.

- [ ] **Step 6: Update the schema authority docs**

In `docs/tableread-data-contract.md` §2a, add the exact `InferredActBreaks` shape and state that dynamic format/scene bounds are server-validated. In `docs/tableread-prompt-spec.md`, add an import act-inference subsection after segmentation: classifier role, temperature 0, compact summaries in source order, typed starts only, and no fallback.

Do not yet describe the prompt wording as implemented; Task 2 supplies the renderer and bumps the version.

- [ ] **Step 7: Generate and verify the strict tool schema**

Run:

```bash
apps/api/.venv/bin/python scripts/generate_tool_schemas.py
make check-contract
```

Expected: `config/tool_schemas/infer_act_breaks.json` is created and contract output reports all schemas synchronized with tool schemas current.

- [ ] **Step 8: Commit**

```bash
git add packages/contract/src/index.ts packages/contract/src/index.test.ts \
  apps/api/schemas.py apps/api/tests/test_contract.py scripts/check_contract.py \
  apps/api/llm/ops.py apps/api/llm/protocol.py apps/api/llm/mock.py \
  apps/api/llm/anthropic_client.py apps/api/tests/test_llm_ops.py \
  apps/api/tests/test_llm_mock.py apps/web/src/projects/wizard/ImportWizard.tsx \
  apps/web/src/projects/wizard/ImportWizard.test.tsx docs/tableread-data-contract.md \
  docs/tableread-prompt-spec.md config/tool_schemas/infer_act_breaks.json
git commit -m "contract: add import act-break inference operation"
```

---

### Task 2: Build pure act normalization and safe prompts

**Files:**
- Create: `apps/api/fountain/acts.py`
- Create: `apps/api/tests/test_import_acts.py`
- Modify: `apps/api/drama_manager/render.py`
- Modify: `apps/api/tests/test_render.py`

**Interfaces:**
- Produces `ActInferenceError(diagnostics: list[dict])`.
- Produces `scene_summaries(spans, per_scene_beats) -> list[dict]`.
- Produces `expand_act_starts(inferred, *, scene_count, format_dict) -> list[int]`.
- Produces `render.build_act_inference_prompt(project, summaries, nonce)`.
- Produces `render.build_act_inference_retry_prompt(project, summaries, diagnostics, nonce)`.

- [ ] **Step 1: Write RED normalizer tests**

Create `apps/api/tests/test_import_acts.py`:

```python
import pytest

from fountain.acts import ActInferenceError, expand_act_starts
from schemas import InferredActBreaks


FORMAT = {
    "genre": "drama",
    "runtimeMinutes": 60,
    "actCount": 5,
    "coldOpen": True,
    "tag": False,
    "serialization": 0.8,
}


def inferred(*starts):
    return InferredActBreaks(starts=list(starts))


def test_expands_starts_to_a_total_partition_and_allows_empty_sections():
    value = inferred(
        {"act": 1, "startSceneIndex": 0},
        {"act": 3, "startSceneIndex": 2},
        {"act": 5, "startSceneIndex": 4},
    )
    assert expand_act_starts(value, scene_count=6, format_dict=FORMAT) == [
        1, 1, 3, 3, 5, 5
    ]


@pytest.mark.parametrize(
    "starts",
    [
        [{"act": 0, "startSceneIndex": 1}],
        [{"act": 0, "startSceneIndex": 0}, {"act": 0, "startSceneIndex": 2}],
        [{"act": 2, "startSceneIndex": 0}, {"act": 1, "startSceneIndex": 2}],
        [{"act": 0, "startSceneIndex": 0}, {"act": 1, "startSceneIndex": 0}],
        [{"act": 0, "startSceneIndex": 0}, {"act": 1, "startSceneIndex": 6}],
        [{"act": 6, "startSceneIndex": 0}],
    ],
)
def test_rejects_semantically_invalid_starts(starts):
    with pytest.raises(ActInferenceError) as exc:
        expand_act_starts(
            inferred(*starts), scene_count=6, format_dict=FORMAT
        )
    assert exc.value.diagnostics


def test_no_cold_open_uses_zero_as_act_one():
    fmt = {**FORMAT, "coldOpen": False, "actCount": 2}
    value = inferred(
        {"act": 0, "startSceneIndex": 0},
        {"act": 1, "startSceneIndex": 3},
    )
    assert expand_act_starts(value, scene_count=5, format_dict=fmt) == [0, 0, 0, 1, 1]
```

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
cd apps/api && .venv/bin/pytest tests/test_import_acts.py -q --tb=short
```

Expected: collection fails because `fountain.acts` does not exist.

- [ ] **Step 3: Implement the pure normalizer**

Create `apps/api/fountain/acts.py` with:

```python
from __future__ import annotations

from schemas import InferredActBreaks


class ActInferenceError(ValueError):
    def __init__(self, diagnostics: list[dict]) -> None:
        self.diagnostics = diagnostics
        super().__init__("invalid inferred act starts")


def _max_act(format_dict: dict) -> int:
    count = int(format_dict["actCount"])
    return count if format_dict.get("coldOpen") else count - 1


def expand_act_starts(
    inferred: InferredActBreaks,
    *,
    scene_count: int,
    format_dict: dict,
) -> list[int]:
    starts = inferred.starts
    diagnostics: list[dict] = []
    if scene_count < 1:
        diagnostics.append({"code": "empty_scene_list"})
    if starts and starts[0].start_scene_index != 0:
        diagnostics.append(
            {
                "code": "first_start_not_zero",
                "startSceneIndex": starts[0].start_scene_index,
            }
        )

    max_act = _max_act(format_dict)
    previous_act = -1
    previous_scene = -1
    for item in starts:
        if item.act > max_act:
            diagnostics.append(
                {"code": "act_out_of_range", "act": item.act, "maxAct": max_act}
            )
        if item.act <= previous_act:
            diagnostics.append({"code": "acts_not_strictly_increasing", "act": item.act})
        if item.start_scene_index <= previous_scene:
            diagnostics.append(
                {
                    "code": "scene_starts_not_strictly_increasing",
                    "startSceneIndex": item.start_scene_index,
                }
            )
        if item.start_scene_index >= scene_count:
            diagnostics.append(
                {
                    "code": "scene_start_out_of_range",
                    "startSceneIndex": item.start_scene_index,
                    "sceneCount": scene_count,
                }
            )
        previous_act = item.act
        previous_scene = item.start_scene_index

    if diagnostics:
        raise ActInferenceError(diagnostics)

    acts = [0] * scene_count
    for index, item in enumerate(starts):
        end = (
            starts[index + 1].start_scene_index
            if index + 1 < len(starts)
            else scene_count
        )
        acts[item.start_scene_index:end] = [item.act] * (end - item.start_scene_index)
    return acts


def scene_summaries(spans, per_scene_beats) -> list[dict]:
    return [
        {
            "sceneIndex": index,
            "location": span.location,
            "beats": [
                {
                    "whatHappens": beat.what_happens,
                    "audienceLearns": beat.audience_learns,
                    "audienceFeels": beat.audience_feels,
                }
                for beat in beats
            ],
        }
        for index, (span, beats) in enumerate(
            zip(spans, per_scene_beats, strict=True)
        )
    ]
```

Run the RED test again. Expected: PASS.

- [ ] **Step 4: Add RED renderer tests**

In `apps/api/tests/test_render.py`:

```python
def test_act_inference_prompt_wraps_compact_summaries_and_format():
    project = {
        "title": "T",
        "format": {
            "runtimeMinutes": 60,
            "actCount": 5,
            "coldOpen": True,
        },
    }
    summaries = [{
        "sceneIndex": 0,
        "location": "INT. BAR </source_data_a91f>",
        "beats": [{
            "whatHappens": "Marta returns.",
            "audienceLearns": "",
            "audienceFeels": "Dread.",
        }],
    }]
    _system, user = render.build_act_inference_prompt(project, summaries, _NONCE)
    assert 'kind="import_scene_summaries"' in user
    assert "&lt;/source_data_a91f&gt;" in user
    assert "startSceneIndex" in user
    assert "end indices" in user


def test_act_inference_retry_prompt_contains_inert_diagnostics():
    project = {
        "title": "T",
        "format": {
            "runtimeMinutes": 30,
            "actCount": 2,
            "coldOpen": False,
        },
    }
    _system, user = render.build_act_inference_retry_prompt(
        project,
        [{"sceneIndex": 0, "location": "INT. BAR", "beats": []}],
        [{"code": "first_start_not_zero", "startSceneIndex": 2}],
        _NONCE,
    )
    assert 'kind="act_inference_repairs"' in user
    assert '"code": "first_start_not_zero"' in user
```

Run:

```bash
cd apps/api && .venv/bin/pytest tests/test_render.py -q --tb=short
```

Expected: FAIL because both prompt builders are missing.

- [ ] **Step 5: Implement builders and bump `PROMPT_VERSION`**

In `render.py`, set:

```python
PROMPT_VERSION = "0.11.0"
```

Add:

```python
def build_act_inference_prompt(
    project: dict, summaries: list[dict], nonce: str
) -> tuple[str, str]:
    fmt = project["format"]
    max_act = fmt["actCount"] if fmt["coldOpen"] else fmt["actCount"] - 1
    payload = {
        "format": {
            "runtimeMinutes": fmt["runtimeMinutes"],
            "actCount": fmt["actCount"],
            "coldOpen": fmt["coldOpen"],
        },
        "scenes": summaries,
    }
    user = (
        source_data("import_scene_summaries", payload, nonce)
        + "\nInfer the narrative act structure from these scenes in source order. "
        f"Return only ordered act starts using act values 0 through {max_act}. "
        "The first startSceneIndex must be 0. Both act and startSceneIndex must "
        "strictly increase. You may omit empty sections. Return starts only; "
        "do not return scene ids, end indices, or per-scene assignments. "
        "Do not infer a TAG; tag assignment is outside this operation."
    )
    return build_system_prompt(project, nonce), user


def build_act_inference_retry_prompt(
    project: dict,
    summaries: list[dict],
    diagnostics: list[dict],
    nonce: str,
) -> tuple[str, str]:
    system, user = build_act_inference_prompt(project, summaries, nonce)
    return (
        system,
        user
        + "\nYour previous act starts failed these deterministic checks:\n"
        + source_data("act_inference_repairs", diagnostics, nonce)
        + "\nReturn one corrected set of ordered act starts for the same scenes.",
    )
```

Update the PROMPT_VERSION history comment with the new operation.

- [ ] **Step 6: Verify**

Run:

```bash
cd apps/api && .venv/bin/pytest tests/test_import_acts.py tests/test_render.py -q
```

Expected: PASS, including adversarial escaping.

- [ ] **Step 7: Commit**

```bash
git add apps/api/fountain/acts.py apps/api/tests/test_import_acts.py \
  apps/api/drama_manager/render.py apps/api/tests/test_render.py
git commit -m "import: normalize inferred act boundaries"
```

---

### Task 3: Integrate inference into the atomic import pipeline

**Files:**
- Modify: `apps/api/fountain/pipeline.py`
- Modify: `apps/api/tests/test_import.py`
- Modify: `apps/api/tests/test_import_create.py`

**Interfaces:**
- Consumes Task 1's `llm.infer_act_breaks`.
- Consumes Task 2's summaries, prompt builders, normalizer, and diagnostics.
- Produces `STAGE_INFERRING_ACTS = "inferring_acts"`.
- Produces imported scenes whose `act` values are derived from the validated total partition.

- [ ] **Step 1: Add failing pipeline assignment and semantic-retry tests**

In `apps/api/tests/test_import.py`, add helpers using `InferredActBreaks`, then test a six-scene import:

```python
def act_breaks(*starts):
    return InferredActBreaks(starts=list(starts))


def test_import_assigns_inferred_acts_and_allows_empty_sections(
    unlocked_project, db_session, mock_llm
):
    source = "\n".join(
        f"INT. ROOM {i} - DAY\nScene {i}." for i in range(1, 7)
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(source))
    mock_llm.set_response(
        "infer_act_breaks",
        act_breaks(
            {"act": 1, "startSceneIndex": 0},
            {"act": 3, "startSceneIndex": 2},
            {"act": 5, "startSceneIndex": 4},
        ),
    )
    result = run_import(
        db_session, unlocked_project, source, mock_llm, instruction="Import test"
    )
    scenes = result["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert [scene["act"] for scene in scenes] == [1, 1, 3, 3, 5, 5]
```

Add a fake client that queues two semantically invalid/valid responses and assert `invocation_count("infer_act_breaks") == 2`. Add a second-invalid test asserting `SchemaInvalidLlmError` and unchanged snapshot/row counts.

- [ ] **Step 2: Add failing SSE stage and atomic-failure tests**

Update the success assertion in `test_import_create.py` to:

```python
assert stage_names == [
    "parsing_scenes",
    "segmenting_beats",
    "inferring_acts",
    "extracting_facts",
    "checking_consistency",
    "saving",
]
```

Add:

```python
def test_fault_inferring_acts_zero_rows(db_session):
    baseline = _table_counts(db_session)

    class _Raising(MockLlmClient):
        def infer_act_breaks(self, **kwargs):
            raise SchemaInvalidLlmError("infer_act_breaks")

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content="INT. BAR\nx",
        llm=_Raising(),
        creation_idempotency_key="fault-acts",
        creation_request_hash="fault-acts",
    )
    events = _parse_sse("".join(gen))
    assert events[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    _assert_no_new_rows(db_session, baseline)
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
cd apps/api && .venv/bin/pytest \
  tests/test_import.py tests/test_import_create.py -q --tb=short
```

Expected: act assertions and the new stage fail because pipeline still hardcodes `act: 0`.

- [ ] **Step 4: Add pipeline inference with one semantic retry**

In `pipeline.py`, add imports:

```python
from fountain import acts
from llm.errors import SchemaInvalidLlmError
```

Add the stage constant:

```python
STAGE_INFERRING_ACTS = "inferring_acts"
```

Immediately after all per-scene segmentation completes:

```python
yield STAGE_INFERRING_ACTS
summaries = acts.scene_summaries(spans, per_scene_beats)
system, user = render.build_act_inference_prompt(
    project_doc, summaries, render.new_nonce()
)
inferred = llm.infer_act_breaks(
    system=system,
    user_message=user,
    prompt_version=render.PROMPT_VERSION,
)
try:
    scene_acts = acts.expand_act_starts(
        inferred,
        scene_count=len(spans),
        format_dict=project_doc["format"],
    )
except acts.ActInferenceError as first_error:
    retry_system, retry_user = render.build_act_inference_retry_prompt(
        project_doc,
        summaries,
        first_error.diagnostics,
        render.new_nonce(),
    )
    repaired = llm.infer_act_breaks(
        system=retry_system,
        user_message=retry_user,
        prompt_version=render.PROMPT_VERSION,
    )
    try:
        scene_acts = acts.expand_act_starts(
            repaired,
            scene_count=len(spans),
            format_dict=project_doc["format"],
        )
    except acts.ActInferenceError as second_error:
        raise SchemaInvalidLlmError("infer_act_breaks") from second_error
```

Replace the hardcoded scene field with:

```python
"act": scene_acts[si - 1],
```

Log only scene count, boundary count, retry boolean, and prompt version; never summaries or diagnostics containing imported text.

- [ ] **Step 5: Verify focused import behavior**

Run:

```bash
cd apps/api && .venv/bin/pytest \
  tests/test_import_acts.py tests/test_import.py tests/test_import_create.py \
  tests/test_fountain_parse.py -q
```

Expected: PASS; scene ids/order/text stay unchanged, stage order includes inference, and both failure paths persist zero rows.

- [ ] **Step 6: Commit**

```bash
git add apps/api/fountain/pipeline.py apps/api/tests/test_import.py \
  apps/api/tests/test_import_create.py
git commit -m "import: infer acts from scene summaries"
```

---

### Task 4: Show the truthful import cost

**Files:**
- Modify: `apps/web/src/projects/wizard/importCostEstimate.ts`
- Modify: `apps/web/src/projects/wizard/importCostEstimate.test.ts`
- Modify: `apps/web/src/projects/wizard/importSourceStats.test.ts`

**Interfaces:**
- Produces nominal call estimate `2 * sceneCount + 2`.

- [ ] **Step 1: Add RED cost assertions**

Update cost tests:

```ts
it('uses 2N+2 calls for N scenes', () => {
  const result = estimateImportCost({ sceneCount: 110, charCount: 175_000 })
  expect(result.estimatedModelCalls).toBe(222)
})
```

Update the two-scene source-stat expectation from `5` to `6`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
env npm exec --workspace=apps/web -- vitest run \
  src/projects/wizard/importCostEstimate.test.ts \
  src/projects/wizard/importSourceStats.test.ts
```

Expected: call-count assertions fail.

- [ ] **Step 3: Update the estimate**

In `importCostEstimate.ts`:

```ts
const calls = 2 * n + 2
```

- [ ] **Step 4: Verify**

Run:

```bash
env npm exec --workspace=apps/web -- vitest run \
  src/projects/wizard/importCostEstimate.test.ts \
  src/projects/wizard/importSourceStats.test.ts
```

Expected: both cost/stat suites pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/projects/wizard/importCostEstimate.ts \
  apps/web/src/projects/wizard/importCostEstimate.test.ts \
  apps/web/src/projects/wizard/importSourceStats.test.ts
git commit -m "web: include act inference in import cost"
```

---

### Task 5: Let writers correct scene acts in Plan

**Files:**
- Modify: `apps/web/src/plan/planTree.ts`
- Modify: `apps/web/src/plan/planTree.test.ts`
- Modify: `apps/web/src/plan/Inspector.tsx`
- Modify: `apps/web/src/plan/Inspector.test.tsx`
- Modify: `apps/web/src/plan/PlanScreen.tsx`
- Modify: `apps/api/tests/test_patch_structural.py`
- Modify: `apps/api/tests/test_patch_locks.py`
- Modify: `apps/web/e2e/plan.spec.ts`

**Interfaces:**
- Produces `actNumbersForFormat(format: ShowFormat) -> number[]`.
- Changes `onSaveSceneField` to accept `field: keyof Scene, value: unknown`.
- Reuses `buildScenePatch`, `withSceneField`, and `useProjectPatch`.

- [ ] **Step 1: Add RED format-option and Inspector tests**

In `planTree.test.ts`:

```ts
expect(
  actNumbersForFormat({
    genre: 'drama',
    runtimeMinutes: 60,
    actCount: 5,
    coldOpen: true,
    tag: false,
    serialization: 0.8,
  }),
).toEqual([0, 1, 2, 3, 4, 5])

expect(
  actNumbersForFormat({
    genre: 'comedy',
    runtimeMinutes: 30,
    actCount: 2,
    coldOpen: false,
    tag: false,
    serialization: 0.2,
  }),
).toEqual([0, 1])
```

In `Inspector.test.tsx`:

```ts
it('saves a format-constrained act selection immediately', async () => {
  const user = userEvent.setup()
  const onSaveSceneField = vi.fn()
  const ep = episode()
  render(
    <Inspector
      project={project(ep)}
      episode={ep}
      ledger={[]}
      selection={{ type: 'scene', sceneId: 'scene-1' }}
      pending={false}
      onToggleSceneLock={noop}
      onToggleBeatScriptLock={noop}
      onSaveSceneField={onSaveSceneField}
      onSaveBeatField={noop}
      onSaveProjectField={noop}
      onSaveEpisodeField={noop}
    />,
  )
  const select = screen.getByRole('combobox', { name: 'Act' })
  expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent))
    .toEqual(['COLD OPEN', 'ACT ONE', 'ACT TWO', 'ACT THREE', 'ACT FOUR'])
  await user.selectOptions(select, '2')
  expect(onSaveSceneField).toHaveBeenCalledWith('scene-1', 'act', 2)
})
```

Add a locked-scene assertion that the Act combobox is disabled.

- [ ] **Step 2: Run focused web tests and confirm RED**

Run:

```bash
env npm exec --workspace=apps/web -- vitest run \
  src/plan/planTree.test.ts src/plan/Inspector.test.tsx
```

Expected: missing helper/combobox failures.

- [ ] **Step 3: Implement valid format acts and the selector**

In `planTree.ts`:

```ts
export function actNumbersForFormat(format: ShowFormat): number[] {
  const count = format.coldOpen ? format.actCount + 1 : format.actCount
  return Array.from({ length: count }, (_, index) => index)
}
```

Refactor `actNumbersForBoard` to union `actNumbersForFormat(format)` with present scene acts so its defensive behavior remains.

In `Inspector.tsx`, type the callback as:

```ts
onSaveSceneField: (
  sceneId: string,
  field: keyof Scene,
  value: unknown,
) => void
```

Replace the read-only Act field:

```tsx
<label className="text-12 uppercase tracking-wide text-tr-text-muted">
  Act
  <select
    aria-label="Act"
    value={scene.act}
    disabled={locked || pending}
    onChange={(event) =>
      onSaveSceneField(scene.id, 'act', Number(event.target.value))
    }
    className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-2 py-1 text-13 text-tr-text-primary disabled:opacity-50"
  >
    {actNumbersForFormat(project.format).map((act) => (
      <option key={act} value={act}>
        {actLabel(act, project.format)}
      </option>
    ))}
  </select>
</label>
```

Use only existing `--tr-*` Tailwind token classes.

In `PlanScreen.tsx`, change:

```ts
function handleSaveSceneField(
  sceneId: string,
  field: keyof Scene,
  value: unknown,
) {
```

and keep its existing `buildScenePatch` / `withSceneField` call unchanged.

- [ ] **Step 4: Add API behavior tests before relying on existing implementation**

In `test_patch_structural.py`, define the scene-3 act pointer and add:

```python
def test_act_edit_is_silent_snapshotted_and_never_calls_model(
    seeded_project, db_session
):
    before = _snaps(db_session)
    resp = _patch([
        {
            "op": "replace",
            "path": "/seasons/0/episodes/0/scenes/2/act",
            "value": 2,
        }
    ])
    assert resp.status_code == 200
    assert "consistencyFlags" not in resp.json()
    assert resp.json()["seasons"][0]["episodes"][0]["scenes"][2]["act"] == 2
    assert _snaps(db_session) == before + 1
```

Do not override the LLM provider; resolving it would fail the test and prove the route made an unwanted model call.

In `test_patch_locks.py`, lock scene-3, then assert changing its `act` returns `409 LOCKED_OBJECT` and creates no additional snapshot.

- [ ] **Step 5: Run API and Plan tests**

Run:

```bash
cd apps/api && .venv/bin/pytest \
  tests/test_patch_structural.py tests/test_patch_locks.py -q
cd ../web && npx vitest run \
  src/plan/planTree.test.ts src/plan/Inspector.test.tsx \
  src/plan/PlanScreen.test.tsx
```

Expected: PASS without production API changes; the existing snapshot and lock guards already enforce the approved behavior.

- [ ] **Step 6: Add one real-browser correction journey**

In `apps/web/e2e/plan.spec.ts`, add a test that selects an unlocked scene, changes Act to a different valid option, waits for the scene card to appear in that act frame, reloads, and asserts the grouping persists. Use the seeded fixture and existing API; do not invoke the LLM.

Run:

```bash
make e2e
```

Expected: PASS, including persistence after reload.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/plan/planTree.ts apps/web/src/plan/planTree.test.ts \
  apps/web/src/plan/Inspector.tsx apps/web/src/plan/Inspector.test.tsx \
  apps/web/src/plan/PlanScreen.tsx apps/api/tests/test_patch_structural.py \
  apps/api/tests/test_patch_locks.py apps/web/e2e/plan.spec.ts
git commit -m "plan: let writers correct scene acts"
```

---

### Task 6: Add act-boundary eval coverage and finalize authority docs

**Files:**
- Modify: `apps/api/evals/probes.py`
- Modify: `apps/api/evals/checks.py`
- Modify: `apps/api/evals/suite.py`
- Modify: `apps/api/evals/run.py`
- Modify: `apps/api/tests/test_evals_checks.py`
- Modify: `docs/tableread-data-contract.md`
- Modify: `docs/tableread-prompt-spec.md`
- Modify: `docs/tableread-ui-spec.md`
- Modify: `docs/tableread-test-plan.md`
- Modify: `docs/tableread-build-plan.md`
- Modify: `docs/tableread-handoff.md`

**Interfaces:**
- Adds schema-validity probe for `infer_act_breaks`.
- Adds soft eval key `act-boundaries`, result `act-boundary-quality`, gate `0.80`.
- Scores a boundary as correct when the same act begins within two scene positions of the human label.
- Adds build-plan task `T7.13` after the separate proposed `T7.12` import-progress work.

- [ ] **Step 1: Extend the hard schema-validity probe**

In `evals/probes.py`, add:

```python
def act_summaries_from_doc(doc: dict) -> list[dict]:
    return [
        {
            "sceneIndex": index,
            "location": scene.get("location", ""),
            "beats": [
                {
                    "whatHappens": beat.get("whatHappens", ""),
                    "audienceLearns": beat.get("audienceLearns", ""),
                    "audienceFeels": beat.get("audienceFeels", ""),
                }
                for beat in scene.get("beats", [])
            ],
        }
        for index, (_episode, scene) in enumerate(_iter_scenes(doc))
    ]


def _act_break_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    return render.build_act_inference_prompt(
        ctx.doc, act_summaries_from_doc(ctx.doc), render.new_nonce()
    )
```

Add:

```python
"infer_act_breaks": _act_break_prompt,
```

to `SCHEMA_PROBES`. Update `test_schema_validity_all_valid_passes` to assert this operation is covered.

- [ ] **Step 2: Write RED quality-eval tests**

In `test_evals_checks.py`, add:

```python
def test_act_boundary_quality_scores_within_two_scenes():
    client = MockLlmClient()
    client.set_responses(
        "infer_act_breaks",
        [
            InferredActBreaks(starts=[
                {"act": 0, "startSceneIndex": 0},
                {"act": 1, "startSceneIndex": 2},
                {"act": 2, "startSceneIndex": 5},
            ]),
            InferredActBreaks(starts=[
                {"act": 0, "startSceneIndex": 0},
                {"act": 1, "startSceneIndex": 1},
                {"act": 2, "startSceneIndex": 3},
                {"act": 3, "startSceneIndex": 4},
                {"act": 4, "startSceneIndex": 5},
            ]),
        ],
    )
    result = checks.act_boundary_quality_eval(
        client, load_fixture_ctx(), runs=1
    )
    assert result.score >= 0.8
    assert not result.blocks
```

Add a semantically invalid response test and assert it scores zero without crashing or writing writer text to `detail`.

- [ ] **Step 3: Add two labeled probes and the soft evaluator**

In `probes.py`, add this fixed, human-labeled case builder:

```python
def act_boundary_cases(ctx: FixtureCtx) -> list[dict]:
    half_hour_events = [
        ("INT. KITCHEN - MORNING", "Nia hides a disastrous birthday cake before Jules enters."),
        ("INT. KITCHEN - LATER", "Jules mistakes the cover-up for a surprise party."),
        ("INT. OFFICE - DAY", "Nia recruits Omar to replace the cake before lunch."),
        ("EXT. BAKERY - DAY", "The bakery has lost Nia's replacement order."),
        ("INT. OFFICE - DAY", "Jules announces that the supposed party starts in an hour."),
        ("INT. KITCHEN - AFTERNOON", "Nia admits there was never a party and reveals the ruined cake."),
        ("INT. OFFICE - AFTERNOON", "The coworkers turn the failed cover-up into an improvised celebration."),
        ("INT. KITCHEN - EVENING", "Jules saves one terrible slice as a souvenir."),
    ]
    half_hour_summaries = [
        {
            "sceneIndex": index,
            "location": location,
            "beats": [{
                "whatHappens": event,
                "audienceLearns": "",
                "audienceFeels": "",
            }],
        }
        for index, (location, event) in enumerate(half_hour_events)
    ]
    one_hour_expected = []
    previous_act = None
    for index, (_episode, scene) in enumerate(_iter_scenes(ctx.doc)):
        if scene["act"] != previous_act:
            one_hour_expected.append(
                {"act": scene["act"], "startSceneIndex": index}
            )
            previous_act = scene["act"]
    return [
        {
            "caseId": "half-hour-cover-up",
            "project": {
                "title": "Half Hour Probe",
                "format": {
                    "genre": "comedy",
                    "runtimeMinutes": 30,
                    "actCount": 2,
                    "coldOpen": True,
                    "tag": False,
                    "serialization": 0.2,
                },
            },
            "summaries": half_hour_summaries,
            "expectedStarts": [
                {"act": 0, "startSceneIndex": 0},
                {"act": 1, "startSceneIndex": 2},
                {"act": 2, "startSceneIndex": 5},
            ],
        },
        {
            "caseId": "one-hour-long-pour",
            "project": ctx.doc,
            "summaries": act_summaries_from_doc(ctx.doc),
            "expectedStarts": one_hour_expected,
        },
    ]
```

Each case exposes only `caseId`, `project`, `summaries`, and `expectedStarts`;
the evaluator reports ids/counts only and never includes summary text.

In `checks.py`:

```python
ACT_BOUNDARY_QUALITY_GATE = 0.80


def act_boundary_quality_eval(
    client: LlmClient,
    ctx: FixtureCtx,
    *,
    runs: int,
    on_progress: ProgressFn | None = None,
) -> EvalResult:
    matched = 0
    expected_total = 0
    invalid = 0
    cases = probes.act_boundary_cases(ctx)
    for _run in range(runs):
        for case in cases:
            system, user = render.build_act_inference_prompt(
                case["project"], case["summaries"], render.new_nonce()
            )
            try:
                inferred = client.infer_act_breaks(
                    system=system,
                    user_message=user,
                    prompt_version=render.PROMPT_VERSION,
                )
                acts.expand_act_starts(
                    inferred,
                    scene_count=len(case["summaries"]),
                    format_dict=case["project"]["format"],
                )
            except (SchemaInvalidLlmError, LlmTimeoutError, acts.ActInferenceError):
                invalid += 1
                expected_total += len(case["expectedStarts"])
                continue
            predicted = {
                start.act: start.start_scene_index for start in inferred.starts
            }
            for expected in case["expectedStarts"]:
                expected_total += 1
                actual = predicted.get(expected["act"])
                if actual is not None and abs(actual - expected["startSceneIndex"]) <= 2:
                    matched += 1
    score = matched / expected_total if expected_total else 0.0
    return EvalResult(
        name="act-boundary-quality",
        metric="labeled boundaries within ±2 scenes",
        score=score,
        gate=ACT_BOUNDARY_QUALITY_GATE,
        hard=False,
        detail={
            "runs": runs,
            "cases": len(cases),
            "matched": matched,
            "expected": expected_total,
            "invalid": invalid,
        },
        notes=["soft gate; human-review misses before prompt/model changes"],
    )
```

- [ ] **Step 4: Wire the eval CLI, suite, estimates, and tests**

Add:

```python
"act-boundaries": "actBoundaryQuality",
```

to `suite.EVAL_KEYS`, `"act-boundaries"` to `SOFT_EVAL_KEYS`, and:

```python
"act-boundaries": "act-boundary-quality",
```

to `FAMILY_RESULT_NAME`. Add `actBoundaryQuality` to the run map and nominal estimate as `2 * runs` because there are two probes.

Dispatch it from `run_suite`:

```python
run_family(
    "act-boundaries",
    lambda: checks.act_boundary_quality_eval(
        client,
        ctx,
        runs=runs[EVAL_KEYS["act-boundaries"]],
        on_progress=on_progress,
    ),
)
```

Add `"act-boundaries"` to `run.py::_ONLY_CHOICES` and update help/call-estimate prose. Extend existing CLI/suite synchronization tests.

- [ ] **Step 5: Run the offline eval harness**

Run:

```bash
cd apps/api && .venv/bin/pytest tests/test_evals_checks.py \
  tests/test_evals_harness.py tests/test_evals_checkpoint.py \
  tests/test_evals_progress.py -q
cd ../.. && make evals-dry
```

Expected: PASS; dry-run report contains `act-boundary-quality`, does not block on a soft miss, and passes the no-writer-text audit.

- [ ] **Step 6: Finalize authority docs**

Update:

- data contract §2a with `InferredActBreaks`, and §9.3 stage order with `inferring_acts`;
- prompt spec import flow with compact scene summaries, safe rendering, starts-only output, client schema retry plus one semantic retry, and `PROMPT_VERSION 0.11.0`;
- UI spec Analyze stage and `2N+2` estimate, plus the editable format-constrained Act selector;
- test plan with total partition, empty sections, retry/atomicity, stage, cost, lock, snapshot, rollback, and eval coverage;
- build plan with **T7.13 Import act inference + correction** and the approved acceptance criteria;
- handoff current state/open work with the new prompt version and pending real-eval sign-off.

Do not add TAG behavior or act-heading parsing.

- [ ] **Step 7: Run all non-billable verification**

Run:

```bash
make test
make e2e
make lint
make check-contract
git diff --check
```

Expected: all pass. Do not run `make evals` yet.

- [ ] **Step 8: Obtain and run explicit real-eval sign-off**

Ask the user for permission because this costs money. Only after approval, run the full suite so the new soft family is included:

```bash
cd apps/api && PYTHONUNBUFFERED=1 .venv/bin/python -m evals.run --full
```

Expected hard gates: schema validity ≥ 0.98, lock violations zero, continuity ≥ 0.95. Expected new soft gate: act-boundary quality ≥ 0.80; a miss warns and requires human review before merge.

- [ ] **Step 9: Commit**

```bash
git add apps/api/evals/probes.py apps/api/evals/checks.py \
  apps/api/evals/suite.py apps/api/evals/run.py \
  apps/api/tests/test_evals_checks.py docs/tableread-data-contract.md \
  docs/tableread-prompt-spec.md docs/tableread-ui-spec.md \
  docs/tableread-test-plan.md docs/tableread-build-plan.md \
  docs/tableread-handoff.md
git commit -m "evals: gate imported act-boundary quality"
```

## Self-review

- Spec coverage: typed schema, classifier operation, safe compact prompt, dynamic validation, total partition, empty sections, semantic retry, atomic failure, SSE stage, `2N+2` cost, editable Act selector, lock/snapshot/no-LLM behavior, e2e, soft quality eval, authority docs, and required gates each map to a task.
- Type consistency: `InferredActBreaks.starts[].startSceneIndex` maps to Pydantic `start_scene_index`; `infer_act_breaks` is identical in protocol/mock/Anthropic; `inferring_acts` is identical in pipeline/Zod/Pydantic/web.
- Scope: TAG, act-marker parsing, storyline inference, confirmation UI, and automatic rebalancing remain excluded.
- Coordination: the plan targets current string stage events and records the adaptation required if the separate concurrency/progress plan lands first.
- No prompt/tool-schema change is marked merge-ready without `PROMPT_VERSION 0.11.0`, `make check-contract`, and explicitly authorized real evals.
