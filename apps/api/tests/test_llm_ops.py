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
    "check_structure": "import_analyst",  # structure checklist
    "verify_structure_check": "writer",
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


def test_effort_is_explicit_where_a_5_5_default_would_change_behaviour():
    """Opus 5.5 changed what each effort level means (its `medium` default
    exceeds Opus 5 at `high`), and Haiku 5.5 thinks by default where Haiku 4.5
    did not. Every import_analyst op therefore names its effort, and every
    classifier op runs at `low`."""
    unset = [
        op.name
        for op in OP_REGISTRY.values()
        if op.role == "import_analyst" and op.effort is None
    ]
    classifier = {op.name: op.effort for op in OP_REGISTRY.values() if op.role == "classifier"}
    assert unset == []
    assert set(classifier.values()) == {"low"}, classifier
