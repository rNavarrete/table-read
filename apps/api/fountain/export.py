"""Fountain export (T1.3): walk the project's scenes/beats and emit each
beat's ``scriptText`` (design-doc §4.6 "Fountain export").

Sluglines already live inside authored ``scriptText`` (see the fixture:
``beat-1-1`` opens with ``INT. THE LONG POUR - NIGHT``), so export does not
emit ``scene.location`` separately — doing so would double every heading and
inflate the re-import scene count. Beats with no script text (an unwritten
plan stub) contribute nothing: you cannot export a screenplay of a scene that
has none. Blocks are joined by a blank line, which is what a Fountain parser
needs before each scene heading.
"""

from __future__ import annotations


def to_fountain(project: dict) -> str:
    """Serialize a `Project` wire dict to a Fountain script string."""
    blocks: list[str] = []
    for season in project.get("seasons", []):
        for episode in season.get("episodes", []):
            for scene in episode.get("scenes", []):
                for beat in scene.get("beats", []):
                    text = beat.get("scriptText", "")
                    if text != "":
                        blocks.append(text)
    return "\n\n".join(blocks)
