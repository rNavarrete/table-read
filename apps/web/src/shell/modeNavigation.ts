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
  window.location.assign(url.toString())
}

/** Open Write on a specific scene (Plan scene-card double-click / deep link).
 * Preserves `?project=` and sets `?scene=`; drops Review-only `changeSet`. */
export function navigateToWriteScene(sceneId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.searchParams.set('scene', sceneId)
  url.searchParams.delete('changeSet')
  url.searchParams.delete('highlightBeat')
  window.location.assign(url.toString())
}
