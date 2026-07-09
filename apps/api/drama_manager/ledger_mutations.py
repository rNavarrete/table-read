"""Ledger mutation semantics (data contract §4 Ledger mode).

Confirm / reject / edit / batch — pure ledger transforms that routes wrap in
`storage/snapshots.mutate` (hard rule 4). No DB, no LLM, no logging of writer
text (hard rule 5).

Supersede resolution (atomic — one transaction each, enforced by the caller
running a single `mutate`):

  - confirm pending_review, supersedes null → active / writer_confirmed
  - confirm pending_review, supersedes fact-X → proposal active/writer_confirmed
    AND fact-X superseded with supersededBy = proposal id (never one without
    the other)
  - reject → rejected; target untouched; supersedes link preserved
  - confirm/reject on non-pending_review → ValidationError
  - confirm when fact-X is missing or not active → ConflictStaleProposal
  - edit text/knownBy → provenance writer_authored; pending_review → active
    (T5.1 accept / DESIGN-GAP vs data-contract "status unchanged")
"""

from __future__ import annotations

import copy


class FactNotFound(LookupError):
    """No ledger fact with this id (route → 404)."""


class ValidationError(ValueError):
    """Fact is not eligible for the requested mutation (route → 409/400)."""


class ConflictStaleProposal(ValueError):
    """Supersede target was itself superseded or deleted (route → 409)."""


def _index(ledger: list[dict]) -> dict[str, int]:
    return {f["id"]: i for i, f in enumerate(ledger)}


def confirm_fact(ledger: list[dict], fact_id: str) -> list[dict]:
    """Apply confirm semantics; returns a new ledger list (never mutates input)."""
    ledger = copy.deepcopy(ledger)
    by_id = _index(ledger)
    if fact_id not in by_id:
        raise FactNotFound(fact_id)

    fact = ledger[by_id[fact_id]]
    if fact["status"] != "pending_review":
        raise ValidationError(f"fact {fact_id!r} is not pending_review")

    target_id = fact.get("supersedes")
    if target_id is not None:
        if target_id not in by_id:
            raise ConflictStaleProposal(f"supersede target {target_id!r} is gone")
        target = ledger[by_id[target_id]]
        # Target must still be the live fact the proposal was meant to replace.
        # Already-superseded (or otherwise non-active) → stale; writer re-reviews.
        if target["status"] != "active":
            raise ConflictStaleProposal(
                f"supersede target {target_id!r} is {target['status']!r}"
            )
        target["status"] = "superseded"
        target["supersededBy"] = fact_id

    fact["status"] = "active"
    fact["provenance"] = "writer_confirmed"
    return ledger


def reject_fact(ledger: list[dict], fact_id: str) -> list[dict]:
    """Apply reject semantics; target of a supersede link is never touched."""
    ledger = copy.deepcopy(ledger)
    by_id = _index(ledger)
    if fact_id not in by_id:
        raise FactNotFound(fact_id)

    fact = ledger[by_id[fact_id]]
    if fact["status"] != "pending_review":
        raise ValidationError(f"fact {fact_id!r} is not pending_review")

    fact["status"] = "rejected"
    # supersedes link intentionally preserved for audit
    return ledger


def edit_fact(
    ledger: list[dict],
    fact_id: str,
    *,
    fact_text: str | None = None,
    known_by: list[str] | None = None,
) -> list[dict]:
    """Edit text and/or knownBy; provenance becomes writer_authored.

    # DESIGN-GAP(T5.1): data contract §4 only says edit flips provenance to
    # writer_authored (status unchanged). Build-plan T5.1 accept requires
    # pending_review → active after edit so the fact leaves the review queue
    # as writer-authored. Activating pending_review on edit matches T5.1;
    # already-active/superseded/etc. statuses are left alone.
    """
    if fact_text is None and known_by is None:
        raise ValidationError("patch must include fact and/or knownBy")

    ledger = copy.deepcopy(ledger)
    by_id = _index(ledger)
    if fact_id not in by_id:
        raise FactNotFound(fact_id)

    fact = ledger[by_id[fact_id]]
    if fact_text is not None:
        fact["fact"] = fact_text
    if known_by is not None:
        fact["knownBy"] = list(known_by)
    fact["provenance"] = "writer_authored"
    if fact["status"] == "pending_review":
        fact["status"] = "active"
    return ledger


def apply_batch(
    ledger: list[dict],
    *,
    confirm_ids: list[str],
    reject_ids: list[str],
) -> list[dict]:
    """Apply confirm then reject for a batch. Validates *all* ids first so any
    invalid id fails the whole batch with nothing applied (data contract §4).

    Raises FactNotFound / ValidationError / ConflictStaleProposal before any
    mutation when a listed id is missing, not pending_review, duplicated across
    lists, or a confirm would hit a stale supersede target.
    """
    confirm_ids = list(confirm_ids)
    reject_ids = list(reject_ids)
    overlap = set(confirm_ids) & set(reject_ids)
    if overlap:
        raise ValidationError(
            f"ids appear in both confirmIds and rejectIds: {sorted(overlap)}"
        )

    by_id = _index(ledger)
    # Validate every id before mutating anything.
    for fact_id in confirm_ids + reject_ids:
        if fact_id not in by_id:
            raise FactNotFound(fact_id)
        if ledger[by_id[fact_id]]["status"] != "pending_review":
            raise ValidationError(f"fact {fact_id!r} is not pending_review")

    # Dry-run confirms against a copy so a mid-batch stale target still fails
    # the whole batch with nothing applied.
    probe = copy.deepcopy(ledger)
    for fact_id in confirm_ids:
        probe = confirm_fact(probe, fact_id)
    for fact_id in reject_ids:
        # reject after confirms so a confirm that supersedes X then a reject of
        # an unrelated proposal still sees a consistent probe; rejects never
        # touch targets, so order vs confirms only matters for the proposal
        # itself (which can't be in both lists).
        probe = reject_fact(probe, fact_id)
    return probe
