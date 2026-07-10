import type { Mode } from '../shell/ModeSwitcher'
import { loadResume } from './resumeContext'

const MODE_PATHS: Record<Mode, string> = {
  Write: '/',
  Plan: '/plan',
  Review: '/review',
  Ledger: '/ledger',
}

export function requireProjectId(): string | null {
  const projectId = new URLSearchParams(window.location.search).get('project')
  if (!projectId) {
    window.location.assign('/projects')
    return null
  }
  return projectId
}

export function projectModeHref(projectId: string): string {
  const resume = loadResume(projectId)
  const url = new URL(MODE_PATHS[resume.mode], window.location.origin)
  url.searchParams.set('project', projectId)
  if (resume.sceneId) url.searchParams.set('scene', resume.sceneId)
  return `${url.pathname}${url.search}`
}
