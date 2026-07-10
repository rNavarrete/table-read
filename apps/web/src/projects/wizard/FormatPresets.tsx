import type { ShowFormat } from 'contract'

export const FORMAT_PRESETS = {
  'one-hour-drama': {
    genre: 'drama',
    runtimeMinutes: 60,
    actCount: 5,
    coldOpen: true,
    tag: true,
    serialization: 0.7,
  },
  'half-hour-comedy': {
    genre: 'comedy',
    runtimeMinutes: 30,
    actCount: 2,
    coldOpen: true,
    tag: false,
    serialization: 0.3,
  },
  'actless-streaming': {
    genre: 'dramedy',
    runtimeMinutes: 60,
    actCount: 1,
    coldOpen: false,
    tag: false,
    serialization: 0.8,
  },
} as const satisfies Record<string, ShowFormat>

export type FormatPresetId = keyof typeof FORMAT_PRESETS

export const FORMAT_PRESET_LABELS: Record<FormatPresetId, string> = {
  'one-hour-drama': 'One-hour drama',
  'half-hour-comedy': 'Half-hour comedy',
  'actless-streaming': 'Actless streaming',
}
