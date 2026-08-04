"""OP_REGISTRY structural coverage (apps/api/llm/ops.py)."""

from llm.ops import OP_REGISTRY

EXPECTED_OPS = {
    "generate_beat_candidates": "writer",
    "tune_beat": "writer",
    "classify_blast_radius": "classifier",
    "regenerate_elements": "writer",
    "extract_ledger_facts": "classifier",
    "suggest_instructions": "classifier",
    "infer_act_breaks": "import_analyst",  # import story breakdown on Opus
    "infer_story_entities": "import_worker",  # bounded Sonnet extraction
    "infer_narrative_promises": "import_analyst",  # §5b
    "infer_story_overview": "import_analyst",  # §5c
    "infer_narrative_map": "writer",  # bounded post-import synthesis on Sonnet
    "infer_narrative_scene_analysis": "import_analyst",
    "infer_narrative_map_synthesis": "import_analyst",
    "verify_narrative_map": "writer",
    "segment_scene": "import_worker",  # high-volume Sonnet import work
    "scan_consistency": "classifier",
    "generate_scene_skeleton": "writer",  # §9.4 guided-setup scene skeleton
}


def test_registry_has_all_expected_ops_with_expected_roles():
    assert OP_REGISTRY.keys() == EXPECTED_OPS.keys()
    for name, role in EXPECTED_OPS.items():
        assert OP_REGISTRY[name].role == role


def test_every_op_name_matches_its_own_key():
    for name, op in OP_REGISTRY.items():
        assert op.name == name


def test_every_op_has_a_non_empty_description_and_a_pydantic_model():
    from pydantic import BaseModel

    for op in OP_REGISTRY.values():
        assert op.description
        assert isinstance(op.model, type) and issubclass(op.model, BaseModel)
