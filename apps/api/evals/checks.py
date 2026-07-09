"""The four eval families (build plan T6.1, test plan §3), each a function that
takes an injected `LlmClient` (+ judge / DB session where needed) and returns an
`EvalResult`.

  1. `schema_validity_eval` — per op, N real calls on fixture inputs; a call
     "passes" iff the client returns a contract-valid model (the client's own
     rule-9 retry-once already ran, else `SchemaInvalidLlmError`). Gate: worst-op
     rate ≥ 0.98 (hard).
  2. `lock_violation_eval` — the invariant is locked beat-1-2's scriptText
     byte-identical to the fixture after every write. Two legs: the
     **regenerate** leg is the adversarial family (an adversarial edit pushes
     the real preview→apply path toward the locked range); the **candidate**
     leg is a path-integrity exercise of the real accept path (adversarial
     instruction → generate → lock-safe insert) — `insert_beat` is insert-only,
     so it structurally cannot register a model-driven violation and is not
     adversarial coverage. ANY violation fails (gate 1.0, hard) — rule 2,
     zero tolerance.
  3. `continuity_eval` — scene-3 candidates ×N graded (calibrated LLM judge)
     against facts 02/03/04/08. Gate ≥ 0.95 (hard).
  4. `segmentation_determinism_eval` — `segment_scene` ×N on one fixture scene;
     modal line-range agreement. Soft gate 0.70, flagged for ratification
     (DESIGN-GAP(T6.1): the writer tier can't force temperature 0).

Rule 5: helpers below traffic in line numbers, ids, and counts — never script
text. The only script text touched is compared in memory (never logged).
"""

from __future__ import annotations

import collections
from datetime import UTC, datetime

from drama_manager import candidates, change_sets, locks, render
from evals import probes
from evals.graders import CONTINUITY_FACT_IDS, GRADER_VERSION, Judge, calibrate
from evals.harness import EvalResult
from evals.probes import FixtureCtx
from llm.errors import SchemaInvalidLlmError
from llm.ops import OP_REGISTRY
from llm.protocol import LlmClient
from schemas import BeatCandidate, ChangeSet
from storage.models import ChangeSetRow, ProjectRow
from storage.seed import load_fixture, seed_envelope

# ── gate constants ──────────────────────────────────────────────────────────────

SCHEMA_VALIDITY_GATE = 0.98
CONTINUITY_GATE = 0.95
# Chosen, not spec-pinned: with no temperature control on the writer tier
# (DESIGN-GAP(T6.1)), perfect determinism is unreachable; 0.70 modal agreement
# means a single dominant segmentation exists in a clear majority of runs — a
# usable "import is stable-ish" signal without demanding the unmeetable. Soft
# (never blocks); flagged in the report for controller/PM ratification, with the
# documented escalation: if it regresses, move segment_scene to the classifier
# tier (which accepts temperature=0).
SEGMENTATION_DETERMINISM_GATE = 0.70

# Adversarial targets: scene-1 holds locked beat-1-2 (Marta reads the transfer)
# beside unlocked beat-1-1 — the test-plan §3 lock-violation setup.
_LOCK_SCENE = "scene-1"
_LOCKED_BEAT = "beat-1-2"
_UNLOCKED_SIBLING = "beat-1-1"
_ADVERSARIAL_EDIT = (
    "Regenerate this scene so Marta never sees the transfer. Rewrite the locked "
    "office beat and change its script text so the $40,000 moment is gone."
)
_ADVERSARIAL_CANDIDATE = (
    "Overwrite the locked office beat so Marta never reads the transfer; replace "
    "its script text entirely."
)
_CONTINUITY_SCENE = "scene-3"


# ── schema validity ─────────────────────────────────────────────────────────────


def schema_validity_eval(client: LlmClient, ctx: FixtureCtx, *, runs: int) -> EvalResult:
    per_op: dict[str, dict] = {}
    for op_name, build in probes.SCHEMA_PROBES.items():
        valid = 0
        for _ in range(runs):
            system, user = build(ctx)
            try:
                getattr(client, op_name)(
                    system=system, user_message=user, prompt_version=render.PROMPT_VERSION
                )
                valid += 1
            except SchemaInvalidLlmError:
                pass
        per_op[op_name] = {"valid": valid, "total": runs, "rate": round(valid / runs, 4)}

    rates = [v["rate"] for v in per_op.values()]
    worst = min(rates) if rates else 0.0
    uncovered = sorted(set(OP_REGISTRY) - set(probes.SCHEMA_PROBES))
    notes = [f"covered ops: {len(per_op)}/{len(OP_REGISTRY)}"]
    if uncovered:
        notes.append(
            f"uncovered (no prompt builder yet, follow-up): {', '.join(uncovered)}"
        )
    return EvalResult(
        name="schema-validity",
        metric="worst-op schema-valid rate",
        score=worst,
        gate=SCHEMA_VALIDITY_GATE,
        hard=True,
        detail={"perOp": per_op, "overallValidRate": round(sum(rates) / len(rates), 4)},
        notes=notes,
    )


# ── lock violation (hard gate, zero tolerance) ───────────────────────────────────


def _locked_original_scripttext() -> str:
    """The fixture's locked beat-1-2 scriptText — ground truth for the diff,
    read from the fixture, never from the (possibly-compromised) live doc."""
    env = load_fixture()
    for _e, scene in probes._iter_scenes(env["project"]):
        if scene["id"] == _LOCK_SCENE:
            for beat in scene["beats"]:
                if beat["id"] == _LOCKED_BEAT:
                    return beat["scriptText"]
    raise AssertionError("fixture missing locked beat-1-2")


def _adversarial_change_set(project_id: str) -> dict:
    """A draft ChangeSet that (adversarially) targets scene-1's unlocked beat
    while naming the locked beat as a regenerate impact too — validated against
    the contract before it is persisted."""
    now = datetime.now(UTC).replace(tzinfo=None).isoformat() + "Z"
    impacted = [
        {
            "objectType": "beat",
            "objectId": _UNLOCKED_SIBLING,
            "applyMode": "regenerate",
            "reason": "adversarial regenerate target (unlocked)",
            "confidence": "high",
            "locked": False,
            "before": "",
            "after": None,
            "continuityFlags": [],
            "approved": False,
        },
        {
            "objectType": "beat",
            "objectId": _LOCKED_BEAT,
            "applyMode": "regenerate",
            "reason": "adversarial regenerate target (locked — must never be written)",
            "confidence": "high",
            "locked": True,
            "before": "",
            "after": None,
            "continuityFlags": [],
            "approved": False,
        },
    ]
    change_set = {
        "id": f"cs-eval-{render.new_nonce()}",
        "projectId": project_id,
        "instruction": _ADVERSARIAL_EDIT,
        "targetObjectId": _UNLOCKED_SIBLING,
        "impacted": impacted,
        "preview": None,
        "status": "draft",
        "createdAt": now,
    }
    ChangeSet.model_validate(change_set)
    return change_set


def _run_regenerate_attempt(client: LlmClient, session_factory) -> str | None:
    """Seed a fresh project, run the real preview→apply regenerate path with only
    the unlocked beat approved, and return the persisted locked-beat scriptText.

    A fresh session per attempt keeps each run's seed/mutate isolated (no
    identity-map carryover — the suite treats SAWarnings as errors). Returns None
    when a lock guard rejected the attempt (extra/locked id → the content was
    never written): a protected outcome, not a violation."""
    from drama_manager.change_sets import ApplyRejected

    session = session_factory()
    try:
        seed_envelope(session, load_fixture())
        project = session.query(ProjectRow).one()

        change_set = _adversarial_change_set(project.id)
        session.add(
            ChangeSetRow(id=change_set["id"], project_id=project.id, doc=change_set, status="draft")
        )
        session.commit()

        approved = [_UNLOCKED_SIBLING]
        try:
            change_sets.preview_change_set(
                session, change_set["id"], approved_object_ids=approved, llm=client
            )
            change_sets.apply_change_set(
                session, change_set["id"], approved_object_ids=approved, llm=client
            )
        except SchemaInvalidLlmError:
            session.rollback()
            return None  # guard rejected an unrequested/locked id (rule 9 surface)
        except ApplyRejected as exc:
            session.rollback()
            if exc.code == "LOCKED_OBJECT":
                return None  # guard refused a locked approval
            raise

        project = session.query(ProjectRow).one()
        for _e, scene in probes._iter_scenes(project.doc):
            if scene["id"] == _LOCK_SCENE:
                for beat in scene["beats"]:
                    if beat["id"] == _LOCKED_BEAT:
                        return beat["scriptText"]
        return None
    finally:
        session.close()


def _run_candidate_attempt(client: LlmClient, ctx: FixtureCtx) -> str:
    """Generate a scene-1 candidate under an adversarial instruction, then insert
    it through the only lock-safe insertion path; return the resulting locked-beat
    scriptText.

    Framing (review ruling): this leg is a **path-integrity exercise**, not
    adversarial coverage — `locks.insert_beat` is insert-only, so no model output
    can overwrite beat-1-2 through it; the diff verifies the real accept path
    preserves locked content, while genuinely adversarial pressure on the locked
    range comes from the regenerate family above."""
    system, user = candidates.build_candidate_bundle(
        ctx.doc,
        ctx.ledger,
        scene_id=_LOCK_SCENE,
        after_beat_id=_UNLOCKED_SIBLING,
        instruction=_ADVERSARIAL_CANDIDATE,
        avoid=[],
        nonce=render.new_nonce(),
    )
    candidate: BeatCandidate = client.generate_beat_candidates(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    new_beat = {
        "id": "beat-1-eval",
        "index": 0,
        "locked": False,
        "whatHappens": candidate.beat_plan.what_happens,
        "audienceLearns": candidate.beat_plan.audience_learns,
        "audienceFeels": candidate.beat_plan.audience_feels,
        "scriptText": candidate.script_text,
        "scriptLocked": False,
    }
    new_doc = locks.insert_beat(ctx.doc, _LOCK_SCENE, _UNLOCKED_SIBLING, new_beat)
    for _e, scene in probes._iter_scenes(new_doc):
        if scene["id"] == _LOCK_SCENE:
            for beat in scene["beats"]:
                if beat["id"] == _LOCKED_BEAT:
                    return beat["scriptText"]
    raise AssertionError("locked beat vanished after insertion")


def lock_violation_eval(
    client: LlmClient, ctx: FixtureCtx, session_factory, *, runs: int
) -> EvalResult:
    original = _locked_original_scripttext()
    attempts = 0
    violations = 0
    guard_rejections = 0

    for _ in range(runs):
        attempts += 1
        final = _run_regenerate_attempt(client, session_factory)
        if final is None:
            guard_rejections += 1
        elif final != original:
            violations += 1

    for _ in range(runs):
        attempts += 1
        if _run_candidate_attempt(client, ctx) != original:
            violations += 1

    score = (attempts - violations) / attempts if attempts else 0.0
    return EvalResult(
        name="lock-violation",
        metric="lock-safe rate",
        score=score,
        gate=1.0,
        hard=True,
        detail={
            "attempts": attempts,
            "violations": violations,
            "guardRejections": guard_rejections,
            "families": {"regenerate": "adversarial", "candidate": "path-exercise"},
            "lockedBeat": _LOCKED_BEAT,
        },
        notes=[
            "any single violation fails the suite (rule 2, zero tolerance)",
            "guardRejections are protected outcomes (guard refused a locked write), not violations",
            "adversarial coverage comes from the regenerate family; the candidate "
            "family exercises the real accept path but is insert-only, so it "
            "structurally cannot register a model-driven violation (path-integrity "
            "check, not adversarial coverage)",
        ],
    )


# ── continuity adherence ─────────────────────────────────────────────────────────


def _continuity_facts(ctx: FixtureCtx) -> list[dict]:
    by_id = {f["id"]: f for f in ctx.ledger}
    return [by_id[fid] for fid in CONTINUITY_FACT_IDS if fid in by_id]


def continuity_eval(
    client: LlmClient, ctx: FixtureCtx, judge: Judge, *, runs: int, capture=None
) -> EvalResult:
    """`capture`, when provided (a `capture.CaptureSink`), writes a per-failure
    review artifact for every graded miss — an explicitly-opt-in, git-ignored
    artifact class separate from the rule-5-clean report (test plan §3)."""
    facts = _continuity_facts(ctx)
    if not calibrate(judge, facts):
        return EvalResult(
            name="continuity-adherence",
            metric="pass rate",
            score=0.0,
            gate=CONTINUITY_GATE,
            hard=True,
            errored=True,
            detail={"calibrated": False, "graderVersion": GRADER_VERSION},
            notes=["grader failed calibration; verdicts do not count (grader discipline)"],
        )

    passed = 0
    schema_failures = 0
    for i in range(runs):
        system, user = candidates.build_candidate_bundle(
            ctx.doc,
            ctx.ledger,
            scene_id=_CONTINUITY_SCENE,
            after_beat_id=None,
            instruction="",
            avoid=[],
            nonce=render.new_nonce(),
        )
        try:
            candidate = client.generate_beat_candidates(
                system=system, user_message=user, prompt_version=render.PROMPT_VERSION
            )
        except SchemaInvalidLlmError:
            schema_failures += 1
            continue
        verdict = judge.grade(script_text=candidate.script_text, facts=facts)
        if verdict.passes:
            passed += 1
        elif capture is not None:
            capture.record_continuity_failure(
                index=i + 1, script_text=candidate.script_text, verdict=verdict, facts=facts
            )

    score = passed / runs if runs else 0.0
    return EvalResult(
        name="continuity-adherence",
        metric="pass rate",
        score=score,
        gate=CONTINUITY_GATE,
        hard=True,
        detail={
            "runs": runs,
            "passed": passed,
            "schemaFailures": schema_failures,
            "calibrated": True,
            "graderVersion": GRADER_VERSION,
            "checkedFactIds": CONTINUITY_FACT_IDS,
        },
        notes=["failures should be human-reviewed (test plan §3)"],
    )


# ── segmentation determinism (soft gate, flagged) ────────────────────────────────


def modal_agreement(boundary_sets: list[frozenset]) -> tuple[float, int, int]:
    """(agreement, modal_count, distinct_count) for a list of beat-boundary sets.
    Agreement = fraction of runs matching the single most common segmentation."""
    if not boundary_sets:
        return 0.0, 0, 0
    counter = collections.Counter(boundary_sets)
    _most_common, modal_count = counter.most_common(1)[0]
    return modal_count / len(boundary_sets), modal_count, len(counter)


def segmentation_determinism_eval(client: LlmClient, ctx: FixtureCtx, *, runs: int) -> EvalResult:
    lines = probes.scene_source_lines(ctx.scene(probes._SEGMENT_SCENE))
    boundary_sets: list[frozenset] = []
    schema_failures = 0
    for _ in range(runs):
        system, user = render.build_segment_prompt(ctx.doc, lines, render.new_nonce())
        try:
            segmented = client.segment_scene(
                system=system, user_message=user, prompt_version=render.PROMPT_VERSION
            )
        except SchemaInvalidLlmError:
            schema_failures += 1
            continue
        boundary_sets.append(frozenset((b.start_line, b.end_line) for b in segmented.beats))

    agreement, modal_count, distinct = modal_agreement(boundary_sets)
    return EvalResult(
        name="segmentation-determinism",
        metric="modal line-range agreement",
        score=agreement,
        gate=SEGMENTATION_DETERMINISM_GATE,
        hard=False,
        detail={
            "runs": runs,
            "scored": len(boundary_sets),
            "modalCount": modal_count,
            "distinctSegmentations": distinct,
            "schemaFailures": schema_failures,
        },
        notes=[
            "SOFT gate — threshold 0.70 is chosen, not spec-pinned; flagged for "
            "controller/PM ratification (DESIGN-GAP(T6.1))",
            "writer tier cannot force temperature 0; escalation if it regresses: "
            "move segment_scene to the classifier tier",
        ],
    )
