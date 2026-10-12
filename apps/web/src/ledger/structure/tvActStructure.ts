import type { ShowFormat, StoryOverview } from 'contract'

export type TvStage = {
  key: string
  label: string
  status: 'hit' | 'missing'
  beatId: string | null
  sceneId: string | null
  summary: string
}

const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']
const norm = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
const slug = (label: string) => norm(label).replace(/ /g, '-')

/** The import beat sheet's own label list for this format (render.py beatSheet rules). */
export function tvActStageLabels(format: ShowFormat): string[] {
  const labels = format.coldOpen ? ['Cold Open'] : []
  for (let act = 1; act <= format.actCount; act++) {
    const word = WORDS[act - 1]
    if (act < format.actCount) labels.push(`Act ${word} Turn`)
    labels.push(`Act ${word} Out`)
  }
  labels.push('Climax')
  if (format.tag) labels.push('Tag')
  return labels
}

export function tvActStages(
  format: ShowFormat | null | undefined,
  overview: StoryOverview | null | undefined,
): TvStage[] | null {
  if (!format) return null
  const rows = overview?.beatSheet ?? []
  return tvActStageLabels(format).map((label): TvStage => {
    const wanted =
      label === 'Cold Open' ? ['cold open', 'teaser'] : [norm(label)]
    const row = rows.find((r) => wanted.includes(norm(r.label)))
    return row
      ? {
          key: slug(label),
          label,
          status: 'hit',
          beatId: row.beatId,
          sceneId: row.sceneId,
          summary: row.summary,
        }
      : {
          key: slug(label),
          label,
          status: 'missing',
          beatId: null,
          sceneId: null,
          summary: '',
        }
  })
}
