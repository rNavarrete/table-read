import { describe, expect, it } from 'vitest'
import type { Character, Motivation, Scene } from 'contract'
import { peekLines } from './CardPeek'
import type { SceneSignals } from './story'

const character = (id: string, name: string): Character => ({
  id,
  name,
  locked: false,
  aliases: [],
  embodiment: '',
  presentation: '',
  hiding: '',
  traits: '',
  seriesArc: '',
  summary: '',
  bio: '',
})
const want = (characterId: string): Motivation => ({
  characterId,
  objective: '',
  stakes: '',
  obstacle: '',
  statedObjective: '',
  concealed: false,
})
const cast = [
  character('char-berg', 'Bergstrom'),
  character('char-lisa', 'Lisa'),
]

function signals(over: Partial<SceneSignals>): SceneSignals {
  return {
    scene: { id: 'scene-1' } as Scene,
    turn: null,
    clashes: [],
    knowledge: null,
    ...over,
  } as SceneSignals
}

describe('peekLines', () => {
  it('states the turn, the clash in full names, and who is in the dark', () => {
    expect(
      peekLines(
        signals({
          turn: {
            stake: 'Self-worth',
            charges: ['holds at ±', 'holds at mixed'],
            holds: true,
          },
          clashes: [{ a: want('char-berg'), b: want('char-lisa') }],
          knowledge: { irony: ['char-lisa'], mystery: [], suspense: false },
        }),
        cast,
      ),
    ).toEqual([
      { term: 'Turns', text: 'Self-worth holds at ±' },
      { term: 'Clash', text: 'Bergstrom vs Lisa' },
      { term: 'Who knows', text: 'Dramatic irony: Lisa in the dark' },
    ])
  })

  it('names the audience for a mystery and leaves out what was not read', () => {
    expect(
      peekLines(
        signals({
          knowledge: { irony: [], mystery: ['char-berg'], suspense: false },
        }),
        cast,
      ),
    ).toEqual([
      { term: 'Who knows', text: 'Mystery: the audience is in the dark' },
    ])
    expect(peekLines(signals({}), cast)).toEqual([])
  })
})
