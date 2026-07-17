"""Strict tool-schema generation must stay inside Anthropic's supported subset."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = REPO_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import generate_tool_schemas  # noqa: E402


def test_strictify_collapses_homogeneous_prefix_items():
    schema = {
        "type": "object",
        "properties": {
            "betweenNames": {
                "type": "array",
                "prefixItems": [{"type": "string"}, {"type": "string"}],
                "minItems": 2,
                "maxItems": 2,
            }
        },
        "required": ["betweenNames"],
        "additionalProperties": False,
    }
    out = generate_tool_schemas._strictify(schema)
    between = out["properties"]["betweenNames"]
    assert "prefixItems" not in between
    assert between["type"] == "array"
    assert between["items"] == {"type": "string"}
    assert "prefixItems" not in between
    assert "minItems" not in between
    assert "exactly 2" in (between.get("description") or "")


def test_infer_story_entities_tool_schema_has_no_prefix_items():
    schemas = generate_tool_schemas.build_tool_schemas()
    entity = schemas["infer_story_entities"]
    blob = str(entity)
    assert "prefixItems" not in blob
    between = entity["properties"]["relationships"]["items"]["properties"]["betweenNames"]
    assert between["type"] == "array"
    assert between["items"] == {"type": "string"}
    assert "minItems" not in between
    assert "exactly 2" in (between.get("description") or "")


def test_strictify_preserves_min_items_one_for_evidence():
    """Anthropic allows minItems of 0 or 1; keep those so empty evidence
    arrays are rejected by constrained decoding, not only by Pydantic."""
    schema = {
        "type": "array",
        "minItems": 1,
        "items": {"type": "object"},
    }
    out = generate_tool_schemas._strictify(schema)
    assert out["minItems"] == 1


def test_strictify_strips_min_items_above_one_but_describes_arity():
    schema = {
        "type": "array",
        "prefixItems": [{"type": "string"}, {"type": "string"}],
        "minItems": 2,
        "maxItems": 2,
    }
    out = generate_tool_schemas._strictify(schema)
    assert "prefixItems" not in out
    assert "minItems" not in out
    assert "maxItems" not in out
    assert out["items"] == {"type": "string"}
    assert "exactly 2" in (out.get("description") or "")


def test_infer_story_entities_evidence_keeps_min_items_one():
    schemas = generate_tool_schemas.build_tool_schemas()
    entity = schemas["infer_story_entities"]
    evidence = entity["properties"]["characters"]["items"]["properties"]["evidence"]
    assert evidence.get("minItems") == 1
