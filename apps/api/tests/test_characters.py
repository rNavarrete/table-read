"""Cast management API (data contract §4 Cast management; T7.16): rename/
alias edit, merge, delete. Pure HTTP + the snapshot helper — no LLM.

Fixture cast (docs/tableread-fixture.json): char-marta, char-dan, char-reyes,
char-luz, none locked by default. char-luz is the least-referenced character
(one relationship with char-dan, knownBy on fact-01/fact-05) so most rename/
delete/merge scenarios exercise it; a fully unreferenced character is minted
for the successful-delete test via the snapshot helper directly.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from storage.models import ProjectRow, SnapshotRow
from storage.snapshots import MutationState, mutate

client = TestClient(app)

PROJECT_ID = "proj-longpour"


def _project(session) -> dict:
    return session.get(ProjectRow, PROJECT_ID).doc


def _characters(session) -> dict[str, dict]:
    return {c["id"]: c for c in _project(session)["seriesBible"]["characters"]}


def _ledger_by_id(session) -> dict[str, dict]:
    from storage.models import LedgerFactRow

    rows = session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).all()
    return {r.id: r.to_wire_dict() for r in rows}


def _snap_count(session) -> int:
    return session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()


def _lock_character(session, cid: str) -> None:
    """Flip a character's `locked` pin directly via the snapshot helper
    (bypassing the generic PATCH route, which does not yet guard characters
    — that gap is orthogonal to this task's lock *enforcement* on the new
    cast-management routes)."""

    def mutator(state: MutationState) -> MutationState:
        doc = state.doc
        for c in doc["seriesBible"]["characters"]:
            if c["id"] == cid:
                c["locked"] = True
        return MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    mutate(session, PROJECT_ID, "test: lock character", mutator)


def _mint_unreferenced_character(session, cid: str, name: str) -> None:
    def mutator(state: MutationState) -> MutationState:
        doc = state.doc
        doc["seriesBible"]["characters"] = [
            *doc["seriesBible"]["characters"],
            {
                "id": cid,
                "name": name,
                "locked": False,
                "aliases": [],
                "embodiment": "",
                "presentation": "",
                "hiding": "",
                "traits": "",
                "seriesArc": "",
            },
        ]
        return MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    mutate(session, PROJECT_ID, "test: mint unreferenced character", mutator)


# ── PATCH rename / aliases ───────────────────────────────────────────────────


def test_patch_rename_updates_name_and_snapshots(db_session, seeded_project):
    before_snaps = _snap_count(db_session)

    response = client.patch(
        "/api/v1/projects/proj-longpour/characters/char-luz",
        json={"name": "Luz Maria Vega"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "char-luz"
    assert body["name"] == "Luz Maria Vega"

    character = _characters(db_session)["char-luz"]
    assert character["name"] == "Luz Maria Vega"
    assert _snap_count(db_session) == before_snaps + 1


def test_patch_edit_aliases_only_leaves_name_untouched(db_session, seeded_project):
    original_name = _characters(db_session)["char-dan"]["name"]

    response = client.patch(
        "/api/v1/projects/proj-longpour/characters/char-dan",
        json={"aliases": ["Danny"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["aliases"] == ["Danny"]
    assert body["name"] == original_name


def test_patch_empty_body_returns_400_validation(db_session, seeded_project):
    before_snaps = _snap_count(db_session)

    response = client.patch("/api/v1/projects/proj-longpour/characters/char-dan", json={})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"
    assert _snap_count(db_session) == before_snaps


def test_patch_missing_character_returns_404(db_session, seeded_project):
    response = client.patch(
        "/api/v1/projects/proj-longpour/characters/char-does-not-exist",
        json={"name": "x"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_patch_locked_character_returns_409_zero_mutations(db_session, seeded_project):
    _lock_character(db_session, "char-luz")
    before = _project(db_session)
    before_snaps = _snap_count(db_session)

    response = client.patch(
        "/api/v1/projects/proj-longpour/characters/char-luz",
        json={"name": "Someone Else"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _project(db_session) == before
    assert _snap_count(db_session) == before_snaps


# ── POST merge-into ──────────────────────────────────────────────────────────


def test_merge_absorbs_aliases_and_source_name(db_session, seeded_project):
    response = client.post("/api/v1/projects/proj-longpour/characters/char-luz/merge-into/char-dan")

    assert response.status_code == 200
    body = response.json()
    target = next(c for c in body["project"]["seriesBible"]["characters"] if c["id"] == "char-dan")
    assert "Luz Vega" in target["aliases"]
    assert not any(c["id"] == "char-luz" for c in body["project"]["seriesBible"]["characters"])


def test_merge_rewrites_ledger_knownby_atomically(db_session, seeded_project):
    before_snaps = _snap_count(db_session)
    knownby_before = {fid: set(f["knownBy"]) for fid, f in _ledger_by_id(db_session).items()}
    assert "char-luz" in knownby_before["fact-01"]
    assert "char-luz" in knownby_before["fact-05"]

    response = client.post("/api/v1/projects/proj-longpour/characters/char-luz/merge-into/char-dan")

    assert response.status_code == 200
    ledger = {f["id"]: f for f in response.json()["ledger"]}
    assert "char-luz" not in ledger["fact-01"]["knownBy"]
    assert "char-dan" in ledger["fact-01"]["knownBy"]
    # dedup: fact-01 already knew char-dan directly — merge must not duplicate it.
    assert ledger["fact-01"]["knownBy"].count("char-dan") == 1

    # DB-side ledger matches the response; one snapshot for the whole merge.
    db_ledger = _ledger_by_id(db_session)
    assert db_ledger["fact-01"]["knownBy"] == ledger["fact-01"]["knownBy"]
    assert _snap_count(db_session) == before_snaps + 1


def test_merge_repoints_relationship_and_drops_self_pair(db_session, seeded_project):
    # Fixture: char-dan <-> char-luz "son and mother" relationship exists.
    before = _project(db_session)["seriesBible"]["relationships"]
    assert any(set(r["between"]) == {"char-dan", "char-luz"} for r in before)

    response = client.post("/api/v1/projects/proj-longpour/characters/char-luz/merge-into/char-dan")

    assert response.status_code == 200
    relationships = response.json()["project"]["seriesBible"]["relationships"]
    assert not any("char-luz" in r["between"] for r in relationships)
    # the dan<->luz relationship collapsed into a self-pair and was dropped
    assert not any(r["between"][0] == r["between"][1] for r in relationships)


def test_merge_removes_source_character(db_session, seeded_project):
    response = client.post("/api/v1/projects/proj-longpour/characters/char-luz/merge-into/char-dan")

    assert response.status_code == 200
    ids = {c["id"] for c in response.json()["project"]["seriesBible"]["characters"]}
    assert "char-luz" not in ids
    assert "char-dan" in ids


def test_merge_into_self_returns_400_validation(db_session, seeded_project):
    before_snaps = _snap_count(db_session)

    response = client.post("/api/v1/projects/proj-longpour/characters/char-dan/merge-into/char-dan")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"
    assert _snap_count(db_session) == before_snaps


def test_merge_missing_source_returns_404(db_session, seeded_project):
    response = client.post(
        "/api/v1/projects/proj-longpour/characters/char-nope/merge-into/char-dan"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_merge_missing_target_returns_404(db_session, seeded_project):
    response = client.post(
        "/api/v1/projects/proj-longpour/characters/char-dan/merge-into/char-nope"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_merge_locked_source_returns_409_zero_mutations(db_session, seeded_project):
    _lock_character(db_session, "char-luz")
    before = _project(db_session)
    before_snaps = _snap_count(db_session)

    response = client.post("/api/v1/projects/proj-longpour/characters/char-luz/merge-into/char-dan")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _project(db_session) == before
    assert _snap_count(db_session) == before_snaps


def test_merge_locked_target_returns_409_zero_mutations(db_session, seeded_project):
    _lock_character(db_session, "char-dan")
    before = _project(db_session)
    before_snaps = _snap_count(db_session)

    response = client.post("/api/v1/projects/proj-longpour/characters/char-luz/merge-into/char-dan")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _project(db_session) == before
    assert _snap_count(db_session) == before_snaps


def test_undo_after_merge_restores_source_character(db_session, seeded_project):
    before = _project(db_session)

    merge = client.post("/api/v1/projects/proj-longpour/characters/char-luz/merge-into/char-dan")
    assert merge.status_code == 200

    undo = client.post(f"/api/v1/projects/{PROJECT_ID}/undo")
    assert undo.status_code == 200
    assert _project(db_session) == before


# ── DELETE ────────────────────────────────────────────────────────────────────


def test_delete_referenced_character_returns_409_with_counts(db_session, seeded_project):
    before = _project(db_session)
    before_snaps = _snap_count(db_session)

    response = client.delete("/api/v1/projects/proj-longpour/characters/char-luz")

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "VALIDATION"
    counts = body["error"]["details"]
    assert counts["facts"] > 0
    assert counts["relationships"] > 0
    assert _project(db_session) == before
    assert _snap_count(db_session) == before_snaps


def test_delete_unreferenced_character_succeeds(db_session, seeded_project):
    _mint_unreferenced_character(db_session, "char-extra", "Extra Extra")
    before_snaps = _snap_count(db_session)

    response = client.delete("/api/v1/projects/proj-longpour/characters/char-extra")

    assert response.status_code == 204
    ids = {c["id"] for c in _project(db_session)["seriesBible"]["characters"]}
    assert "char-extra" not in ids
    assert _snap_count(db_session) == before_snaps + 1


def test_delete_missing_character_returns_404(db_session, seeded_project):
    response = client.delete("/api/v1/projects/proj-longpour/characters/char-nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_delete_locked_character_returns_409_locked_object(db_session, seeded_project):
    _mint_unreferenced_character(db_session, "char-extra", "Extra Extra")
    _lock_character(db_session, "char-extra")
    before_snaps = _snap_count(db_session)

    response = client.delete("/api/v1/projects/proj-longpour/characters/char-extra")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _snap_count(db_session) == before_snaps
