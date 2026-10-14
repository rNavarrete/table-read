import type { LedgerFact, Project } from 'contract'
import { boardOrder } from '../write/projectTree'

function sourceSpanParts(
  fact: LedgerFact,
  project: Project,
): { epN: string | number; scN: string | number; beatN: string | number } {
  const span = fact.sourceSpan
  const episode = project.seasons
    .flatMap((s) => s.episodes)
    .find((e) => e.id === span.episodeId)
  const scenes = boardOrder(episode?.scenes ?? [])
  const at = scenes.findIndex((s) => s.id === span.sceneId)
  const beat = scenes[at]?.beats.find((b) => b.id === span.beatId)
  return {
    epN: episode ? episode.index + 1 : '?',
    scN: at >= 0 ? at + 1 : '?',
    beatN: beat ? beat.index + 1 : '?',
  }
}

/** "ep 1 · sc 3 · beat 2" — 1-based; the scene number is its story position. */
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
