"""Ledger mutation API (data contract §4 Ledger mode; test plan lines 12, 18).

Covers confirm / reject / edit / batch supersede semantics, snapshot versioning,
and undo restoring the ledger byte-identical. No LLM — pure HTTP + snapshot
helper.
"""

from __future__ import annotations

import copy

from fastapi.testclient import TestClient

from main import app
from storage.models import LedgerFactRow, ProjectRow, SnapshotRow
from storage.snapshots import MutationState, mutate

client = TestClient(app)

PROJECT_ID = "proj-longpour"


def _ledger(session) -> list[dict]:
    rows = session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).all()
    return sorted((r.to_wire_dict() for r in rows), key=lambda f: f["id"])


def _by_id(session) -> dict[str, dict]:
    return {f["id"]: f for f in _ledger(session)}


def _snapshot_count(session) -> int:
    return session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()


def _insert_proposal(session, *, proposal_id: str, supersedes: str, status="pending_review"):
    """Append a supersede proposal to the live ledger via the snapshot helper."""
    target = _by_id(session)[supersedes]

    def add_proposal(state: MutationState) -> MutationState:
        proposal = {
            "id": proposal_id,
            "fact": "Dan has been arrested.",
            "factType": target["factType"],
            "sourceSpan": {
                "episodeId": "ep-1",
                "sceneId": "scene-3",
                "beatId": "beat-3-2",
                "startLine": None,
                "endLine": None,
                "charStart": None,
                "charEnd": None,
            },
            "sourceText": "",
            "knownBy": list(target["knownBy"]),
            "audienceKnows": target["audienceKnows"],
            "provenance": "inferred",
            "confidence": 0.9,
            "status": status,
            "supersedes": supersedes,
            "supersededBy": None,
        }
        return MutationState(doc=state.doc, ledger=[*state.ledger, proposal], flags=state.flags)

    mutate(session, PROJECT_ID, "test: insert supersede proposal", add_proposal)


# ── confirm: plain pending_review ────────────────────────────────────────────


def test_confirm_pending_review_becomes_active_writer_confirmed(db_session, seeded_project):
    before_snaps = _snapshot_count(db_session)
    assert _by_id(db_session)["fact-06"]["status"] == "pending_review"

    response = client.post("/api/v1/ledger/fact-06/confirm")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "fact-06"
    assert body["status"] == "active"
    assert body["provenance"] == "writer_confirmed"

    fact = _by_id(db_session)["fact-06"]
    assert fact["status"] == "active"
    assert fact["provenance"] == "writer_confirmed"
    assert _snapshot_count(db_session) == before_snaps + 1


# ── confirm: supersede proposal (atomic) ─────────────────────────────────────


def test_confirm_supersede_proposal_flips_both_atomically(db_session, seeded_project):
    _insert_proposal(db_session, proposal_id="fact-09", supersedes="fact-07")
    before_snaps = _snapshot_count(db_session)

    response = client.post("/api/v1/ledger/fact-09/confirm")

    assert response.status_code == 200
    ledger = _by_id(db_session)
    proposal = ledger["fact-09"]
    target = ledger["fact-07"]

    assert proposal["status"] == "active"
    assert proposal["provenance"] == "writer_confirmed"
    assert proposal["supersedes"] == "fact-07"

    assert target["status"] == "superseded"
    assert target["supersededBy"] == "fact-09"
    # never one without the other — both flipped in the same snapshot
    assert _snapshot_count(db_session) == before_snaps + 1
    head = db_session.get(ProjectRow, PROJECT_ID).head_snapshot_id
    snap = db_session.get(SnapshotRow, head)
    snap_by_id = {f["id"]: f for f in snap.ledger}
    assert snap_by_id["fact-09"]["status"] == "active"
    assert snap_by_id["fact-07"]["status"] == "superseded"
    assert snap_by_id["fact-07"]["supersededBy"] == "fact-09"


# ── reject: supersede proposal leaves target untouched ───────────────────────


def test_reject_supersede_proposal_leaves_target_active(db_session, seeded_project):
    _insert_proposal(db_session, proposal_id="fact-09", supersedes="fact-07")
    target_before = copy.deepcopy(_by_id(db_session)["fact-07"])

    response = client.post("/api/v1/ledger/fact-09/reject")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "rejected"
    assert body["supersedes"] == "fact-07"  # link preserved for audit

    target = _by_id(db_session)["fact-07"]
    assert target == target_before  # untouched
    assert target["status"] == "active"
    assert target["supersededBy"] is None


def test_reject_plain_pending_review(db_session, seeded_project):
    response = client.post("/api/v1/ledger/fact-06/reject")

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert _by_id(db_session)["fact-06"]["status"] == "rejected"


# ── confirm/reject on non-pending → 409 VALIDATION ───────────────────────────


def test_confirm_non_pending_returns_409_validation(db_session, seeded_project):
    response = client.post("/api/v1/ledger/fact-01/confirm")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION"
    assert _by_id(db_session)["fact-01"]["status"] == "active"  # unchanged


def test_reject_non_pending_returns_409_validation(db_session, seeded_project):
    response = client.post("/api/v1/ledger/fact-01/reject")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION"


# ── stale supersede target → 409 CONFLICT_STALE_PROPOSAL ─────────────────────


def test_confirm_when_target_already_superseded_returns_409_stale(db_session, seeded_project):
    _insert_proposal(db_session, proposal_id="fact-09", supersedes="fact-07")
    # Simulate fact-07 already superseded by an earlier confirm of another proposal.
    def mark_target_superseded(state: MutationState) -> MutationState:
        ledger = []
        for f in state.ledger:
            if f["id"] == "fact-07":
                f = {**f, "status": "superseded", "supersededBy": "fact-earlier"}
            ledger.append(f)
        return MutationState(doc=state.doc, ledger=ledger, flags=state.flags)

    mutate(db_session, PROJECT_ID, "test: stale target", mark_target_superseded)
    before = _by_id(db_session)

    response = client.post("/api/v1/ledger/fact-09/confirm")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONFLICT_STALE_PROPOSAL"
    # nothing applied
    assert _by_id(db_session) == before


def test_confirm_when_target_deleted_returns_409_stale(db_session, seeded_project):
    _insert_proposal(db_session, proposal_id="fact-09", supersedes="fact-07")

    def drop_target(state: MutationState) -> MutationState:
        ledger = [f for f in state.ledger if f["id"] != "fact-07"]
        return MutationState(doc=state.doc, ledger=ledger, flags=state.flags)

    mutate(db_session, PROJECT_ID, "test: delete target", drop_target)
    before = _by_id(db_session)

    response = client.post("/api/v1/ledger/fact-09/confirm")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONFLICT_STALE_PROPOSAL"
    assert _by_id(db_session) == before


# ── missing fact → 404 ───────────────────────────────────────────────────────


def test_confirm_missing_fact_returns_404(db_session, seeded_project):
    response = client.post("/api/v1/ledger/fact-does-not-exist/confirm")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ── PATCH edit → writer_authored ─────────────────────────────────────────────


def test_patch_edit_sets_writer_authored(db_session, seeded_project):
    before_snaps = _snapshot_count(db_session)

    response = client.patch(
        "/api/v1/ledger/fact-06",
        json={"fact": "Reyes may be bluffing about the warrant.", "knownBy": ["char-marta"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["fact"] == "Reyes may be bluffing about the warrant."
    assert body["knownBy"] == ["char-marta"]
    assert body["provenance"] == "writer_authored"

    fact = _by_id(db_session)["fact-06"]
    assert fact["provenance"] == "writer_authored"
    assert fact["fact"] == "Reyes may be bluffing about the warrant."
    assert _snapshot_count(db_session) == before_snaps + 1


def test_patch_edit_partial_known_by_only(db_session, seeded_project):
    original_text = _by_id(db_session)["fact-01"]["fact"]

    response = client.patch("/api/v1/ledger/fact-01", json={"knownBy": ["char-dan"]})

    assert response.status_code == 200
    body = response.json()
    assert body["knownBy"] == ["char-dan"]
    assert body["fact"] == original_text
    assert body["provenance"] == "writer_authored"


def test_patch_missing_fact_returns_404(db_session, seeded_project):
    response = client.patch("/api/v1/ledger/fact-missing", json={"fact": "x"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ── batch: one snapshot, atomic failure ──────────────────────────────────────


def test_batch_confirm_and_reject_one_snapshot(db_session, seeded_project):
    _insert_proposal(db_session, proposal_id="fact-09", supersedes="fact-07")
    before_snaps = _snapshot_count(db_session)

    response = client.post(
        f"/api/v1/projects/{PROJECT_ID}/ledger/batch",
        json={"confirmIds": ["fact-06"], "rejectIds": ["fact-09"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert "ledger" in body
    by_id = {f["id"]: f for f in body["ledger"]}
    assert by_id["fact-06"]["status"] == "active"
    assert by_id["fact-06"]["provenance"] == "writer_confirmed"
    assert by_id["fact-09"]["status"] == "rejected"
    assert by_id["fact-07"]["status"] == "active"  # reject left target alone
    assert by_id["fact-07"]["supersededBy"] is None

    assert _snapshot_count(db_session) == before_snaps + 1


def test_batch_supersede_confirm_flips_target(db_session, seeded_project):
    _insert_proposal(db_session, proposal_id="fact-09", supersedes="fact-07")

    response = client.post(
        f"/api/v1/projects/{PROJECT_ID}/ledger/batch",
        json={"confirmIds": ["fact-09"], "rejectIds": []},
    )

    assert response.status_code == 200
    by_id = {f["id"]: f for f in response.json()["ledger"]}
    assert by_id["fact-09"]["status"] == "active"
    assert by_id["fact-07"]["status"] == "superseded"
    assert by_id["fact-07"]["supersededBy"] == "fact-09"


def test_batch_invalid_id_fails_atomically_400(db_session, seeded_project):
    before = _by_id(db_session)
    before_snaps = _snapshot_count(db_session)

    response = client.post(
        f"/api/v1/projects/{PROJECT_ID}/ledger/batch",
        json={"confirmIds": ["fact-06", "fact-does-not-exist"], "rejectIds": []},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"
    assert _by_id(db_session) == before  # nothing applied
    assert _snapshot_count(db_session) == before_snaps


def test_batch_non_pending_id_fails_atomically_400(db_session, seeded_project):
    before = _by_id(db_session)
    before_snaps = _snapshot_count(db_session)

    response = client.post(
        f"/api/v1/projects/{PROJECT_ID}/ledger/batch",
        json={"confirmIds": ["fact-01"], "rejectIds": []},  # fact-01 is active
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"
    assert _by_id(db_session) == before
    assert _snapshot_count(db_session) == before_snaps


# ── undo restores ledger byte-identical ──────────────────────────────────────


def test_undo_after_confirm_restores_ledger_byte_identical(db_session, seeded_project):
    before = _ledger(db_session)

    confirm = client.post("/api/v1/ledger/fact-06/confirm")
    assert confirm.status_code == 200
    assert _by_id(db_session)["fact-06"]["status"] == "active"

    undo = client.post(f"/api/v1/projects/{PROJECT_ID}/undo")
    assert undo.status_code == 200
    assert _ledger(db_session) == before


def test_undo_after_batch_restores_all_to_pending_review(db_session, seeded_project):
    _insert_proposal(db_session, proposal_id="fact-09", supersedes="fact-07")
    before = _ledger(db_session)

    batch = client.post(
        f"/api/v1/projects/{PROJECT_ID}/ledger/batch",
        json={"confirmIds": ["fact-06", "fact-09"], "rejectIds": []},
    )
    assert batch.status_code == 200

    undo = client.post(f"/api/v1/projects/{PROJECT_ID}/undo")
    assert undo.status_code == 200
    assert _ledger(db_session) == before
    by_id = _by_id(db_session)
    assert by_id["fact-06"]["status"] == "pending_review"
    assert by_id["fact-09"]["status"] == "pending_review"
    assert by_id["fact-07"]["status"] == "active"
    assert by_id["fact-07"]["supersededBy"] is None
