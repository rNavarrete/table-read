"""Candidate generation: context bundle assembly + streaming contract
(prompt spec §1/§8a, data contract §4, test plan lines 20/23/24).

All against MockLlmClient / crafted fragment streams — never the network.
"""

from __future__ import annotations

import copy
import json

import pytest

from drama_manager import candidates
from drama_manager.candidates import (
    approx_token_count,
    build_candidate_bundle,
    extract_script_text_prefix,
    generate_candidate_events,
)
from llm.mock import MockLlmClient
from schemas import BeatCandidate
from storage.seed import load_fixture


def _doc() -> dict:
    return copy.deepcopy(load_fixture()["project"])


def _ledger() -> list[dict]:
    return copy.deepcopy(load_fixture()["ledger"])


def _cand(label: str, script: str = "MARTA\nYou tell me.") -> BeatCandidate:
    return BeatCandidate(
        label=label,
        beatPlan={"whatHappens": "w", "audienceLearns": "l", "audienceFeels": "f"},
        scriptText=script,
        continuityConflicts=[],
    )


def _events(mock: MockLlmClient, **over) -> list[tuple[str, dict]]:
    kwargs = dict(scene_id="scene-3", after_beat_id="beat-3-1", instruction="")
    kwargs.update(over)
    return list(generate_candidate_events(mock, _doc(), _ledger(), **kwargs))


# ── token counting ──────────────────────────────────────────────────────────────


def test_approx_token_count_is_ceil_quarter():
    assert approx_token_count("") == 0
    assert approx_token_count("abcd") == 1
    assert approx_token_count("abcde") == 2  # ceil(5/4)


# ── context bundle snapshot (test plan line 20) ─────────────────────────────────


def test_bundle_scene3_snapshot():
    system, user = build_candidate_bundle(
        _doc(), _ledger(), scene_id="scene-3", after_beat_id="beat-3-1",
        instruction="", avoid=[], nonce="a91f",
    )
    # eligible facts present, pending_review excluded
    assert "fact-02" in user and "fact-03" in user and "fact-04" in user and "fact-08" in user
    assert "fact-06" not in user
    # only in-scene characters (scene-3 = Marta + Dan) — check distinctive sheet
    # content, since character *names* also appear in the premise text
    assert "Chicago firm" in user  # Marta's hiding
    assert "Aldan brothers" in user  # Dan's hiding
    assert "soda water" not in user  # Reyes absent
    assert "soup and silence" not in user  # Luz absent
    # scene-3 has no locked beats
    assert "beat-1-2" not in user
    # token budget
    assert approx_token_count(user) <= 6000
    # system carries the boundary nonce
    assert "a91f" in system


def test_bundle_all_freeform_fields_wrapped_in_source_data():
    system, user = build_candidate_bundle(
        _doc(), _ledger(), scene_id="scene-3", after_beat_id="beat-3-1",
        instruction="", avoid=[], nonce="a91f",
    )
    for kind in (
        "series", "characters", "episode", "scene_plan",
        "continuity_facts", "locked_beats", "script", "next_beat_plan",
    ):
        assert f'<source_data_a91f kind="{kind}">' in user


def test_bundle_scene1_includes_locked_beat_scripttext_as_constraint():
    # test plan line 20: locked beat-1-2 scriptText present as constraint.
    _, user = build_candidate_bundle(
        _doc(), _ledger(), scene_id="scene-1", after_beat_id="beat-1-1",
        instruction="", avoid=[], nonce="a91f",
    )
    assert '<source_data_a91f kind="locked_beats">' in user
    assert "OUTGOING TRANSFER" in user  # beat-1-2's locked script text


def test_bundle_scene2_has_dan_only():
    _, user = build_candidate_bundle(
        _doc(), _ledger(), scene_id="scene-2", after_beat_id=None,
        instruction="", avoid=[], nonce="a91f",
    )
    assert "Aldan brothers" in user  # Dan's sheet present
    assert "Chicago firm" not in user  # Marta's sheet absent


def test_bundle_writer_instruction_outside_tags():
    _, user = build_candidate_bundle(
        _doc(), _ledger(), scene_id="scene-3", after_beat_id="beat-3-1",
        instruction="make it colder", avoid=[], nonce="a91f",
    )
    assert "WRITER INSTRUCTION (may be empty): make it colder" in user


# ── incremental scriptText extraction (§8a) ─────────────────────────────────────


def test_extractor_none_before_scripttext_opens():
    assert extract_script_text_prefix('{"label":"x"') is None
    assert extract_script_text_prefix('{"scriptText"') is None  # key seen, value not open
    assert extract_script_text_prefix('{"scriptText":  ') is None


def test_extractor_grows_and_stops_at_close():
    assert extract_script_text_prefix('{"scriptText":"hel') == "hel"
    assert extract_script_text_prefix('{"scriptText":"hello","x":1}') == "hello"


def test_extractor_defers_mid_escape():
    # trailing backslash = mid-escape cut → stop before it
    assert extract_script_text_prefix('{"scriptText":"line1\\') == "line1"
    assert extract_script_text_prefix('{"scriptText":"line1\\n') == "line1\n"


def test_extractor_decodes_common_escapes():
    assert extract_script_text_prefix('{"scriptText":"a\\tb\\"c"') == 'a\tb"c'


def test_extractor_combines_surrogate_pair():
    assert extract_script_text_prefix('{"scriptText":"hi \\ud83d\\ude00"') == "hi \U0001f600"


def test_extractor_defers_lone_high_surrogate():
    # high surrogate present but low half not yet arrived → stop before it
    assert extract_script_text_prefix('{"scriptText":"hi \\ud83d') == "hi "


# ── streaming contract (test plan lines 23/24) ──────────────────────────────────


def test_three_candidate_done_with_distinct_valid_candidates():
    mock = MockLlmClient()
    mock.set_responses(
        "generate_beat_candidates",
        [_cand("Quiet reveal"), _cand("Deflected ambush"), _cand("Power shift")],
    )
    events = _events(mock)

    starts = [d["index"] for n, d in events if n == candidates.CANDIDATE_START]
    dones = [d for n, d in events if n == candidates.CANDIDATE_DONE]
    assert starts == [0, 1, 2]
    assert events[-1][0] == candidates.DONE
    assert [c["label"] for c in dones] == ["Quiet reveal", "Deflected ambush", "Power shift"]
    for wire in dones:  # each is a schema-valid BeatCandidate
        BeatCandidate.model_validate(wire)


def _missing_scripttext_json() -> str:
    """Valid JSON that fails BeatCandidate validation (no scriptText) — the
    rule-9 retryable case: a schema-invalid slot consumes TWO streamed calls
    (initial attempt + its one retry)."""
    return json.dumps(
        {
            "label": "x",
            "beatPlan": {"whatHappens": "w", "audienceLearns": "l", "audienceFeels": "f"},
            "continuityConflicts": [],
        }
    )


def test_invalid_candidate_emits_failed_not_partial():
    mock = MockLlmClient()
    missing = _missing_scripttext_json()
    # slot 0: valid; slot 1: invalid attempt + invalid rule-9 retry; slot 2: valid
    mock.set_candidate_streams([
        [_cand("Good one").model_dump_json(by_alias=True)],
        [missing],
        [missing],
        [_cand("Third").model_dump_json(by_alias=True)],
    ])
    events = _events(mock)

    names = [n for n, _ in events]
    assert names.count(candidates.CANDIDATE_DONE) == 2
    failed = [d for n, d in events if n == candidates.CANDIDATE_FAILED]
    assert len(failed) == 1
    assert failed[0]["error"]["code"] == "SCHEMA_INVALID_LLM"
    # the failed candidate (index 1) produced no candidate_done between its
    # start and the next start
    start_idxs = [i for i, (n, _) in enumerate(events) if n == candidates.CANDIDATE_START]
    between = events[start_idxs[1] : start_idxs[2]]
    assert candidates.CANDIDATE_DONE not in [n for n, _ in between]


def test_stream_without_scripttext_fails():
    mock = MockLlmClient()
    missing = _missing_scripttext_json()
    # two streams per slot: the initial attempt plus its rule-9 retry
    mock.set_candidate_streams([[missing]] * 6)
    events = _events(mock)
    assert [n for n, _ in events].count(candidates.CANDIDATE_FAILED) == 3
    assert [n for n, _ in events].count(candidates.CANDIDATE_DONE) == 0


def test_fragmented_input_yields_clean_deltas_and_authoritative_done():
    mock = MockLlmClient()
    candidate = _cand("Split", script="line1\nline2")
    full = candidate.model_dump_json(by_alias=True)
    # split mid-escape: between the backslash and the 'n' of the \n in scriptText
    idx = full.index("\\n")
    frag1, frag2 = full[: idx + 1], full[idx + 1 :]
    mock.set_candidate_streams([[frag1, frag2]])

    events = generate_candidate_events(
        mock, _doc(), _ledger(), scene_id="scene-3", after_beat_id="beat-3-1",
        instruction="", count=1,
    )
    events = list(events)

    deltas = [d["text"] for n, d in events if n == candidates.DELTA]
    assert "".join(deltas) == "line1\nline2"  # clean unescaped display text
    # no raw JSON fragment ever reaches the client
    for text in deltas:
        assert "{" not in text and '"scriptText"' not in text and "\\n" not in text
    done = [d for n, d in events if n == candidates.CANDIDATE_DONE]
    assert len(done) == 1
    assert done[0]["scriptText"] == "line1\nline2"  # authoritative value


def test_out_of_order_fields_still_finalize():
    # scriptText appears after continuityConflicts — extractor scans whole buffer
    mock = MockLlmClient()
    reordered = json.dumps(
        {
            "continuityConflicts": [],
            "scriptText": "late field",
            "label": "Late",
            "beatPlan": {"whatHappens": "w", "audienceLearns": "l", "audienceFeels": "f"},
        }
    )
    mock.set_candidate_streams([[reordered]])
    events = list(
        generate_candidate_events(
            mock, _doc(), _ledger(), scene_id="scene-3", after_beat_id="beat-3-1",
            instruction="", count=1,
        )
    )
    done = [d for n, d in events if n == candidates.CANDIDATE_DONE]
    assert done and done[0]["scriptText"] == "late field"


# ── rule-9 streaming retry (data contract §4: SCHEMA_INVALID_LLM "after retry") ─


class _ScriptedLlm(MockLlmClient):
    """Yields scripted fragment streams in order, recording each call's
    user_message. Exhausting the script raises IndexError — which loudly fails
    any test where a third call is attempted (rule 9: never more than two)."""

    def __init__(self, streams: list[list[str]]) -> None:
        super().__init__()
        self._streams = [list(s) for s in streams]
        self.user_messages: list[str] = []

    def stream_beat_candidate(self, *, system, user_message, prompt_version):
        self.user_messages.append(user_message)
        yield from self._streams.pop(0)


def _one_slot_events(mock) -> list[tuple[str, dict]]:
    return list(
        generate_candidate_events(
            mock, _doc(), _ledger(), scene_id="scene-3", after_beat_id="beat-3-1",
            instruction="", count=1,
        )
    )


def test_schema_invalid_stream_retries_once_then_succeeds():
    # attempt 1: valid JSON, schema-invalid (label > 40 chars); retry: valid.
    bad = json.dumps(
        {
            "label": "x" * 41,
            "beatPlan": {"whatHappens": "w", "audienceLearns": "l", "audienceFeels": "f"},
            "scriptText": "bad attempt",
            "continuityConflicts": [],
        }
    )
    good = _cand("Fixed", script="good attempt").model_dump_json(by_alias=True)
    mock = _ScriptedLlm([[bad], [good]])
    events = _one_slot_events(mock)

    # exactly two calls; the retry prompt carries the rule-9 error note
    assert len(mock.user_messages) == 2
    assert "did not call the 'generate_beat_candidates' tool" in mock.user_messages[1]
    assert "with valid input" in mock.user_messages[1]
    assert mock.user_messages[1].startswith(mock.user_messages[0])  # original bundle kept

    # retry deltas restart the scriptText prefix (documented choice); the
    # authoritative candidate_done carries the retry's value
    deltas = [d["text"] for n, d in events if n == candidates.DELTA]
    assert "".join(deltas) == "bad attempt" + "good attempt"
    done = [d for n, d in events if n == candidates.CANDIDATE_DONE]
    assert len(done) == 1
    assert done[0]["scriptText"] == "good attempt"
    assert done[0]["label"] == "Fixed"
    assert not [d for n, d in events if n == candidates.CANDIDATE_FAILED]


def test_schema_invalid_stream_retry_fails_after_exactly_two_calls():
    bad = _missing_scripttext_json()
    mock = _ScriptedLlm([[bad], [bad]])  # a third call would IndexError
    events = _one_slot_events(mock)

    assert len(mock.user_messages) == 2  # exactly one retry, never a third
    failed = [d for n, d in events if n == candidates.CANDIDATE_FAILED]
    assert len(failed) == 1
    assert failed[0]["error"]["code"] == "SCHEMA_INVALID_LLM"
    assert not [d for n, d in events if n == candidates.CANDIDATE_DONE]


def test_unparseable_json_aborts_without_retry():
    # §8a: parser cannot resync → abort the candidate, no rule-9 retry.
    mock = _ScriptedLlm([['{"scriptText":"x" garbage}}']])  # one stream only
    events = _one_slot_events(mock)

    assert len(mock.user_messages) == 1  # no retry call made
    failed = [d for n, d in events if n == candidates.CANDIDATE_FAILED]
    assert len(failed) == 1
    assert failed[0]["error"]["code"] == "SCHEMA_INVALID_LLM"


# ── diversity mechanic: prior candidates flow into AVOID ────────────────────────


class _RecordingLlm(MockLlmClient):
    """Records each streamed call's user_message and yields a distinct card."""

    def __init__(self, labels: list[str]) -> None:
        super().__init__()
        self._labels = list(labels)
        self.user_messages: list[str] = []

    def stream_beat_candidate(self, *, system, user_message, prompt_version):
        self.user_messages.append(user_message)
        yield _cand(self._labels.pop(0)).model_dump_json(by_alias=True)


def test_second_call_prompt_contains_prior_candidate_labels_in_avoid():
    mock = _RecordingLlm(["Quiet reveal", "Deflected ambush", "Power shift"])
    _events(mock)
    assert len(mock.user_messages) == 3
    # first call has an empty AVOID; later calls accumulate prior labels
    assert "AVOID (prior candidates this round): \n" in mock.user_messages[0] or \
        mock.user_messages[0].rstrip().endswith("AVOID (prior candidates this round):")
    assert "Quiet reveal" in mock.user_messages[1]
    assert "Quiet reveal" in mock.user_messages[2] and "Deflected ambush" in mock.user_messages[2]


# ── bad target ids ──────────────────────────────────────────────────────────────


def test_validate_target_raises_for_bad_ids():
    with pytest.raises(candidates.SceneNotFound):
        candidates.validate_target(_doc(), "scene-999", None)
    with pytest.raises(candidates.BeatNotFound):
        candidates.validate_target(_doc(), "scene-3", "beat-nope")
