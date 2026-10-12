// Exports JSON Schema for every §1/§2/§2a contract type, one call per type
// (never a shared registry) so each schema comes out fully self-contained —
// no cross-type $ref/$defs on the Zod side. Invoked by
// scripts/check_contract.py, which does the same on the Pydantic side and
// diffs the two. Run directly: `node packages/contract/scripts/export-json-schema.ts`.
import * as contract from '../src/index.ts'

// Data contract §5: "covering §1, §2, and the §2a LLM operation schemas."
// Storage-derived envelope types (Snapshot, SuggestionHistoryEntry,
// PersistedState) are deliberately excluded — see index.ts's module header.
const SCHEMA_NAMES = [
  // §1
  'ShowFormat',
  'Character',
  'Relationship',
  'SeriesBible',
  'Motivation',
  'Beat',
  'Scene',
  'TimelineAnchor',
  'RelationshipState',
  'ObjectState',
  'StoryThread',
  'StoryOverviewOutlineItem',
  'StoryOverviewBeatItem',
  'StoryOverview',
  'NarrativeEvidence',
  'NarrativeTheme',
  'NarrativeAct',
  'HeroJourneyStage',
  'HeroJourney',
  'CharacterArcTurningPoint',
  'NarrativeCharacterArc',
  'SceneTurn',
  'ThreadMovement',
  'NarrativeMap',
  'NarrativeMapRun',
  'StructureStage',
  'StructureCheck',
  'WorldRule',
  'Episode',
  'Season',
  'SourceSpan',
  'KnowledgeEvent',
  'LedgerFact',
  'Project',
  'ProjectSummary',
  'CharacterSeed',
  'ProjectFoundationInput',
  'ProjectCreateRequest',
  'ProjectImportCreateRequest',
  'SnapshotSummary',
  'ProjectRestoreRequest',
  // §2
  'BeatCandidate',
  'ImpactedObject',
  'ConsistencyFlag',
  'ProjectImportResult',
  'ProjectImportProgressEvent',
  'BeatUpdate',
  'SceneUpdate',
  'SceneAddition',
  'InitialSceneSkeletonCandidate',
  'ChangeSetPreview',
  'ChangeSet',
  // §2a
  'BlastRadius',
  'RegeneratedElements',
  'ExtractedKnowledgeEvent',
  'ExtractedFact',
  'LedgerExtraction',
  'InstructionSuggestions',
  'SuggestRequest',
  'InferredActBreaks',
  'SegmentedScene',
  'ConsistencyScan',
  'InitialSceneSkeleton',
  'EntityEvidence',
  'InferredCharacter',
  'InferredRelationship',
  'InferredWorldElement',
  'StoryEntities',
  'NarrativePromises',
  'InferredStoryOverview',
  'InferredNarrativeMap',
  'InferredNarrativeSceneAnalysisBatch',
  'InferredNarrativeMapSynthesis',
  'NarrativeMapVerification',
  'InferredStructureCheck',
  'StructureCheckVerification',
] as const

const { z } = await import('zod')

const output: Record<string, unknown> = {}
for (const name of SCHEMA_NAMES) {
  const schema = (contract as Record<string, unknown>)[name]
  if (!schema) {
    throw new Error(
      `export-json-schema: no export named "${name}" in packages/contract/src/index.ts`,
    )
  }
  output[name] = z.toJSONSchema(schema as Parameters<typeof z.toJSONSchema>[0])
}

process.stdout.write(JSON.stringify(output))
