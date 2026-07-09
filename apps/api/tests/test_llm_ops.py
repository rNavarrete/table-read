"""OP_REGISTRY structural coverage (apps/api/llm/ops.py)."""

from llm.ops import OP_REGISTRY

EXPECTED_OPS = {
    "generate_beat_candidates": "writer",
    "tune_beat": "writer",
    "classify_blast_radius": "classifier",
    "regenerate_elements": "writer",
    "extract_ledger_facts": "classifier",
    "suggest_instructions": "classifier",
    "segment_scene": "classifier",  # T6.1 escalation: moved writer->classifier for temperature 0
    "scan_consistency": "classifier",
}


def test_registry_has_all_eight_ops_with_expected_roles():
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
