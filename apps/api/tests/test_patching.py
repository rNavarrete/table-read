"""Unit tests for the RFC 6902 JSON Patch applier (storage/patching.py).

T1.1 supports the ops direct writer edits actually use (add / replace /
remove) with JSON Pointer resolution; unsupported ops are rejected loudly
rather than silently mishandled.
"""

import pytest

from storage.patching import PatchError, apply_json_patch

BASE = {
    "id": "proj-x",
    "title": "Old",
    "seasons": [{"episodes": [{"scenes": [{"whatHappens": "a"}, {"whatHappens": "b"}]}]}],
    "tags": ["one", "two"],
    "nested": {"a/b": "slashkey", "c~d": "tildekey"},
}


def test_replace_top_level_field():
    out = apply_json_patch(BASE, [{"op": "replace", "path": "/title", "value": "New"}])
    assert out["title"] == "New"


def test_replace_deeply_nested_field():
    patch = [{"op": "replace", "path": "/seasons/0/episodes/0/scenes/1/whatHappens", "value": "z"}]
    out = apply_json_patch(BASE, patch)
    assert out["seasons"][0]["episodes"][0]["scenes"][1]["whatHappens"] == "z"


def test_add_object_key():
    out = apply_json_patch(BASE, [{"op": "add", "path": "/subtitle", "value": "sub"}])
    assert out["subtitle"] == "sub"


def test_add_array_append_with_dash():
    out = apply_json_patch(BASE, [{"op": "add", "path": "/tags/-", "value": "three"}])
    assert out["tags"] == ["one", "two", "three"]


def test_add_array_at_index_inserts():
    out = apply_json_patch(BASE, [{"op": "add", "path": "/tags/1", "value": "mid"}])
    assert out["tags"] == ["one", "mid", "two"]


def test_remove_array_element():
    out = apply_json_patch(BASE, [{"op": "remove", "path": "/tags/0"}])
    assert out["tags"] == ["two"]


def test_remove_object_key():
    out = apply_json_patch(BASE, [{"op": "remove", "path": "/title"}])
    assert "title" not in out


def test_pointer_escaping_tilde_and_slash():
    out = apply_json_patch(BASE, [{"op": "replace", "path": "/nested/a~1b", "value": "S"}])
    assert out["nested"]["a/b"] == "S"
    out2 = apply_json_patch(BASE, [{"op": "replace", "path": "/nested/c~0d", "value": "T"}])
    assert out2["nested"]["c~d"] == "T"


def test_does_not_mutate_input():
    apply_json_patch(BASE, [{"op": "replace", "path": "/title", "value": "New"}])
    assert BASE["title"] == "Old"


def test_unsupported_op_rejected():
    with pytest.raises(PatchError):
        apply_json_patch(BASE, [{"op": "move", "from": "/title", "path": "/x"}])


def test_missing_value_rejected():
    with pytest.raises(PatchError):
        apply_json_patch(BASE, [{"op": "replace", "path": "/title"}])


def test_replace_missing_target_rejected():
    with pytest.raises(PatchError):
        apply_json_patch(BASE, [{"op": "replace", "path": "/nope", "value": 1}])


def test_root_path_rejected():
    with pytest.raises(PatchError):
        apply_json_patch(BASE, [{"op": "replace", "path": "", "value": {}}])


def test_bad_pointer_rejected():
    with pytest.raises(PatchError):
        apply_json_patch(BASE, [{"op": "replace", "path": "title", "value": 1}])
