"""Table Read data contract — Pydantic mirror.

Mirrors packages/contract/src/index.ts field-for-field. Zod is the source of
truth (CLAUDE.md Layout); this module must never diverge from it —
scripts/check_contract.py diffs the JSON Schema of every §1/§2/§2a type on
every PR (CLAUDE.md hard rule 3, data contract §5).

Config per data contract §5: one module, models named identically to their
Zod counterparts, `alias_generator=to_camel` + `populate_by_name=True` so
wire format is camelCase while Python code stays snake_case, enums as
`StrEnum` with identical values.

A final "Storage (§3) — persisted-state envelope" section mirrors the
matching section in index.ts: Snapshot / SuggestionHistoryEntry /
PersistedState are inferred from the §3 storage table (not given as Zod in
the doc) and are out of scope for the §1/§2/§2a CI schema diff — see
index.ts's module header and the task report for why.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

# "scene-1", "beat-1-2", "fact-04", "char-marta"
Id = Annotated[str, StringConstraints(min_length=1)]


class _Base(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ─────────────────────────────────────────────────────────────────────────
# §1. Core types
# ─────────────────────────────────────────────────────────────────────────


class Genre(StrEnum):
    drama = "drama"
    comedy = "comedy"
    dramedy = "dramedy"


class ShowFormat(_Base):
    genre: Genre
    runtime_minutes: int = Field(gt=0)
    act_count: int = Field(ge=1, le=6)
    cold_open: bool
    tag: bool
    serialization: float = Field(ge=0, le=1)


class Character(_Base):
    id: Id
    name: str
    locked: bool = False
    embodiment: str
    presentation: str
    hiding: str
    traits: str
    series_arc: str


class Relationship(_Base):
    between: tuple[Id, Id]
    label: str
    really_like: str
    locked: bool = False


class LockedText(_Base):
    text: str
    locked: bool = False


class WorldQA(_Base):
    q: str
    a: str
    locked: bool = False


class SeriesBible(_Base):
    existential_question: LockedText
    world_rules: list[LockedText]
    stories_to_avoid: list[str]
    characters: list[Character]
    relationships: list[Relationship]
    audience_goals: list[str]
    narrator_goals: list[str]
    # to_camel("world_qa") -> "worldQa"; the wire field is "worldQA" (data
    # contract §1 / fixture) — override the generated alias for this one field.
    world_qa: list[WorldQA] = Field(alias="worldQA")


class Motivation(_Base):
    character_id: Id
    objective: str
    stakes: str
    obstacle: str


class Beat(_Base):
    id: Id
    index: int = Field(ge=0)
    locked: bool = False
    what_happens: str
    audience_learns: str
    audience_feels: str
    script_text: str = ""
    script_locked: bool = False


class StorylineId(StrEnum):
    a = "A"
    b = "B"
    c = "C"


class Scene(_Base):
    id: Id
    index: int = Field(ge=0)
    act: int = Field(ge=0)  # 0 = cold open
    storyline: StorylineId = StorylineId.a  # present in schema; UI tagging is v2
    locked: bool = False
    location: str
    time: str
    social_situation: str
    what_happens: str
    audience_learns: str
    audience_feels: str
    motivations: list[Motivation]
    beats: list[Beat]


class EpisodeStoryline(_Base):
    id: StorylineId
    summary: str
    character_ids: list[Id]


class Episode(_Base):
    id: Id
    index: int = Field(ge=0)
    locked: bool = False
    title: str
    premise: str
    season_function: str = ""
    storylines: list[EpisodeStoryline]
    scenes: list[Scene]


class CharacterArc(_Base):
    character_id: Id
    arc: str
    locked: bool = False


class Season(_Base):
    id: Id
    index: int = Field(ge=0)
    locked: bool = False
    season_arc: str = ""
    character_arcs: list[CharacterArc]
    episodes: list[Episode]  # MVP: exactly one


class SourceSpan(_Base):
    episode_id: Id
    scene_id: Id
    beat_id: Id
    # Offsets within the beat's scriptText. Lines are model-reported (input is
    # line-numbered); char offsets are computed server-side by locating
    # sourceText verbatim within the line range (disambiguates duplicates).
    start_line: int | None = Field(default=None, ge=0)
    end_line: int | None = Field(default=None, ge=0)
    char_start: int | None = Field(default=None, ge=0)
    char_end: int | None = Field(default=None, ge=0)


class FactType(StrEnum):
    event = "event"
    state = "state"
    knowledge = "knowledge"
    relationship = "relationship"
    world_rule = "world_rule"


class Provenance(StrEnum):
    inferred = "inferred"
    writer_confirmed = "writer_confirmed"
    writer_authored = "writer_authored"


class FactStatus(StrEnum):
    active = "active"
    superseded = "superseded"
    stale = "stale"
    pending_review = "pending_review"
    rejected = "rejected"


class LedgerFact(_Base):
    id: Id
    fact: str
    fact_type: FactType
    source_span: SourceSpan
    source_text: str = ""  # verbatim quote from the establishing beat; server-verified
    known_by: list[Id]
    audience_knows: bool = True  # distinct from knownBy — dramatic irony lives in the gap
    provenance: Provenance
    confidence: float = Field(ge=0, le=1)
    status: FactStatus
    supersedes: Id | None
    superseded_by: Id | None


class Project(_Base):
    id: Id
    title: str
    format: ShowFormat
    enabled_components: list[str]
    premise: str
    series_bible: SeriesBible
    seasons: list[Season]
    head_snapshot_id: Id | None


# Ledger, snapshots, suggestionHistory live in separate stores (design doc §5).


# ─────────────────────────────────────────────────────────────────────────
# §2. Generation / Review types
# ─────────────────────────────────────────────────────────────────────────


class ContinuityConflict(_Base):
    fact_id: Id
    explanation: str


class BeatPlan(_Base):
    what_happens: str
    audience_learns: str
    audience_feels: str


class BeatCandidate(_Base):
    label: str = Field(max_length=40)
    beat_plan: BeatPlan
    script_text: str
    continuity_conflicts: list[ContinuityConflict]


class ImpactedObjectType(StrEnum):
    scene = "scene"
    beat = "beat"
    character = "character"
    ledger_fact = "ledgerFact"


class ApplyMode(StrEnum):
    regenerate = "regenerate"
    flag_only = "flag_only"


class ConfidenceLevel(StrEnum):
    high = "high"
    speculative = "speculative"


class ImpactedObject(_Base):
    object_type: ImpactedObjectType
    object_id: Id
    # server-annotated: scene/beat -> regenerate; character/ledgerFact -> flag_only
    # (MVP has no machine-edit path for them)
    apply_mode: ApplyMode
    reason: str
    confidence: ConfidenceLevel
    locked: bool  # server-annotated; locked rows render disabled
    before: str  # rendered snippet
    after: str | None  # null until regeneration preview exists; always null for flag_only
    continuity_flags: list[ContinuityConflict]
    approved: bool = False  # only meaningful for applyMode "regenerate"


class FlagObjectType(StrEnum):
    scene = "scene"
    beat = "beat"


class FlagSeverity(StrEnum):
    contradiction = "contradiction"
    tension = "tension"


class FlagStatus(StrEnum):
    open = "open"
    dismissed = "dismissed"
    resolved = "resolved"


class ConsistencyFlag(_Base):
    id: Id
    object_type: FlagObjectType
    object_id: Id  # an untouched object
    fact_id: Id | None
    explanation: str
    severity: FlagSeverity
    status: FlagStatus
    source_change: Id  # the ChangeSet or accepted-beat snapshot that triggered the scan


# Exact, typed preview content — what apply actually writes. `ImpactedObject.after`
# is only the rendered display snippet; this is the source of truth.
class BeatUpdate(_Base):
    beat_id: Id
    beat_plan: BeatPlan | None
    script_text: str | None  # null = field unchanged


class SceneUpdateFields(_Base):
    what_happens: str | None
    audience_learns: str | None
    audience_feels: str | None
    location: str | None
    time: str | None
    social_situation: str | None


class SceneUpdate(_Base):
    scene_id: Id
    fields: SceneUpdateFields  # null = field unchanged


class ChangeSetContinuityConflict(_Base):
    fact_id: Id
    object_id: Id
    explanation: str


class ChangeSetPreview(_Base):
    beat_updates: list[BeatUpdate]
    scene_updates: list[SceneUpdate]
    continuity_conflicts: list[ChangeSetContinuityConflict]
    based_on_snapshot_id: Id  # head at preview time; apply 409s (PREVIEW_STALE) if head moved
    generated_at: str


class ChangeSetStatus(StrEnum):
    draft = "draft"
    previewing = "previewing"
    applied = "applied"
    discarded = "discarded"
    flagged = "flagged"


class ChangeSet(_Base):
    id: Id
    project_id: Id
    instruction: str  # the edit that triggered it
    target_object_id: Id
    impacted: list[ImpactedObject]
    preview: ChangeSetPreview | None  # null until POST /preview succeeds
    status: ChangeSetStatus
    created_at: str


# ─────────────────────────────────────────────────────────────────────────
# §2a. LLM operation schemas (tool outputs)
#
# Implementations must not define op schemas anywhere else (grep gate in
# scripts/check_contract.py). Server-side annotations (ImpactedObject.applyMode
# /locked, LedgerFact.provenance/status, ConsistencyFlag.id/status) are
# deliberately absent here — the model never sets them.
# ─────────────────────────────────────────────────────────────────────────

# §1/§2 generate_beat_candidates, tune_beat -> BeatCandidate (defined in §2 above)


class BlastRadiusImpact(_Base):
    object_type: ImpactedObjectType
    object_id: Id
    reason: str
    confidence: ConfidenceLevel


# §3 classify_blast_radius
class BlastRadius(_Base):
    impacted: list[BlastRadiusImpact]


# §4 regenerate_elements — reuses BeatUpdate/SceneUpdate from §2, so the
# model's output IS the ChangeSetPreview payload shape (no translation layer).
class RegeneratedElements(_Base):
    beats: list[BeatUpdate]
    scenes: list[SceneUpdate]
    continuity_conflicts: list[ChangeSetContinuityConflict]


class ExtractedFactSourceSpan(_Base):
    episode_id: Id
    scene_id: Id
    beat_id: Id
    start_line: int = Field(ge=0)
    end_line: int = Field(ge=0)


# §5 extract_ledger_facts — model span has lines only; char offsets are computed server-side.
class ExtractedFact(_Base):
    fact: str
    fact_type: FactType
    source_span: ExtractedFactSourceSpan
    source_text: str
    known_by: list[Id]
    audience_knows: bool
    confidence: float = Field(ge=0, le=1)


class LedgerContradiction(_Base):
    existing_fact_id: Id
    explanation: str
    proposed_replacement: str | None


class LedgerExtraction(_Base):
    new_facts: list[ExtractedFact]
    contradictions: list[LedgerContradiction]


# §6 suggest_instructions
class InstructionSuggestions(_Base):
    suggestions: list[str] = Field(min_length=3, max_length=3)


class SegmentedSceneBeat(_Base):
    start_line: int = Field(ge=0)
    end_line: int = Field(ge=0)
    what_happens: str
    audience_learns: str
    audience_feels: str


class SegmentedSceneUnassigned(_Base):
    start_line: int = Field(ge=0)
    end_line: int = Field(ge=0)
    reason: str


# §7 parse_script stage 2
class SegmentedScene(_Base):
    beats: list[SegmentedSceneBeat]
    unassigned: list[SegmentedSceneUnassigned]


class ConsistencyScanFlag(_Base):
    object_type: FlagObjectType
    object_id: Id
    fact_id: Id | None
    explanation: str
    severity: FlagSeverity


# §8c scan_consistency
class ConsistencyScan(_Base):
    flags: list[ConsistencyScanFlag]


# ─────────────────────────────────────────────────────────────────────────
# Storage (§3) — persisted-state envelope
#
# See the module header and index.ts's matching section: Snapshot /
# SuggestionHistoryEntry / PersistedState are inferred from the §3 storage
# table's column list (not given as Zod in the doc) and are out of scope for
# the §1/§2/§2a CI schema diff. They exist solely so the fixture's full
# envelope can be validated on both sides.
# ─────────────────────────────────────────────────────────────────────────


class Snapshot(_Base):
    id: Id
    parent_id: Id | None
    instruction: str
    doc: Project
    ledger: list[LedgerFact]
    flags: list[ConsistencyFlag]
    ts: str


class SuggestionHistoryEntry(_Base):
    id: Id
    project_id: Id
    text: str
    # MVP: cosine similarity computed in Python (data contract §3). The fixture
    # never carries a populated entry, so the wire shape of the embedding blob
    # is not yet exercised by real data; modeled as a nullable numeric vector.
    embedding: list[float] | None = None


class PersistedState(_Base):
    project: Project
    ledger: list[LedgerFact]
    snapshots: list[Snapshot]
    consistency_flags: list[ConsistencyFlag]
    change_sets: list[ChangeSet]
    suggestion_history: list[SuggestionHistoryEntry]


# ─────────────────────────────────────────────────────────────────────────
# §4 Ledger mode — request bodies (not §1/§2/§2a wire types; API-only)
# ─────────────────────────────────────────────────────────────────────────


class LedgerFactEdit(_Base):
    """PATCH /ledger/{factId}: edit text and/or knownBy → writer_authored."""

    fact: str | None = None
    known_by: list[Id] | None = None


class LedgerBatchRequest(_Base):
    """POST /projects/{pid}/ledger/batch — import-queue review."""

    confirm_ids: list[Id]
    reject_ids: list[Id]


class ChangeSetApprovedRequest(_Base):
    """POST /change-sets/{cid}/preview|apply — approved regenerate targets."""

    approved_object_ids: list[Id]

