"""Craft notes (T10.13, design `2026-10-20-craft-notes-design.md`): a
writer-triggered read of the episode's dialogue (`review_craft`) for lines
that state the theme outright or say what a character is doing, filed as
dismissable ConsistencyFlags with `[craft_<check>]` explanation codes.

No writer/import text is logged here (hard rule 5): only ids and counts.
"""

from __future__ import annotations

import copy
import logging
import re
from collections import Counter
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from drama_manager import render
from drama_manager.ledger_policy import IdMinter, locate_quote
from drama_manager.locks import scenes_in_story_order
from drama_manager.promises import _CHARACTER_CUE, _PARENTHETICAL, _is_slugline
from schemas import CraftReview
from storage import snapshots

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from llm.protocol import LlmClient

_logger = logging.getLogger("drama_manager.craft")

# A run files at most this many notes (spec anti-goal: noise), strongest
# first as the model ranks them.
CRAFT_CAP = 12
EXCERPT_MAX = 200
SNAPSHOT_INSTRUCTION = "Craft check"
_CRAFT_CODE = re.compile(r"^\[craft_(theme_stated|on_the_nose)\] “(.*?)” — ", re.S)


class CraftCheckNotReady(Exception):
    """The episode has no beats to check."""


def dialogue_lines(script_text: str) -> list[str]:
    """The spoken part of a beat: each character cue with the dialogue under
    it, parentheticals dropped. Action, sluglines and a caps line with no
    speech under it ("WIDE ANGLE ON THE BAR") are left out."""
    out: list[str] = []
    block: list[str] = []
    for raw in (script_text or "").splitlines() + [""]:
        line = raw.strip()
        if block:
            if not line:
                if len(block) > 1:
                    out.extend(block)
                block = []
            elif not _PARENTHETICAL.match(line):
                block.append(line)
            continue
        if line and not _is_slugline(line) and _CHARACTER_CUE.match(line):
            block = [line]
    return out


def craft_spine(episode: dict) -> list[dict]:
    """`review_craft`'s input: every scene in story order with each beat's
    id and dialogue; beats without dialogue, and scenes left with none, are
    left out (the checks are about what characters say)."""
    spine: list[dict] = []
    for scene in scenes_in_story_order(episode):
        beats = [
            {"beatId": beat["id"], "dialogue": lines}
            for beat in sorted(scene.get("beats") or [], key=lambda b: b.get("index") or 0)
            if (lines := dialogue_lines(beat.get("scriptText") or ""))
        ]
        if beats:
            spine.append({"sceneId": scene["id"], "beats": beats})
    return spine


def _parse(flag: dict) -> tuple[str, str] | None:
    """(check, excerpt) of a craft flag, or None for any other flag."""
    match = _CRAFT_CODE.match(flag.get("explanation") or "")
    return (match.group(1), match.group(2)) if match else None


def _on_page(script_text: str, excerpt: str) -> bool:
    lines = script_text.count("\n") + 1
    return locate_quote(script_text, excerpt, 1, lines)[0] is not None


def craft_flags(
    review: CraftReview, episode: dict, existing_flags: list[dict]
) -> tuple[list[dict], list[dict], Counter]:
    """This run's new craft flags, the existing flags as they should now
    stand, and counts for the log (spec "Server-side checks", "Storage").

    A note is kept only when its beat belongs to its scene and its excerpt is
    on that beat's page (`locate_quote`), once per check per beat, never on a
    check the writer dismissed on that beat, at most `CRAFT_CAP`. Open craft
    flags are replaced by this run, except one whose line is gone from its
    beat, which becomes `resolved`. Every other flag is left as it was.
    `sourceChange` is stamped by the caller's mutator."""
    beats = {
        beat["id"]: (scene["id"], beat)
        for scene in episode.get("scenes") or []
        for beat in scene.get("beats") or []
    }
    counts: Counter = Counter()
    dismissed: set[tuple[str, str]] = set()
    kept: list[dict] = []
    for flag in existing_flags:
        parsed = _parse(flag)
        if parsed is None or flag.get("status") != "open":
            if parsed and flag.get("status") == "dismissed":
                dismissed.add((parsed[0], flag.get("objectId")))
            kept.append(flag)
            continue
        beat = beats.get(flag.get("objectId"), (None, {}))[1]
        if not _on_page(beat.get("scriptText") or "", parsed[1]):
            kept.append({**flag, "status": "resolved"})
            counts["resolved"] += 1
        # else: an open craft note this run replaces

    minter = IdMinter([f["id"] for f in existing_flags], "flag-")
    seen: set[tuple[str, str]] = set()
    new: list[dict] = []
    for note in review.notes:
        counts["notes"] += 1
        check = str(note.check)
        scene_id, beat = beats.get(note.beat_id, (None, None))
        excerpt = " ".join(note.excerpt.split())[:EXCERPT_MAX]
        if (
            beat is None
            or scene_id != note.scene_id
            or not excerpt
            or not _on_page(beat.get("scriptText") or "", excerpt)
        ):
            counts["unverified"] += 1
            continue
        key = (check, note.beat_id)
        if key in seen:
            counts["duplicate"] += 1
            continue
        seen.add(key)
        if key in dismissed:
            counts["dismissed_skip"] += 1
            continue
        if len(new) >= CRAFT_CAP:
            counts["over_cap"] += 1
            continue
        why = " ".join(note.why.split())
        new.append(
            {
                "id": minter.mint(),
                "objectType": "beat",
                "objectId": note.beat_id,
                "factId": None,
                "explanation": f"[craft_{check}] “{excerpt}” — {why}",
                "severity": "tension",
                "status": "open",
                "sourceChange": "",
            }
        )
    counts["kept"] = len(new)
    return new, kept, counts


def _episode(doc: dict) -> dict | None:
    return next(
        (e for season in doc.get("seasons") or [] for e in season.get("episodes") or []), None
    )


def run_craft_check(
    session: Session,
    project,
    llm: LlmClient,
    *,
    expected_head_snapshot_id: str,
) -> dict:
    """Run one writer-triggered craft check (Plan's Check craft) and save its
    notes as flags in one snapshot (rule 4), stamping
    `episode.craftCheckedAt` (the only doc change, so a locked episode is
    fine: like structure checks, nothing a writer authored moves). Raises `CraftCheckNotReady` for
    an episode with no beats; `snapshots.StaleHead`, and the LLM's errors,
    propagate for the route to map. A script with no dialogue is checked
    without a model call and files nothing. Returns the project doc."""
    episode = _episode(project.doc) or {}
    if not any(scene.get("beats") for scene in episode.get("scenes") or []):
        raise CraftCheckNotReady()
    spine = craft_spine(episode)
    if spine:
        cast = [
            c["name"]
            for c in (project.doc.get("seriesBible") or {}).get("characters") or []
            if c.get("name")
        ]
        system, user = render.build_craft_prompt(
            project.doc, episode.get("storyOverview") or {}, cast, spine, render.new_nonce()
        )
        review = llm.review_craft(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
    else:
        review = CraftReview(notes=[])
    counts: Counter = Counter()

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        nonlocal counts
        new, kept, counts = craft_flags(review, _episode(state.doc) or {}, state.flags)
        stamped = [{**flag, "sourceChange": state.snapshot_id} for flag in new]
        doc = copy.deepcopy(state.doc)
        target = _episode(doc)
        if target is not None:
            target["craftCheckedAt"] = datetime.now(UTC).isoformat()
        return snapshots.MutationState(
            doc=doc,
            ledger=state.ledger,
            flags=kept + stamped,
            snapshot_id=state.snapshot_id,
        )

    snap = snapshots.mutate(
        session,
        project.id,
        SNAPSHOT_INSTRUCTION,
        mutator,
        expected_head_snapshot_id=expected_head_snapshot_id,
    )
    _logger.info(
        "craft_check project=%s snapshot=%s notes=%d kept=%d unverified=%d duplicate=%d "
        "dismissed_skip=%d over_cap=%d resolved=%d prompt_version=%s",
        project.id,
        snap.id,
        counts["notes"],
        counts["kept"],
        counts["unverified"],
        counts["duplicate"],
        counts["dismissed_skip"],
        counts["over_cap"],
        counts["resolved"],
        render.PROMPT_VERSION,
    )
    return snap.doc
