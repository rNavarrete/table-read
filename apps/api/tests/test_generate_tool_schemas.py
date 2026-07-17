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
    assert between == {"type": "array", "items": {"type": "string"}}


def test_infer_story_entities_tool_schema_has_no_prefix_items():
    schemas = generate_tool_schemas.build_tool_schemas()
    entity = schemas["infer_story_entities"]
    blob = str(entity)
    assert "prefixItems" not in blob
    between = entity["properties"]["relationships"]["items"]["properties"]["betweenNames"]
    assert between == {"type": "array", "items": {"type": "string"}}
