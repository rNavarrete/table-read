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
from math import isfinite
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    StringConstraints,
    field_validator,
)
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
    # Alternate names/nicknames the script uses for this character
    # (infer_story_entities resolves these against existing characters before
    # minting a new one). Defaults to [] so pre-existing docs validate.
    aliases: list[str] = []
    embodiment: str
    presentation: str
    hiding: str
    traits: str
    series_arc: str
    # T7.31 — Ledger People profile prose (separate from craft fields).
    # Defaults keep pre-existing docs / fixture validating without migration.
    summary: str = ""
    bio: str = ""


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


class WorldRule(_Base):
    """T7.19 — extends the original `{text, locked}` bible entry with
    structured limit/cost/exception fields plus one evidence citation. See
    packages/contract/src/index.ts's `WorldRule` docstring."""

    text: str
    locked: bool = False
    limit: str = ""
    cost: str = ""
    exception: str = ""
    evidence_scene_id: Id | None = None
    evidence_quote: str = ""


class SeriesBible(_Base):
    existential_question: LockedText
    world_rules: list[WorldRule]
    stories_to_avoid: list[str]
    characters: list[Character]
    relationships: list[Relationship]
    audience_goals: list[str]
    narrator_goals: list[str]
    # to_camel("world_qa") -> "worldQa"; the wire field is "worldQA" (data
    # contract §1 / fixture) — override the generated alias for this one field.
    world_qa: list[WorldQA] = Field(alias="worldQA")


class Motivation(_Base):
    """`objective` is what the character actually pursues; `stated_objective`
    is what they claim, when that differs (empty = no gap, the common case).
    The distance between the two IS the ulterior motive. `concealed`
    separates deliberate deception from self-deception — a dramaturg treats
    those differently and it isn't recoverable from the strings alone.
    See packages/contract/src/index.ts's `Motivation` docstring."""

    character_id: Id
    objective: str
    stakes: str
    obstacle: str
    stated_objective: str = ""
    concealed: bool = False


class Beat(_Base):
    id: Id
    index: int = Field(ge=0)
    locked: bool = False
    what_happens: str
    audience_learns: str
    audience_feels: str
    script_text: str = ""
    script_locked: bool = False
    # T10.1 — the beat from the character's side (see the Zod `Beat`). Import
    # fills them; an unresolved actor/target name stays None.
    actor_character_id: Id | None = None
    action_verb: str = ""
    target_character_id: Id | None = None
    reaction: str = ""
    # T10.9 — kernel / choice under pressure (see the Zod `Beat`); None = not read.
    kernel: bool | None = None
    pressure_choice: bool | None = None


class Charge(StrEnum):
    """T10.1 — a value's charge as a scene opens or closes."""

    positive = "positive"
    negative = "negative"
    mixed = "mixed"


class StorylineId(StrEnum):
    """T10.2 — A the main story, B the second, C and D lesser strands or a
    runner. See packages/contract/src/index.ts's `StorylineId`."""

    a = "A"
    b = "B"
    c = "C"
    d = "D"


class Scene(_Base):
    id: Id
    index: int = Field(ge=0)
    act: int = Field(ge=0)  # 0 = cold open
    storyline: StorylineId = StorylineId.a  # import infers it (T10.2); writer tagging is v2
    locked: bool = False
    location: str
    time: str
    social_situation: str
    what_happens: str
    audience_learns: str
    audience_feels: str
    motivations: list[Motivation]
    beats: list[Beat]
    # T10.1 — the scene's turn (see the Zod `Scene`): import readings only;
    # whether it turns is derived where shown, never stored.
    value_at_stake: str = ""
    charge_in: Charge | None = None
    charge_out: Charge | None = None
    why_now: str = ""


class EpisodeStoryline(_Base):
    id: StorylineId
    summary: str
    character_ids: list[Id]


class TimelineAnchorKind(StrEnum):
    relative = "relative"
    absolute = "absolute"


class TimelineAnchor(_Base):
    """T7.24 — see packages/contract/src/index.ts's `TimelineAnchor` docstring."""

    after_scene_id: Id
    label: str
    kind: TimelineAnchorKind
    quote: str = ""


class RelationshipState(_Base):
    """T7.25 — see packages/contract/src/index.ts's `RelationshipState` docstring."""

    between: tuple[Id, Id]
    label: str
    scene_id: Id
    quote: str = ""


class ObjectState(_Base):
    """T7.26 — see packages/contract/src/index.ts's `ObjectState` docstring."""

    name: str
    holder_character_id: Id | None
    location_label: str
    scene_id: Id
    quote: str = ""


class ThreadStatus(StrEnum):
    open = "open"
    paid_off = "paid_off"
    abandoned = "abandoned"


# Shared by the Narrative Map's ThreadMovement and the thread ledger's
# StoryThreadMovement (T10.3).
class ThreadMovementPhase(StrEnum):
    setup = "setup"
    escalation = "escalation"
    reversal = "reversal"
    reveal = "reveal"
    payoff = "payoff"
    aftermath = "aftermath"


class ThreadClosureLevel(StrEnum):
    """T10.3 — how a paid-off thread is closed. See the Zod docstring."""

    plot = "plot"
    story = "story"
    thematic = "thematic"
    parametric = "parametric"


class StoryThreadMovement(_Base):
    """T10.3 — one scene where a thread appears and what changed for it.
    Both the model's output row and the stored row; see the Zod docstring
    for the server rules (drama_manager.promises)."""

    scene_id: Id
    beat_id: Id | None
    phase: ThreadMovementPhase
    summary: str


class StoryThread(_Base):
    """T7.19 — a narrative setup/payoff arc, MVP-scoped to the episode it
    lives on. See packages/contract/src/index.ts's `StoryThread` docstring."""

    id: Id
    label: str
    summary: str
    status: ThreadStatus
    owner_character_ids: list[Id] = []
    setup_scene_id: Id
    payoff_scene_id: Id | None = None
    setup_quote: str = ""
    payoff_quote: str = ""
    # From the model's beat citation on merge; the server derives the quote
    # from that beat. See the Zod `StoryThread.setupBeatId` docstring for when
    # both are kept and why a scene id is too coarse.
    setup_beat_id: Id | None = None
    payoff_beat_id: Id | None = None
    locked: bool = False
    # T10.2 — kept only when that storyline survived the import merge.
    storyline: StorylineId | None = None
    # T10.3 — movements in scene order, closure level (null unless paid off)
    # and the setup's second job.
    movements: list[StoryThreadMovement] = []
    closure_level: ThreadClosureLevel | None = None
    second_job: str = ""


class Provenance(StrEnum):
    inferred = "inferred"
    writer_confirmed = "writer_confirmed"
    writer_authored = "writer_authored"


class Secret(_Base):
    """A StoryThread's shape applied to concealment: established -> revealed
    rather than setup -> paid off. What it adds is the asymmetry a thread has
    no room for — who holds it and who is kept in the dark. A fact everyone
    knows is not a secret, and `known_by` alone cannot say whether the gap is
    deliberate. See packages/contract/src/index.ts's `Secret` docstring."""

    id: Id
    summary: str
    fact_id: Id | None = None
    holder_character_ids: list[Id] = []
    concealed_from_character_ids: list[Id] = []
    audience_knows: bool = True
    established_scene_id: Id
    revealed_scene_id: Id | None = None
    concealment_scene_ids: list[Id] = []
    established_quote: str = ""
    revealed_quote: str = ""
    # Server-derived on merge; see `StoryThread.setup_beat_id`.
    established_beat_id: Id | None = None
    revealed_beat_id: Id | None = None
    provenance: Provenance = Provenance.inferred
    locked: bool = False


class Anachrony(StrEnum):
    """T10.6 — a scene told out of story order (see the Zod `Anachrony`)."""

    none = "none"
    flashback = "flashback"
    flashforward = "flashforward"


class StoryOverviewOutlineItem(_Base):
    """T7.27 — one scene row in the episode outline."""

    scene_id: Id
    summary: str
    # T10.6 — story time (see the Zod `StoryOverviewOutlineItem`).
    story_order: int | None = Field(default=None, ge=0)
    story_time: str = ""
    anachrony: Anachrony = Anachrony.none


class StoryOverviewBeatItem(_Base):
    """T7.27 — one named turn in the episode beat sheet."""

    beat_id: Id
    label: str = ""
    summary: str
    scene_id: Id | None = None
    act: int | None = Field(default=None, ge=0)


class StoryOverviewProvenance(StrEnum):
    inferred = "inferred"
    writer_authored = "writer_authored"


class StoryOverview(_Base):
    """T7.27 — episode story overview. See packages/contract StoryOverview."""

    logline: str
    outline: list[StoryOverviewOutlineItem]
    beat_sheet: list[StoryOverviewBeatItem]
    summary: str
    # T10.6 — what the episode is about (see the Zod `StoryOverview`).
    dramatic_question: str = ""
    central_argument: str = ""
    anti_theme: str = ""
    provenance: StoryOverviewProvenance = StoryOverviewProvenance.inferred
    locked: bool = False


class CharacterArcStop(_Base):
    """T10.6 — where a principal's head is at in one scene."""

    scene_id: Id
    head_at: str


class EpisodeCharacterArc(_Base):
    """T10.6 — a principal's arc across one episode (see the Zod type)."""

    character_id: Id
    want: str
    need: str
    lie: str
    ghost: str
    continuum_axis: str
    stops: list[CharacterArcStop]


class NarrativeEvidence(_Base):
    beat_id: Id
    quote: str = Field(min_length=1, max_length=200)


class NarrativeTheme(_Base):
    label: str
    statement: str
    evidence: list[NarrativeEvidence] = Field(min_length=1)


class NarrativeAct(_Base):
    act: int = Field(ge=0)
    dramatic_question: str
    escalation: str
    # Server-filled; see the Zod definition for why the escalation carries its
    # own evidence and the turn beat's quote is not a substitute for it.
    escalation_evidence: list[NarrativeEvidence] = []
    turn_beat_id: Id
    evidence_quote: str = Field(min_length=1, max_length=200)


class HeroJourneyStageName(StrEnum):
    ordinary_world = "ordinary_world"
    call_to_adventure = "call_to_adventure"
    refusal = "refusal"
    meeting_the_mentor = "meeting_the_mentor"
    crossing_the_threshold = "crossing_the_threshold"
    tests_allies_enemies = "tests_allies_enemies"
    approach = "approach"
    ordeal = "ordeal"
    reward = "reward"
    road_back = "road_back"
    resurrection = "resurrection"
    return_with_elixir = "return_with_elixir"


class HeroJourneyStage(_Base):
    stage: HeroJourneyStageName
    beat_id: Id
    summary: str
    evidence_quote: str = Field(min_length=1, max_length=200)


class HeroJourney(_Base):
    applies: bool
    protagonist_character_id: Id | None
    rationale: str
    stages: list[HeroJourneyStage]


class CharacterArcTurningPoint(_Base):
    beat_id: Id
    change: str
    quote: str = Field(min_length=1, max_length=200)


class NarrativeCharacterArc(_Base):
    character_id: Id
    want: str
    need: str
    internal_conflict: str
    external_pressure: str
    arc_summary: str
    turning_points: list[CharacterArcTurningPoint] = Field(min_length=1)


class SceneTurn(_Base):
    scene_id: Id
    focal_character_id: Id | None
    dramatic_function: str
    conflict: str
    stakes: str
    turn_beat_id: Id
    turn: str
    evidence_quote: str = Field(min_length=1, max_length=200)


class ThreadMovement(_Base):
    thread_id: Id
    beat_id: Id
    phase: ThreadMovementPhase
    summary: str
    evidence_quote: str = Field(min_length=1, max_length=200)


class NarrativeMap(_Base):
    dramatic_question: str
    central_conflict: str
    controlling_idea: str
    themes: list[NarrativeTheme] = Field(min_length=1)
    acts: list[NarrativeAct] = Field(min_length=1)
    hero_journey: HeroJourney
    character_arcs: list[NarrativeCharacterArc]
    scene_turns: list[SceneTurn] = Field(min_length=1)
    thread_movements: list[ThreadMovement]
    # See the Zod comment: listed scenes have no turn and nothing cites them.
    unanalyzed_scene_ids: list[Id] = []
    provenance: StoryOverviewProvenance = StoryOverviewProvenance.inferred
    locked: bool = False


class NarrativeMapRunStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    rejected = "rejected"
    failed = "failed"
    stale = "stale"


class NarrativeMapRunPhase(StrEnum):
    readiness = "readiness"
    scene_analysis = "scene_analysis"
    synthesis = "synthesis"
    verification = "verification"
    saving = "saving"
    complete = "complete"
    failed = "failed"


class NarrativeMapRejectionDiagnostic(_Base):
    code: str
    path: str
    reason: str = ""


class NarrativeMapRemovedClaim(_Base):
    action: str
    path: str
    subject: str
    reason: str = ""


class NarrativeMapRun(_Base):
    id: Id
    project_id: Id
    source_snapshot_id: Id
    source_hash: str = Field(min_length=1)
    analysis_version: str = Field(min_length=1)
    status: NarrativeMapRunStatus
    phase: NarrativeMapRunPhase
    scene_count: int = Field(ge=0)
    completed_scene_count: int = Field(ge=0)
    attempt_count: int = Field(ge=0)
    retry_allowed: bool
    estimated_cost_usd: float | None = Field(ge=0)
    actual_input_tokens: int | None = Field(ge=0)
    actual_output_tokens: int | None = Field(ge=0)
    result_snapshot_id: Id | None
    error_code: str | None
    error_message: str | None
    # Why the evidence gate rejected this run — see the Zod docstring.
    rejection_diagnostics: list[NarrativeMapRejectionDiagnostic] = []
    removed_claims: list[NarrativeMapRemovedClaim] = []
    created_at: str
    updated_at: str


# Structure checklist (spec 2026-10-11). TV act structure is derived in the
# web and never stored, so it is not a lens here.
class StructureLens(StrEnum):
    heros_journey = "heros_journey"
    story_circle = "story_circle"
    save_the_cat = "save_the_cat"
    turning_points = "turning_points"


class StructureStageName(StrEnum):
    ordinary_world = "ordinary_world"
    call_to_adventure = "call_to_adventure"
    refusal = "refusal"
    meeting_the_mentor = "meeting_the_mentor"
    crossing_the_threshold = "crossing_the_threshold"
    tests_allies_enemies = "tests_allies_enemies"
    approach = "approach"
    ordeal = "ordeal"
    reward = "reward"
    road_back = "road_back"
    resurrection = "resurrection"
    return_with_elixir = "return_with_elixir"
    circle_you = "circle_you"
    circle_need = "circle_need"
    circle_go = "circle_go"
    circle_search = "circle_search"
    circle_find = "circle_find"
    circle_take = "circle_take"
    circle_return = "circle_return"
    circle_change = "circle_change"
    opening_image = "opening_image"
    theme_stated = "theme_stated"
    set_up = "set_up"
    catalyst = "catalyst"
    debate = "debate"
    break_into_two = "break_into_two"
    b_story = "b_story"
    fun_and_games = "fun_and_games"
    midpoint = "midpoint"
    bad_guys_close_in = "bad_guys_close_in"
    all_is_lost = "all_is_lost"
    dark_night_of_the_soul = "dark_night_of_the_soul"
    break_into_three = "break_into_three"
    finale = "finale"
    final_image = "final_image"
    tp_opportunity = "tp_opportunity"
    tp_change_of_plans = "tp_change_of_plans"
    tp_point_of_no_return = "tp_point_of_no_return"
    tp_major_setback = "tp_major_setback"
    tp_climax = "tp_climax"


class StructureStageStatus(StrEnum):
    hit = "hit"
    thin = "thin"
    missing = "missing"
    unverified = "unverified"


# Where a stage's beat sits against its lens's expected window (T10.5).
# Server-derived, separate from status; None when not placed.
class StructurePlacement(StrEnum):
    in_window = "in_window"
    early = "early"
    late = "late"
    out_of_order = "out_of_order"


class StructureStage(_Base):
    stage: StructureStageName
    status: StructureStageStatus
    beat_id: Id | None
    scene_id: Id | None
    reason: str
    evidence_quote: str | None = Field(min_length=1, max_length=200)
    # Server-derived (T10.5), never from the model; defaulted so older checks load.
    position_pct: float | None = Field(default=None, ge=0, le=100)
    expected_pct: float | None = None
    window_pct: float | None = None
    placement: StructurePlacement | None = None


class StructureCheck(_Base):
    lens: StructureLens
    applies: bool
    rationale: str
    stages: list[StructureStage]
    source_hash: str = Field(min_length=1)
    checked_at: str
    prompt_version: str


class Episode(_Base):
    id: Id
    index: int = Field(ge=0)
    locked: bool = False
    title: str
    premise: str
    season_function: str = ""
    storylines: list[EpisodeStoryline]
    scenes: list[Scene]
    timeline_anchors: list[TimelineAnchor] = []
    relationship_states: list[RelationshipState] = []
    object_states: list[ObjectState] = []
    threads: list[StoryThread] = []
    secrets: list[Secret] = []
    story_overview: StoryOverview | None = None
    # T10.6 — up to three principals' arcs (infer_story_overview).
    character_arcs: list[EpisodeCharacterArc] = []
    narrative_map: NarrativeMap | None = None
    # At most one per lens; a new check replaces that lens's entry.
    structure_checks: list[StructureCheck] = []


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
    # sourceText within the line range (disambiguates duplicates). Import also
    # searches the whole beat and ignores whitespace, HTML entities and page
    # furniture (T9.9); null means the quote was not found on the page.
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


class FactStatus(StrEnum):
    active = "active"
    superseded = "superseded"
    stale = "stale"
    pending_review = "pending_review"
    rejected = "rejected"


class KnowledgeEventKind(StrEnum):
    """Only `learns`/`confirms` add to the knower set and only `forgets`
    removes; `suspects` and `misinformed` deliberately do NOT, so `known_by`
    keeps meaning "who actually knows the true fact". See
    packages/contract/src/index.ts's `KnowledgeEventKind` docstring."""

    learns = "learns"
    confirms = "confirms"
    forgets = "forgets"
    suspects = "suspects"
    misinformed = "misinformed"


class KnowledgeEvent(_Base):
    """T7.23 — a knowledge-state transition after a fact's establishing scene.
    See packages/contract/src/index.ts's `KnowledgeEvent` docstring."""

    scene_id: Id
    character_ids: list[Id] = []
    kind: KnowledgeEventKind
    quote: str = ""  # <=200 chars evidence
    # T10.4: what a suspects/misinformed character believes instead; blanked
    # server-side on every other kind.
    belief: str = ""


class FactDelivery(StrEnum):
    """T10.8 — how the audience gets a fact: said outright, shown in picture
    without being said, or left for the audience to put together."""

    stated = "stated"
    shown = "shown"
    implied = "implied"


class LedgerFact(_Base):
    id: Id
    fact: str
    fact_type: FactType
    source_span: SourceSpan
    source_text: str = ""  # verbatim quote from the establishing beat; server-verified
    known_by: list[Id]
    # T7.23 knowledge-transition history beyond the baseline `knownBy` set.
    knowledge_events: list[KnowledgeEvent] = []
    audience_knows: bool = True  # distinct from knownBy — dramatic irony lives in the gap
    # T10.8 exposition audit; null = not read. needed_by_scene_id is the first
    # scene whose events depend on the audience knowing the fact; the server
    # nulls an id that is not a scene of the episode.
    delivery: FactDelivery | None = None
    needed_by_scene_id: Id | None = None
    provenance: Provenance
    confidence: float = Field(ge=0, le=1)
    status: FactStatus
    supersedes: Id | None
    superseded_by: Id | None
    # T7.23 response-only enrichment: GET /ledger?asOfScene= fills this with
    # knowers_as_of's result. Always null outside that query param — never
    # persisted, never settable by clients.
    known_by_as_of: list[Id] | None = None


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
    # None: worked out from the script during import (owner decision 2026-10-11).
    format: ShowFormat | None = None
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
    inferring_acts = "inferring_acts"
    inferring_entities = "inferring_entities"
    inferring_promises = "inferring_promises"
    inferring_overview = "inferring_overview"
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


class ImportFoundScene(_Base):
    index: int = Field(ge=0)
    slugline: str
    line_count: int = Field(ge=0)
    int_ext: Literal["int", "ext", "other"]


class ImportFoundScenes(_Base):
    kind: Literal["scenes"]
    scenes: list[ImportFoundScene]


class ImportFoundBeat(_Base):
    """A segmented beat's reading fields (T9.17); never its `scriptText`."""

    what_happens: str
    audience_learns: str
    audience_feels: str


class ImportFoundSceneRead(_Base):
    kind: Literal["scene"]
    index: int = Field(ge=0)
    beat_count: int = Field(ge=0)
    what_happens: str
    failed: bool
    beats: list[ImportFoundBeat] = []


class ImportFoundActs(_Base):
    kind: Literal["acts"]
    format: ShowFormat
    scene_acts: list[Annotated[int, Field(ge=0)]]


class ImportFoundCastRead(_Base):
    kind: Literal["castRead"]
    scene_indexes: list[Annotated[int, Field(ge=0)]]


class ImportFoundCharacter(_Base):
    name: str
    scene_count: int = Field(ge=0)


class ImportFoundCast(_Base):
    kind: Literal["cast"]
    total: int = Field(ge=0)
    characters: list[ImportFoundCharacter]


class ImportFoundThread(_Base):
    label: str
    status: ThreadStatus
    setup_scene_index: int | None = Field(ge=0)
    payoff_scene_index: int | None = Field(ge=0)


class ImportFoundThreads(_Base):
    kind: Literal["threads"]
    threads: list[ImportFoundThread]


class ImportFoundBeatSheetItem(_Base):
    label: str
    scene_index: int | None = Field(ge=0)


class ImportFoundOverview(_Base):
    kind: Literal["overview"]
    logline: str
    beat_sheet: list[ImportFoundBeatSheetItem]


class ImportFoundFacts(_Base):
    kind: Literal["facts"]
    index: int = Field(ge=0)
    fact_count: int = Field(ge=0)
    secret_count: int = Field(ge=0)
    failed: bool


class ImportFoundFlags(_Base):
    kind: Literal["flags"]
    contradictions: int = Field(ge=0)
    tensions: int = Field(ge=0)
    other: int = Field(ge=0)


ProjectImportFound = Annotated[
    ImportFoundScenes
    | ImportFoundSceneRead
    | ImportFoundActs
    | ImportFoundCastRead
    | ImportFoundCast
    | ImportFoundThreads
    | ImportFoundOverview
    | ImportFoundFacts
    | ImportFoundFlags,
    Field(discriminator="kind"),
]


class ProjectImportFoundEvent(_Base):
    type: Literal["found"]
    stage: ImportProgressStageName
    cached: bool = False
    data: ProjectImportFound


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
            | ProjectImportFoundEvent
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
    addition is tagged 'A', a narrower enum than `StorylineId` (A-D)."""

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


class InferredCharacterRole(StrEnum):
    principal = "principal"
    supporting = "supporting"
    minor = "minor"


class WorldElementKind(StrEnum):
    location = "location"
    object = "object"


# §5a infer_story_entities — import-time character/relationship/world-element
# candidates, run between act inference and fact extraction (prompt spec
# §5a). Names are strings, not ids: the server resolves each against the
# existing bible (matching on name/aliases) and mints new ids for anything
# unresolved — the model never sets/knows ids. Every entity carries at least
# one evidence citation (scene id + short quote) for the review UI.
# A character whose name and aliases match more than one existing row is
# neither attached nor minted; it becomes an open `[merge_proposal]` scene
# flag pointing at Merge into (T9.8).
class EntityEvidence(_Base):
    scene_id: Id
    quote: str  # verbatim-ish; server-truncated to 200 chars


class InferredCharacter(_Base):
    name: str
    aliases: list[str]
    role: InferredCharacterRole
    traits: str  # one line, may be ""
    evidence: list[EntityEvidence] = Field(min_length=1)


class InferredRelationship(_Base):
    between_names: tuple[str, str]
    label: str
    really_like: str  # may be ""
    evidence: list[EntityEvidence] = Field(min_length=1)


class InferredWorldElement(_Base):
    kind: WorldElementKind
    name: str
    note: str  # one line, may be ""
    evidence: list[EntityEvidence] = Field(min_length=1)


# InferredWorldElement rows land as SeriesBible.worldQA entries
# (`q: "Where/What is <name>?"`, `a: note`) — no first-class Project field
# in P0; a dedicated world-element entity is P1 (see task report).
class StoryEntities(_Base):
    characters: list[InferredCharacter]
    relationships: list[InferredRelationship]
    world_elements: list[InferredWorldElement]


# T7.19 infer_narrative_promises — see packages/contract/src/index.ts's
# `NarrativePromises` docstring for the name-resolution/merge rules.
class InferredThread(_Base):
    label: str
    summary: str
    status: ThreadStatus
    owner_names: list[str]
    setup_scene_id: Id
    payoff_scene_id: Id | None
    # The model cites the beat that carries the claim; the server derives the
    # quote from that beat. See the Zod docstring.
    setup_beat_id: Id | None
    payoff_beat_id: Id | None
    # T10.2 — the letter of the storyline this thread belongs to.
    storyline: StorylineId | None = None
    # T10.3 — defaulted so a pre-0.56.0 response or checkpoint parses.
    movements: list[StoryThreadMovement] = []
    closure_level: ThreadClosureLevel | None = None
    second_job: str = ""


class InferredStoryline(_Base):
    """T10.2 — one episode storyline. Names, not ids (server resolves);
    scene ids from the supplied list. See the Zod `NarrativePromises`
    docstring for the merge rules."""

    letter: StorylineId
    summary: str
    character_names: list[str]
    scene_ids: list[Id]


class InferredMotivation(_Base):
    character_name: str
    objective: str
    stakes: str
    obstacle: str
    stated_objective: str
    concealed: bool


class InferredSceneMotivations(_Base):
    scene_id: Id
    motivations: list[InferredMotivation]


class InferredWorldRule(_Base):
    text: str
    limit: str
    cost: str
    exception: str
    evidence_scene_id: Id | None
    # The model cites the beat that carries the claim; the server derives the
    # quote from that beat. See the Zod docstring.
    evidence_beat_id: Id | None


class InferredSecret(_Base):
    """Names, not ids — the server resolves them and mints the secret id."""

    summary: str
    holder_names: list[str]
    concealed_from_names: list[str]
    audience_knows: bool
    established_scene_id: Id
    revealed_scene_id: Id | None
    concealment_scene_ids: list[Id]
    # The model cites the beat that carries the claim; the server derives the
    # quote from that beat. See the Zod docstring.
    established_beat_id: Id | None
    revealed_beat_id: Id | None


class NarrativePromises(_Base):
    threads: list[InferredThread]
    # Defaults to [] so a pre-0.53.0 response or checkpoint parses.
    storylines: list[InferredStoryline] = []
    secrets: list[InferredSecret]
    world_rules: list[InferredWorldRule]


class SceneMotivations(_Base):
    """T10.11 infer_scene_motivations — see packages/contract's
    `SceneMotivations` docstring. Split from NarrativePromises, whose strict
    grammar the API refused once T10.2/T10.3 grew it."""

    scene_motivations: list[InferredSceneMotivations]


class InferredOutlineItem(_Base):
    scene_id: Id
    summary: str
    # T10.6 — the server keeps the ranks only when they are a full,
    # non-identity permutation of the outline rows.
    story_order: int | None = Field(default=None, ge=0)
    story_time: str = ""
    anachrony: Anachrony = Anachrony.none


class InferredCharacterArc(_Base):
    """T10.6 — a principal named as the script names them; resolved on merge."""

    character_name: str
    want: str
    need: str
    lie: str
    ghost: str
    continuum_axis: str
    stops: list[CharacterArcStop]


class InferredBeatSheetItem(_Base):
    beat_id: Id
    label: str
    summary: str
    scene_id: Id | None
    # Required nullable (mirrors Zod InferredStoryOverview.beatSheet.act) —
    # model must emit act or null; merge coerces from the parent scene.
    act: int | None = Field(ge=0)


class InferredStoryOverview(_Base):
    """T7.27 infer_story_overview — see packages/contract InferredStoryOverview."""

    logline: str
    outline: list[InferredOutlineItem]
    beat_sheet: list[InferredBeatSheetItem]
    summary: str
    # T10.6 — defaulted so a pre-0.59.0 response or checkpoint parses.
    dramatic_question: str = ""
    central_argument: str = ""
    anti_theme: str = ""
    character_arcs: list[InferredCharacterArc] = []


class InferredNarrativeEvidence(_Base):
    beat_id: Id


class InferredNarrativeTheme(_Base):
    label: str
    statement: str
    evidence: list[InferredNarrativeEvidence] = Field(min_length=1)


class InferredNarrativeAct(_Base):
    act: int = Field(ge=0)
    dramatic_question: str
    escalation: str
    escalation_evidence: list[InferredNarrativeEvidence] = Field(min_length=1, max_length=3)
    turn_beat_id: Id


class InferredHeroJourneyStage(_Base):
    stage: HeroJourneyStageName
    beat_id: Id
    summary: str


class InferredCharacterArcTurningPoint(_Base):
    beat_id: Id
    change: str


class InferredThreadMovement(_Base):
    thread_id: Id
    beat_id: Id
    phase: ThreadMovementPhase
    summary: str


class InferredNarrativeCharacterArc(_Base):
    character_name: str
    want: str
    need: str
    internal_conflict: str
    external_pressure: str
    arc_summary: str
    turning_points: list[InferredCharacterArcTurningPoint] = Field(min_length=1)


class InferredSceneTurn(_Base):
    scene_id: Id
    focal_character_name: str | None
    dramatic_function: str
    conflict: str
    stakes: str
    turn_beat_id: Id
    turn: str


class InferredHeroJourney(_Base):
    applies: bool
    protagonist_name: str | None
    rationale: str
    stages: list[InferredHeroJourneyStage]


class InferredNarrativeMap(_Base):
    dramatic_question: str
    central_conflict: str
    controlling_idea: str
    themes: list[InferredNarrativeTheme] = Field(min_length=1)
    acts: list[InferredNarrativeAct] = Field(min_length=1)
    hero_journey: InferredHeroJourney
    character_arcs: list[InferredNarrativeCharacterArc]
    scene_turns: list[InferredSceneTurn] = Field(min_length=1)
    thread_movements: list[InferredThreadMovement]


class InferredNarrativeMoment(_Base):
    beat_id: Id = Field(description="A beatId copied from allowedBeatIds for the supplied scene.")
    summary: str = Field(
        description="Concrete on-page action or decision at this moment; never a placeholder."
    )
    dramatic_function: str = Field(
        description=(
            "How this moment changes pressure, information, power, or choice in the scene."
        )
    )
    consequence: str = Field(
        description="What becomes newly true or must be addressed after this moment."
    )


class InferredNarrativeSceneAnalysis(_Base):
    scene_id: Id = Field(description="The single supplied sceneId, copied exactly.")
    summary: str = Field(
        description="A concrete present-tense summary naming the scene's on-page action."
    )
    focal_character_name: str | None = Field(
        description=(
            "A name copied from known_cast when one perspective clearly leads; otherwise null."
        )
    )
    dramatic_function: str = Field(
        description="The specific job this scene performs in the episode's developing story."
    )
    conflict: str = Field(
        description=(
            "The scene's immediate opposition or pressure. For a connective scene, state "
            "that there is no independent confrontation and name the pressure carried forward."
        )
    )
    stakes: str = Field(
        description="What can be gained, lost, exposed, or made harder by the scene's action."
    )
    turn_beat_id: Id = Field(
        description="The allowed beatId where the scene's main change is clearest."
    )
    turn: str = Field(
        description="The concrete change in information, decision, value, or power by scene end."
    )
    key_moments: list[InferredNarrativeMoment] = Field(
        min_length=1,
        description="One or more decisive on-page moments, each tied to an allowed beatId.",
    )


class InferredNarrativeSceneAnalysisBatch(_Base):
    scenes: list[InferredNarrativeSceneAnalysis] = Field(min_length=1)


class InferredNarrativeMapSynthesis(_Base):
    dramatic_question: str
    central_conflict: str
    controlling_idea: str
    themes: list[InferredNarrativeTheme] = Field(min_length=1)
    acts: list[InferredNarrativeAct] = Field(min_length=1)
    hero_journey: InferredHeroJourney
    character_arcs: list[InferredNarrativeCharacterArc]
    thread_movements: list[InferredThreadMovement]


class NarrativeMapVerificationNote(_Base):
    path: str
    reason: str


class NarrativeMapUnsupportedClaim(_Base):
    """A blocking finding, plus the answer the server actually reads.

    `excerpt_carries_claim` is last to match the Zod declaration order, which
    is the decoding grammar's order: state the path, reason it out, then
    commit. See the Zod definition for the retractions that made it necessary.
    """

    path: str
    reason: str
    excerpt_carries_claim: bool


# Mirrors the Zod contract: `unsupported_claims` blocks, `advisories` never
# does, and both carry a reason so the verifier never has to smuggle one into
# the path. See the Zod definition for what that used to cost.
class NarrativeMapVerification(_Base):
    approved: bool
    unsupported_claims: list[NarrativeMapUnsupportedClaim]
    missing_scene_ids: list[Id]
    advisories: list[NarrativeMapVerificationNote]


# Structure checklist ops (spec 2026-10-11). The model never writes quotes or
# scene ids, and never says `unverified`: the server fills and sets those.
class InferredStructureStage(_Base):
    stage: StructureStageName
    status: Literal["hit", "thin", "missing"]
    beat_id: Id | None
    reason: str


class InferredStructureCheck(_Base):
    applies: bool
    rationale: str
    stages: list[InferredStructureStage]


# `supported` is last to match the Zod declaration order (reason, then answer).
class StructureCheckVerdict(_Base):
    stage: StructureStageName
    reason: str
    supported: bool


class StructureCheckVerification(_Base):
    stages: list[StructureCheckVerdict]


class ExtractedFactSourceSpan(_Base):
    episode_id: Id
    scene_id: Id
    beat_id: Id
    start_line: int = Field(ge=0)
    end_line: int = Field(ge=0)


# T7.23 extract-time counterpart to `KnowledgeEvent`: the model names
# characters, never ids (same convention as `knownBy`) -- resolved
# server-side (fountain.characters.normalize_known_by), same as knownBy.
class ExtractedKnowledgeEvent(_Base):
    scene_id: Id
    character_names: list[str] = []
    kind: KnowledgeEventKind
    quote: str = ""
    belief: str = ""  # T10.4: see KnowledgeEvent.belief


# §5 extract_ledger_facts — model span has lines only; char offsets are computed server-side.
class ExtractedFact(_Base):
    fact: str
    fact_type: FactType
    source_span: ExtractedFactSourceSpan
    source_text: str
    known_by: list[Id]
    # T7.23: optional knowledge-transition notes for this fact beyond the
    # baseline knownBy -- empty array is the common case (first cut).
    knowledge_events: list[ExtractedKnowledgeEvent] = []
    audience_knows: bool
    delivery: FactDelivery | None = None  # T10.8: see LedgerFact.delivery
    needed_by_scene_id: Id | None = None
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


class InferredActStart(_Base):
    act: int = Field(ge=0)
    start_scene_index: int = Field(ge=0)

    @field_validator("act", "start_scene_index", mode="before")
    @classmethod
    def require_integral_json_number(cls, value):
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, float) and isfinite(value) and value.is_integer():
            return value
        raise ValueError("must be an integral JSON number")


class InferredActBreaks(_Base):
    starts: list[InferredActStart] = Field(min_length=1)
    format: ShowFormat | None = None


class SegmentedSceneBeat(_Base):
    kind: Literal["beat"]
    start_line: int = Field(ge=1)
    what_happens: str
    audience_learns: str
    audience_feels: str
    # T10.1 — names as the script gives them; the server resolves them.
    actor: str = ""
    action_verb: str = ""
    target: str = ""
    reaction: str = ""
    # T10.9 — defaulted so a pre-0.60.0 response parses.
    kernel: bool = False
    pressure_choice: bool = False


class SegmentedSceneUnassigned(_Base):
    kind: Literal["unassigned"]
    start_line: int = Field(ge=1)
    reason: str


# §7 parse_script stage 2
class SegmentedScene(_Base):
    segments: list[SegmentedSceneBeat | SegmentedSceneUnassigned]
    # Scene-level craft fields — see the Zod `SegmentedScene` docstring for
    # why these ride along with segmentation instead of getting their own pass.
    scene_what_happens: str = ""
    scene_audience_learns: str = ""
    scene_audience_feels: str = ""
    scene_social_situation: str = ""
    # T10.1 — the scene's turn, defaulted so a pre-0.54.0 response parses.
    scene_value_at_stake: str = ""
    scene_charge_in: Charge | None = None
    scene_charge_out: Charge | None = None
    scene_why_now: str = ""


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
