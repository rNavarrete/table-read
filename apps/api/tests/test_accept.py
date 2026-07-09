"""POST /projects/{pid}/scenes/{sid}/beats — beat accept end-to-end (data
contract §4). MockLlmClient injected via dependency override (hard rule 1).

Accept is where generated content enters the project: beat insert, ledger
extraction with the §5 policy, supersede proposals, and consistency-scan flags,
all committed in one snapshot (obligation 1).
"""

from __future__ import annotations

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from drama_manager import accept
from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import ConsistencyScan, LedgerExtraction
from storage import snapshots
from storage.models import ConsistencyFlagRow, LedgerFactRow, ProjectRow, SnapshotRow

PROJECT_ID = "proj-longpour"

# scriptText the accepted candidate carries; sourceText assertions key off it.
SCRIPT = "INT. THE LONG POUR - DAY\n\nReyes snaps the cuffs on Dan.\n\nDAN\nThis is a mistake."


def candidate(script: str = SCRIPT, label: str = "The arrest") -> dict:
    return {
        "label": label,
        "beatPlan": {"whatHappens": "Reyes arrests Dan.", "audienceLearns": "Dan is caught.",
                     "audienceFeels": "Shock."},
        "scriptText": script,
        "continuityConflicts": [],
    }


def body(after_beat_id: str | None = "beat-3-1", **over) -> dict:
    b = {"candidate": candidate(), "afterBeatId": after_beat_id}
    b.update(over)
    return b


def extraction(new_facts=None, contradictions=None) -> LedgerExtraction:
    return LedgerExtraction.model_validate(
        {"newFacts": new_facts or [], "contradictions": contradictions or []}
    )


def a_fact(confidence=0.95, source_text="", start=1, end=1) -> dict:
    return {
        "fact": "Dan is arrested.", "factType": "event",
        "sourceSpan": {"episodeId": "ep-1", "sceneId": "scene-3", "beatId": "beat-3-2",
                       "startLine": start, "endLine": end},
        "sourceText": source_text, "knownBy": ["char-marta", "char-dan"],
        "audienceKnows": True, "confidence": confidence,
    }


def scan(flags=None) -> ConsistencyScan:
    return ConsistencyScan.model_validate({"flags": flags or []})


@pytest.fixture()
def mock_llm():
    client = MockLlmClient()
    client.set_response("extract_ledger_facts", extraction())
    client.set_response("scan_consistency", scan())
    app.dependency_overrides[get_llm_client] = lambda: client
    yield client
    app.dependency_overrides.pop(get_llm_client, None)


client = TestClient(app)


def _post(after_beat_id="beat-3-1", scene="scene-3"):
    return client.post(f"/api/v1/projects/{PROJECT_ID}/scenes/{scene}/beats",
                       json=body(after_beat_id))


# ── beat insert at the correct index ─────────────────────────────────────────


def test_accept_inserts_beat_at_correct_index(seeded_project, mock_llm):
    resp = _post("beat-3-1")
    assert resp.status_code == 200
    scenes = resp.json()["project"]["seasons"][0]["episodes"][0]["scenes"]
    scene3 = next(s for s in scenes if s["id"] == "scene-3")
    ids = [b["id"] for b in scene3["beats"]]
    assert ids == ["beat-3-1", "beat-3-2"]
    assert [b["index"] for b in scene3["beats"]] == [0, 1]
    new_beat = scene3["beats"][1]
    assert new_beat["scriptText"] == SCRIPT
    assert new_beat["locked"] is False and new_beat["scriptLocked"] is False


def test_accept_at_top_of_scene_reindexes(seeded_project, mock_llm):
    resp = client.post(f"/api/v1/projects/{PROJECT_ID}/scenes/scene-3/beats",
                       json=body(after_beat_id=None))
    scene3 = next(s for s in resp.json()["project"]["seasons"][0]["episodes"][0]["scenes"]
                 if s["id"] == "scene-3")
    assert [b["id"] for b in scene3["beats"]] == ["beat-3-2", "beat-3-1"]
    assert [b["index"] for b in scene3["beats"]] == [0, 1]


def test_response_shape(seeded_project, mock_llm):
    assert set(_post().json()) == {"project", "newFacts", "contradictions", "consistencyFlags"}


# ── one snapshot for beat + facts + flags (obligation 1) ─────────────────────


def test_accept_creates_exactly_one_snapshot(seeded_project, db_session, mock_llm):
    before = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    mock_llm.set_response("extract_ledger_facts", extraction([a_fact()]))
    mock_llm.set_response("scan_consistency", scan(
        [{"objectType": "scene", "objectId": "scene-5", "factId": None,
          "explanation": "tension", "severity": "tension"}]))
    _post()
    after = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    assert after == before + 1

    # the new head snapshot materializes doc + ledger + flags together
    project = db_session.get(ProjectRow, PROJECT_ID)
    snap = db_session.get(SnapshotRow, project.head_snapshot_id)
    assert any(b["id"] == "beat-3-2" for s in snap.doc["seasons"][0]["episodes"][0]["scenes"]
               for b in s["beats"])
    assert any(f["fact"] == "Dan is arrested." for f in snap.ledger)
    assert any(fl["objectId"] == "scene-5" for fl in snap.flags)


# ── ledger policy: confidence + sourceText (obligations 3, 4) ────────────────


def test_high_confidence_fact_active_low_confidence_pending(seeded_project, mock_llm):
    mock_llm.set_response("extract_ledger_facts", extraction([
        a_fact(confidence=0.95, source_text="Reyes snaps the cuffs on Dan.", start=3, end=3),
        a_fact(confidence=0.5, source_text=""),
    ]))
    new_facts = _post().json()["newFacts"]
    by_conf = {f["confidence"]: f for f in new_facts}
    assert by_conf[0.95]["status"] == "active"
    assert by_conf[0.5]["status"] == "pending_review"


def test_sourcetext_verified_offsets_reproduce_exactly(seeded_project, mock_llm):
    quote = "Reyes snaps the cuffs on Dan."
    mock_llm.set_response("extract_ledger_facts", extraction([
        a_fact(confidence=0.95, source_text=quote, start=3, end=3)]))
    fact = _post().json()["newFacts"][0]
    span = fact["sourceSpan"]
    assert fact["status"] == "active"
    assert SCRIPT[span["charStart"]:span["charEnd"]] == quote
    assert span["beatId"] == "beat-3-2" and span["sceneId"] == "scene-3"


def test_sourcetext_not_in_range_demotes_even_high_confidence(seeded_project, mock_llm):
    mock_llm.set_response("extract_ledger_facts", extraction([
        a_fact(confidence=0.99, source_text="Reyes snaps the cuffs on Dan.", start=1, end=1)]))
    fact = _post().json()["newFacts"][0]
    assert fact["status"] == "pending_review"
    assert fact["sourceSpan"]["charStart"] is None


def test_new_facts_persist_in_ledger(seeded_project, mock_llm):
    mock_llm.set_response("extract_ledger_facts", extraction([a_fact(confidence=0.95,
                          source_text="Reyes snaps the cuffs on Dan.", start=3, end=3)]))
    _post()
    ledger = client.get(f"/api/v1/projects/{PROJECT_ID}/ledger").json()
    assert any(f["fact"] == "Dan is arrested." and f["status"] == "active" for f in ledger)


# ── supersede proposal (fact-07 case): original untouched, no overwrite ──────


def test_contradiction_creates_proposal_and_leaves_fact07_untouched(seeded_project, mock_llm):
    mock_llm.set_response("extract_ledger_facts", extraction(
        new_facts=[a_fact(confidence=0.95, source_text="Reyes snaps the cuffs on Dan.",
                          start=3, end=3)],
        contradictions=[{"existingFactId": "fact-07",
                         "explanation": "Dan is now arrested.",
                         "proposedReplacement": "Dan has been arrested."}]))
    resp = _post().json()
    assert resp["contradictions"][0]["existingFactId"] == "fact-07"
    proposal_id = resp["contradictions"][0]["proposalId"]

    ledger = {f["id"]: f for f in client.get(f"/api/v1/projects/{PROJECT_ID}/ledger").json()}

    # original fact-07 untouched: still active, still writer_authored, no supersededBy
    assert ledger["fact-07"]["status"] == "active"
    assert ledger["fact-07"]["provenance"] == "writer_authored"
    assert ledger["fact-07"]["supersededBy"] is None

    # a new proposal fact links to fact-07 via supersedes, pending review
    proposal = ledger[proposal_id]
    assert proposal["supersedes"] == "fact-07"
    assert proposal["status"] == "pending_review"
    assert proposal["provenance"] == "inferred"
    assert proposal["fact"] == "Dan has been arrested."


# ── consistency-scan flags surface + persist open (obligation 6) ─────────────


def test_scan_flags_surface_in_response_and_persist_open(seeded_project, db_session, mock_llm):
    mock_llm.set_response("scan_consistency", scan(
        [{"objectType": "scene", "objectId": "scene-5", "factId": None,
          "explanation": "The bar-staged argument is stale.", "severity": "tension"}]))
    flags = _post().json()["consistencyFlags"]
    assert len(flags) == 1
    assert flags[0]["objectId"] == "scene-5"
    assert flags[0]["status"] == "open"
    assert flags[0]["sourceChange"].startswith("snap-")

    persisted = db_session.query(ConsistencyFlagRow).filter_by(project_id=PROJECT_ID).all()
    assert any(f.object_id == "scene-5" and f.status == "open" for f in persisted)


def test_scan_flags_for_changed_and_unknown_ids_dropped(seeded_project, mock_llm):
    mock_llm.set_response("scan_consistency", scan([
        {"objectType": "beat", "objectId": "beat-3-2", "factId": None,      # the changed beat
         "explanation": "self", "severity": "tension"},
        {"objectType": "scene", "objectId": "scene-999", "factId": None,    # unknown
         "explanation": "phantom", "severity": "tension"},
        {"objectType": "beat", "objectId": "beat-1-2", "factId": None,      # locked beat
         "explanation": "locked", "severity": "tension"},
        {"objectType": "scene", "objectId": "scene-5", "factId": None,      # kept
         "explanation": "real", "severity": "tension"},
    ]))
    flags = _post().json()["consistencyFlags"]
    assert [f["objectId"] for f in flags] == ["scene-5"]


# ── locks (rule 2): reject locked scene; preserve adjacent locked content ────


def test_accept_into_locked_scene_409_zero_mutations(seeded_project, db_session, mock_llm):
    # lock scene-3 directly in the stored doc
    project = db_session.get(ProjectRow, PROJECT_ID)
    import copy
    doc = copy.deepcopy(project.doc)
    for s in doc["seasons"][0]["episodes"][0]["scenes"]:
        if s["id"] == "scene-3":
            s["locked"] = True
    project.doc = doc
    db_session.commit()

    snaps_before = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    resp = _post()
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == snaps_before


def test_accept_adjacent_to_locked_beat_preserves_content(seeded_project, db_session, mock_llm):
    # insert after beat-1-1 in scene-1, shifting locked beat-1-2 — content must survive
    project = db_session.get(ProjectRow, PROJECT_ID)
    locked_before = next(
        b for b in project.doc["seasons"][0]["episodes"][0]["scenes"][0]["beats"]
        if b["id"] == "beat-1-2"
    )
    import copy
    locked_before = copy.deepcopy(locked_before)

    resp = client.post(f"/api/v1/projects/{PROJECT_ID}/scenes/scene-1/beats",
                       json=body(after_beat_id="beat-1-1"))
    assert resp.status_code == 200
    scene1 = resp.json()["project"]["seasons"][0]["episodes"][0]["scenes"][0]
    locked_after = next(b for b in scene1["beats"] if b["id"] == "beat-1-2")
    assert locked_after["scriptText"] == locked_before["scriptText"]
    assert locked_after["whatHappens"] == locked_before["whatHappens"]
    assert locked_after["locked"] and locked_after["scriptLocked"]
    assert locked_after["index"] == locked_before["index"] + 1  # reindexed only


# ── undo-orphan: undo after accept removes beat + its facts + flags ──────────


def test_undo_after_accept_removes_beat_facts_and_flags(seeded_project, db_session, mock_llm):
    mock_llm.set_response("extract_ledger_facts", extraction([a_fact(confidence=0.95,
                          source_text="Reyes snaps the cuffs on Dan.", start=3, end=3)]))
    mock_llm.set_response("scan_consistency", scan(
        [{"objectType": "scene", "objectId": "scene-5", "factId": None,
          "explanation": "t", "severity": "tension"}]))
    accepted = _post().json()
    new_fact_ids = {f["id"] for f in accepted["newFacts"]}
    new_flag_ids = {f["id"] for f in accepted["consistencyFlags"]}
    assert new_fact_ids and new_flag_ids  # the accept really created both

    undone = client.post(f"/api/v1/projects/{PROJECT_ID}/undo").json()
    scene3 = next(s for s in undone["seasons"][0]["episodes"][0]["scenes"] if s["id"] == "scene-3")
    assert [b["id"] for b in scene3["beats"]] == ["beat-3-1"]  # inserted beat gone

    # facts and flags cannot outlive the beat that established them (undo-orphan)
    ledger_ids = {f["id"] for f in client.get(f"/api/v1/projects/{PROJECT_ID}/ledger").json()}
    assert not (new_fact_ids & ledger_ids)
    remaining_flags = {
        f.id for f in db_session.query(ConsistencyFlagRow).filter_by(project_id=PROJECT_ID).all()
    }
    assert not (new_flag_ids & remaining_flags)


# ── atomicity: mid-transaction fault leaves zero rows changed ────────────────


def test_mid_transaction_fault_leaves_zero_rows(seeded_project, db_session, monkeypatch):
    project = db_session.get(ProjectRow, PROJECT_ID)
    import copy
    original_doc = copy.deepcopy(project.doc)
    original_head = project.head_snapshot_id
    snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()

    llm = MockLlmClient()
    llm.set_response("extract_ledger_facts", extraction([a_fact()]))
    llm.set_response("scan_consistency", scan(
        [{"objectType": "scene", "objectId": "scene-5", "factId": None,
          "explanation": "x", "severity": "tension"}]))

    def boom(*a, **k):
        raise RuntimeError("injected mid-transaction failure")

    monkeypatch.setattr(snapshots, "_rewrite_flags", boom)

    from schemas import BeatCandidate
    with pytest.raises(RuntimeError, match="injected"):
        accept.run_accept(
            db_session, project, BeatCandidate.model_validate(candidate()),
            "beat-3-1", llm, scene_id="scene-3", instruction="Accepted beat candidate",
        )

    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc == original_doc
    assert project.head_snapshot_id == original_head
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == snaps
    assert db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count() == facts


# ── LLM failure blocks the accept (obligation 7): nothing persisted ──────────


class _RaisingLlm(MockLlmClient):
    def __init__(self, exc, on="extract_ledger_facts"):
        super().__init__()
        self._exc = exc
        self._on = on

    def extract_ledger_facts(self, **kw):
        if self._on == "extract_ledger_facts":
            raise self._exc
        return super().extract_ledger_facts(**kw)

    def scan_consistency(self, **kw):
        if self._on == "scan_consistency":
            raise self._exc
        return super().scan_consistency(**kw)


@pytest.mark.parametrize("on", ["extract_ledger_facts", "scan_consistency"])
def test_transport_error_blocks_accept_503(seeded_project, db_session, on):
    exc = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
    snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    app.dependency_overrides[get_llm_client] = lambda: _RaisingLlm(exc, on)
    try:
        resp = _post()
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "LLM_UNAVAILABLE"
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == snaps


def test_schema_invalid_llm_blocks_accept_502(seeded_project, db_session):
    snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    app.dependency_overrides[get_llm_client] = lambda: _RaisingLlm(
        SchemaInvalidLlmError("extract_ledger_facts"))
    try:
        resp = _post()
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == snaps


# ── route guards ─────────────────────────────────────────────────────────────


def test_scene_not_found_404(seeded_project, mock_llm):
    resp = client.post(f"/api/v1/projects/{PROJECT_ID}/scenes/scene-999/beats", json=body())
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_bad_after_beat_id_400(seeded_project, mock_llm):
    resp = _post(after_beat_id="beat-nope")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION"


def test_missing_project_404(mock_llm):
    resp = client.post("/api/v1/projects/nope/scenes/scene-3/beats", json=body())
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_invalid_candidate_body_422(seeded_project, mock_llm):
    resp = client.post(f"/api/v1/projects/{PROJECT_ID}/scenes/scene-3/beats",
                       json={"candidate": {"label": "x"}, "afterBeatId": "beat-3-1"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION"
