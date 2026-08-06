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


# ── discriminated-union key order ───────────────────────────────────────────
#
# Anthropic strict tools compile `input_schema` into a decoding grammar that
# constrains the order keys may be emitted in. For a discriminated union that
# decides which branch the model can pick: alphabetizing `properties` pushed
# `kind` to third place in SegmentedSceneBeat while leaving it first in
# SegmentedSceneUnassigned, so a model emitting the discriminator first — the
# natural thing to do — could only ever produce `unassigned`. Every scene of
# every real import came back fully unassigned, with an empty beat layer, and
# no prompt change could move it.


def test_segment_scene_beat_branch_leads_with_its_discriminator():
    """The regression that emptied the beat layer of every import."""
    schema = generate_tool_schemas.build_tool_schemas()["segment_scene"]
    branches = schema["properties"]["segments"]["items"]["anyOf"]
    beat = next(b for b in branches if b["properties"]["kind"]["const"] == "beat")
    assert list(beat["properties"])[0] == "kind", (
        "`kind` must be emitted first or the model cannot select the beat branch"
    )


def test_rendered_schema_is_not_alphabetized():
    """`sort_keys=True` is what alphabetized the branches — keep it off."""
    schema = generate_tool_schemas.build_tool_schemas()["segment_scene"]
    text = generate_tool_schemas.render_tool_schema(schema)
    assert text.index('"kind"') < text.index('"audienceFeels"')


def test_discriminator_order_failures_flags_a_misordered_branch():
    bad = {
        "op": {
            "properties": {
                "segments": {
                    "items": {
                        "anyOf": [
                            {
                                "properties": {
                                    "audienceFeels": {"type": "string"},
                                    "kind": {"type": "string", "const": "beat"},
                                }
                            }
                        ]
                    }
                }
            }
        }
    }
    failures = generate_tool_schemas.discriminator_order_failures(bad)
    assert len(failures) == 1
    assert "'audienceFeels' before its discriminator 'kind'" in failures[0]


def test_committed_schemas_all_lead_with_their_discriminators():
    assert generate_tool_schemas.discriminator_order_failures(
        generate_tool_schemas.build_tool_schemas()
    ) == []
