"""Load the fixture (docs/tableread-fixture.json) into the six stores, verbatim.

The fixture is a persisted-state envelope: `project`, `ledger`, `snapshots`
(root `snap-root`), plus empty `consistencyFlags`/`changeSets`/
`suggestionHistory`. Each envelope key is written to its own store exactly
as parsed from the fixture — no re-derivation, no re-serialization through
the Pydantic contract models (which could reorder/reformat values) — only
validated against them first, so a fixture that drifts from the contract
fails loudly before anything is written.

Idempotency: **replace**. Re-running `make seed` deletes any existing rows
scoped to the fixture's project id and re-inserts fresh ones, so repeated
seeding during dev never duplicates rows or leaves stale state — the
tradeoff (destroying any writer edits made since the last seed) is fine
for a fixture-loading dev command, not a production data path.
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from schemas import PersistedState
from storage.db import Base, SessionLocal, engine, ensure_storage_schema
from storage.models import (
    ChangeSetRow,
    ConsistencyFlagRow,
    LedgerFactRow,
    ProjectRow,
    SnapshotRow,
    SuggestionHistoryRow,
)

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "docs" / "tableread-fixture.json"


def load_fixture(path: Path = FIXTURE_PATH) -> dict:
    return json.loads(path.read_text())


def seed_envelope(session: Session, envelope: dict) -> None:
    """Write a persisted-state envelope to its six stores (replace semantics)."""
    PersistedState.model_validate(envelope)  # shape check; raises before any write

    project_doc = envelope["project"]
    project_id = project_doc["id"]

    for model in (
        SnapshotRow,
        LedgerFactRow,
        ChangeSetRow,
        ConsistencyFlagRow,
        SuggestionHistoryRow,
    ):
        session.query(model).filter_by(project_id=project_id).delete()
    session.query(ProjectRow).filter_by(id=project_id).delete()

    session.add(
        ProjectRow(
            id=project_id,
            doc=project_doc,
            head_snapshot_id=project_doc["headSnapshotId"],
        )
    )

    for snap in envelope["snapshots"]:
        session.add(
            SnapshotRow(
                id=snap["id"],
                project_id=project_id,
                parent_id=snap["parentId"],
                instruction=snap["instruction"],
                doc=snap["doc"],
                ledger=snap["ledger"],
                flags=snap["flags"],
                ts=snap["ts"],
            )
        )

    for fact in envelope["ledger"]:
        session.add(
            LedgerFactRow(
                id=fact["id"],
                project_id=project_id,
                fact=fact["fact"],
                fact_type=fact["factType"],
                source_span=fact["sourceSpan"],
                source_text=fact["sourceText"],
                known_by=fact["knownBy"],
                audience_knows=fact["audienceKnows"],
                provenance=fact["provenance"],
                confidence=fact["confidence"],
                status=fact["status"],
                supersedes=fact["supersedes"],
                superseded_by=fact["supersededBy"],
            )
        )

    for cs in envelope["changeSets"]:
        session.add(
            ChangeSetRow(
                id=cs["id"],
                project_id=cs["projectId"],
                doc=cs,
                status=cs["status"],
            )
        )

    for flag in envelope["consistencyFlags"]:
        session.add(
            ConsistencyFlagRow(
                id=flag["id"],
                project_id=project_id,
                object_type=flag["objectType"],
                object_id=flag["objectId"],
                fact_id=flag["factId"],
                explanation=flag["explanation"],
                severity=flag["severity"],
                status=flag["status"],
                source_change=flag["sourceChange"],
            )
        )

    for entry in envelope["suggestionHistory"]:
        session.add(
            SuggestionHistoryRow(
                id=entry["id"],
                project_id=entry["projectId"],
                text=entry["text"],
                embedding=entry.get("embedding"),
            )
        )

    session.commit()


def main() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_storage_schema()
    envelope = load_fixture()
    with SessionLocal() as session:
        seed_envelope(session, envelope)
    print(
        f"seeded project {envelope['project']['id']!r}: "
        f"{len(envelope['ledger'])} ledger facts, {len(envelope['snapshots'])} snapshots"
    )


if __name__ == "__main__":
    main()
