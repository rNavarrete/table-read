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
# support (see docs/tableread-prompt-spec.md §8 and Anthropic structured-
# outputs docs: no numeric bounds, no string-length bounds, no array-length
# bounds except `minItems` of 0 or 1), plus the draft-URL key Zod adds for
# readability. `additionalProperties`, `required`, `enum`, `type`,
# `properties`, `items`, `anyOf`, and `minItems` ∈ {0, 1} pass through.
#
# Zod `z.tuple([...])` emits draft-2020-12 `prefixItems`; Haiku/Sonnet
# strict tools reject that keyword with 400 invalid_request_error
# ("For 'array' type, property 'prefixItems' is not supported"). Collapse
# tuples to plain `items` here and record the exact arity in `description`
# (Anthropic strips `minItems`/`maxItems` > 1). Pydantic still enforces
# exact arity on `tool_use.input` (e.g. `between_names: tuple[str, str]`).
#
# Stripping unsupported bounds does not weaken validation end to end:
# Pydantic (apps/api/schemas.py) still enforces them on the returned
# `tool_use.input` (prompt spec §8: "schema conformance alone never implies
# acceptance").
_ALWAYS_STRIP_KEYS = frozenset(
    {"minLength", "maxLength", "minimum", "maximum", "maxItems", "$schema"}
)


def _append_description(node: dict[str, Any], note: str) -> None:
    existing = node.get("description")
    if isinstance(existing, str) and existing.strip():
        if note in existing:
            return
        node["description"] = f"{existing.rstrip()} ({note})"
    else:
        node["description"] = note


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

    # Capture arity hints before stripping unsupported keys.
    min_items = node.get("minItems")
    max_items = node.get("maxItems")
    prefix_raw = node.get("prefixItems")

    out: dict[str, Any] = {}
    for key, value in node.items():
        if key in _ALWAYS_STRIP_KEYS:
            continue
        if key == "minItems":
            # Anthropic supports minItems of 0 or 1 only.
            if isinstance(value, int) and value in (0, 1):
                out[key] = value
            continue
        if key == "prefixItems":
            continue
        out[key] = _strictify(value)

    if isinstance(prefix_raw, list) and prefix_raw:
        # `items: false` means "no additional items" beside the tuple slots.
        if out.get("items") is False:
            out.pop("items", None)
        out["items"] = _unify_prefix_items([_strictify(item) for item in prefix_raw])
        _append_description(out, f"exactly {len(prefix_raw)} items")
    elif isinstance(min_items, int) and min_items > 1:
        if isinstance(max_items, int) and max_items == min_items:
            _append_description(out, f"exactly {min_items} items")
        else:
            _append_description(out, f"at least {min_items} items")
    elif isinstance(max_items, int) and max_items >= 0 and "minItems" not in out:
        _append_description(out, f"at most {max_items} items")

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


def render_tool_schema(schema: dict[str, Any]) -> str:
    """The exact bytes committed to config/tool_schemas/<op>.json.

    Property order is load-bearing and must follow the Zod declaration order,
    so this deliberately does NOT pass `sort_keys=True`.

    Anthropic strict tools compile `input_schema` into a decoding grammar that
    constrains the order keys may be emitted in. Alphabetizing `properties`
    reorders that grammar. For a discriminated union that is not cosmetic: it
    decides which branch the model is allowed to choose. `SegmentedSceneBeat`
    declares `kind` first but sorts to third (after `audienceFeels` and
    `audienceLearns`), while `SegmentedSceneUnassigned` sorts `kind` first —
    so a model emitting the discriminator first, which is the natural thing to
    do, could only ever produce `unassigned`. Every scene of every real import
    came back fully unassigned because of this, and no prompt change could fix
    it. Output is still deterministic: the Zod export is declaration-ordered.

    `check_tool_schemas_match` compares against this text byte for byte, and
    `check_discriminators_lead` enforces the discriminator-first invariant the
    Zod definitions currently satisfy.
    """
    return json.dumps(schema, indent=2) + "\n"


def discriminator_order_failures(schemas: dict[str, dict[str, Any]]) -> list[str]:
    """Union branches whose `const` discriminator is not their first property.

    Guards the grammar-ordering hazard described in `render_tool_schema` at the
    source rather than silently rewriting it — the Zod contract is authoritative
    (CLAUDE.md), so a branch that leads with something other than its
    discriminator is a contract bug to fix in `packages/contract`, not a
    serialization detail for this script to paper over.
    """
    failures: list[str] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, list):
            for i, item in enumerate(node):
                walk(item, f"{path}[{i}]")
            return
        if not isinstance(node, dict):
            return
        for branch in node.get("anyOf", []) or []:
            props = branch.get("properties") if isinstance(branch, dict) else None
            if not isinstance(props, dict) or not props:
                continue
            names = list(props)
            discriminators = [
                n for n in names if isinstance(props[n], dict) and "const" in props[n]
            ]
            if discriminators and discriminators[0] != names[0]:
                failures.append(
                    f"{path}: union branch lists {names[0]!r} before its discriminator "
                    f"{discriminators[0]!r}. Strict-tool grammars constrain key order, so the "
                    f"model cannot select this branch by emitting the discriminator first. "
                    f"Move {discriminators[0]!r} first in the Zod definition."
                )
        for key, value in node.items():
            walk(value, f"{path}.{key}")

    for op_name, schema in schemas.items():
        walk(schema, op_name)
    return failures


def write_tool_schemas() -> dict[str, dict[str, Any]]:
    TOOL_SCHEMAS_DIR.mkdir(parents=True, exist_ok=True)
    schemas = build_tool_schemas()
    existing = {p.stem for p in TOOL_SCHEMAS_DIR.glob("*.json")}
    for op_name, schema in schemas.items():
        path = TOOL_SCHEMAS_DIR / f"{op_name}.json"
        path.write_text(render_tool_schema(schema))
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
