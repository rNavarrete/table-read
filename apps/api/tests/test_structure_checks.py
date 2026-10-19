"""POST /projects/{pid}/structure-checks/{lens}: writer-triggered structure
checks (spec 2026-10-11). The lock-violation test comes first (rule 2).
"""

from __future__ import annotations

import copy
import logging

import pytest
from fastapi.testclient import TestClient

from drama_manager import render
from drama_manager.structure_checks import (
    StructureCheckInvalid,
    build_spine,
    structure_source_hash,
    validate_check,
)
from drama_manager.structure_stages import STRUCTURE_STAGES
from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import InferredStructureCheck, StructureCheckVerification
from storage import snapshots
from storage.models import ProjectRow

client = TestClient(app)
PID = "proj-longpour"
CIRCLE = [stage for stage, _ in STRUCTURE_STAGES["story_circle"]]


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _doc(db_session) -> dict:
    db_session.expire_all()
    return copy.deepcopy(db_session.get(ProjectRow, PID).doc)


def _episode(doc: dict) -> dict:
    return doc["seasons"][0]["episodes"][0]


def _edit(db_session, change) -> None:
    """Test setup through the snapshot helper (pattern: test_narrative_map_stale_head.py)."""

    def mutator(state):
        doc = copy.deepcopy(state.doc)
        change(_episode(doc))
        return snapshots.MutationState(
            doc=doc, ledger=state.ledger, flags=state.flags, snapshot_id=state.snapshot_id
        )

    snapshots.mutate(db_session, PID, "test setup", mutator)


def _post(lens: str, head: str | None = None):
    return client.post(
        f"/api/v1/projects/{PID}/structure-checks/{lens}",
        json={},
        headers={"If-Match": head} if head else {},
    )


def _inferred(cited: dict[str, tuple[str, str | None]], applies: bool = True):
    stages = [
        {
            "stage": s,
            "status": cited.get(s, ("missing", None))[0],
            "beatId": cited.get(s, ("missing", None))[1],
            "reason": f"{s} reason",
        }
        for s in CIRCLE
    ]
    return InferredStructureCheck.model_validate(
        {"applies": applies, "rationale": "Fits.", "stages": stages if applies else []}
    )


def _verdicts(**supported: bool):
    return StructureCheckVerification.model_validate(
        {
            "stages": [
                {"stage": s, "reason": f"{s} verdict", "supported": ok}
                for s, ok in supported.items()
            ]
        }
    )


def _checks(res) -> list[dict]:
    return res.json()["seasons"][0]["episodes"][0]["structureChecks"]


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
    mock_llm.set_response(
        "check_structure",
        _inferred({"circle_you": ("hit", "beat-1-1"), "circle_need": ("thin", "beat-2-1")}),
    )
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True, circle_need=True))
    head = _doc(db_session)["headSnapshotId"]
    res = _post("story_circle")
    assert res.json()["headSnapshotId"] != head  # one new snapshot (rule 4)
    (check,) = _checks(res)
    assert [s["stage"] for s in check["stages"]] == CIRCLE
    you = check["stages"][0]
    assert (you["status"], you["sceneId"]) == ("hit", "scene-1") and you["evidenceQuote"]
    assert check["stages"][2]["status"] == "missing" and check["stages"][2]["beatId"] is None
    assert check["sourceHash"] == structure_source_hash(_episode(_doc(db_session)))
    assert check["promptVersion"] == render.PROMPT_VERSION and check["lens"] == "story_circle"


def test_unsupported_and_unanswered_stages_become_unverified(seeded_project, mock_llm):
    mock_llm.set_response(
        "check_structure",
        _inferred(
            {
                "circle_you": ("hit", "beat-1-1"),
                "circle_need": ("thin", "beat-2-1"),
                "circle_go": ("hit", "beat-3-1"),
            }
        ),
    )
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True, circle_need=False))
    by = {s["stage"]: s for s in _checks(_post("story_circle"))[0]["stages"]}
    assert by["circle_you"]["status"] == "hit"
    need, go = by["circle_need"], by["circle_go"]
    assert (need["status"], need["reason"]) == ("unverified", "circle_need verdict")
    assert (go["status"], go["reason"]) == ("unverified", "Not verified")


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



def test_validation_names_every_problem_by_code():
    inferred = _inferred({"circle_you": ("hit", "beat-1-1"), "circle_need": ("thin", None)})
    inferred.stages[2].beat_id = "beat-9-9"
    inferred.stages[2].status = "hit"
    inferred.stages[3] = inferred.stages[0].model_copy()
    inferred.stages[4].stage = "ordeal"
    inferred.stages[5].beat_id = "beat-1-1"  # a beat on a missing stage is dropped, not an error
    with pytest.raises(StructureCheckInvalid) as exc:
        validate_check("story_circle", inferred, {"beat-1-1": "scene-1"})
    assert exc.value.diagnostics == [
        {"code": "beat_required", "stage": "circle_need"},
        {"code": "unknown_beat", "stage": "circle_go", "beatId": "beat-9-9"},
        {"code": "duplicate_stage", "stage": "circle_you"},
        {"code": "stage_wrong_structure", "stage": "ordeal"},
        {"code": "missing_stage", "stage": "circle_search"},
        {"code": "missing_stage", "stage": "circle_find"},
    ]

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
    check = _checks(_post("story_circle"))[0]
    assert (check["applies"], check["stages"], check["rationale"]) == (False, [], "Fits.")
    assert mock_llm._invocations.get("verify_structure_check", 0) == 0


def test_empty_beat_text_saves_null_quote(seeded_project, mock_llm):
    mock_llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-5-1")}))
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True))
    stage = _checks(_post("story_circle"))[0]["stages"][0]
    assert stage["evidenceQuote"] is None


def test_rerun_replaces_the_lens_entry(seeded_project, mock_llm):
    _post("story_circle")
    checks = _checks(_post("story_circle"))
    assert [c["lens"] for c in checks] == ["story_circle"]


def test_stale_if_match_is_409(seeded_project, mock_llm):
    res = _post("story_circle", head="snap-not-the-head")
    assert (res.status_code, res.json()["error"]["code"]) == (409, "CONFLICT_STALE_HEAD")
    assert mock_llm.total_invocations() == 0


def test_unknown_and_tv_lenses_are_400(seeded_project, mock_llm):
    for lens in ("tv_act_structure", "nope"):
        res = _post(lens)
        assert (res.status_code, res.json()["error"]["code"]) == (400, "VALIDATION")


def test_an_episode_without_beats_is_not_ready(seeded_project, db_session, mock_llm):
    _edit(db_session, lambda ep: [scene.update(beats=[]) for scene in ep["scenes"]])
    res = _post("story_circle")
    assert (res.status_code, res.json()["error"]["code"]) == (409, "STRUCTURE_CHECK_NOT_READY")


def test_source_hash_matches_the_shared_vector():
    episode = {
        "scenes": [
            {
                "id": "scene-1",
                "beats": [
                    {"id": "beat-1-1", "scriptText": "INT. BAR - NIGHT\nMarta pours."},
                    {"id": "beat-1-2", "scriptText": "Café — “ok”"},
                ],
            },
            {"id": "scene-2", "beats": []},
            {"id": "scene-3", "beats": [{"id": "beat-3-1"}]},
        ]
    }
    assert (
        structure_source_hash(episode)
        == "b9c534c0bc4d1db690a5d82bb4c0e4a9f87ec02be3119977227131d62c27735f"
    )
    assert (
        structure_source_hash({"scenes": []})
        == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_logs_carry_no_writer_text(seeded_project, mock_llm, caplog):
    mock_llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-1-1")}))
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True))
    with caplog.at_level(logging.INFO, logger="drama_manager.structure_checks"):
        assert _post("story_circle").status_code == 200
    assert render.PROMPT_VERSION in caplog.text and "lens=story_circle" in caplog.text
    for writer_text in ("circle_you reason", "circle_you verdict", "Fits."):
        assert writer_text not in caplog.text


def test_hash_and_spine_follow_act_and_index_not_stored_order():
    """Plan's drag-reorder rewrites index/act and leaves the arrays alone."""
    episode = {"scenes": [
        {"id": "scene-a", "act": 1, "index": 1, "beats": [
            {"id": "beat-a-2", "index": 1, "scriptText": "two"},
            {"id": "beat-a-1", "index": 0, "scriptText": "one"}]},
        {"id": "scene-b", "act": 1, "index": 0, "beats": [
            {"id": "beat-b-1", "index": 0, "scriptText": "b"}]},
        {"id": "scene-c", "act": 0, "index": 5, "beats": [
            {"id": "beat-c-1", "index": 0, "scriptText": "c"}]},
    ]}
    assert structure_source_hash(episode) == (
        "a609cf03fd17c719082283cd94f032e7cf5fef723207e1f1666b9b9aea702ce6"
    )
    spine = build_spine(episode)["scenes"]
    assert [s["sceneId"] for s in spine] == ["scene-c", "scene-b", "scene-a"]
    assert [b["beatId"] for b in spine[2]["beats"]] == ["beat-a-1", "beat-a-2"]


def test_a_plan_only_beat_is_verified_against_its_plan(seeded_project, mock_llm, monkeypatch):
    """beat-5-1 has no script yet; the verifier must see its whatHappens, not ""."""
    seen: dict = {}
    real = render.build_structure_verification_prompt

    def spy(project, lens, claims, nonce):
        seen["claims"] = claims
        return real(project, lens, claims, nonce)

    monkeypatch.setattr(render, "build_structure_verification_prompt", spy)
    mock_llm.set_response("check_structure", _inferred({"circle_you": ("hit", "beat-5-1")}))
    mock_llm.set_response("verify_structure_check", _verdicts(circle_you=True))
    assert _post("story_circle").status_code == 200
    assert seen["claims"][0]["excerpt"].startswith("The cover stories collapse")
