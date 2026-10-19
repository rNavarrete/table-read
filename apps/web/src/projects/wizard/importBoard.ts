import type {
  ConsistencyFlag,
  ImportFoundBeat,
  LedgerFact,
  Project,
  ProjectImportFound,
  ShowFormat,
} from 'contract'
import { actLabel } from '../../plan/planTree'
import { sceneLocationType } from '../../write/sceneType'

// The live import board (spec 2026-10-12-import-board-design.md): a pure
// fold of the stream's `found` frames, then one reconcile against the
// `complete` payload. No React here; the board components render it.

export type BoardScene = {
  index: number
  slugline: string
  lineCount: number
  intExt: 'int' | 'ext' | 'other'
  read: 'pending' | 'read' | 'failed'
  beatCount: number
  whatHappens: string
  beats: ImportFoundBeat[] // each beat's reading, in order; [] until read
  act: number | null
  castRead: boolean
  factCount: number | null
  secretCount: number
  factsFailed: boolean
  pins: number[] // 1-based thread numbers pinned on this card
}

export type BoardThread = {
  label: string
  status: 'open' | 'paid_off' | 'abandoned'
  setupSceneIndex: number | null
  payoffSceneIndex: number | null
}

export type BoardState = {
  scenes: BoardScene[]
  format: ShowFormat | null
  actsKnown: boolean
  cast: {
    total: number
    characters: { name: string; sceneCount: number }[]
  } | null
  threads: BoardThread[] | null
  logline: string | null
  beatSheet: { label: string; sceneIndex: number | null }[]
  flags: { contradictions: number; tensions: number; other: number } | null
  latestIndex: number | null // newest filled card (read or facts) for the lift/lamp
  factTotal: number
}

export function emptyBoard(): BoardState {
  return {
    scenes: [],
    format: null,
    actsKnown: false,
    cast: null,
    threads: null,
    logline: null,
    beatSheet: [],
    flags: null,
    latestIndex: null,
    factTotal: 0,
  }
}

function pendingCard(
  scene: Pick<BoardScene, 'index' | 'slugline' | 'lineCount' | 'intExt'>,
): BoardScene {
  return {
    ...scene,
    read: 'pending',
    beatCount: 0,
    whatHappens: '',
    beats: [],
    act: null,
    castRead: false,
    factCount: null,
    secretCount: 0,
    factsFailed: false,
    pins: [],
  }
}

function withCard(
  state: BoardState,
  index: number,
  update: Partial<BoardScene>,
): BoardState {
  if (!state.scenes.some((card) => card.index === index)) return state
  return {
    ...state,
    scenes: state.scenes.map((card) =>
      card.index === index ? { ...card, ...update } : card,
    ),
  }
}

function pinsFor(index: number, threads: BoardThread[]): number[] {
  return threads.flatMap((thread, k) =>
    thread.setupSceneIndex === index || thread.payoffSceneIndex === index
      ? [k + 1]
      : [],
  )
}

function factTotal(scenes: BoardScene[]): number {
  return scenes.reduce((sum, card) => sum + (card.factCount ?? 0), 0)
}

export function applyFound(
  state: BoardState,
  data: ProjectImportFound,
): BoardState {
  switch (data.kind) {
    case 'scenes':
      // A parse starts the board over: a resumed stream re-sends every
      // later frame (cached ones included), so nothing stale survives.
      return { ...emptyBoard(), scenes: data.scenes.map(pendingCard) }
    case 'scene': {
      const next = withCard(state, data.index, {
        read: data.failed ? 'failed' : 'read',
        beatCount: data.beatCount,
        whatHappens: data.whatHappens,
        // Frames arrive unparsed, so the contract's default applies here.
        beats: data.beats ?? [],
      })
      return next === state ? state : { ...next, latestIndex: data.index }
    }
    case 'acts':
      return {
        ...state,
        format: data.format,
        actsKnown: true,
        scenes: state.scenes.map((card) => ({
          ...card,
          act: data.sceneActs[card.index] ?? null,
        })),
      }
    case 'castRead': {
      const covered = new Set(data.sceneIndexes)
      return {
        ...state,
        scenes: state.scenes.map((card) =>
          covered.has(card.index) ? { ...card, castRead: true } : card,
        ),
      }
    }
    case 'cast':
      return {
        ...state,
        cast: { total: data.total, characters: data.characters },
      }
    case 'threads':
      return {
        ...state,
        threads: data.threads,
        scenes: state.scenes.map((card) => ({
          ...card,
          pins: pinsFor(card.index, data.threads),
        })),
      }
    case 'overview':
      return { ...state, logline: data.logline, beatSheet: data.beatSheet }
    case 'facts': {
      const next = withCard(state, data.index, {
        factCount: data.factCount,
        secretCount: data.secretCount,
        factsFailed: data.failed,
      })
      if (next === state) return state
      return {
        ...next,
        latestIndex: data.index,
        factTotal: factTotal(next.scenes),
      }
    }
    case 'flags':
      return {
        ...state,
        flags: {
          contradictions: data.contradictions,
          tensions: data.tensions,
          other: data.other,
        },
      }
  }
}

/** Settle the board once against the `complete` payload: counts come from the
 * saved project, readings the writer already saw stay, and anything the
 * stream never delivered is filled from the project's scenes and beats. */
export function reconcileWithResult(
  state: BoardState,
  result: {
    project: Project
    newFacts: LedgerFact[]
    consistencyFlags: ConsistencyFlag[]
  },
): BoardState {
  const { project, newFacts, consistencyFlags } = result
  const episode = project.seasons[0]?.episodes[0]
  const projectScenes = episode?.scenes ?? []
  const indexById = new Map(projectScenes.map((s) => [s.id, s.index]))
  const sceneIndex = (id: string | null) =>
    id === null ? null : (indexById.get(id) ?? null)
  const seen = new Map(state.scenes.map((card) => [card.index, card]))
  // A unit the stream never showed (a replay of only the terminal `complete`)
  // is known failed by the flag the server files on its scene.
  const flagged = (sceneId: string, code: string) =>
    consistencyFlags.some(
      (f) =>
        f.objectType === 'scene' &&
        f.objectId === sceneId &&
        f.explanation.startsWith(`[${code}]`),
    )

  const threads: BoardThread[] = (episode?.threads ?? []).map((thread) => ({
    label: thread.label,
    status: thread.status,
    setupSceneIndex: sceneIndex(thread.setupSceneId),
    payoffSceneIndex: sceneIndex(thread.payoffSceneId),
  }))

  const scenes = projectScenes.map((scene): BoardScene => {
    const card = seen.get(scene.index)
    const wasRead = card !== undefined && card.read !== 'pending'
    const facts = newFacts.filter((f) => f.sourceSpan.sceneId === scene.id)
    return {
      index: scene.index,
      slugline: card?.slugline ?? scene.location,
      lineCount:
        card?.lineCount ??
        scene.beats.reduce(
          (sum, beat) =>
            sum + (beat.scriptText ? beat.scriptText.split('\n').length : 0),
          0,
        ),
      intExt: card?.intExt ?? sceneLocationType(scene),
      read: wasRead
        ? card.read
        : flagged(scene.id, 'segmentation_failed')
          ? 'failed'
          : 'read',
      whatHappens: wasRead ? card.whatHappens : scene.whatHappens,
      beats: wasRead
        ? card.beats
        : scene.beats.map((beat) => ({
            whatHappens: beat.whatHappens,
            audienceLearns: beat.audienceLearns,
            audienceFeels: beat.audienceFeels,
          })),
      beatCount: scene.beats.length,
      act: scene.act,
      castRead: true,
      factCount: facts.length,
      secretCount: facts.filter((f) => !f.audienceKnows).length,
      factsFailed:
        card !== undefined && (card.factCount !== null || card.factsFailed)
          ? card.factsFailed
          : flagged(scene.id, 'extraction_failed'),
      pins: pinsFor(scene.index, threads),
    }
  })

  const contradictions = consistencyFlags.filter(
    (f) => f.severity === 'contradiction',
  ).length
  const tensions = consistencyFlags.filter(
    (f) => f.severity === 'tension',
  ).length
  const overview = episode?.storyOverview ?? null

  return {
    ...state,
    scenes,
    format: project.format,
    actsKnown: true,
    cast: {
      total: project.seriesBible.characters.length,
      characters: state.cast?.characters ?? [],
    },
    threads,
    logline: overview?.logline ?? state.logline,
    beatSheet: overview
      ? overview.beatSheet.map((item) => ({
          label: item.label,
          sceneIndex: sceneIndex(item.sceneId),
        }))
      : state.beatSheet,
    flags: {
      contradictions,
      tensions,
      other: consistencyFlags.length - contradictions - tensions,
    },
    factTotal: newFacts.length,
  }
}

/** A read card with a beat to show opens its reading view (T9.17). */
export function isReadable(scene: BoardScene): boolean {
  return (
    scene.read === 'read' &&
    scene.beats.some((beat) => beat.whatHappens.trim() !== '')
  )
}

/** Act frames for the board, in act order; `[]` until the acts land. */
export function actGroups(
  state: BoardState,
): { act: number; label: string; sceneIndexes: number[] }[] {
  const format = state.format
  if (!state.actsKnown || format === null) return []
  const byAct = new Map<number, number[]>()
  for (const card of state.scenes) {
    if (card.act === null) continue
    byAct.set(card.act, [...(byAct.get(card.act) ?? []), card.index])
  }
  return [...byAct.entries()]
    .sort(([a], [b]) => a - b)
    .map(([act, sceneIndexes]) => ({
      act,
      label: actLabel(act, format),
      sceneIndexes: sceneIndexes.sort((a, b) => a - b),
    }))
}
