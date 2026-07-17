#!/usr/bin/env python3
"""Generates config/tool_schemas/<op>.json -- the strict Anthropic tool
`input_schema` for every LLM operation (apps/api/llm/ops.py's OP_REGISTRY),
derived from the Zod §2a/§2 schemas in packages/contract (data contract §5;
prompt spec §8: "the canonical input_schema for every op is generated from
the Zod definitions ... with additionalProperties: false, explicit required
arrays, enums, and nullable fields").

Closes a T0.2 deferral (scripts/check_contract.py's docstring used to list
it): that task built the Zod<->Pydantic diff but explicitly deferred
"regenerating strict tool input_schemas from §2a and diffing against
config/tool_schemas/" because no LLM client/tool-calling code existed yet to
consume them. T1.2 adds that consumer (apps/api/llm/anthropic_client.py), so
this script and its check_contract.py wiring (`check_tool_schemas_match`) now
exist for real.

Run directly to (re)write the committed files after a contract change:
    python scripts/generate_tool_schemas.py

`scripts/check_contract.py` imports `build_tool_schemas()` from this module
and diffs its output against the committed files on every `make
check-contract` run -- that is the drift gate. This script's own subprocess
call to the Zod exporter intentionally duplicates
`check_contract.export_zod_schemas()` rather than importing it, so neither
script depends on the other (no circular import) and each stays runnable
standalone.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "apps" / "api"
TOOL_SCHEMAS_DIR = REPO_ROOT / "config" / "tool_schemas"

# JSON Schema keywords the Anthropic strict-tool-schema decoder does not
# support (see docs/tableread-prompt-spec.md §8 and the claude-api skill's
# "Structured Outputs > JSON Schema Limitations": no numeric bounds, no
# string-length bounds, no array-length bounds), plus the draft-URL key Zod
# adds for readability. `additionalProperties`, `required`, `enum`, `type`,
# `properties`, `items`, and `anyOf` all pass through unchanged.
#
# Zod `z.tuple([...])` emits draft-2020-12 `prefixItems`; Haiku/Sonnet
# strict tools reject that keyword with 400 invalid_request_error
# ("For 'array' type, property 'prefixItems' is not supported"). Collapse
# tuples to plain `items` here — Pydantic still enforces exact arity on
# `tool_use.input` (e.g. `between_names: tuple[str, str]`).
#
# Stripping these does not weaken validation end to end: Pydantic
# (apps/api/schemas.py) still enforces every one of these bounds on the
# `tool_use.input` the model returns, same as every other piece of LLM
# output (prompt spec §8: "schema conformance alone never implies
# acceptance").
_UNSUPPORTED_KEYS = frozenset(
    {"minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "$schema"}
)


def _unify_prefix_items(prefix: list[Any]) -> Any:
    """Collapse a Zod tuple's prefixItems into a single items schema."""
    first = prefix[0]
    if all(item == first for item in prefix[1:]):
        return first
    unique: list[Any] = []
    for item in prefix:
        if item not in unique:
            unique.append(item)
    if len(unique) == 1:
        return unique[0]
    return {"anyOf": unique}


def _strictify(node: Any) -> Any:
    if isinstance(node, list):
        return [_strictify(item) for item in node]
    if not isinstance(node, dict):
        return node
    out = {
        key: _strictify(value)
        for key, value in node.items()
        if key not in _UNSUPPORTED_KEYS
    }
    if "prefixItems" in out:
        prefix = out.pop("prefixItems")
        if not isinstance(prefix, list) or not prefix:
            raise ValueError("prefixItems must be a non-empty list after strictify")
        # `items: false` means "no additional items" beside the tuple slots.
        if out.get("items") is False:
            out.pop("items", None)
        out["items"] = _unify_prefix_items(prefix)
    return out


def _export_zod_schemas() -> dict[str, Any]:
    script = REPO_ROOT / "packages" / "contract" / "scripts" / "export-json-schema.ts"
    result = subprocess.run(["node", str(script)], cwd=REPO_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"generate_tool_schemas: failed to export Zod JSON Schema\n{result.stderr}"
        )
    return json.loads(result.stdout)


def _load_op_registry() -> dict[str, Any]:
    if str(API_DIR) not in sys.path:
        sys.path.insert(0, str(API_DIR))
    from llm.ops import OP_REGISTRY  # deliberate late import: sys.path just set up above

    return OP_REGISTRY


def build_tool_schemas() -> dict[str, dict[str, Any]]:
    """op name -> strict `input_schema`, freshly derived from the Zod contract."""
    op_registry = _load_op_registry()
    zod_schemas = _export_zod_schemas()
    return {op.name: _strictify(zod_schemas[op.schema_name]) for op in op_registry.values()}


def write_tool_schemas() -> dict[str, dict[str, Any]]:
    TOOL_SCHEMAS_DIR.mkdir(parents=True, exist_ok=True)
    schemas = build_tool_schemas()
    existing = {p.stem for p in TOOL_SCHEMAS_DIR.glob("*.json")}
    for op_name, schema in schemas.items():
        path = TOOL_SCHEMAS_DIR / f"{op_name}.json"
        path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    # Remove stale files for ops that no longer exist, so the directory never
    # silently accumulates orphans as OP_REGISTRY changes.
    for stale in existing - set(schemas):
        (TOOL_SCHEMAS_DIR / f"{stale}.json").unlink()
    return schemas


def main() -> int:
    schemas = write_tool_schemas()
    print(f"generate_tool_schemas: wrote {len(schemas)} files to {TOOL_SCHEMAS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
