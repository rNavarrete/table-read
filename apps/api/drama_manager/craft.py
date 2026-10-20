"""Craft notes (T10.13, design `2026-10-20-craft-notes-design.md`): a
writer-triggered read of the episode's dialogue (`review_craft`) for lines
that state the theme outright or say what a character is doing, filed as
dismissable ConsistencyFlags with `[craft_<check>]` explanation codes.

No writer/import text is logged here (hard rule 5): only ids and counts.
"""

from __future__ import annotations

from drama_manager.locks import scenes_in_story_order
from drama_manager.promises import _CHARACTER_CUE, _PARENTHETICAL, _is_slugline


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
