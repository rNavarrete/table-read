"""Overlapped late stages (import speed-ups, Phase 1): threads, overview and
facts→consistency start together after the cast merge. The saved project,
every prompt and the event order must match the serial path
(`TABLEREAD_IMPORT_OVERLAP=0`) exactly; a failed branch must save what its
siblings finished, and a resume must not pay for it again.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import re
import threading
import time
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

import fountain.characters as characters_mod
from drama_manager import ledger_policy
from fountain import pipeline
from fountain.parse import split_into_scenes
from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import LedgerExtraction, NarrativePromises, SegmentedScene
from storage import snapshots
from storage.models import ImportRunRow, ImportRunUnitRow
from storage.project_scaffold import initial_project_doc

FORMAT = {
    "genre": "drama",
    "runtimeMinutes": 30,
    "actCount": 3,
    "coldOpen": False,
    "tag": False,
    "serialization": 0.5,
}

# Five scenes: the mock's default threads, overview and scan answers cite
# scene-1..scene-5. Kim is named only in an action line, so a fact known by
# Kim mints a character during facts assembly — the cast the scan reads
# differs from the one threads resolves against.
SCRIPT = """INT. THE LONG POUR - NIGHT

Marta wipes down the bar. Sal nods from his usual stool.

MARTA
We need to talk about the transfer.

DAN
Not tonight.

INT. BACK OFFICE - NIGHT

Dan counts cash. Kim, the harbor cop, watches from the door.

DAN
Forty thousand.

EXT. MARINA - NIGHT

MARTA
Where did it go, Dan?

INT. THE LONG POUR - LATER

DAN
I'm closing up.

EXT. PARKING LOT - DAWN

REYES
You two done?
"""

client = TestClient(app)


def _segments() -> list[SegmentedScene]:
    return [
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
        for _scene in split_into_scenes(SCRIPT)
    ]


class _ScriptedLlm(MockLlmClient):
    """Hashes every request it is sent (system, user turn, cache prefix,
    prewarms included), answers extraction per scene, and sleeps per op when
    `delays` says so."""

    def __init__(self, delays: dict[str, float] | None = None) -> None:
        super().__init__()
        self.delays = delays or {}
        self.requests: list[str] = []
        self.set_responses("segment_scene", _segments())
        # A thread owned by Kim too: Kim joins the cast only in facts
        # assembly, so the threads merge (which runs first, as it always has)
        # must not resolve him, in either mode.
        promises = self._responses["infer_narrative_promises"].model_dump(by_alias=True)
        promises["threads"][0]["ownerNames"] = ["Marta", "Kim"]
        self.set_response("infer_narrative_promises", NarrativePromises.model_validate(promises))

    def _record(self, *parts: str | None) -> None:
        digest = hashlib.sha256("\x00".join(p or "" for p in parts).encode()).hexdigest()
        self.requests.append(digest)

    def _call(self, op, *, system, user_message, prompt_version):
        self._record(op, system, user_message)
        time.sleep(self.delays.get(op, 0))
        return super()._call(
            op, system=system, user_message=user_message, prompt_version=prompt_version
        )

    def prewarm_cache(self, op, *, system, user_message, cache_prefix=None):
        self._record("prewarm", op, system, user_message, cache_prefix)
        return super().prewarm_cache(
            op, system=system, user_message=user_message, cache_prefix=cache_prefix
        )

    def extract_ledger_facts(self, *, system, user_message, prompt_version, cache_prefix=None):
        self._record("prefix", cache_prefix)
        super().extract_ledger_facts(
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
            cache_prefix=cache_prefix,
        )
        scene_id = re.search(r'"sceneId": "(scene-\d+)"', user_message).group(1)
        n = scene_id.split("-")[1]
        return LedgerExtraction.model_validate(
            {
                "newFacts": [
                    {
                        "fact": f"Something is settled in {scene_id}.",
                        "factType": "event",
                        "sourceSpan": {
                            "episodeId": "ep-1",
                            "sceneId": scene_id,
                            "beatId": f"beat-{n}-1",
                            "startLine": 1,
                            "endLine": 1,
                        },
                        "sourceText": "",
                        "knownBy": ["Kim"] if n == "2" else ["Marta"],
                        "audienceKnows": True,
                        "confidence": 0.95,
                    }
                ],
                "contradictions": [],
            }
        )


@pytest.fixture()
def fixed_ids(monkeypatch):
    """Server-minted ids, made deterministic so two runs compare byte for
    byte: each IdMinter counts on its own (threads, secrets, facts and flags
    mint in a different interleaving under overlap, but each in its own
    order), and characters (minted only on the generator's thread, in the
    same order in both modes) share one counter, reset per run."""

    def mint(self):
        self._n = getattr(self, "_n", 0) + 1
        return f"{self._prefix}{self._n:012x}"

    monkeypatch.setattr(ledger_policy.IdMinter, "mint", mint)

    def reset() -> None:
        counter = itertools.count(1)
        monkeypatch.setattr(
            characters_mod,
            "uuid",
            SimpleNamespace(uuid4=lambda: SimpleNamespace(hex=f"{next(counter):032x}")),
        )

    return reset


def _analyze(monkeypatch, llm, *, overlap: bool, concurrency: int = 8, **kwargs):
    monkeypatch.setattr(pipeline, "IMPORT_OVERLAP", overlap)
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", concurrency)
    gen = pipeline.analyze_import(
        initial_project_doc("Ferry Crossing", FORMAT, ""),
        [],
        SCRIPT,
        llm,
        nonce="0f0f0f0f",
        **kwargs,
    )
    events = []
    while True:
        try:
            events.append(next(gen))
        except StopIteration as stop:
            return events, stop.value


def _shape(events) -> list[tuple]:
    """Every event's type, stage and counters, in order. A `found` frame's
    payload is left out: facts land in completion order under concurrency."""
    shape = []
    for event in events:
        if isinstance(event, pipeline.ImportStageStarted):
            shape.append(("stage", event.name))
        elif isinstance(event, pipeline.ImportStageProgress):
            shape.append(("progress", event.stage, event.done, event.total))
        else:
            shape.append(("found", event.stage, event.data["kind"], event.cached))
    return shape


def _payloads(events) -> list[str]:
    return sorted(
        json.dumps(e.data, sort_keys=True)
        for e in events
        if isinstance(e, pipeline.ImportFound)
    )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, 8), ("4", 4), ("16", 16), ("0", 1), ("-3", 1), ("40", 16), ("eight", 8)],
)
def test_import_concurrency_defaults_to_8_and_clamps_to_1_16(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("TABLEREAD_IMPORT_CONCURRENCY", raising=False)
    else:
        monkeypatch.setenv("TABLEREAD_IMPORT_CONCURRENCY", raw)
    assert pipeline._import_concurrency() == expected


def test_overlap_saves_byte_identical_output_events_and_prompts(monkeypatch, fixed_ids):
    """Serial is today's path: one stage after another, one call at a time,
    each prompt built after the previous merge. Overlap builds every late
    prompt up front, before threads or overview merge, so equal prompt
    hashes prove none of them reads what those merges write. Threads and
    overview are slowed so that, under overlap, every fact lands (and the
    facts are assembled and the scan started) before either merges."""
    runs = {}
    for overlap, concurrency in ((False, 1), (True, 8)):
        fixed_ids()
        llm = _ScriptedLlm({"infer_narrative_promises": 0.1, "infer_story_overview": 0.1})
        events, analysis = _analyze(
            monkeypatch, llm, overlap=overlap, concurrency=concurrency
        )
        runs[overlap] = (events, analysis, llm)
    (serial_events, serial, serial_llm) = runs[False]
    (overlap_events, overlapped, overlap_llm) = runs[True]

    # The comparison has real content to compare: threads, a backfilled
    # premise, facts, flags and a knower minted during facts assembly.
    episode = serial.new_doc["seasons"][0]["episodes"][0]
    assert episode["threads"] and episode["storyOverview"]["logline"]
    assert len(serial.new_facts) == 5 and serial.raw_flags
    assert "Kim" in [c["name"] for c in serial.new_doc["seriesBible"]["characters"]]

    # Byte for byte, key order included (the doc is stored as JSON).
    assert json.dumps(overlapped.new_doc) == json.dumps(serial.new_doc)
    assert json.dumps(overlapped.new_facts) == json.dumps(serial.new_facts)
    assert json.dumps(overlapped.raw_flags) == json.dumps(serial.raw_flags)

    assert _shape(overlap_events) == _shape(serial_events)
    assert _payloads(overlap_events) == _payloads(serial_events)

    assert sorted(overlap_llm.requests) == sorted(serial_llm.requests)
    assert overlap_llm.total_invocations() == serial_llm.total_invocations()


def test_late_stages_run_side_by_side(monkeypatch):
    """Serial pays threads + overview + facts; overlap pays about the longest
    of them. Same worker count both ways, so only the overlap differs."""
    delays = {
        "infer_narrative_promises": 0.3,
        "infer_story_overview": 0.2,
        "extract_ledger_facts": 0.05,
    }
    elapsed = {}
    for overlap in (False, True):
        llm = _ScriptedLlm(delays)
        started = time.monotonic()
        _analyze(monkeypatch, llm, overlap=overlap)
        elapsed[overlap] = time.monotonic() - started

    assert elapsed[False] >= 0.55
    assert elapsed[True] < elapsed[False] - 0.15, elapsed


# ── through the create-and-import stream, with real run checkpoints ─────────


def _post(llm: MockLlmClient, key: str) -> list[tuple[str, dict]]:
    app.dependency_overrides[get_llm_client] = lambda: llm
    try:
        resp = client.post(
            "/api/v1/projects/import",
            json={
                "title": "Ferry Crossing",
                "format": FORMAT,
                "source": {"format": "fountain", "content": SCRIPT},
            },
            headers={"Idempotency-Key": key},
        )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    events = []
    for frame in resp.text.strip().split("\n\n"):
        lines = frame.splitlines()
        name = next(line[len("event: ") :] for line in lines if line.startswith("event: "))
        data = next(line[len("data: ") :] for line in lines if line.startswith("data: "))
        events.append((name, json.loads(data)))
    return events


def _connection_error() -> anthropic.APIConnectionError:
    return anthropic.APIConnectionError(
        request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    )


class _FactsFailOnceLlm(_ScriptedLlm):
    """Scene 2's extraction fails, once, after threads, overview and every
    other scene's extraction have returned."""

    def __init__(self) -> None:
        super().__init__()
        self.fail_scene_2 = True
        self._others = threading.Semaphore(0)
        self._threads_done = threading.Event()
        self._overview_done = threading.Event()

    def infer_narrative_promises(self, **kwargs):
        try:
            return super().infer_narrative_promises(**kwargs)
        finally:
            self._threads_done.set()

    def infer_story_overview(self, **kwargs):
        try:
            return super().infer_story_overview(**kwargs)
        finally:
            self._overview_done.set()

    def extract_ledger_facts(self, **kwargs):
        if '"sceneId": "scene-2"' in kwargs["user_message"] and self.fail_scene_2:
            self.fail_scene_2 = False
            for _ in range(4):
                assert self._others.acquire(timeout=5)
            assert self._threads_done.wait(5) and self._overview_done.wait(5)
            raise _connection_error()
        try:
            return super().extract_ledger_facts(**kwargs)
        finally:
            self._others.release()


def test_resume_after_a_facts_failure_recalls_neither_threads_nor_overview(db_session):
    key = "00000000-0000-4000-8000-0000000f1001"
    llm = _FactsFailOnceLlm()

    failed = _post(llm, key)
    assert failed[-1] == (
        "failed",
        {
            "type": "failed",
            "error": {"code": "LLM_UNAVAILABLE", "message": "the language model is unavailable"},
        },
    )
    resumed = _post(llm, key)

    assert resumed[-1][0] == "complete"
    assert llm.invocation_count("infer_narrative_promises") == 1
    assert llm.invocation_count("infer_story_overview") == 1
    # Four scenes saved on the first run; only scene 2 is asked again.
    assert llm.invocation_count("extract_ledger_facts") == 5
    facts_cached = {
        data["data"]["index"]: data["cached"]
        for name, data in resumed
        if name == "found" and data["data"]["kind"] == "facts"
    }
    assert facts_cached == {0: True, 1: False, 2: True, 3: True, 4: True}
    for kind in ("threads", "overview"):
        (frame,) = [d for n, d in resumed if n == "found" and d["data"]["kind"] == kind]
        assert frame["cached"] is True, kind

    snapshots.purge_project(db_session, resumed[-1][1]["result"]["project"]["id"])


class _OverviewFailsLlm(_ScriptedLlm):
    """Overview fails validation (rule 9's retry already spent) at once,
    while threads and the facts are still running."""

    def __init__(self) -> None:
        super().__init__({"infer_narrative_promises": 0.2, "extract_ledger_facts": 0.1})

    def infer_story_overview(self, **kwargs):
        raise SchemaInvalidLlmError("infer_story_overview")


def test_a_failed_branch_saves_its_siblings_and_surfaces_its_own_error(db_session):
    key = "00000000-0000-4000-8000-0000000f1002"
    llm = _OverviewFailsLlm()

    events = _post(llm, key)

    assert events[-1][0] == "failed"
    assert events[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    # No overview, facts or consistency frame reached the board: the run
    # stopped at overview, which §9.3 puts before facts and consistency.
    kinds = {data["data"]["kind"] for name, data in events if name == "found"}
    assert not kinds & {"overview", "facts", "flags"}
    # Threads and every scene's facts were in flight; each was saved.
    db_session.expire_all()
    run = db_session.query(ImportRunRow).filter_by(idempotency_key=key).one()
    assert run.status == "failed"
    assert "inferring_promises" in run.checkpoint
    assert "inferring_overview" not in run.checkpoint
    saved_facts = (
        db_session.query(ImportRunUnitRow)
        .filter_by(run_id=run.id, stage="extracting_facts")
        .count()
    )
    assert saved_facts == 5
    assert llm.invocation_count("scan_consistency") == 0


class _SceneThreeOutageLlm(_ScriptedLlm):
    """Scene 3's extraction hits an outage at once, while threads and
    overview are still running."""

    def __init__(self) -> None:
        super().__init__({"infer_narrative_promises": 0.2, "infer_story_overview": 0.1})

    def extract_ledger_facts(self, **kwargs):
        if '"sceneId": "scene-3"' in kwargs["user_message"]:
            raise _connection_error()
        return super().extract_ledger_facts(**kwargs)


@pytest.mark.parametrize("overlap", [False, True], ids=["serial", "overlap"])
@pytest.mark.parametrize(
    ("llm_type", "stage", "code", "key"),
    [
        (_SceneThreeOutageLlm, "extracting_facts", "LLM_UNAVAILABLE", "f1003"),
        (_OverviewFailsLlm, "inferring_overview", "SCHEMA_INVALID_LLM", "f1004"),
    ],
    ids=["facts-outage", "overview-schema"],
)
def test_a_failure_stops_the_run_at_the_stage_that_failed(
    db_session, monkeypatch, overlap, llm_type, stage, code, key
):
    """Overlap runs a call before its stage starts; its failure must still
    be reported at that stage, after every earlier stage has merged and
    shown what it found, as in serial."""
    monkeypatch.setattr(pipeline, "IMPORT_OVERLAP", overlap)
    key = f"00000000-0000-4000-8000-0000000{key}{int(overlap)}"

    events = _post(llm_type(), key)

    assert events[-1][0] == "failed"
    assert events[-1][1]["error"]["code"] == code
    assert [data["name"] for name, data in events if name == "stage"][-1] == stage
    assert "threads" in {data["data"]["kind"] for name, data in events if name == "found"}
    db_session.expire_all()
    run = db_session.query(ImportRunRow).filter_by(idempotency_key=key).one()
    assert run.phase == stage


class _SceneOneFailsLlm(_ScriptedLlm):
    """Scene 1's extraction fails (uncounted) after a moment; threads runs
    long enough for every other scene to finish if nothing stops them."""

    def __init__(self) -> None:
        super().__init__({"infer_narrative_promises": 0.3, "extract_ledger_facts": 0.1})

    def extract_ledger_facts(self, **kwargs):
        if '"sceneId": "scene-1"' in kwargs["user_message"]:
            time.sleep(0.05)
            raise _connection_error()
        return super().extract_ledger_facts(**kwargs)


def test_a_scene_failure_cancels_the_scenes_not_yet_started(monkeypatch):
    """One worker, so the scenes queue behind scene 1. Its failure is held
    until the facts stage, but the queued scenes are cancelled as it lands:
    at most the one already picked up is asked."""
    llm = _SceneOneFailsLlm()

    with pytest.raises(anthropic.APIConnectionError):
        _analyze(monkeypatch, llm, overlap=True, concurrency=1)

    assert llm.invocation_count("extract_ledger_facts") <= 1
    assert llm.invocation_count("scan_consistency") == 0
