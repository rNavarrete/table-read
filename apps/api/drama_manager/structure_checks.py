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

from drama_manager import locks, render

# ponytail: move with step 4's Story Map deletion
from drama_manager.narrative_map import _evidence_quote
from drama_manager.structure_stages import STAGE_DEFINITIONS, STAGE_WINDOWS, STRUCTURE_STAGES
from llm.errors import SchemaInvalidLlmError
from storage import snapshots

_logger = logging.getLogger("drama_manager.structure_checks")
_TEXT_CAP = 300
# The whole beat, in practice: the hand check (2026-10-11) found 520 characters cut
# off the moment a stage cites ("the excerpt cuts off before Josh agrees") on
# beats up to 1,400 characters, turning real hits into Couldn't verify.
_EXCERPT_CAP = 2_000


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


def _ordered_scenes(episode: dict) -> list[dict]:
    """Scenes by (act, index), beats by index: the order the writer sees. Plan's
    drag-reorder rewrites `index`/`act` and leaves the stored array alone."""
    return [
        {**s, "beats": sorted(s.get("beats") or [], key=lambda b: b.get("index") or 0)}
        for s in locks.scenes_in_story_order(episode)
    ]


def structure_source_hash(episode: dict) -> str:
    text = "".join(
        f"{scene['id']}\x1f{beat['id']}\x1f{beat.get('scriptText') or ''}\x1e"
        for scene in _ordered_scenes(episode)
        for beat in scene["beats"]
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _excerpt(beat: dict) -> str:
    """What the verifier reads: the beat's script, or its plan when no script exists
    yet (the check reads `whatHappens`, so a plan-only beat is a fair citation)."""
    return (beat.get("scriptText") or beat.get("whatHappens") or "")[:_EXCERPT_CAP]


def build_spine(episode: dict) -> dict:
    overview = episode.get("storyOverview") or {}
    return {
        "storyOverview": {
            "logline": overview.get("logline", ""),
            "summary": overview.get("summary", ""),
            "beatSheet": [
                {
                    "beatId": r["beatId"],
                    "label": r.get("label", ""),
                    "sceneId": r.get("sceneId"),
                    "act": r.get("act"),
                }
                for r in overview.get("beatSheet") or []
            ],
        },
        "threads": [
            {
                "id": t["id"],
                "label": t.get("label", ""),
                "summary": t.get("summary", ""),
                "status": t.get("status"),
                "setupBeatId": t.get("setupBeatId"),
                "payoffBeatId": t.get("payoffBeatId"),
            }
            for t in episode.get("threads") or []
        ],
        "scenes": [
            {
                "sceneId": s["id"],
                "act": s.get("act"),
                "heading": s.get("location", ""),
                "whatHappens": (s.get("whatHappens") or "")[:_TEXT_CAP],
                "audienceLearns": (s.get("audienceLearns") or "")[:_TEXT_CAP],
                "beats": [
                    {"beatId": b["id"], "whatHappens": (b.get("whatHappens") or "")[:_TEXT_CAP]}
                    for b in s["beats"]
                ],
            }
            for s in _ordered_scenes(episode)
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
            # A beat cited on a missing stage is dropped.
            beat_id = item.beat_id if status != "missing" else None
            by_stage[stage] = {
                "stage": stage,
                "status": status,
                "beatId": beat_id,
                "sceneId": beat_scene.get(beat_id) if beat_id else None,
                "reason": item.reason,
            }
    seen = by_stage.keys() | {d["stage"] for d in diagnostics}
    diagnostics += [{"code": "missing_stage", "stage": s} for s in order if s not in seen]
    if diagnostics:
        raise StructureCheckInvalid(diagnostics)
    return [by_stage[s] for s in order]


def apply_verdicts(stages: list[dict], verification) -> list[dict]:
    """Downgrade, never drop: an unsupported or unanswered claim becomes `unverified`."""
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


def beat_positions(episode: dict) -> dict[str, float]:
    """Each beat's midpoint as a share (%, 0.1) of the episode's script text, in the
    writer's order — the act share bar's length measure. Empty without script."""
    beats = [b for scene in _ordered_scenes(episode) for b in scene["beats"]]
    lengths = [len(b.get("scriptText") or "") for b in beats]
    total, before, out = sum(lengths), 0, {}
    if not total:
        return out
    for beat, length in zip(beats, lengths, strict=True):
        out[beat["id"]] = round(100 * (before + length / 2) / total, 1)
        before += length
    return out


def place_stages(lens: str, stages: list[dict], positions: dict[str, float]) -> list[dict]:
    """Server-derived position and placement (T10.5), separate from status. Only a
    hit or thin stage the lens places gets a placement; an earlier placed stage
    whose beat comes later makes it out_of_order before any window applies."""
    windows = STAGE_WINDOWS.get(lens, {})
    latest: float | None = None
    out = []
    for stage in stages:
        position = positions.get(stage["beatId"]) if stage["beatId"] else None
        expected, window = windows.get(stage["stage"], (None, None))
        placement = None
        if expected is not None and position is not None and stage["status"] in ("hit", "thin"):
            if latest is not None and position < latest:
                placement = "out_of_order"
            elif position < expected - window:
                placement = "early"
            elif position > expected + window:
                placement = "late"
            else:
                placement = "in_window"
            latest = position if latest is None else max(latest, position)
        out.append(
            {
                **stage,
                "positionPct": position,
                "expectedPct": expected,
                "windowPct": window,
                "placement": placement,
            }
        )
    return out


def run_structure_check(
    session, project, lens: str, llm, *, expected_head_snapshot_id: str
) -> dict:
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
        return llm.check_structure(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )

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
        {
            "stage": s["stage"],
            "label": labels[s["stage"]],
            **({"definition": d} if (d := STAGE_DEFINITIONS.get(s["stage"])) else {}),
            "status": s["status"],
            "claim": s["reason"],
            "beatId": s["beatId"],
            "excerpt": _excerpt(beats[s["beatId"]][1]),
        }
        for s in stages
        if s["status"] in ("hit", "thin")
    ]
    if claims:
        system, user = render.build_structure_verification_prompt(doc, lens, claims, nonce)
        verification = llm.verify_structure_check(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        stages = apply_verdicts(stages, verification)
    for stage in stages:
        scene_beat = beats.get(stage["beatId"]) if stage["beatId"] else None
        stage["evidenceQuote"] = (_evidence_quote(*scene_beat) or None) if scene_beat else None
    stages = place_stages(lens, stages, beat_positions(episode))

    check = {
        "lens": lens,
        "applies": inferred.applies,
        "rationale": inferred.rationale,
        "stages": stages,
        "sourceHash": structure_source_hash(episode),
        "checkedAt": datetime.now(UTC).isoformat(),
        "promptVersion": render.PROMPT_VERSION,
    }

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        new_doc = copy.deepcopy(state.doc)
        target = _episode(new_doc)
        target["structureChecks"] = [
            c for c in target.get("structureChecks") or [] if c.get("lens") != lens
        ] + [check]
        return snapshots.MutationState(
            doc=new_doc, ledger=state.ledger, flags=state.flags, snapshot_id=state.snapshot_id
        )

    snap = snapshots.mutate(
        session,
        project.id,
        f"Structure check: {lens}",
        mutator,
        expected_head_snapshot_id=expected_head_snapshot_id,
    )
    counts = Counter(s["status"] for s in stages)
    _logger.info(
        "structure_check project=%s snapshot=%s lens=%s applies=%s hit=%d thin=%d missing=%d "
        "unverified=%d prompt_version=%s",
        project.id,
        snap.id,
        lens,
        inferred.applies,
        counts["hit"],
        counts["thin"],
        counts["missing"],
        counts["unverified"],
        render.PROMPT_VERSION,
    )
    return snap.doc
