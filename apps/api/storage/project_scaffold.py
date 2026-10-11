"""The initial (pre-any-write) project document shape, shared by both
project-creation transactions: routes.py's plain `POST /projects` (idea
path, data contract §9.2) and `fountain/create_import.py`'s atomic
create-and-import (§9.3). Neither writes a project row through this module —
it only builds the in-memory doc `storage/snapshots.py` then persists.
"""

from __future__ import annotations

# Default component set for a new project (design doc §5 / fixture). The
# writer toggles these in show-format settings later.
DEFAULT_ENABLED_COMPONENTS = [
    "existential_question",
    "audience_goals",
    "motivations",
    "desiderata",
    "continuity_ledger",
]


def minimal_series_bible() -> dict:
    """A scaffolded but empty `SeriesBible` (data contract §4 `POST /projects`)."""
    return {
        "existentialQuestion": {"text": "", "locked": False},
        "worldRules": [],
        "storiesToAvoid": [],
        "characters": [],
        "relationships": [],
        "audienceGoals": [],
        "narratorGoals": [],
        "worldQA": [],
    }


def initial_project_doc(title: str, format_dict: dict | None, premise: str) -> dict:
    """The pre-creation `Project` doc: no `id`/`headSnapshotId` yet (the
    creating transaction stamps both), an empty bible, and no seasons. The
    import create-and-import path (§9.3) never supplies a `foundation` —
    the import wizard has no story-foundation step. A create-and-import
    without a format leaves it None until the import's act stage reads it
    from the script."""
    return {
        "id": None,
        "title": title,
        "format": format_dict,
        "enabledComponents": list(DEFAULT_ENABLED_COMPONENTS),
        "premise": premise,
        "seriesBible": minimal_series_bible(),
        "seasons": [],
        "headSnapshotId": None,
        "defaultCraftLevel": "standard",
    }
