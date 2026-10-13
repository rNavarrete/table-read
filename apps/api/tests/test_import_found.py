"""`found` frames on the create-and-import stream (data contract §9.3): what
each step found, post-merge, never `scriptText`. MockLlmClient only (rule 1)."""

from __future__ import annotations

import json
import logging
from collections import Counter

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from fountain import found
from fountain.parse import SceneSpan
from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import LedgerExtraction, ProjectImportProgressEvent, SegmentedScene
from storage import snapshots

URL = "/api/v1/projects/import"
FORMAT = {
    "genre": "drama",
    "runtimeMinutes": 30,
    "actCount": 3,
    "coldOpen": False,
    "tag": False,
    "serialization": 0.5,
}
BODY_LINES = [
    "We need to talk about the transfer.",
    "Not tonight, Marta.",
    "I said not tonight.",
    "Marta grips the wheel and stares ahead.",
]
SRC = "\n".join(
    [
        "INT. BAR - NIGHT",
        "MARTA",
        BODY_LINES[0],
        "DAN",
        BODY_LINES[1],
        "EXT. ALLEY - NIGHT",
        "DAN",
        BODY_LINES[2],
        "INT./EXT. MARTA'S CAR - LATER",
        BODY_LINES[3],
    ]
)
READING = "Someone reaches a quiet decision"
KIND_STAGE = {
    "scenes": "parsing_scenes",
    "scene": "segmenting_beats",
    "acts": "inferring_acts",
    "castRead": "inferring_entities",
    "cast": "inferring_entities",
    "threads": "inferring_promises",
    "overview": "inferring_overview",
    "facts": "extracting_facts",
    "flags": "checking_consistency",
}

client = TestClient(app)


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    llm.set_response(
        "segment_scene",
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
                ],
                "sceneWhatHappens": READING,
            }
        ),
    )
    llm.set_response(
        "extract_ledger_facts",
        LedgerExtraction.model_validate(
            {"newFacts": [_fact(True), _fact(False)], "contradictions": []}
        ),
    )
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _fact(audience_knows: bool) -> dict:
    return {
        "fact": "Something is established.",
        "factType": "event",
        "sourceSpan": {
            "episodeId": "ep-1",
            "sceneId": "scene-1",
            "beatId": "beat-1-1",
            "startLine": 1,
            "endLine": 1,
        },
        "sourceText": "",
        "knownBy": [],
        "audienceKnows": audience_knows,
        "confidence": 0.95,
    }


def _post(key: str) -> list[tuple[str, dict]]:
    resp = client.post(
        URL,
        json={"title": "Found", "format": FORMAT, "source": {"format": "fountain", "content": SRC}},
        headers={"Idempotency-Key": key},
    )
    assert resp.status_code == 200
    events = []
    for frame in resp.text.strip().split("\n\n"):
        lines = frame.splitlines()
        name = next(line[len("event: ") :] for line in lines if line.startswith("event: "))
        data = next(line[len("data: ") :] for line in lines if line.startswith("data: "))
        events.append((name, json.loads(data)))
    return events


def _found(events: list[tuple[str, dict]], kind: str | None = None) -> list[dict]:
    return [
        data
        for name, data in events
        if name == "found" and (kind is None or data["data"]["kind"] == kind)
    ]


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def test_found_frames_carry_each_steps_post_merge_results(db_session, mock_llm):
    events = _post("found-success")

    assert events[-1][0] == "complete"
    result = events[-1][1]["result"]
    project = result["project"]
    episode = project["seasons"][0]["episodes"][0]
    scenes = episode["scenes"]
    index_of = {scene["id"]: scene["index"] for scene in scenes}
    frames = _found(events)
    for frame in frames:
        assert ProjectImportProgressEvent.model_validate(frame).root.type == "found"
        assert frame["stage"] == KIND_STAGE[frame["data"]["kind"]]
        assert frame["cached"] is False

    (scenes_frame,) = _found(events, "scenes")
    assert [tuple(scene.values()) for scene in scenes_frame["data"]["scenes"]] == [
        (0, "INT. BAR - NIGHT", 5, "int"),
        (1, "EXT. ALLEY - NIGHT", 3, "ext"),
        (2, "INT./EXT. MARTA'S CAR - LATER", 2, "other"),
    ]

    scene_frames = sorted((f["data"] for f in _found(events, "scene")), key=lambda d: d["index"])
    assert scene_frames == [
        {
            "kind": "scene",
            "index": scene["index"],
            "beatCount": len(scene["beats"]),
            "whatHappens": READING,
            "failed": False,
        }
        for scene in scenes
    ]

    (acts,) = _found(events, "acts")
    assert acts["data"]["format"] == project["format"]
    assert acts["data"]["sceneActs"] == [scene["act"] for scene in scenes]

    cast_reads = _found(events, "castRead")
    assert len(cast_reads) == mock_llm.invocation_count("infer_story_entities")
    assert sorted(i for f in cast_reads for i in f["data"]["sceneIndexes"]) == [0, 1, 2]

    (cast,) = _found(events, "cast")
    assert cast["data"]["total"] == len(project["seriesBible"]["characters"])
    assert cast["data"]["characters"] == [
        {"name": "Dan", "sceneCount": 2},
        {"name": "Marta", "sceneCount": 1},
    ]

    (threads,) = _found(events, "threads")
    assert episode["threads"]
    assert threads["data"]["threads"] == [
        {
            "label": thread["label"],
            "status": thread["status"],
            "setupSceneIndex": index_of.get(thread["setupSceneId"]),
            "payoffSceneIndex": index_of.get(thread["payoffSceneId"]),
        }
        for thread in episode["threads"]
    ]

    (overview,) = _found(events, "overview")
    story = episode["storyOverview"]
    assert overview["data"]["logline"] == story["logline"]
    assert overview["data"]["beatSheet"] == [
        {"label": item["label"], "sceneIndex": index_of[item["sceneId"]]}
        for item in story["beatSheet"]
    ]

    facts = sorted((f["data"] for f in _found(events, "facts")), key=lambda d: d["index"])
    assert [(d["index"], d["factCount"], d["secretCount"], d["failed"]) for d in facts] == [
        (0, 2, 1, False),
        (1, 2, 1, False),
        (2, 2, 1, False),
    ]
    assert sum(d["factCount"] for d in facts) == len(result["newFacts"])

    (flags,) = _found(events, "flags")
    severities = Counter(flag["severity"] for flag in result["consistencyFlags"])
    assert flags["data"] == {
        "kind": "flags",
        "contradictions": severities["contradiction"],
        "tensions": severities["tension"],
        "other": 0,
    }

    # No frame carries script text: only sluglines come from the page.
    strings = [s for frame in frames for s in _strings(frame["data"])]
    assert not [line for line in BODY_LINES for s in strings if line in s]

    snapshots.purge_project(db_session, project["id"])


def test_found_frames_are_logged_as_counts_only(db_session, mock_llm, caplog):
    with caplog.at_level(logging.INFO, logger="fountain.create_import"):
        events = _post("found-logs")

    logged = "\n".join(
        r.getMessage() for r in caplog.records if r.name == "fountain.create_import"
    )
    assert "import_found" in logged
    assert "kind=scenes cached=False count=3" in logged
    texts = [
        s
        for frame in _found(events)
        for key, s in _flat(frame["data"])
        if key in {"slugline", "whatHappens", "label", "logline"}
    ]
    assert texts
    assert not [text for text in texts if text in logged]

    snapshots.purge_project(db_session, events[-1][1]["result"]["project"]["id"])


def _flat(value, key: str = ""):
    if isinstance(value, dict):
        for k, item in value.items():
            yield from _flat(item, k)
    elif isinstance(value, list):
        for item in value:
            yield from _flat(item, key)
    elif isinstance(value, str):
        yield key, value


def test_a_scene_that_fails_twice_is_found_failed(db_session, mock_llm, monkeypatch):
    original = mock_llm.segment_scene

    def segment_scene(**kwargs):
        if BODY_LINES[2] in kwargs["user_message"]:
            raise SchemaInvalidLlmError("segment_scene")
        return original(**kwargs)

    monkeypatch.setattr(mock_llm, "segment_scene", segment_scene)
    events = _post("found-failed-segment")

    assert events[-1][0] == "complete"
    by_index = {f["data"]["index"]: f["data"] for f in _found(events, "scene")}
    assert by_index[1] == {
        "kind": "scene",
        "index": 1,
        "beatCount": 1,
        "whatHappens": "",
        "failed": True,
    }
    assert not by_index[0]["failed"] and not by_index[2]["failed"]

    snapshots.purge_project(db_session, events[-1][1]["result"]["project"]["id"])


def test_resume_re_emits_saved_units_as_cached(db_session, mock_llm, monkeypatch):
    original = mock_llm.extract_ledger_facts
    calls: list[int] = []

    def flaky(**kwargs):
        # The warm call (scene 0) is saved; the fan-out after it fails.
        calls.append(1)
        if len(calls) > 1:
            raise anthropic.APIConnectionError(
                request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            )
        return original(**kwargs)

    monkeypatch.setattr(mock_llm, "extract_ledger_facts", flaky)
    first = _post("found-resume")
    assert first[-1][1]["error"]["code"] == "LLM_UNAVAILABLE"

    monkeypatch.setattr(mock_llm, "extract_ledger_facts", original)
    resumed = _post("found-resume")

    assert resumed[-1][0] == "complete"
    first_scenes = sorted((f["data"] for f in _found(first, "scene")), key=lambda d: d["index"])
    resumed_scene_frames = _found(resumed, "scene")
    assert all(f["cached"] for f in resumed_scene_frames)
    assert sorted((f["data"] for f in resumed_scene_frames), key=lambda d: d["index"]) == (
        first_scenes
    )
    facts_cached = {f["data"]["index"]: f["cached"] for f in _found(resumed, "facts")}
    assert facts_cached == {0: True, 1: False, 2: False}
    for kind in ("acts", "castRead", "cast", "threads", "overview"):
        assert all(f["cached"] for f in _found(resumed, kind)), kind
    (flags,) = _found(resumed, "flags")
    assert flags["cached"] is False

    snapshots.purge_project(db_session, resumed[-1][1]["result"]["project"]["id"])


@pytest.mark.parametrize(
    ("slugline", "int_ext"),
    [
        ("INT. BAR - NIGHT", "int"),
        ("17 INT. OFFICE - DAY 17", "int"),
        ("A12 EXT. ROOF - DAY", "ext"),
        ("EXT. ALLEY", "ext"),
        ("INT./EXT. CAR - MOVING", "other"),
        ("INT/EXT CAR", "other"),
        ("EXT./INT. HOUSE", "other"),
        ("EXT/INT HOUSE", "other"),
        ("I/E CAR", "other"),
        ("EST. CITY", "other"),
        ("", "other"),
    ],
)
def test_scenes_found_reads_int_ext_from_the_slugline(slugline, int_ext):
    span = SceneSpan(location=slugline, lines=[slugline, "x"], start_line=0)
    assert found.scenes_found([span])["scenes"][0]["intExt"] == int_ext


def test_cast_keeps_the_twelve_who_speak_in_most_scenes():
    names = ["ANNA", "BEN", "CARL", "DORA", "ERIN", "FINN", "GUS"]
    names += ["HAL", "IDA", "JON", "KAT", "LEO", "MAX", "NED"]
    crowd = "\n".join(f"{name}\nHello." for name in names)
    scene_docs = [
        {"beats": [{"scriptText": f"INT. HALL - DAY\n{crowd}"}]},
        {"beats": [{"scriptText": "INT. HALL - NIGHT\nNED\nStill here."}]},
    ]
    characters = [{"id": f"char-{n.lower()}", "name": n.title()} for n in names]

    cast = found.cast_found(characters, scene_docs, shooting_script=False)

    assert cast["total"] == 14
    assert cast["characters"][0] == {"name": "Ned", "sceneCount": 2}
    assert [c["sceneCount"] for c in cast["characters"][1:]] == [1] * 11
