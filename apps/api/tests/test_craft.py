"""T10.13 craft notes: the dialogue spine, the prompt, and the check that
files verified notes as dismissable craft flags (drama_manager/craft.py)."""

from __future__ import annotations

from drama_manager import craft, render

NONCE = "n0nce"


def test_dialogue_lines_keeps_cue_and_speech_drops_action():
    text = "INT. BAR - DAY\nMarta wipes the bar.\n\nMARTA\n(quiet)\nI know what you did."
    assert craft.dialogue_lines(text) == ["MARTA", "I know what you did."]


def test_dialogue_lines_skips_a_caps_line_with_no_speech_under_it():
    text = "WIDE ANGLE ON THE BAR\n\nDAN\nTwo coffees.\n\nThe door swings shut."
    assert craft.dialogue_lines(text) == ["DAN", "Two coffees."]


def _episode() -> dict:
    def beat(bid: str, index: int, text: str) -> dict:
        return {"id": bid, "index": index, "scriptText": text}

    return {
        "scenes": [
            {
                "id": "scene-2",
                "act": 1,
                "index": 1,
                "beats": [beat("beat-2-1", 0, "DAN\nWe're family. Family protects family.")],
            },
            {
                "id": "scene-1",
                "act": 1,
                "index": 0,
                "beats": [
                    beat("beat-1-1", 0, "Marta walks in. Nobody speaks."),
                    beat("beat-1-2", 1, "MARTA\nI'm angry with you."),
                ],
            },
        ]
    }


def test_craft_spine_is_board_ordered_dialogue_only():
    assert craft.craft_spine(_episode()) == [
        {
            "sceneId": "scene-1",
            "beats": [{"beatId": "beat-1-2", "dialogue": ["MARTA", "I'm angry with you."]}],
        },
        {
            "sceneId": "scene-2",
            "beats": [
                {
                    "beatId": "beat-2-1",
                    "dialogue": ["DAN", "We're family. Family protects family."],
                }
            ],
        },
    ]


def test_craft_prompt_carries_overview_cast_and_spine():
    overview = {"logline": "A bar, a debt.", "centralArgument": "Loyalty costs more than it pays."}
    spine = craft.craft_spine(_episode())
    _system, user = render.build_craft_prompt(
        {"title": "T", "format": {}}, overview, ["Marta", "Dan"], spine, NONCE
    )
    for kind in ("story_overview", "known_cast", "craft_spine"):
        assert f'kind="{kind}"' in user
    assert "Loyalty costs more than it pays." in user
    for words in ("theme_stated", "on_the_nose", "at most 12"):
        assert words in user


def test_craft_prompt_without_overview_omits_it():
    _system, user = render.build_craft_prompt(
        {"title": "T", "format": {}}, {}, ["Marta"], craft.craft_spine(_episode()), NONCE
    )
    assert 'kind="story_overview"' not in user
    assert 'kind="craft_spine"' in user


# ── the check: verified notes, stored as dismissable craft flags ───────────

import copy  # noqa: E402
import logging  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from llm.dependency import get_llm_client  # noqa: E402
from llm.mock import MockLlmClient  # noqa: E402
from main import app  # noqa: E402
from schemas import CraftReview  # noqa: E402
from storage import snapshots  # noqa: E402
from storage.models import ProjectRow, SnapshotRow  # noqa: E402

client = TestClient(app)
PID = "proj-longpour"
LINE = "You're the numbers person. I figured — you and me."  # beat-3-1


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _note(**over) -> dict:
    return {
        "check": "on_the_nose",
        "sceneId": "scene-3",
        "beatId": "beat-3-1",
        "excerpt": LINE,
        "why": "Dan spells out the partnership.",
        **over,
    }


def _review(*notes: dict) -> CraftReview:
    return CraftReview.model_validate({"notes": list(notes)})


def _head(db_session) -> str:
    db_session.expire_all()
    return db_session.get(ProjectRow, PID).head_snapshot_id


def _check(db_session, head: str | None = None):
    return client.post(
        f"/api/v1/projects/{PID}/craft-check",
        json={},
        headers={"If-Match": head or _head(db_session)},
    )


def _craft_flags(status: str | None = None) -> list[dict]:
    flags = client.get(f"/api/v1/projects/{PID}/consistency-flags").json()
    return [
        f
        for f in flags
        if f["explanation"].startswith("[craft_") and (status is None or f["status"] == status)
    ]


def _edit(db_session, change) -> None:
    def mutator(state):
        doc = copy.deepcopy(state.doc)
        change(doc["seasons"][0]["episodes"][0])
        return snapshots.MutationState(
            doc=doc, ledger=state.ledger, flags=state.flags, snapshot_id=state.snapshot_id
        )

    snapshots.mutate(db_session, PID, "test setup", mutator)


def _beat(episode: dict, beat_id: str) -> dict:
    return next(b for s in episode["scenes"] for b in s["beats"] if b["id"] == beat_id)


def test_check_files_verified_notes_as_craft_flags(seeded_project, db_session, mock_llm):
    res = _check(db_session)
    assert res.status_code == 200, res.text
    (flag,) = _craft_flags()
    assert flag["explanation"] == (
        f"[craft_on_the_nose] “{LINE}” — "
        "Dan spells out the partnership he wants instead of letting the offer do it."
    )
    assert (flag["objectType"], flag["objectId"]) == ("beat", "beat-3-1")
    assert (flag["status"], flag["severity"], flag["factId"]) == ("open", "tension", None)
    assert res.json()["seasons"][0]["episodes"][0]["craftCheckedAt"]
    head = db_session.get(SnapshotRow, _head(db_session))
    assert head.instruction == "Craft check"


def test_invented_excerpt_and_foreign_beat_are_dropped(seeded_project, db_session, mock_llm):
    mock_llm.set_response(
        "review_craft",
        _review(_note(excerpt="Words nobody wrote."), _note(beatId="beat-1-1")),
    )
    assert _check(db_session).status_code == 200
    assert _craft_flags() == []


def test_curly_quotes_still_verify(seeded_project, db_session, mock_llm):
    mock_llm.set_response("review_craft", _review(_note(excerpt="You’re the numbers person.")))
    assert _check(db_session).status_code == 200
    assert len(_craft_flags("open")) == 1


def test_duplicates_collapse_and_cap_is_12():
    beats = [
        {"id": f"beat-1-{i}", "index": i, "scriptText": f"MARTA\nLine number {i} here."}
        for i in range(15)
    ]
    episode = {"scenes": [{"id": "scene-1", "act": 0, "index": 0, "beats": beats}]}
    notes = [
        _note(sceneId="scene-1", beatId=f"beat-1-{i}", excerpt=f"Line number {i} here.")
        for i in range(15)
    ]
    notes.insert(1, notes[0])  # a duplicate of the first
    new, kept, counts = craft.craft_flags(_review(*notes), episode, [])
    assert len(new) == 12
    assert kept == []
    assert counts["duplicate"] == 1


def test_dismissed_check_on_a_beat_is_not_refiled(seeded_project, db_session, mock_llm):
    assert _check(db_session).status_code == 200
    (flag,) = _craft_flags("open")
    dismissed = client.post(
        f"/api/v1/consistency-flags/{flag['id']}/dismiss",
        headers={"If-Match": _head(db_session)},
    )
    assert dismissed.status_code == 200
    # Same check, same beat, a different span of the dialogue.
    mock_llm.set_response("review_craft", _review(_note(excerpt="Sixty days.")))
    assert _check(db_session).status_code == 200
    assert _craft_flags("open") == []
    assert len(_craft_flags("dismissed")) == 1


def test_recheck_replaces_open_craft_notes_and_leaves_other_flags(
    seeded_project, db_session, mock_llm
):
    others = [
        f
        for f in client.get(f"/api/v1/projects/{PID}/consistency-flags").json()
        if not f["explanation"].startswith("[craft_")
    ]
    assert _check(db_session).status_code == 200
    mock_llm.set_response(
        "review_craft", _review(_note(check="theme_stated", excerpt="Vega and Vega."))
    )
    assert _check(db_session).status_code == 200
    (flag,) = _craft_flags()
    assert flag["explanation"].startswith("[craft_theme_stated] “Vega and Vega.”")
    after = [
        f
        for f in client.get(f"/api/v1/projects/{PID}/consistency-flags").json()
        if not f["explanation"].startswith("[craft_")
    ]
    assert after == others


def test_fixed_line_resolves_on_recheck(seeded_project, db_session, mock_llm):
    assert _check(db_session).status_code == 200

    def rewrite(episode):
        beat = _beat(episode, "beat-3-1")
        beat["scriptText"] = beat["scriptText"].replace(LINE, "Just the two of us.")

    _edit(db_session, rewrite)
    mock_llm.set_response("review_craft", _review())
    assert _check(db_session).status_code == 200
    (flag,) = _craft_flags()
    assert flag["status"] == "resolved"


def test_locked_episode_runs_and_only_the_timestamp_changes(seeded_project, db_session, mock_llm):
    _edit(db_session, lambda episode: episode.update(locked=True))
    db_session.expire_all()
    before = copy.deepcopy(db_session.get(ProjectRow, PID).doc)
    res = _check(db_session)
    assert res.status_code == 200, res.text
    db_session.expire_all()
    after = copy.deepcopy(db_session.get(ProjectRow, PID).doc)
    before.pop("headSnapshotId", None), after.pop("headSnapshotId", None)
    # Only the check's own timestamp moves.
    assert after["seasons"][0]["episodes"][0].pop("craftCheckedAt")
    before["seasons"][0]["episodes"][0].pop("craftCheckedAt", None)
    assert after == before
    assert len(_craft_flags("open")) == 1


def test_stale_if_match_is_409_and_saves_nothing(seeded_project, db_session, mock_llm):
    res = _check(db_session, head="snap-stale")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT_STALE_HEAD"
    assert _craft_flags() == []
    assert mock_llm.invocation_count("review_craft") == 0


def test_no_beats_is_409_not_ready(seeded_project, db_session, mock_llm):
    def clear(episode):
        for scene in episode["scenes"]:
            scene["beats"] = []

    _edit(db_session, clear)
    res = _check(db_session)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CRAFT_CHECK_NOT_READY"


def test_logs_never_carry_excerpts(seeded_project, db_session, mock_llm, caplog):
    caplog.set_level(logging.DEBUG)
    assert _check(db_session).status_code == 200
    assert "numbers person" not in caplog.text
    assert "partnership" not in caplog.text
    assert "craft_check project=" in caplog.text
