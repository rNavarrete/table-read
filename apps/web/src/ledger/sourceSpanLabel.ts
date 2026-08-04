import type { LedgerFact, Project } from 'contract'

function sourceSpanParts(
  fact: LedgerFact,
  project: Project,
): { epN: string | number; scN: string | number; beatN: string | number } {
  const span = fact.sourceSpan
  const episode = project.seasons
    .flatMap((s) => s.episodes)
    .find((e) => e.id === span.episodeId)
  const scene = episode?.scenes.find((s) => s.id === span.sceneId)
  const beat = scene?.beats.find((b) => b.id === span.beatId)
  return {
    epN: episode ? episode.index + 1 : '?',
    scN: scene ? scene.index + 1 : '?',
    beatN: beat ? beat.index + 1 : '?',
  }
}

/** "ep 1 · sc 3 · beat 2" — episode/scene/beat use 1-based display indices. */
export function formatSourceSpanLabel(
  fact: LedgerFact,
  project: Project,
): string {
  const { epN, scN, beatN } = sourceSpanParts(fact, project)
  return `ep ${epN} · sc ${scN} · beat ${beatN}`
}

/** Kept for callers that use a chip, but the wording matches every Ledger view. */
export function formatSourceSpanChip(
  fact: LedgerFact,
  project: Project,
): string {
  return formatSourceSpanLabel(fact, project)
}
