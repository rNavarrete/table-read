"""Fountain export (T1.3): walk the project's scenes/beats and emit each
beat's ``scriptText`` (design-doc §4.6 "Fountain export").

Sluglines already live inside authored ``scriptText`` (see the fixture:
``beat-1-1`` opens with ``INT. THE LONG POUR - NIGHT``), so export does not
emit ``scene.location`` separately — doing so would double every heading and
inflate the re-import scene count. Beats with no script text (an unwritten
plan stub) contribute nothing: you cannot export a screenplay of a scene that
has none. Blocks are joined by a blank line, which is what a Fountain parser
needs before each scene heading.

The breakdown spreadsheet (T10.10, ``to_breakdown_csv``) lives here too: the
same walk, one CSV row per scene instead of script text.
"""

from __future__ import annotations

import csv
import io
import re

from drama_manager.locks import scenes_in_story_order
from fountain.acts import act_label
from fountain.characters import cues_from_scenes


def to_fountain(project: dict) -> str:
    """Serialize a `Project` wire dict to a Fountain script string, scenes in
    story order (act, then index — not the stored array's order)."""
    blocks: list[str] = []
    for season in project.get("seasons", []):
        for episode in season.get("episodes", []):
            for scene in scenes_in_story_order(episode):
                for beat in scene.get("beats", []):
                    text = beat.get("scriptText", "")
                    if text != "":
                        blocks.append(text)
    return "\n\n".join(blocks)


# T10.10 — Story Grid's scene spreadsheet plus the ledgers' columns, in order.
BREAKDOWN_COLUMNS = (
    "Scene", "Act", "Storyline", "Location", "Time", "What happens",
    "Value at stake", "Charge in", "Charge out", "Turns", "Why now",
    "Story order", "Story time", "Anachrony", "Beats", "Kernel beats",
    "Choices", "Wants", "Threads set up", "Threads paid off",
    "Threads moving", "Secrets", "Facts established", "Characters",
)


def breakdown_filename(title: str) -> str:
    """Attachment name from the project title, safe characters only (the
    same rule the web uses for the Fountain download)."""
    return f"{re.sub(r'[^A-Za-z0-9_.-]+', '_', title) or 'script'}-breakdown.csv"


def to_breakdown_csv(project: dict, ledger: list[dict]) -> str:
    """One row per scene of the first episode (the one the app shows), in
    board order (act, then index); an empty cell where a value is absent.
    Header only when there is no episode. Pure read: no LLM, no write."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(BREAKDOWN_COLUMNS)
    episodes = ((project.get("seasons") or [{}])[0]).get("episodes") or []
    if episodes:
        writer.writerows(_breakdown_rows(project, episodes[0], ledger))
    return out.getvalue()


def _breakdown_rows(project: dict, episode: dict, ledger: list[dict]):
    fmt = project.get("format") or {}
    characters = (project.get("seriesBible") or {}).get("characters") or []
    name_of = {c["id"]: c["name"] for c in characters}
    outline = {
        row["sceneId"]: row
        for row in ((episode.get("storyOverview") or {}).get("outline") or [])
    }
    threads = episode.get("threads") or []
    for number, scene in enumerate(scenes_in_story_order(episode), start=1):
        sid = scene["id"]
        beats = scene.get("beats") or []
        motivations = scene.get("motivations") or []
        charge_in, charge_out = scene.get("chargeIn"), scene.get("chargeOut")
        told = outline.get(sid) or {}
        story_order = told.get("storyOrder")
        anachrony = told.get("anachrony")
        set_up = [t for t in threads if t.get("setupSceneId") == sid]
        paid_off = [t for t in threads if t.get("payoffSceneId") == sid]
        yield [
            number,
            act_label(scene.get("act") or 0, fmt),
            scene.get("storyline") or "",
            scene.get("location") or "",
            scene.get("time") or "",
            scene.get("whatHappens") or "",
            scene.get("valueAtStake") or "",
            charge_in or "",
            charge_out or "",
            ("yes" if charge_in != charge_out else "no") if charge_in and charge_out else "",
            scene.get("whyNow") or "",
            "" if story_order is None else story_order + 1,
            told.get("storyTime") or "",
            anachrony if anachrony and anachrony != "none" else "",
            len(beats),
            _count_read(beats, "kernel"),
            _count_read(beats, "pressureChoice"),
            "; ".join(
                f"{name_of.get(m['characterId'], m['characterId'])}: {m['objective']}"
                for m in motivations
                if (m.get("objective") or "").strip()
            ),
            "; ".join(t["label"] for t in set_up),
            "; ".join(t["label"] for t in paid_off),
            "; ".join(
                f"{t['label']} ({', '.join(phases)})"
                for t in threads
                if sid not in (t.get("setupSceneId"), t.get("payoffSceneId"))
                and (phases := _phases(t, sid))
            ),
            "; ".join(
                f"{s['summary']} ({role})"
                for s in episode.get("secrets") or []
                if (role := _secret_role(s, sid))
            ),
            sum(
                f["sourceSpan"]["sceneId"] == sid and f["status"] in ("active", "pending_review")
                for f in ledger
            ),
            "; ".join(_present(scene, characters)),
        ]


def _count_read(beats: list[dict], key: str) -> int | str:
    """Beats where `key` (T10.9's `kernel` / `pressureChoice`) is true; empty
    when no beat in the scene was read for it (null or absent everywhere)."""
    read = [b[key] for b in beats if b.get(key) is not None]
    return sum(v is True for v in read) if read else ""


def _phases(thread: dict, sid: str) -> list[str]:
    """The thread's movement phases in this scene, stored order (T10.3)."""
    return [m["phase"] for m in thread.get("movements") or [] if m["sceneId"] == sid]


def _secret_role(secret: dict, sid: str) -> str | None:
    """Plan's first match (story.ts secretsForScene): set, out, then kept."""
    if secret.get("establishedSceneId") == sid:
        return "set"
    if secret.get("revealedSceneId") == sid:
        return "out"
    return "kept" if sid in (secret.get("concealmentSceneIds") or []) else None


def _present(scene: dict, characters: list[dict]) -> list[str]:
    """Plan's present cast, bible order: a dialogue cue matching a name, first
    name or alias (story.ts castFromDialogue), or a motivation in the scene."""
    cues = {cue.casefold() for cue in cues_from_scenes([scene])}
    wanting = {m["characterId"] for m in scene.get("motivations") or []}
    return [
        c["name"]
        for c in characters
        if c["id"] in wanting
        or any(
            n.casefold() in cues
            for n in (c["name"], *c["name"].split()[:1], *(c.get("aliases") or []))
            if n
        )
    ]
