import type { LedgerFact } from 'contract'

export type FactChapterId =
  'knowledge' | 'event' | 'state' | 'relationship' | 'world_rule'

export interface FactChapter {
  id: FactChapterId
  title: string
  facts: LedgerFact[]
}

const CHAPTERS: ReadonlyArray<{ id: FactChapterId; title: string }> = [
  { id: 'knowledge', title: 'People & knowledge' },
  { id: 'event', title: 'Events' },
  { id: 'state', title: 'States' },
  { id: 'relationship', title: 'Relationships' },
  { id: 'world_rule', title: 'World rules' },
]

export function groupFactsIntoChapters(facts: LedgerFact[]): FactChapter[] {
  const byType = new Map<FactChapterId, LedgerFact[]>()
  for (const fact of facts) {
    const chapterId = fact.factType as FactChapterId
    const bucket = byType.get(chapterId)
    if (bucket) {
      bucket.push(fact)
    } else {
      byType.set(chapterId, [fact])
    }
  }

  return CHAPTERS.flatMap((chapter) => {
    const chapterFacts = byType.get(chapter.id)
    if (!chapterFacts?.length) return []
    return [{ ...chapter, facts: chapterFacts }]
  })
}
