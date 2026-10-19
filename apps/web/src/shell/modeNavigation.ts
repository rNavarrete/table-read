import type { Mode } from './ModeSwitcher'

// Path each mode navigates to; `null` means "not built yet". No router in
// this app (T0.1 scaffold, same "a single dev route doesn't justify one"
// call as main.tsx's /tokens switch) — mode switching is a full navigation,
// preserving the query string (`?project=`, etc.) so switching modes
// mid-session keeps context.
//
// Kept in its own module (not ModeSwitcher.tsx) so that file stays a
// component-only export — the repo's `react-refresh/only-export-components`
// lint rule warns on mixing a component export with a plain function/const.
const MODE_PATHS: Record<Mode, string | null> = {
  Write: '/',
  Plan: '/plan',
  Review: '/review',
  Ledger: '/ledger',
}

export function isModeBuilt(mode: Mode): boolean {
  return MODE_PATHS[mode] !== null
}

let beforeModeSwitch: (() => Promise<unknown> | null) | null = null
let leaveGuard: (() => Promise<boolean>) | null = null

/** How long a mode switch waits for Write's save before leaving anyway (the
 * beforeunload prompt then covers whatever is still unsaved). */
export const MODE_SWITCH_SAVE_WAIT_MS = 1500

/** Write registers its autosave flush here (write/useWriteQueue.ts): a mode
 * switch is a full navigation, so it waits briefly for the save instead of
 * leaving mid-flight and tripping the beforeunload prompt. The flush returns
 * `null` when nothing is pending, and the switch is then immediate. */
export function setBeforeModeSwitch(
  fn: (() => Promise<unknown> | null) | null,
) {
  beforeModeSwitch = fn
}

/** Plan registers its unsaved-edits confirmation here
 * (plan/panel/useLeaveGuard.ts). Every navigation below (and AppShell's
 * project-title link) asks it first and
 * goes only on `true`; with no guard set they navigate synchronously, exactly
 * as before. */
export function setLeaveGuard(fn: (() => Promise<boolean>) | null) {
  leaveGuard = fn
}

function leave(go: () => void) {
  if (!leaveGuard) return go()
  void leaveGuard().then((ok) => {
    if (ok) go()
  })
}

/** Navigates to `mode` if it's built; a no-op for unbuilt modes. Shared by
 * ModeSwitcher's tab buttons and AppShell's ⌘1-4 shortcut (UI spec §2). */
export function navigateToMode(mode: Mode) {
  const path = MODE_PATHS[mode]
  if (path === null) return
  const url = new URL(window.location.href)
  url.pathname = path
  // Mode-switcher entry to Review lists drafts (UI spec §5). Drop a leftover
  // `changeSet` from a prior Review visit so we don't skip the picker.
  if (mode === 'Review') {
    url.searchParams.delete('changeSet')
  }
  const go = () => window.location.assign(url.toString())
  leave(() => {
    const saving = beforeModeSwitch?.()
    if (!saving) return go()
    void Promise.race([
      saving,
      new Promise((resolve) => setTimeout(resolve, MODE_SWITCH_SAVE_WAIT_MS)),
    ]).then(go)
  })
}

/** Open Write on a specific scene (Plan scene-card double-click / deep link).
 * Preserves `?project=` and sets `?scene=`; drops Review-only `changeSet`. */
export function navigateToWriteScene(sceneId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.searchParams.set('scene', sceneId)
  url.searchParams.delete('changeSet')
  url.searchParams.delete('highlightBeat')
  leave(() => window.location.assign(url.toString()))
}

/** Open Write at a specific beat (Ledger Structure row). Same as
 * `navigateToWriteScene`, but keeps the beat as `?highlightBeat=`. */
export function navigateToWriteBeat(sceneId: string, beatId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.searchParams.set('scene', sceneId)
  url.searchParams.set('highlightBeat', beatId)
  url.searchParams.delete('changeSet')
  leave(() => window.location.assign(url.toString()))
}

/** Open one fact in Ledger (Plan's fact links). Keeps `?project=`. */
export function navigateToLedgerFact(factId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/ledger'
  url.searchParams.set('fact', factId)
  leave(() => window.location.assign(url.toString()))
}

/** Back to the project list (AppShell's project title). */
export function navigateToProjects() {
  leave(() => window.location.assign('/projects'))
}
