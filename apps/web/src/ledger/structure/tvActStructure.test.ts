import { describe, expect, it } from 'vitest'
import type { ShowFormat, StoryOverview } from 'contract'
import { tvActStageLabels, tvActStages } from './tvActStructure'

const format = (over: Partial<ShowFormat> = {}): ShowFormat => ({
  genre: 'drama',
  runtimeMinutes: 60,
  actCount: 4,
  coldOpen: true,
  tag: false,
  serialization: 0.5,
  ...over,
})
const overview = (
  rows: { label: string; beatId: string; sceneId: string }[],
): StoryOverview => ({
  logline: '',
  summary: '',
  outline: [],
  provenance: 'inferred',
  locked: false,
  beatSheet: rows.map((r) => ({
    ...r,
    summary: `${r.label} summary`,
    act: null,
  })),
})

describe('tvActStageLabels', () => {
  it('follows the import beat sheet grammar', () => {
    expect(tvActStageLabels(format())).toEqual([
      'Cold Open',
      'Act One Turn',
      'Act One Out',
      'Act Two Turn',
      'Act Two Out',
      'Act Three Turn',
      'Act Three Out',
      'Act Four Out',
      'Climax',
    ])
    expect(
      tvActStageLabels(format({ coldOpen: false, actCount: 2, tag: true })),
    ).toEqual(['Act One Turn', 'Act One Out', 'Act Two Out', 'Climax', 'Tag'])
  })
})

describe('tvActStages', () => {
  it('is null without a format', () => {
    expect(tvActStages(null, null)).toBeNull()
  })
  it('marks every stage missing without a beat sheet', () => {
    const stages = tvActStages(format(), null)!
    expect(stages).toHaveLength(9)
    expect(
      stages.every((s) => s.status === 'missing' && s.beatId === null),
    ).toBe(true)
  })
  it('matches labels case-insensitively, takes the first row, and accepts Teaser', () => {
    const stages = tvActStages(
      format(),
      overview([
        { label: 'teaser', beatId: 'beat-1-1', sceneId: 'scene-1' },
        { label: 'ACT  ONE  TURN', beatId: 'beat-2-1', sceneId: 'scene-2' },
        { label: 'Act One Turn', beatId: 'beat-3-1', sceneId: 'scene-3' },
      ]),
    )!
    expect(stages[0]).toMatchObject({
      label: 'Cold Open',
      status: 'hit',
      beatId: 'beat-1-1',
    })
    expect(stages[1]).toMatchObject({
      label: 'Act One Turn',
      status: 'hit',
      beatId: 'beat-2-1',
    })
    expect(stages[2]).toMatchObject({ label: 'Act One Out', status: 'missing' })
  })
})
