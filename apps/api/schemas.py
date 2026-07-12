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
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, StringConstraints
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


class CraftLevel(StrEnum):
    fast = "fast"
    standard = "standard"
    considered = "considered"


class Project(_Base):
    id: Id
    title: str
    format: ShowFormat
    enabled_components: list[str]
    premise: str
    series_bible: SeriesBible
    seasons: list[Season]
    head_snapshot_id: Id | None
    default_craft_level: CraftLevel = CraftLevel.standard


# Ledger, snapshots, suggestionHistory live in separate stores (design doc §5).


class SetupState(StrEnum):
    incomplete = "incomplete"
    ready = "ready"


class ProjectSummary(_Base):
    id: Id
    title: str
    format: ShowFormat
    updated_at: str
    pending_review_count: int = Field(ge=0)
    setup_state: SetupState


class CharacterSeed(_Base):
    name: str = Field(min_length=1)
    traits: str | None = None


class ProjectFoundationInput(_Base):
    existential_question: str | None = None
    stories_to_avoid: list[str] | None = None
    characters: list[CharacterSeed] | None = None


class ProjectCreateRequest(_Base):
    title: str
    format: ShowFormat
    premise: str
    foundation: ProjectFoundationInput | None = None


class ProjectImportSourceFormat(StrEnum):
    fountain = "fountain"
    text = "text"


class ProjectImportSource(_Base):
    format: ProjectImportSourceFormat
    content: str


class ProjectImportCreateRequest(_Base):
    title: str
    format: ShowFormat
    premise: str | None = None
    source: ProjectImportSource


class PdfExtractMethod(StrEnum):
    text_layer = "text_layer"
    ocr = "ocr"


class PdfExtractResult(_Base):
    text: str
    method: PdfExtractMethod
    page_count: int = Field(gt=0)
    warnings: list[str]


class SnapshotSummary(_Base):
    """One restorable ancestor entry for the undo timeline (adoption A5)."""

    id: Id
    instruction: str
    ts: str


class ProjectRestoreRequest(_Base):
    """POST /projects/{pid}/restore — jump head to an ancestor snapshot."""

    snapshot_id: Id


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
    # §9.4 initial_scene_skeleton variant: objectId is a proposalId, not a
    # final scene id (new-project-flow design spec §9.4).
    add = "add"


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


class ProjectImportResult(_Base):
    project: Project
    new_facts: list[LedgerFact]
    consistency_flags: list[ConsistencyFlag]


class ImportProgressStageName(StrEnum):
    parsing_scenes = "parsing_scenes"
    segmenting_beats = "segmenting_beats"
    extracting_facts = "extracting_facts"
    checking_consistency = "checking_consistency"
    saving = "saving"


class ImportProgressStageEvent(_Base):
    type: Literal["stage"]
    name: ImportProgressStageName


class ImportProgressItemEvent(_Base):
    type: Literal["progress"]
    stage: ImportProgressStageName
    done: int = Field(ge=0)
    total: int = Field(ge=0)


class ImportProgressCompleteEvent(_Base):
    type: Literal["complete"]
    result: ProjectImportResult


class ImportProgressErrorBody(_Base):
    code: str
    message: str
    details: object | None = None


class ImportProgressFailedEvent(_Base):
    type: Literal["failed"]
    error: ImportProgressErrorBody


class ProjectImportProgressEvent(
    RootModel[
        Annotated[
            ImportProgressStageEvent
            | ImportProgressItemEvent
            | ImportProgressCompleteEvent
            | ImportProgressFailedEvent,
            Field(discriminator="type"),
        ]
    ]
):
    """Mirrors the Zod discriminated union of the same name (data contract
    §9.3). A `RootModel` so `model_json_schema()` exists for the CI schema
    diff (scripts/check_contract.py) even though this type has no object
    fields of its own — routes build the SSE payload as plain dicts (like
    every other SSE event in this codebase; see drama_manager/candidates.py),
    so this model exists for the contract diff and any caller that wants to
    validate an event, not as a construction path."""


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


# §9.4 initial scene skeleton — guided-setup scene-addition Change Set
# (new-project-flow design spec §6/§9.4). MVP defers storyline inference, so
# every addition carries storyline "A" (Scene's own default) rather than a
# model-set field. `proposal_id` is the server-assigned selection handle —
# never the final scene id — minted once generation validates the model's
# scene list (InitialSceneSkeleton below); the model never sets ids.
class SceneAdditionStoryline(StrEnum):
    """MVP: storyline inference is deferred (design spec §9.4) — every scene
    addition is tagged 'A', a narrower enum than `StorylineId` (A/B/C)."""

    a = "A"


class SceneAddition(_Base):
    proposal_id: Id
    act: int = Field(ge=0)
    storyline: SceneAdditionStoryline = SceneAdditionStoryline.a
    location: str
    time: str
    social_situation: str
    what_happens: str
    audience_learns: str
    audience_feels: str
    motivations: list[Motivation]  # characterId references existing Characters
    beat_plan_seeds: list[BeatPlan]  # ordered; apply mints beat ids/scriptText: "" server-side


# One generated skeleton option (data contract §9.4): the writer compares
# three of these side by side, then selects one to create a Change Set.
class InitialSceneSkeletonCandidate(_Base):
    candidate_id: Id
    based_on_snapshot_id: Id  # the headSnapshotId this candidate was generated against
    label: str = Field(max_length=40)
    scenes: list[SceneAddition]  # ordered


class ChangeSetPreview(_Base):
    beat_updates: list[BeatUpdate]
    scene_updates: list[SceneUpdate]
    continuity_conflicts: list[ChangeSetContinuityConflict]
    based_on_snapshot_id: Id  # head at preview time; apply 409s (PREVIEW_STALE) if head moved
    generated_at: str
    # §9.4 initial_scene_skeleton variant: the chosen candidate's scene
    # additions, verbatim. Null for the ordinary "edit" ChangeSet kind.
    scene_additions: list[SceneAddition] | None = None


class ChangeSetStatus(StrEnum):
    draft = "draft"
    previewing = "previewing"
    applied = "applied"
    discarded = "discarded"
    flagged = "flagged"


class ChangeSetKind(StrEnum):
    edit = "edit"
    initial_scene_skeleton = "initial_scene_skeleton"


class ChangeSet(_Base):
    id: Id
    project_id: Id
    kind: ChangeSetKind = ChangeSetKind.edit
    instruction: str  # the edit that triggered it (or a generated label for initial_scene_skeleton)
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


# §9.4 generate_scene_skeleton — the guided-setup convergent loop calls this
# 3x (drama_manager/scene_skeleton.py). The model emits no ids and no
# `scriptText` (hard rule: "no scriptText in skeleton"); the server assigns
# each scene a proposalId and stamps storyline "A" after validation,
# producing a SceneAddition (§2 above) per scene.
class InitialSceneSkeletonScene(_Base):
    act: int = Field(ge=0)
    location: str
    time: str
    social_situation: str
    what_happens: str
    audience_learns: str
    audience_feels: str
    motivations: list[Motivation]
    beat_plan_seeds: list[BeatPlan]


class InitialSceneSkeleton(_Base):
    label: str = Field(max_length=40)
    scenes: list[InitialSceneSkeletonScene]


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


class SuggestRequest(_Base):
    """POST /projects/{pid}/suggest — adoption A4 carousel context."""

    context: Literal["scene", "beat"]
    target_id: Id
    surface: Literal["command_bar", "scene_premise", "tune"]
    draft_script: str | None = None


class SegmentedSceneBeat(_Base):
    kind: Literal["beat"]
    start_line: int = Field(ge=1)
    what_happens: str
    audience_learns: str
    audience_feels: str


class SegmentedSceneUnassigned(_Base):
    kind: Literal["unassigned"]
    start_line: int = Field(ge=1)
    reason: str


# §7 parse_script stage 2
class SegmentedScene(_Base):
    segments: list[SegmentedSceneBeat | SegmentedSceneUnassigned]


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
    craft_level: CraftLevel | None = None
