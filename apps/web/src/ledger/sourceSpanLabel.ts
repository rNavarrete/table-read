import type { LedgerFact, Project } from 'contract'

/** "ep 1 · sc 3 · beat 2" — episode/scene/beat use 1-based display indices. */
export function formatSourceSpanLabel(
  fact: LedgerFact,
  project: Project,
): string {
  const span = fact.sourceSpan
  const episode = project.seasons
    .flatMap((s) => s.episodes)
    .find((e) => e.id === span.episodeId)
  const scene = episode?.scenes.find((s) => s.id === span.sceneId)
  const beat = scene?.beats.find((b) => b.id === span.beatId)
  const epN = episode ? episode.index + 1 : '?'
  const scN = scene ? scene.index + 1 : '?'
  const beatN = beat ? beat.index + 1 : '?'
  return `ep ${epN} · sc ${scN} · beat ${beatN}`
}
