"""Minimal RFC 6902 JSON Patch applier for direct writer edits.

`PATCH /projects/{pid}` takes a JSON-patch body (data contract §4). T1.1
supports the ops direct field edits actually use — `add`, `replace`,
`remove` — with full JSON Pointer resolution (§4 of RFC 6901, including the
`~1`/`~0` escapes and the `-` array-append token). Unsupported ops
(`move`/`copy`/`test`) are rejected with `PatchError` rather than silently
mishandled; a later task can widen support if a real edit path needs it.

Pure function: it deep-copies and never mutates its input, so the caller
owns when the result becomes the new document.
"""

from __future__ import annotations

import copy
from typing import Any

_SUPPORTED_OPS = {"add", "replace", "remove"}


class PatchError(ValueError):
    """A malformed or unsupported patch. Routes surface it as 400 VALIDATION."""


def apply_json_patch(doc: dict, patch: Any) -> dict:
    """Return a new document with `patch` (a list of RFC 6902 ops) applied."""
    if not isinstance(patch, list):
        raise PatchError("patch body must be a JSON array of operations")

    result = copy.deepcopy(doc)
    for op in patch:
        if not isinstance(op, dict):
            raise PatchError("each patch operation must be an object")
        name = op.get("op")
        if name not in _SUPPORTED_OPS:
            raise PatchError(f"unsupported patch op: {name!r}")
        path = op.get("path")
        if not isinstance(path, str):
            raise PatchError("patch operation missing string 'path'")
        if name in ("add", "replace") and "value" not in op:
            raise PatchError(f"{name} operation missing 'value'")
        _apply_one(result, _parse_pointer(path), name, op.get("value"))
    return result


def _parse_pointer(path: str) -> list[str]:
    if path == "":
        raise PatchError("cannot patch the document root")
    if not path.startswith("/"):
        raise PatchError(f"invalid JSON Pointer: {path!r}")
    # unescape ~1 -> "/" and ~0 -> "~" (order matters, per RFC 6901)
    return [token.replace("~1", "/").replace("~0", "~") for token in path[1:].split("/")]


def _apply_one(doc: Any, tokens: list[str], name: str, value: Any) -> None:
    parent = doc
    for token in tokens[:-1]:
        parent = _descend(parent, token)
    last = tokens[-1]

    if isinstance(parent, list):
        _apply_to_list(parent, last, name, value)
    elif isinstance(parent, dict):
        _apply_to_dict(parent, last, name, value)
    else:
        raise PatchError("cannot navigate into a non-container value")


def _descend(node: Any, token: str) -> Any:
    if isinstance(node, dict):
        if token not in node:
            raise PatchError(f"path references missing key: {token!r}")
        return node[token]
    if isinstance(node, list):
        return node[_list_index(node, token, allow_end=False)]
    raise PatchError("cannot navigate into a non-container value")


def _apply_to_dict(parent: dict, key: str, name: str, value: Any) -> None:
    if name == "remove":
        if key not in parent:
            raise PatchError(f"cannot remove missing key: {key!r}")
        del parent[key]
    elif name == "replace":
        if key not in parent:
            raise PatchError(f"cannot replace missing key: {key!r}")
        parent[key] = value
    else:  # add
        parent[key] = value


def _apply_to_list(parent: list, token: str, name: str, value: Any) -> None:
    if name == "add":
        index = _list_index(parent, token, allow_end=True)
        parent.insert(index, value)
    elif name == "replace":
        parent[_list_index(parent, token, allow_end=False)] = value
    else:  # remove
        del parent[_list_index(parent, token, allow_end=False)]


def _list_index(parent: list, token: str, *, allow_end: bool) -> int:
    if token == "-":
        if not allow_end:
            raise PatchError("the '-' array index is only valid for add")
        return len(parent)
    try:
        index = int(token)
    except ValueError:
        raise PatchError(f"invalid array index: {token!r}") from None
    upper = len(parent) if allow_end else len(parent) - 1
    if index < 0 or index > upper:
        raise PatchError(f"array index out of range: {token!r}")
    return index
