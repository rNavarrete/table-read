"""Write-mode candidate generation (prompt spec §1, data contract §4 SSE).

Product logic, not transport: this module *selects* the context bundle pieces
(in-scene characters, prompt-eligible facts, locked-beat constraints, previous
script, landing beat) and drives the 3-call diversity loop, but every freeform
value it emits into a prompt goes through `drama_manager/render.py` (the §8b
choke point). It is read-only w.r.t. the project doc — generation persists
nothing until Accept (T2.2, data contract §4).

Streaming contract (§8a): the injected `LlmClient` yields **raw tool-input JSON
fragments** (`input_json_delta` chunks — not guaranteed valid/complete JSON at
any intermediate point). This module feeds them into an incremental parser that
watches for `scriptText`, forwarding only *unescaped, display-ready* delta text
to the client. On `content_block_stop` (stream end) it parses and validates the
**complete** accumulated tool input; a valid parse emits `candidate_done`
(authoritative), a failure emits `candidate_failed` — never a partial card.
Raw JSON fragments never reach the client.

No writer text is logged here (hard rule 5): only ids/counts/PROMPT_VERSION.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterable, Iterator

import anthropic
from pydantic import ValidationError

from drama_manager import ledger_filter, locks, render
from drama_manager.ledger_filter import RelevanceContext
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import BeatCandidate

_logger = logging.getLogger("drama_manager.candidates")

CANDIDATE_COUNT = 3
TOKEN_BUDGET = 6000
_LLM_UNAVAILABLE = "LLM_UNAVAILABLE"  # data contract §4 (route/stream-layer mapping)

CRAFT_COUNTS = {"fast": 1, "standard": 3, "considered": 3}

# Event names (data contract §4 SSE stream).
CANDIDATE_START = "candidate_start"
DELTA = "delta"
CANDIDATE_DONE = "candidate_done"
CANDIDATE_FAILED = "candidate_failed"
DONE = "done"

Event = tuple[str, dict]


class SceneNotFound(LookupError):
    """Raised when a scene id is not present in the project doc."""


class BeatNotFound(LookupError):
    """Raised when `afterBeatId` is not a beat of the target scene."""


# ── token counting ────────────────────────────────────────────────────────────


def approx_token_count(text: str) -> int:
    """Deterministic, offline token approximation: ~4 chars/token (ceil).

    Prompt spec §1 targets < 6k tokens but pins no counting method; this is a
    documented deterministic approximation (obligation 7). It is NOT the
    Anthropic tokenizer — real counts differ — so treat the ≤6k assertion as a
    guard rail with margin, not an exact budget. Flagged as a concern in the
    task report."""
    return -(-len(text) // 4)  # ceil division


# ── context selection ──────────────────────────────────────────────────────────


def _locate_scene(doc: dict, scene_id: str) -> tuple[dict, dict]:
    for season in doc.get("seasons", []):
        for episode in season.get("episodes", []):
            for scene in episode.get("scenes", []):
                if scene["id"] == scene_id:
                    return episode, scene
    raise SceneNotFound(scene_id)


def validate_target(doc: dict, scene_id: str, after_beat_id: str | None) -> None:
    """Validate the generation target up front so bad ids surface as HTTP
    errors *before* the SSE stream (and its 200 headers) begins. Raises
    `SceneNotFound` / `BeatNotFound`."""
    _, scene = _locate_scene(doc, scene_id)
    if after_beat_id is not None and not any(
        b["id"] == after_beat_id for b in scene.get("beats", [])
    ):
        raise BeatNotFound(after_beat_id)


def _characters_in_scene(scene: dict) -> list[str]:
    """In-scene character ids, from the scene's motivations (deterministic,
    order-preserving, deduplicated). Matches the test-plan expectation that a
    scene with only Dan's motivation yields Dan-only character sheets."""
    seen: list[str] = []
    for motivation in scene.get("motivations", []):
        cid = motivation.get("characterId")
        if cid and cid not in seen:
            seen.append(cid)
    return seen


def _character_sheets(doc: dict, character_ids: list[str]) -> list[dict]:
    by_id = {c["id"]: c for c in doc.get("seriesBible", {}).get("characters", [])}
    sheets = []
    for cid in character_ids:
        c = by_id.get(cid)
        if c is None:
            continue
        sheets.append(
            {
                "name": c.get("name", ""),
                "presentation": c.get("presentation", ""),
                "hiding": c.get("hiding", ""),
                "traits": c.get("traits", ""),
            }
        )
    return sheets


def _scene_plan(scene: dict, character_names: dict[str, str]) -> dict:
    return {
        "n": scene.get("index", 0) + 1,
        "location": scene.get("location", ""),
        "time": scene.get("time", ""),
        "whatHappens": scene.get("whatHappens", ""),
        "audienceLearns": scene.get("audienceLearns", ""),
        "audienceFeels": scene.get("audienceFeels", ""),
        "motivations": [
            {
                "character": character_names.get(m.get("characterId"), m.get("characterId", "")),
                "objective": m.get("objective", ""),
                "stakes": m.get("stakes", ""),
                "obstacle": m.get("obstacle", ""),
            }
            for m in scene.get("motivations", [])
        ],
    }


def _fact_summary(fact: dict) -> dict:
    return {
        "id": fact.get("id"),
        "fact": fact.get("fact", ""),
        "knownBy": fact.get("knownBy", []),
        "audienceKnows": fact.get("audienceKnows", True),
    }


def _beat_plan(beat: dict) -> dict:
    return {
        "whatHappens": beat.get("whatHappens", ""),
        "audienceLearns": beat.get("audienceLearns", ""),
        "audienceFeels": beat.get("audienceFeels", ""),
    }


def _previous_and_next(scene: dict, after_beat_id: str | None) -> tuple[str, dict | None]:
    """Previous script (last ~2 beats up to and including `after_beat_id`) and
    the landing beat plan (the beat immediately after the insertion point).

    `after_beat_id` None = insert at the top of the scene: no previous script,
    next beat is the scene's first beat. Kept within-scene for MVP (cross-scene
    prior context is a later refinement — flagged in the report)."""
    beats = scene.get("beats", [])
    if after_beat_id is None:
        next_plan = _beat_plan(beats[0]) if beats else None
        return "", next_plan

    index = next((i for i, b in enumerate(beats) if b["id"] == after_beat_id), None)
    if index is None:
        raise BeatNotFound(after_beat_id)
    previous = beats[max(0, index - 1) : index + 1]
    previous_script = "\n\n".join(b.get("scriptText", "") for b in previous if b.get("scriptText"))
    next_plan = _beat_plan(beats[index + 1]) if index + 1 < len(beats) else None
    return previous_script, next_plan


def _scene_context(
    doc: dict, ledger: list[dict], *, scene_id: str, after_beat_id: str | None
) -> dict:
    """Select the §1 context-bundle pieces for `scene_id` (shared by the §1
    candidate and §2 tune builders): series/theme, in-scene character sheets,
    episode premise, scene plan, prompt-eligible facts, locked-beat constraints,
    previous script, and the landing beat plan. Raises `SceneNotFound` /
    `BeatNotFound`. Read-only; touches no storage."""
    episode, scene = _locate_scene(doc, scene_id)
    character_ids = _characters_in_scene(scene)
    names = {c["id"]: c.get("name", "") for c in doc.get("seriesBible", {}).get("characters", [])}

    context = RelevanceContext(scene_id=scene_id, characters_in_scene=frozenset(character_ids))
    facts = [_fact_summary(f) for f in ledger_filter.eligible_facts(ledger, context)]

    previous_script, next_beat_plan = _previous_and_next(scene, after_beat_id)

    bible = doc.get("seriesBible", {})
    return {
        "series": {
            "premise": doc.get("premise", ""),
            "theme": bible.get("existentialQuestion", {}).get("text", ""),
        },
        "characters": _character_sheets(doc, character_ids),
        "episode": {"premise": episode.get("premise", "")},
        "scene_plan": _scene_plan(scene, names),
        "continuity_facts": facts,
        "locked_beats": locks.locked_beats_in_scene(doc, scene_id),
        "previous_script": previous_script,
        "next_beat_plan": next_beat_plan,
    }


def build_candidate_bundle(
    doc: dict,
    ledger: list[dict],
    *,
    scene_id: str,
    after_beat_id: str | None,
    instruction: str,
    avoid: list[dict],
    nonce: str,
) -> tuple[str, str]:
    """Assemble the §1 candidate context bundle for `scene_id`, returning the
    rendered `(system, user)` pair. Raises `SceneNotFound` / `BeatNotFound`
    for bad ids. Read-only; touches no storage."""
    ctx = _scene_context(doc, ledger, scene_id=scene_id, after_beat_id=after_beat_id)
    return render.build_candidate_prompt(
        doc, **ctx, instruction=instruction, avoid=avoid, nonce=nonce
    )


def build_tune_bundle(
    doc: dict,
    ledger: list[dict],
    *,
    scene_id: str,
    current_candidate: dict,
    instruction: str,
    nonce: str,
) -> tuple[str, str]:
    """Assemble the §2 tune context bundle: the §1 scene context plus the
    CURRENT CANDIDATE being revised and the TUNE INSTRUCTION. The tune request
    (data contract §4) carries no insertion point, so the scene context is
    built as top-of-scene (`after_beat_id=None`); the candidate itself is the
    focus. Raises `SceneNotFound`. Read-only; touches no storage."""
    ctx = _scene_context(doc, ledger, scene_id=scene_id, after_beat_id=None)
    return render.build_tune_prompt(
        doc, **ctx, current_candidate=current_candidate, instruction=instruction, nonce=nonce
    )


# ── incremental scriptText extraction (§8a) ─────────────────────────────────────

_KEY = '"scriptText"'
_SIMPLE_ESCAPES = {
    '"': '"', "\\": "\\", "/": "/", "n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f",
}


def extract_script_text_prefix(buffer: str) -> str | None:
    """Given a prefix of the tool-input JSON, return the safely-decoded
    (unescaped) value of `scriptText` known so far, or None if the value has
    not yet started opening.

    Never returns a value past a truncation point: a fragment split mid-escape
    or mid-surrogate-pair stops before the incomplete sequence, so the returned
    string is always a valid, encodable prefix (no lone surrogates). The caller
    diffs successive prefixes to produce clean `delta` events; the final
    authoritative value comes from validating the complete buffer, so a
    conservatively-short prefix here only defers display, never corrupts it."""
    ki = buffer.find(_KEY)
    if ki == -1:
        return None
    i = ki + len(_KEY)
    n = len(buffer)
    while i < n and buffer[i] in " \t\r\n":
        i += 1
    if i >= n or buffer[i] != ":":
        return None
    i += 1
    while i < n and buffer[i] in " \t\r\n":
        i += 1
    if i >= n or buffer[i] != '"':
        return None
    i += 1  # first content char

    out: list[str] = []
    while i < n:
        c = buffer[i]
        if c == '"':
            break  # closing quote — value complete
        if c != "\\":
            out.append(c)
            i += 1
            continue
        # escape sequence
        if i + 1 >= n:
            break  # mid-escape cut
        e = buffer[i + 1]
        if e != "u":
            out.append(_SIMPLE_ESCAPES.get(e, e))
            i += 2
            continue
        if i + 6 > n:
            break  # incomplete \uXXXX
        try:
            cp = int(buffer[i + 2 : i + 6], 16)
        except ValueError:
            break
        if 0xD800 <= cp <= 0xDBFF:  # high surrogate — need the low half
            if i + 12 > n or buffer[i + 6 : i + 8] != "\\u":
                break  # low half not yet arrived
            try:
                lo = int(buffer[i + 8 : i + 12], 16)
            except ValueError:
                break
            if not (0xDC00 <= lo <= 0xDFFF):
                break
            out.append(chr(0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)))
            i += 12
            continue
        out.append(chr(cp))
        i += 6
    return "".join(out)


def normalize_script_text(text: str) -> str:
    """Collapse LLM double-escaped Fountain whitespace.

    Proper JSON `"line\\nline"` already becomes a real newline after
    `json.loads`. Double-escaped `"line\\\\nline"` leaves the two-character
    sequence backslash + n, which then renders literally in the dock.
    """
    if "\\" not in text:
        return text
    return (
        text.replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n")
        .replace("\\t", "\t")
    )


def _finalize(buffer: str) -> BeatCandidate:
    """Parse and validate the complete accumulated tool input. Raises
    `json.JSONDecodeError` or `pydantic.ValidationError` on any failure — both
    surface as `candidate_failed` with SCHEMA_INVALID_LLM.

    Light structural repairs only (not content invention): normalize escaped
    newlines, default a missing continuityConflicts list, and clamp label to
    the contract max (40). Anything still invalid still fails after rule-9
    retry — never a fabricated BeatCandidate.
    """
    obj = json.loads(buffer)
    script = obj.get("scriptText")
    if isinstance(script, str):
        obj["scriptText"] = normalize_script_text(script)
    if "continuityConflicts" not in obj:
        obj["continuityConflicts"] = []
    label = obj.get("label")
    if isinstance(label, str) and len(label) > 40:
        obj["label"] = label[:39] + "…"
    return BeatCandidate.model_validate(obj)


def schema_failure_client_message(exc: ValidationError) -> str:
    """Safe client message for SCHEMA_INVALID_LLM (hard rule 5: field paths /
    error kinds only — never model or writer text from `input`)."""
    hints: list[str] = []
    for err in exc.errors():
        loc = err.get("loc") or ()
        path = ".".join(str(p) for p in loc)
        typ = err.get("type", "")
        if typ == "string_too_long" and path == "label":
            hints.append("label exceeds 40 characters")
        elif typ == "string_too_long":
            hints.append(f"{path} too long" if path else "a string field is too long")
        elif typ == "missing":
            hints.append(f"missing {path}" if path else "missing field")
        elif path.endswith("factId") or path.endswith("fact_id"):
            hints.append("invalid continuity conflict fact id")
        elif path:
            hints.append(f"invalid {path}")
        else:
            hints.append(typ or "invalid field")
    deduped: list[str] = []
    seen: set[str] = set()
    for hint in hints:
        if hint not in seen:
            seen.add(hint)
            deduped.append(hint)
    if not deduped:
        return "candidate failed schema validation"
    return "candidate failed schema validation (" + "; ".join(deduped[:3]) + ")"


def _one_line(text: str, limit: int = 80) -> str:
    line = " ".join(text.split())
    return line if len(line) <= limit else line[: limit - 1] + "…"


# ── the 3-call diversity event generator ────────────────────────────────────────


def generate_candidate_events(
    llm: LlmClient,
    doc: dict,
    ledger: list[dict],
    *,
    scene_id: str,
    after_beat_id: str | None,
    instruction: str,
    craft_level: str = "standard",
    count: int | None = None,
) -> Iterator[Event]:
    """Yield the SSE event tuples for a candidate-generation request (data
    contract §4 / adoption A3 craft levels).

    - fast: 1 streamed candidate
    - standard: 3 streamed (default)
    - considered: 3 sync diversity samples + 1 streamed polished pick
      (extra `generate_beat_candidates` calls — critique-and-select without a
      new op)
    """
    level = craft_level if craft_level in CRAFT_COUNTS else "standard"
    if count is None:
        count = CRAFT_COUNTS[level]

    if level == "considered":
        yield from _considered_events(
            llm,
            doc,
            ledger,
            scene_id=scene_id,
            after_beat_id=after_beat_id,
            instruction=instruction,
        )
        return

    avoid: list[dict] = []
    for index in range(count):
        yield (CANDIDATE_START, {"index": index})
        nonce = render.new_nonce()
        system, user = build_candidate_bundle(
            doc,
            ledger,
            scene_id=scene_id,
            after_beat_id=after_beat_id,
            instruction=instruction,
            avoid=avoid,
            nonce=nonce,
        )
        result = yield from _stream_one(
            _candidate_stream(llm), system, user, nonce, "generate_beat_candidates"
        )
        if result is not None:
            candidate, wire = result
            yield (CANDIDATE_DONE, wire)
            avoid.append(
                {"label": candidate.label, "summary": _one_line(candidate.beat_plan.what_happens)}
            )
    yield (DONE, {})


def _considered_events(
    llm: LlmClient,
    doc: dict,
    ledger: list[dict],
    *,
    scene_id: str,
    after_beat_id: str | None,
    instruction: str,
) -> Iterator[Event]:
    """Generate three sync drafts, then stream one polished selection (A3)."""
    avoid: list[dict] = []
    drafts: list[dict] = []
    for _ in range(CANDIDATE_COUNT):
        nonce = render.new_nonce()
        system, user = build_candidate_bundle(
            doc,
            ledger,
            scene_id=scene_id,
            after_beat_id=after_beat_id,
            instruction=instruction,
            avoid=avoid,
            nonce=nonce,
        )
        candidate = llm.generate_beat_candidates(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        wire = candidate.model_dump(by_alias=True, mode="json")
        drafts.append(wire)
        avoid.append(
            {
                "label": candidate.label,
                "summary": _one_line(candidate.beat_plan.what_happens),
            }
        )

    polish_instruction = (
        (instruction.strip() + "\n\n" if instruction.strip() else "")
        + "CRITIQUE AND SELECT: Prior drafts this round were: "
        + "; ".join(
            f"{d.get('label', '')} — "
            f"{_one_line(d.get('beatPlan', {}).get('whatHappens', ''))}"
            for d in drafts
        )
        + ". Return a single polished best beat that keeps the strongest choice "
        "and improves weak lines. Do not merely copy one draft verbatim."
    )
    yield (CANDIDATE_START, {"index": 0})
    nonce = render.new_nonce()
    system, user = build_candidate_bundle(
        doc,
        ledger,
        scene_id=scene_id,
        after_beat_id=after_beat_id,
        instruction=polish_instruction,
        avoid=avoid,
        nonce=nonce,
    )
    result = yield from _stream_one(
        _candidate_stream(llm), system, user, nonce, "generate_beat_candidates"
    )
    if result is not None:
        _candidate, wire = result
        yield (CANDIDATE_DONE, wire)
    yield (DONE, {})


def generate_tune_events(
    llm: LlmClient,
    doc: dict,
    ledger: list[dict],
    *,
    scene_id: str,
    current_candidate: dict,
    instruction: str,
) -> Iterator[Event]:
    """Yield the SSE event tuples for a tune request (data contract §4:
    "SSE, one candidate"). Same streaming machinery as candidate generation —
    one `candidate_start {index: 0}`, zero or more `delta {text}`, one
    `candidate_done`/`candidate_failed`, then `done` — but a single revised
    candidate driven by `stream_tune_beat` and the §2 tune context. This is the
    explicit writer gesture (CLAUDE.md rule 8); validation of `scene_id` happens
    before the stream starts (the route surfaces it as an HTTP error)."""
    yield (CANDIDATE_START, {"index": 0})
    nonce = render.new_nonce()
    system, user = build_tune_bundle(
        doc, ledger, scene_id=scene_id, current_candidate=current_candidate,
        instruction=instruction, nonce=nonce,
    )
    result = yield from _stream_one(_tune_stream(llm), system, user, nonce, "tune_beat")
    if result is not None:
        _candidate, wire = result
        yield (CANDIDATE_DONE, wire)
    yield (DONE, {})


def _candidate_stream(llm: LlmClient):
    return lambda system, user: llm.stream_beat_candidate(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )


def _tune_stream(llm: LlmClient):
    return lambda system, user: llm.stream_tune_beat(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )


# Rule 9 retry instruction — mirrors anthropic_client._retry_once's plain
# user-turn fallback format (the streaming path has no tool_use_id to reply to
# with an is_error tool_result, so the plain-turn restatement is the mirror).
# The interpolated validation error is model-output-derived, not writer/import
# freeform text, so it sits outside <source_data> exactly like the tool_result
# content in the non-streaming retry (§8b governs writer/import text).
_RETRY_NOTE = (
    "Your previous response did not call the {tool!r} tool with valid input: "
    "{error}. Call {tool!r} with valid input."
)

# A bound streamed call: (system, user) -> raw tool-input JSON fragments.
StreamFn = Callable[[str, str], Iterator[str]]


def _stream_attempt(stream_fn: StreamFn, system: str, user: str) -> Iterator[Event]:
    """One streamed call for a candidate slot: forward clean `delta` events,
    then finalize the complete buffer. `stream_fn` is the bound streaming op
    (`stream_beat_candidate` or `stream_tune_beat`).

    Returns (via generator return) a `(status, payload)` pair:
      - `("ok", BeatCandidate)` — complete tool input parsed and validated
      - `("invalid_schema", error_text)` — valid JSON that failed BeatCandidate
        validation, or no tool input at all (the model answered in prose;
        tool choice is `auto` on the 5.5 models): the rule-9 retryable case
      - `("bad_json", None)` — buffer never parses (§8a: parser cannot resync)
      - `("unavailable", None)` — SDK transport/availability failure

    Raw JSON fragments are never yielded — only unescaped scriptText growth.
    Each attempt starts its emitted-prefix diff from empty (see `_stream_one`
    for how that behaves on retry)."""
    buffer = ""
    emitted = ""
    try:
        for fragment in stream_fn(system, user):
            buffer += fragment
            prefix = extract_script_text_prefix(buffer)
            if prefix is not None and len(prefix) > len(emitted):
                yield (DELTA, {"text": prefix[len(emitted):]})
                emitted = prefix
    except (anthropic.APIError, LlmTimeoutError):
        return ("unavailable", None)

    if not buffer:
        return ("invalid_schema", "no tool call was made")
    try:
        return ("ok", _finalize(buffer))
    except json.JSONDecodeError:
        return ("bad_json", None)
    except ValidationError as exc:
        # Keep the ValidationError for a safe client hint; retry note uses str().
        return ("invalid_schema", exc)


def _stream_one(
    stream_fn: StreamFn, system: str, user: str, nonce: str, op_name: str
) -> Iterator[Event]:
    """Stream one candidate slot with rule-9 retry semantics. `stream_fn` is the
    bound streaming op and `op_name` names it in the retry note / failure log
    (`generate_beat_candidates` or `tune_beat`).

    Attempt 1 streams normally. If its complete buffer is valid JSON but fails
    `BeatCandidate` validation (schema-invalid LLM output), exactly **one**
    retry is made for the slot — a fresh streamed call with the validation
    error appended to the user message (`_RETRY_NOTE`, mirroring the
    non-streaming `anthropic_client._retry_once` mechanics) — before any
    `candidate_failed` is emitted (data contract §4: SCHEMA_INVALID_LLM is
    "after retry"). A `JSONDecodeError` aborts the slot without retry (§8a:
    parser cannot resync), as do transport failures (mapped to
    LLM_UNAVAILABLE, obligation 1). Never a third call.

    Delta behavior on retry: the retry emits **fresh deltas that restart the
    scriptText prefix** (its emitted-diff starts from empty). Deltas are
    provisional display only; the authoritative value is `candidate_done`,
    which the client uses to replace its provisional buffer (§8a), so
    first-attempt deltas are corrected by the final card.

    Returns (via generator return) `(BeatCandidate, wire_dict)` on success, or
    None after yielding a `candidate_failed` event."""
    retried = False
    status, payload = yield from _stream_attempt(stream_fn, system, user)
    if status == "invalid_schema":
        # Rule 9: exactly one retry with the error appended. Log flags only —
        # `payload` (the validation error) can echo model-produced field
        # values and must never be logged (hard rule 5).
        retried = True
        retry_user = f"{user}\n\n" + _RETRY_NOTE.format(
            tool=op_name, error=str(payload)
        )
        status, payload = yield from _stream_attempt(stream_fn, system, retry_user)

    if status == "ok":
        candidate: BeatCandidate = payload
        if retried:
            _logger.info("candidate stream nonce=%s retried=True failed=False", nonce)
        return candidate, candidate.model_dump(by_alias=True)

    if status == "unavailable":
        # Obligation 1: raw SDK transport/availability errors → LLM_UNAVAILABLE,
        # SSE-shaped (the 200 response has already begun; the error is an event).
        _logger.info(
            "candidate stream nonce=%s retried=%s failed=LLM_UNAVAILABLE", nonce, retried
        )
        yield (
            CANDIDATE_FAILED,
            {"error": {"code": _LLM_UNAVAILABLE, "message": "the language model is unavailable"}},
        )
        return None

    # "bad_json" (§8a abort, no retry) or "invalid_schema" after the one
    # retry (rule 9: surface, never a third attempt or a fabricated fallback).
    _logger.info(
        "candidate stream nonce=%s retried=%s failed=%s",
        nonce,
        retried,
        SchemaInvalidLlmError.code,
    )
    if status == "bad_json":
        client_message = "candidate response was not valid JSON"
    elif isinstance(payload, ValidationError):
        client_message = schema_failure_client_message(payload)
    else:
        client_message = "candidate failed schema validation"
    yield (
        CANDIDATE_FAILED,
        {
            "error": {
                "code": SchemaInvalidLlmError.code,
                "message": client_message,
            }
        },
    )
    return None


def to_sse(events: Iterable[Event]) -> Iterator[str]:
    """Adapt candidate event tuples to SSE wire frames for a StreamingResponse."""
    from sse import format_sse

    for name, data in events:
        yield format_sse(name, data)
