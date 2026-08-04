"""Unit tests for `drama_manager.promises.merge_narrative_promises` (T7.20).

Mirrors `test_fountain_characters.py`'s style for the sibling
`merge_inferred_entities` merge: plain doc/character dicts, no DB, no LLM.
"""

from __future__ import annotations

from drama_manager.promises import merge_narrative_promises
from schemas import NarrativePromises


def _character(cid: str, name: str, *, locked: bool = False, aliases=None) -> dict:
    return {
        "id": cid,
        "name": name,
        "locked": locked,
        "aliases": aliases or [],
        "embodiment": "",
        "presentation": "",
        "hiding": "",
        "traits": "",
        "seriesArc": "",
    }


def _doc(*, characters=None, world_rules=None, scenes=None, threads=None) -> dict:
    scenes = scenes or [
        {"id": "scene-1", "motivations": []},
        {"id": "scene-2", "motivations": []},
    ]
    return {
        "seasons": [
            {
                "id": "season-1",
                "episodes": [
                    {
                        "id": "ep-1",
                        "scenes": scenes,
                        "threads": threads if threads is not None else [],
                    }
                ],
            }
        ],
        "seriesBible": {
            "characters": characters or [],
            "worldRules": world_rules or [],
        },
    }


def promises(
    threads: list[dict] | None = None,
    scene_motivations: list[dict] | None = None,
    world_rules: list[dict] | None = None,
    secrets: list[dict] | None = None,
) -> NarrativePromises:
    return NarrativePromises.model_validate(
        {
            "threads": threads or [],
            "secrets": secrets or [],
            "sceneMotivations": scene_motivations or [],
            "worldRules": world_rules or [],
        }
    )


def _thread(**overrides) -> dict:
    return {
        "label": "The missing money",
        "summary": "Marta suspects Dan.",
        "status": "open",
        "ownerNames": ["Marta"],
        "setupSceneId": "scene-1",
        "payoffSceneId": None,
        "setupQuote": "quote",
        "payoffQuote": "",
        **overrides,
    }


def _world_rule(**overrides) -> dict:
    return {
        "text": "The bar is neutral ground.",
        "limit": "",
        "cost": "",
        "exception": "",
        "evidenceSceneId": "scene-1",
        "evidenceQuote": "quote",
        **overrides,
    }


# ── threads ──────────────────────────────────────────────────────────────


def test_merge_mints_thread_and_resolves_owner_by_alias():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc, "ep-1", promises(threads=[_thread(ownerNames=["Marta"])])
    )

    episode = result["seasons"][0]["episodes"][0]
    assert len(episode["threads"]) == 1
    thread = episode["threads"][0]
    assert thread["id"].startswith("thread-")
    assert thread["ownerCharacterIds"] == ["char-marta"]
    assert thread["setupSceneId"] == "scene-1"
    assert thread["payoffSceneId"] is None
    assert thread["locked"] is False


def test_merge_drops_unresolvable_owner_but_keeps_resolved_ones():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc, "ep-1", promises(threads=[_thread(ownerNames=["Marta", "Ghost"])])
    )

    thread = result["seasons"][0]["episodes"][0]["threads"][0]
    assert thread["ownerCharacterIds"] == ["char-marta"]


def test_merge_drops_thread_with_unknown_setup_scene():
    doc = _doc()

    result = merge_narrative_promises(
        doc, "ep-1", promises(threads=[_thread(setupSceneId="scene-nope")])
    )

    assert result["seasons"][0]["episodes"][0]["threads"] == []


def test_merge_treats_unresolved_payoff_scene_as_still_open():
    doc = _doc()

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(threads=[_thread(status="paid_off", payoffSceneId="scene-nope")]),
    )

    thread = result["seasons"][0]["episodes"][0]["threads"][0]
    assert thread["payoffSceneId"] is None


def test_merge_replaces_episodes_prior_import_threads():
    doc = _doc(threads=[{"id": "thread-old", "label": "stale"}])

    result = merge_narrative_promises(doc, "ep-1", promises(threads=[]))

    assert result["seasons"][0]["episodes"][0]["threads"] == []


# ── scene motivations ───────────────────────────────────────────────────


def test_merge_patches_scene_motivations_when_character_resolves():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-1",
                    "motivations": [
                        {
                            "characterName": "Marta",
                            "objective": "Find the money.",
                            "stakes": "Trust.",
                            "obstacle": "Dan's charm.",
                            "statedObjective": "",
                            "concealed": False,
                        }
                    ],
                }
            ]
        ),
    )

    scene = result["seasons"][0]["episodes"][0]["scenes"][0]
    assert scene["motivations"] == [
        {
            "characterId": "char-marta",
            "objective": "Find the money.",
            "stakes": "Trust.",
            "obstacle": "Dan's charm.",
        }
    ]


def test_merge_keeps_prior_motivations_when_none_resolve():
    prior = [
        {
            "characterId": "char-marta",
            "objective": "old",
            "stakes": "old",
            "obstacle": "old",
        }
    ]
    doc = _doc(scenes=[{"id": "scene-1", "motivations": prior}])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-1",
                    "motivations": [
                        {
                            "characterName": "Ghost",
                            "objective": "x",
                            "stakes": "x",
                            "obstacle": "x",
                            "statedObjective": "",
                            "concealed": False,
                        }
                    ],
                }
            ]
        ),
    )

    scene = result["seasons"][0]["episodes"][0]["scenes"][0]
    assert scene["motivations"] == prior


def test_merge_ignores_motivations_for_unknown_scene():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-nope",
                    "motivations": [
                        {
                            "characterName": "Marta",
                            "objective": "x",
                            "stakes": "x",
                            "obstacle": "x",
                            "statedObjective": "",
                            "concealed": False,
                        }
                    ],
                }
            ]
        ),
    )

    scenes = result["seasons"][0]["episodes"][0]["scenes"]
    assert all(s["motivations"] == [] for s in scenes)


# ── world rules ──────────────────────────────────────────────────────────


def test_merge_appends_new_world_rule_with_structured_fields():
    doc = _doc()

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            world_rules=[
                _world_rule(
                    text="No one drinks alone on a debt night.",
                    limit="Only inside the bar.",
                    cost="Free drinks for the table.",
                    exception="Unless the sheriff is there.",
                )
            ]
        ),
    )

    rules = result["seriesBible"]["worldRules"]
    assert rules == [
        {
            "text": "No one drinks alone on a debt night.",
            "locked": False,
            "limit": "Only inside the bar.",
            "cost": "Free drinks for the table.",
            "exception": "Unless the sheriff is there.",
            "evidenceSceneId": "scene-1",
            "evidenceQuote": "quote",
        }
    ]


def test_merge_skips_world_rule_matching_existing_text_casefold():
    doc = _doc(world_rules=[{"text": "The Bar Is Neutral Ground.", "locked": False}])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(world_rules=[_world_rule(text="the bar is neutral ground.")]),
    )

    assert result["seriesBible"]["worldRules"] == [
        {"text": "The Bar Is Neutral Ground.", "locked": False}
    ]


def test_merge_never_duplicates_locked_world_rule_text():
    doc = _doc(
        world_rules=[{"text": "Debts are never spoken aloud.", "locked": True}]
    )

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(world_rules=[_world_rule(text="Debts are never spoken aloud.")]),
    )

    rules = result["seriesBible"]["worldRules"]
    assert rules == [{"text": "Debts are never spoken aloud.", "locked": True}]


def test_merge_drops_evidence_scene_id_for_unknown_scene():
    doc = _doc()

    result = merge_narrative_promises(
        doc, "ep-1", promises(world_rules=[_world_rule(evidenceSceneId="scene-nope")])
    )

    assert result["seriesBible"]["worldRules"][0]["evidenceSceneId"] is None
