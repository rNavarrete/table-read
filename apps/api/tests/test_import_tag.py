"""T10.7 — a tag is act `format.actCount + 1`, valid only when `format.tag`.

Printed TAG markers and model starts may open it; a format with no tag turns
either into the same disagreement or repair any other bad act gets."""

import pytest

from fountain.acts import (
    ActInferenceError,
    acts_from_markers,
    expand_act_starts,
    printed_structure,
)
from fountain.parse import split_into_scenes, strip_screenplay_front_matter
from fountain.pipeline import analyze_import, run_import, run_to_completion
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from schemas import (
    ConsistencyScan,
    InferredActBreaks,
    LedgerExtraction,
    SegmentedScene,
)
from storage.models import LedgerFactRow, ProjectRow, SnapshotRow

PROJECT_ID = "proj-longpour"

TAGGED = {
    "genre": "comedy",
    "runtimeMinutes": 30,
    "actCount": 2,
    "coldOpen": True,
    "tag": True,
    "serialization": 0.2,
}


def breaks(*pairs: tuple[int, int]) -> InferredActBreaks:
    return InferredActBreaks(
        starts=[{"act": act, "startSceneIndex": index} for act, index in pairs]
    )


# ── expansion ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("fmt", "pairs", "expected"),
    [
        # cold open, acts 1-2, tag 3
        (TAGGED, [(0, 0), (1, 1), (2, 2), (3, 3)], [0, 1, 2, 3]),
        # no cold open: acts 0-1, tag still actCount + 1 = 3
        ({**TAGGED, "coldOpen": False}, [(0, 0), (1, 2), (3, 3)], [0, 0, 1, 3]),
    ],
)
def test_a_tag_start_expands_when_the_format_has_a_tag(fmt, pairs, expected):
    assert expand_act_starts(breaks(*pairs), scene_count=4, format_dict=fmt) == expected


def test_a_tag_start_is_out_of_range_without_a_tag():
    with pytest.raises(ActInferenceError) as exc:
        expand_act_starts(
            breaks((0, 0), (1, 1), (3, 2)),
            scene_count=3,
            format_dict={**TAGGED, "tag": False},
        )
    assert exc.value.diagnostics == [{"code": "act_out_of_range", "act": 3, "maxAct": 2}]


def test_the_act_between_the_last_act_and_the_tag_is_still_out_of_range():
    # No cold open: acts 0-1, tag 3; act 2 is neither. The repair names the tag.
    with pytest.raises(ActInferenceError) as exc:
        expand_act_starts(
            breaks((0, 0), (2, 1)),
            scene_count=2,
            format_dict={**TAGGED, "coldOpen": False},
        )
    assert exc.value.diagnostics == [
        {"code": "act_out_of_range", "act": 2, "maxAct": 1, "tagAct": 3}
    ]


# ── printed markers ─────────────────────────────────────────────────────────


def _spans(*scenes: str) -> list:
    return split_into_scenes("\n".join(scenes))


MARKED_TAG = (
    "COLD OPEN",
    "INT. BAR - NIGHT\nMarta pours.\nACT ONE",
    "INT. KITCHEN - DAY\nDan waits.\nEND OF ACT ONE",
    "INT. CELLAR - NIGHT\nThe key.\nEND OF ACT TWO\n\nTAG",
    "EXT. STREET - NIGHT\nThey part.\nEND OF TAG",
)


def test_a_printed_tag_opens_the_tag():
    # Spans: the COLD OPEN preamble, then the four scenes.
    assert acts_from_markers(_spans(*MARKED_TAG), TAGGED) == [0, 0, 1, 2, 3]


def test_a_printed_tag_disagrees_with_a_format_without_one():
    assert acts_from_markers(_spans(*MARKED_TAG), {**TAGGED, "tag": False}) is None


def test_an_unprinted_tag_stays_empty():
    scenes = [s.replace("\n\nTAG", "").replace("\nEND OF TAG", "") for s in MARKED_TAG]
    assert acts_from_markers(_spans(*scenes), TAGGED) == [0, 0, 1, 2, 2]


def test_a_tag_printed_in_the_last_scene_holds_nothing():
    scenes = (*MARKED_TAG[:3], "INT. CELLAR - NIGHT\nThe key.\nEND OF ACT TWO", "TAG")
    assert acts_from_markers(_spans(*scenes), TAGGED) is None


def test_mixed_case_tag_is_dialogue_not_a_marker():
    scenes = [s.replace("\n\nTAG", "\nMARTA\nTag.") for s in MARKED_TAG]
    assert acts_from_markers(_spans(*scenes), TAGGED) == [0, 0, 1, 2, 2]


def test_printed_structure_reads_the_tag():
    source = "\n".join(MARKED_TAG)
    stripped = strip_screenplay_front_matter(source)
    front_matter = source.split("\n")[: stripped.removed_line_count]
    assert printed_structure(front_matter, split_into_scenes(stripped.content)) == (
        2,
        True,
        True,
        [0, 0, 1, 2, 3],
    )


# ── the import's act stage ──────────────────────────────────────────────────


def _mock(source: str, *act_responses: InferredActBreaks) -> MockLlmClient:
    llm = MockLlmClient()
    llm.set_responses(
        "segment_scene",
        [
            SegmentedScene.model_validate(
                {
                    "segments": [
                        {
                            "kind": "beat",
                            "startLine": 1,
                            "whatHappens": "w",
                            "audienceLearns": "l",
                            "audienceFeels": "f",
                        }
                    ]
                }
            )
            for _ in split_into_scenes(source)
        ],
    )
    llm.set_response(
        "extract_ledger_facts",
        LedgerExtraction.model_validate({"newFacts": [], "contradictions": []}),
    )
    llm.set_response("scan_consistency", ConsistencyScan.model_validate({"flags": []}))
    if act_responses:
        llm.set_responses("infer_act_breaks", list(act_responses))
    return llm


UNMARKED = "\n".join(f"INT. ROOM {i} - DAY\nScene {i}." for i in range(1, 5))


def _import(db_session, fmt: dict, source: str, llm: MockLlmClient) -> list[int]:
    project = db_session.get(ProjectRow, PROJECT_ID)
    project.doc = {**project.doc, "format": fmt}
    result = run_import(db_session, project, source, llm, instruction="Import test")
    return [s["act"] for s in result["project"]["seasons"][0]["episodes"][0]["scenes"]]


def test_a_model_tag_start_is_kept_when_the_format_has_a_tag(unlocked_project, db_session):
    llm = _mock(UNMARKED, breaks((0, 0), (1, 1), (2, 2), (3, 3)))
    assert _import(db_session, TAGGED, UNMARKED, llm) == [0, 1, 2, 3]
    assert llm.invocation_count("infer_act_breaks") == 1


def test_a_model_tag_start_without_a_tag_is_repaired_not_kept(
    unlocked_project, db_session, monkeypatch
):
    llm = _mock(
        UNMARKED,
        breaks((0, 0), (1, 1), (2, 2), (3, 3)),
        breaks((0, 0), (1, 1), (2, 2)),
    )
    prompts: list[str] = []
    original = llm.infer_act_breaks

    def spy(**kwargs):
        prompts.append(kwargs["user_message"])
        return original(**kwargs)

    monkeypatch.setattr(llm, "infer_act_breaks", spy)

    assert _import(db_session, {**TAGGED, "tag": False}, UNMARKED, llm) == [0, 1, 2, 2]
    assert len(prompts) == 2
    assert '"code": "act_out_of_range"' in prompts[1]


def test_a_second_tag_start_without_a_tag_fails_and_persists_nothing(
    unlocked_project, db_session
):
    project = db_session.get(ProjectRow, PROJECT_ID)
    doc, head = project.doc, project.head_snapshot_id
    snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
    tag_start = breaks((0, 0), (5, 1))  # the fixture: four acts, no tag
    llm = _mock(UNMARKED, tag_start, tag_start)

    with pytest.raises(SchemaInvalidLlmError, match="infer_act_breaks"):
        run_import(db_session, project, UNMARKED, llm, instruction="Import test")

    assert llm.invocation_count("infer_act_breaks") == 2
    db_session.refresh(project)
    assert project.doc == doc
    assert project.head_snapshot_id == head
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == snaps
    assert db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count() == facts


def test_a_printed_tag_needs_no_model_call(unlocked_project, db_session):
    source = "\n".join(MARKED_TAG)
    llm = _mock(source)
    assert _import(db_session, TAGGED, source, llm) == [0, 0, 1, 2, 3]
    assert llm.invocation_count("infer_act_breaks") == 0


def test_an_import_without_a_format_keeps_a_printed_tag(unlocked_project, db_session):
    """The printed structure decides act count, cold open and tag; the model
    said no tag, and the printed TAG wins."""
    source = "\n".join(MARKED_TAG)
    llm = _mock(
        source,
        InferredActBreaks(
            starts=[{"act": 0, "startSceneIndex": 0}], format={**TAGGED, "tag": False}
        ),
    )
    project = db_session.get(ProjectRow, PROJECT_ID)
    analysis = run_to_completion(
        analyze_import({**project.doc, "format": None}, [], source, llm)
    )
    assert analysis.new_doc["format"] == TAGGED
    scenes = analysis.new_doc["seasons"][0]["episodes"][0]["scenes"]
    assert [s["act"] for s in scenes] == [0, 0, 1, 2, 3]
