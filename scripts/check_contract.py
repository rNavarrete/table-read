#!/usr/bin/env python3
"""CI gate for the data contract (docs/tableread-data-contract.md §5).

Runs from the repo root (invoked by `make check-contract`):

1. Zod <-> Pydantic JSON Schema diff for every §1/§2/§2a type (data contract
   §5, test plan §2). The two libraries emit structurally-equivalent-but-not-
   byte-identical JSON Schema (Pydantic uses $defs/$ref + per-field "title";
   Zod inlines everything; Pydantic drops fields-with-defaults from
   "required" while Zod keeps them; Zod adds a JS-safe-integer "maximum" to
   unbounded ints; Pydantic doesn't emit "additionalProperties: false" under
   the §5-prescribed model_config). `normalize()` below cancels out exactly
   those known, accepted differences and nothing else, so a real divergence
   (renamed/added/removed field, changed type, changed enum values, changed
   required-ness, changed numeric bounds) still fails the diff.
2. Fixture validation: docs/tableread-fixture.json's full persisted-state
   envelope (project/ledger/snapshots/consistencyFlags/changeSets/
   suggestionHistory) parses against both the Zod and the Pydantic side.
3. Grep gate (test plan §2): no `z.object(`/`(BaseModel)` definitions for
   contract types outside packages/contract/src and apps/api/schemas.py.
4. LLM tool `input_schema` diff (closes a T0.2 deferral -- see that task's
   report): scripts/generate_tool_schemas.py regenerates every op's strict
   Anthropic tool `input_schema` in-memory from the same Zod source as (1)
   and diffs it against the committed config/tool_schemas/<op>.json files
   apps/api/llm/anthropic_client.py reads at runtime (T1.2). A tool-schema
   diff triggers the `make evals` requirement (CLAUDE.md hard rule 3).

Still deferred: OpenAPI snapshot (no API routes exist yet beyond /health);
prompt-template placeholder linter (no prompt templates exist yet).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTRACT_DIR = REPO_ROOT / "packages" / "contract"
API_DIR = REPO_ROOT / "apps" / "api"
SCRIPTS_DIR = REPO_ROOT / "scripts"
FIXTURE_PATH = REPO_ROOT / "docs" / "tableread-fixture.json"
TOOL_SCHEMAS_DIR = REPO_ROOT / "config" / "tool_schemas"

# data contract §5: "covering §1, §2, and the §2a LLM operation schemas."
# Storage-derived envelope types (Snapshot, SuggestionHistoryEntry,
# PersistedState) are deliberately excluded from the diff — see index.ts's
# and schemas.py's module headers.
SCHEMA_NAMES = [
    # §1
    "ShowFormat",
    "Character",
    "Relationship",
    "SeriesBible",
    "Motivation",
    "Beat",
    "Scene",
    "Episode",
    "Season",
    "SourceSpan",
    "LedgerFact",
    "Project",
    "ProjectSummary",
    "CharacterSeed",
    "ProjectFoundationInput",
    "ProjectCreateRequest",
    "ProjectImportCreateRequest",
    # §2
    "BeatCandidate",
    "ImpactedObject",
    "ConsistencyFlag",
    "ProjectImportResult",
    "ProjectImportProgressEvent",
    "BeatUpdate",
    "SceneUpdate",
    "SceneAddition",
    "InitialSceneSkeletonCandidate",
    "ChangeSetPreview",
    "ChangeSet",
    # §2a
    "BlastRadius",
    "RegeneratedElements",
    "ExtractedFact",
    "LedgerExtraction",
    "InstructionSuggestions",
    "SegmentedScene",
    "ConsistencyScan",
    "InitialSceneSkeleton",
]

# JSON Schema keys that are cosmetic/library-specific noise, not part of the
# validated contract shape. "discriminator" is Pydantic's OpenAPI-style
# annotation for `Field(discriminator=...)` unions (data contract §9.3
# ProjectImportProgressEvent) — Zod's `z.discriminatedUnion` JSON Schema has
# no equivalent key, only the plain `oneOf` both sides already agree on.
_IGNORED_KEYS = {
    "title",
    "$schema",
    "description",
    "$id",
    "additionalProperties",
    "discriminator",
}
# Zod's ".int()" without an explicit .max() emits this JS-safe-integer bound;
# Python ints have no such bound so Pydantic never emits it.
_JS_SAFE_INTEGER_MAX = 9007199254740991


def _dedefault_json(value: Any) -> str:
    """Canonical string form of a normalized node, for order-independent comparisons."""
    return json.dumps(value, sort_keys=True)


def normalize(node: Any, defs: dict[str, Any]) -> Any:
    """Reduce a JSON Schema node to the shape that's actually load-bearing
    for contract parity, resolving Pydantic's $ref/$defs and cancelling the
    known accepted Zod<->Pydantic representational differences documented in
    the module docstring."""
    if isinstance(node, list):
        return [normalize(item, defs) for item in node]
    if not isinstance(node, dict):
        return node

    if "$ref" in node:
        ref = node["$ref"]
        assert ref.startswith("#/$defs/"), f"unsupported $ref: {ref}"
        target = normalize(defs[ref.removeprefix("#/$defs/")], defs)
        if not isinstance(target, dict):
            return target
        # Pydantic puts field-level annotations (chiefly "default") as
        # siblings of "$ref" rather than merged into the $defs target —
        # carry them over so e.g. an enum field's default survives deref.
        merged = dict(target)
        for key, value in node.items():
            if key == "$ref" or key in _IGNORED_KEYS:
                continue
            merged[key] = value
        return merged

    out: dict[str, Any] = {}
    for key, value in node.items():
        if key in _IGNORED_KEYS or key == "$defs":
            continue
        if key in ("format", "pattern") and node.get("type") == "string":
            continue
        out[key] = value

    if out.get("type") == "integer" and out.get("maximum") == _JS_SAFE_INTEGER_MAX:
        del out["maximum"]

    if "prefixItems" in out:
        out.pop("minItems", None)
        out.pop("maxItems", None)
        out["prefixItems"] = normalize(out["prefixItems"], defs)

    if "items" in out:
        out["items"] = normalize(out["items"], defs)

    if "properties" in out:
        properties = {name: normalize(sub, defs) for name, sub in out["properties"].items()}
        out["properties"] = properties
        defaulted = {
            name for name, sub in properties.items() if isinstance(sub, dict) and "default" in sub
        }
        effective_required = sorted(set(out.get("required", [])) - defaulted)
        out["required"] = effective_required

    if "enum" in out:
        out["enum"] = sorted(out["enum"])

    for branch_key in ("anyOf", "oneOf"):
        if branch_key in out:
            branches = [normalize(b, defs) for b in out[branch_key]]
            out[branch_key] = sorted(branches, key=_dedefault_json)

    return out


def export_zod_schemas() -> dict[str, Any]:
    script = CONTRACT_DIR / "scripts" / "export-json-schema.ts"
    result = subprocess.run(
        ["node", str(script)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("check-contract: failed to export Zod JSON Schema", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def _load_schemas_module():
    if str(API_DIR) not in sys.path:
        sys.path.insert(0, str(API_DIR))
    import schemas  # deliberate late import: sys.path just set up above

    return schemas


def export_pydantic_schemas() -> dict[str, Any]:
    schemas_module = _load_schemas_module()

    output: dict[str, Any] = {}
    for name in SCHEMA_NAMES:
        model = getattr(schemas_module, name, None)
        if model is None:
            print(
                f"check-contract: no Pydantic model named {name!r} in apps/api/schemas.py",
                file=sys.stderr,
            )
            sys.exit(1)
        output[name] = model.model_json_schema(by_alias=True)
    return output


def diff_schemas() -> list[str]:
    zod_schemas = export_zod_schemas()
    pydantic_schemas = export_pydantic_schemas()

    failures: list[str] = []
    for name in SCHEMA_NAMES:
        if name not in zod_schemas:
            failures.append(f"{name}: missing from packages/contract/src/index.ts exports")
            continue
        if name not in pydantic_schemas:
            failures.append(f"{name}: missing from apps/api/schemas.py")
            continue

        zod_normalized = normalize(zod_schemas[name], {})
        pyd_schema = pydantic_schemas[name]
        pyd_normalized = normalize(pyd_schema, pyd_schema.get("$defs", {}))

        if zod_normalized != pyd_normalized:
            failures.append(
                f"{name}: Zod/Pydantic JSON Schema mismatch\n"
                f"  Zod:      {json.dumps(zod_normalized, sort_keys=True)}\n"
                f"  Pydantic: {json.dumps(pyd_normalized, sort_keys=True)}"
            )
    return failures


def check_fixture_validates() -> list[str]:
    failures: list[str] = []
    fixture = json.loads(FIXTURE_PATH.read_text())

    script = CONTRACT_DIR / "scripts" / "check-fixture.ts"
    result = subprocess.run(
        ["node", str(script)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        failures.append(
            f"fixture fails Zod validation (PersistedState):\n{result.stderr}{result.stdout}"
        )

    schemas_module = _load_schemas_module()

    try:
        schemas_module.PersistedState.model_validate(fixture)
    except Exception as exc:  # want the full pydantic ValidationError text, whatever it is
        failures.append(f"fixture fails Pydantic validation (PersistedState):\n{exc}")

    return failures


def check_no_stray_op_schemas() -> list[str]:
    """Test plan §2 grep gate: no z.object(...)/...(BaseModel) definitions for
    contract types outside packages/contract/src / apps/api/schemas.py."""
    failures: list[str] = []

    web_src = REPO_ROOT / "apps" / "web" / "src"
    if web_src.exists():
        result = subprocess.run(
            ["grep", "-rn", "-E", r"z\.object\(", str(web_src)],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            failures.append(
                "found z.object(...) definitions outside packages/contract/src "
                f"(op schemas must live only there):\n{result.stdout}"
            )

    api_py_files = [
        p for p in API_DIR.rglob("*.py") if p.name != "schemas.py" and ".venv" not in p.parts
    ]
    for path in api_py_files:
        result = subprocess.run(
            ["grep", "-n", "-E", r"\(BaseModel\)", str(path)],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            failures.append(
                "found a BaseModel definition outside apps/api/schemas.py "
                f"in {path}:\n{result.stdout}"
            )

    return failures


def _load_generate_tool_schemas_module():
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    import generate_tool_schemas  # deliberate late import: sys.path just set up above

    return generate_tool_schemas


def check_tool_schemas_match() -> list[str]:
    """LLM tool `input_schema` diff (closes a T0.2 deferral -- module
    docstring point 4): regenerates every op's strict Anthropic tool
    `input_schema` in-memory (scripts/generate_tool_schemas.py) and diffs it
    against the committed config/tool_schemas/<op>.json files
    apps/api/llm/anthropic_client.py reads at runtime."""
    failures: list[str] = []
    generate_tool_schemas = _load_generate_tool_schemas_module()
    current = generate_tool_schemas.build_tool_schemas()

    for op_name, schema in current.items():
        path = TOOL_SCHEMAS_DIR / f"{op_name}.json"
        if not path.exists():
            failures.append(
                f"tool schema for {op_name!r} missing at config/tool_schemas/{op_name}.json "
                "(run `python scripts/generate_tool_schemas.py`)"
            )
            continue
        on_disk = json.loads(path.read_text())
        if on_disk != schema:
            failures.append(
                f"{op_name}: tool input_schema drift (config/tool_schemas/{op_name}.json is "
                "stale -- run `python scripts/generate_tool_schemas.py`)\n"
                f"  generated: {json.dumps(schema, sort_keys=True)}\n"
                f"  on disk:   {json.dumps(on_disk, sort_keys=True)}"
            )

    if TOOL_SCHEMAS_DIR.exists():
        on_disk_names = {p.stem for p in TOOL_SCHEMAS_DIR.glob("*.json")}
        for extra in sorted(on_disk_names - set(current)):
            failures.append(
                f"config/tool_schemas/{extra}.json has no corresponding op in "
                "apps/api/llm/ops.py OP_REGISTRY"
            )

    return failures


def main() -> int:
    all_failures: list[str] = []
    all_failures += diff_schemas()
    all_failures += check_fixture_validates()
    all_failures += check_no_stray_op_schemas()
    all_failures += check_tool_schemas_match()

    if all_failures:
        print("check-contract: FAILED\n", file=sys.stderr)
        for failure in all_failures:
            print(f"- {failure}\n", file=sys.stderr)
        return 1

    print(
        f"check-contract: OK ({len(SCHEMA_NAMES)} schemas diffed, "
        "fixture validated on both sides, LLM tool schemas up to date)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
