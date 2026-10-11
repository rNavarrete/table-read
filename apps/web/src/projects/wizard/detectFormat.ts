// Reads the structure a TV script prints (TEASER / COLD OPEN, ACT ONE…, TAG)
// into a ShowFormat, so the import wizard pre-fills the format with no model
// call (owner decision 2026-10-11). Mirrors the server's marker rules
// (apps/api/fountain/acts.py `_printed_act_start`, fountain/characters.py
// `_ACT_MARKER_RE`), so the act count it suggests is one the server's
// printed-act reading accepts instead of discarding.
import type { ShowFormat } from 'contract'
import { FORMAT_PRESETS, type FormatPresetId } from './FormatPresets'
import { SLUGLINE_RE } from './importSourceStats'

const ACT_MARKER_RE =
  /^(?:END OF |TOP OF |BEGIN(?:NING)? OF )?ACT\b[ .]*(?:[0-9IVX]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN)?$/
const ACT_NUMBERS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
}
// ShowFormat.actCount's ceiling (packages/contract).
const MAX_ACTS = 6

export interface DetectedFormat {
  format: ShowFormat
  /** The preset this structure matches exactly, if any. */
  presetId: FormatPresetId | null
  /** What was read, in the writer's terms: "cold open, 3 acts, tag". */
  reason: string
}

// Markers are printed in caps; dialogue such as "Act two." is not one.
function markerText(line: string): string | null {
  const text = line.split(/\s+/).join(' ').trim()
  if (!text || text !== text.toUpperCase()) return null
  return text.replace(/^[<>*_.: ]+|[<>*_.: ]+$/g, '')
}

function matchingPreset(format: ShowFormat): FormatPresetId | null {
  const ids = Object.keys(FORMAT_PRESETS) as FormatPresetId[]
  return (
    ids.find((id) =>
      (Object.keys(format) as (keyof ShowFormat)[]).every(
        (key) => FORMAT_PRESETS[id][key] === format[key],
      ),
    ) ?? null
  )
}

export function detectFormat(source: string): DetectedFormat {
  let coldOpenMarker = false
  let tag = false
  let actCount = 0
  let actOneLine = -1
  let firstSceneLine = -1
  source.split('\n').forEach((line, index) => {
    if (firstSceneLine < 0 && SLUGLINE_RE.test(line)) firstSceneLine = index
    const text = markerText(line)
    if (text === null) return
    const isEnd = text.startsWith('END OF ')
    const body = text.replace(/^END OF /, '')
    if (body === 'TEASER' || body === 'COLD OPEN') {
      coldOpenMarker = true
    } else if (body === 'TAG') {
      tag = true
    } else if (ACT_MARKER_RE.test(text)) {
      const token = body.split(' ').at(-1) ?? ''
      const number = /^\d+$/.test(token) ? Number(token) : ACT_NUMBERS[token]
      if (!number) return
      // The highest act printed, so an act heading lost to OCR damage
      // ("AcT Two") does not shrink the count.
      actCount = Math.max(actCount, number)
      if (number === 1 && !isEnd && actOneLine < 0) actOneLine = index
    }
  })

  if (actCount === 0 || actCount > MAX_ACTS) {
    return {
      format: FORMAT_PRESETS['actless-streaming'],
      presetId: 'actless-streaming',
      reason:
        actCount === 0
          ? 'no act breaks printed'
          : `${actCount} acts printed, more than a format can hold`,
    }
  }
  // Scenes before ACT ONE are a cold open even when its TEASER line is gone.
  const coldOpen =
    coldOpenMarker || (actOneLine > firstSceneLine && firstSceneLine >= 0)
  // A half-hour script prints up to three acts; an hour, four or more.
  const halfHour = actCount <= 3
  const format: ShowFormat = {
    genre: halfHour ? 'comedy' : 'drama',
    runtimeMinutes: halfHour ? 30 : 60,
    actCount,
    coldOpen,
    tag,
    serialization: halfHour ? 0.3 : 0.7,
  }
  const reason = [
    coldOpen ? 'cold open' : null,
    `${actCount} act${actCount === 1 ? '' : 's'}`,
    tag ? 'tag' : null,
  ]
    .filter(Boolean)
    .join(', ')
  return { format, presetId: matchingPreset(format), reason }
}
