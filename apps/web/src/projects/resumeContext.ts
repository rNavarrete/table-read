import type { Mode } from '../shell/ModeSwitcher'

export interface ResumeContext {
  mode: Mode
  sceneId?: string
}

const MODES: readonly Mode[] = ['Write', 'Plan', 'Review', 'Ledger']

function storageKey(projectId: string): string {
  return `tr.resume.v1.${projectId}`
}

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && MODES.includes(value as Mode)
}

export function loadResume(
  projectId: string,
  sceneIds?: readonly string[],
): ResumeContext {
  const raw = localStorage.getItem(storageKey(projectId))
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }

  const candidate =
    parsed && typeof parsed === 'object'
      ? (parsed as Partial<ResumeContext>)
      : {}
  const mode = isMode(candidate.mode) ? candidate.mode : 'Write'
  const sceneId =
    typeof candidate.sceneId === 'string' ? candidate.sceneId : undefined

  if (!sceneIds) return sceneId ? { mode, sceneId } : { mode }
  if (!sceneId) return { mode, sceneId: sceneIds[0] }
  return {
    mode,
    sceneId: sceneIds.includes(sceneId) ? sceneId : sceneIds[0],
  }
}

export function saveResume(projectId: string, context: ResumeContext) {
  localStorage.setItem(storageKey(projectId), JSON.stringify(context))
}
