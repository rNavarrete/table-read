"""Chunk + merge helpers for import-time `infer_story_entities`.

Large imports (~100+ scenes × early script lines) must not send one giant
classifier prompt. Chunk under a documented char budget, call per chunk,
merge name/alias-aware StoryEntities before bible fold.
"""

from __future__ import annotations

from fountain.entity_inference import (
    ENTITY_INFER_MAX_SCENES_PER_CHUNK,
    ENTITY_INFER_USER_CHAR_BUDGET,
    chunk_entity_scene_summaries,
    combine_story_entities,
)
from schemas import StoryEntities


def _summary(i: int, *, script_chars: int = 200) -> dict:
    return {
        "id": f"scene-{i}",
        "location": f"LOC {i}",
        "whatHappens": f"beat {i}",
        "scriptText": ("X" * script_chars),
    }


def _entities(**overrides) -> StoryEntities:
    return StoryEntities.model_validate(
        {
            "characters": [],
            "relationships": [],
            "worldElements": [],
            **overrides,
        }
    )


def test_budget_constant_is_documented_and_conservative():
    # A ~79k-character, 112-scene request hit the five-minute timeout. Keep
    # both bounds low enough that latency, not just context size, stays safe.
    assert ENTITY_INFER_USER_CHAR_BUDGET == 12_000
    assert ENTITY_INFER_MAX_SCENES_PER_CHUNK == 12


def test_small_script_is_single_chunk():
    summaries = [_summary(i, script_chars=50) for i in range(1, 4)]
    chunks = chunk_entity_scene_summaries(summaries, speaker_names=["MARTA"])
    assert len(chunks) == 1
    assert [s["id"] for s in chunks[0]] == ["scene-1", "scene-2", "scene-3"]


def test_oversized_import_splits_into_multiple_chunks():
    # Each scene ~9k chars of scriptText -> a few scenes exceed the budget.
    summaries = [_summary(i, script_chars=9_000) for i in range(1, 16)]
    chunks = chunk_entity_scene_summaries(summaries, speaker_names=["A", "B"])
    assert len(chunks) >= 2
    # Preserve order and cover every scene exactly once.
    flat = [s["id"] for chunk in chunks for s in chunk]
    assert flat == [f"scene-{i}" for i in range(1, 16)]
    # Each chunk's estimated user payload stays under budget (or is a single
    # oversized scene that cannot shrink further).
    for chunk in chunks:
        if len(chunk) == 1:
            continue
        from fountain.entity_inference import estimate_entity_user_chars

        assert (
            estimate_entity_user_chars(chunk, ["A", "B"])
            <= ENTITY_INFER_USER_CHAR_BUDGET
        )


def test_scene_count_limit_splits_small_payloads():
    summaries = [_summary(i, script_chars=10) for i in range(1, 70)]

    chunks = chunk_entity_scene_summaries(summaries, speaker_names=[])

    assert [len(chunk) for chunk in chunks] == [12, 12, 12, 12, 12, 9]


def test_combine_merges_characters_by_normalized_name_and_aliases():
    a = _entities(
        characters=[
            {
                "name": "Doc Brown",
                "aliases": ["Doc"],
                "role": "principal",
                "traits": "inventor",
                "evidence": [{"sceneId": "scene-1", "quote": "Doc?"}],
            }
        ]
    )
    b = _entities(
        characters=[
            {
                "name": "DOC",
                "aliases": ["Emmett"],
                "role": "principal",
                "traits": "",
                "evidence": [{"sceneId": "scene-2", "quote": "Emmett!"}],
            },
            {
                "name": "Marty",
                "aliases": [],
                "role": "principal",
                "traits": "kid",
                "evidence": [{"sceneId": "scene-2", "quote": "Marty"}],
            },
        ]
    )
    combined = combine_story_entities([a, b])
    by_name = {c.name: c for c in combined.characters}
    assert set(by_name) == {"Doc Brown", "Marty"}
    assert set(by_name["Doc Brown"].aliases) == {"Doc", "Emmett"}
    assert len(by_name["Doc Brown"].evidence) == 2


def test_combine_dedupes_relationships_and_world_elements():
    a = _entities(
        relationships=[
            {
                "betweenNames": ["Doc", "Marty"],
                "label": "mentor",
                "reallyLike": "",
                "evidence": [{"sceneId": "scene-1", "quote": "q1"}],
            }
        ],
        worldElements=[
            {
                "kind": "location",
                "name": "Lab",
                "note": "cluttered",
                "evidence": [{"sceneId": "scene-1", "quote": "INT. LAB"}],
            }
        ],
    )
    b = _entities(
        relationships=[
            {
                "betweenNames": ["Marty", "Doc"],
                "label": "Mentor",
                "reallyLike": "father figure",
                "evidence": [{"sceneId": "scene-2", "quote": "q2"}],
            }
        ],
        worldElements=[
            {
                "kind": "location",
                "name": "lab",
                "note": "cluttered",
                "evidence": [{"sceneId": "scene-2", "quote": "the lab"}],
            },
            {
                "kind": "object",
                "name": "DeLorean",
                "note": "time machine",
                "evidence": [{"sceneId": "scene-2", "quote": "car"}],
            },
        ],
    )
    combined = combine_story_entities([a, b])
    assert len(combined.relationships) == 1
    rel = combined.relationships[0]
    assert rel.really_like == "father figure"  # non-empty wins
    assert len(rel.evidence) == 2
    assert len(combined.world_elements) == 2
    names = {(e.kind, e.name.casefold()) for e in combined.world_elements}
    assert names == {("location", "lab"), ("object", "delorean")}


def test_combine_empty_list_is_empty_entities():
    combined = combine_story_entities([])
    assert combined.characters == []
    assert combined.relationships == []
    assert combined.world_elements == []
