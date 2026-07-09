"""HTTP endpoint tests for T0.3's read/undo scope: GET /projects/{pid},
GET /projects/{pid}/ledger, and POST /projects/{pid}/undo (root-only 409).

Full undo (restoring a non-root snapshot) and any mutation endpoints are
T1.1 scope — not exercised here.
"""

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

PROJECT_ID = "proj-longpour"


def test_get_project_returns_seeded_fixture(seeded_project):
    response = client.get(f"/api/v1/projects/{PROJECT_ID}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == PROJECT_ID
    assert body["title"] == "The Long Pour"
    assert body["headSnapshotId"] == "snap-root"


def test_get_project_missing_returns_404():
    response = client.get("/api/v1/projects/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_get_ledger_returns_all_8_facts(seeded_project):
    response = client.get(f"/api/v1/projects/{PROJECT_ID}/ledger")

    assert response.status_code == 200
    facts = response.json()
    assert len(facts) == 8
    assert {f["id"] for f in facts} == {f"fact-0{i}" for i in range(1, 9)}


def test_get_ledger_filters_by_status(seeded_project):
    url = f"/api/v1/projects/{PROJECT_ID}/ledger"
    response = client.get(url, params={"status": "pending_review"})

    assert response.status_code == 200
    facts = response.json()
    assert [f["id"] for f in facts] == ["fact-06"]


def test_get_ledger_filters_by_character_id(seeded_project):
    url = f"/api/v1/projects/{PROJECT_ID}/ledger"
    response = client.get(url, params={"characterId": "char-reyes"})

    assert response.status_code == 200
    facts = response.json()
    assert {f["id"] for f in facts} == {"fact-05", "fact-06"}


def test_undo_at_root_returns_409(seeded_project):
    response = client.post(f"/api/v1/projects/{PROJECT_ID}/undo")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION"


def test_undo_missing_project_returns_404():
    response = client.post("/api/v1/projects/does-not-exist/undo")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
