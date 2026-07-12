import type { ReactNode } from 'react'
import { RecipeHost } from './onboarding/RecipeOverlay'
import { LedgerScreen } from './ledger/LedgerScreen'
import { PlanScreen } from './plan/PlanScreen'
import { DashboardScreen } from './projects/DashboardScreen'
import {
  IdeaWizardRoute,
  ImportWizardRoute,
} from './projects/wizard/NewProjectWizards'
import { ReviewScreen } from './review/ReviewScreen'
import { WriteScreen } from './write/WriteScreen'

// No router (T0.1 scaffold; see main.tsx's /tokens switch for the same
// precedent) — each mode adds its own pathname branch. ModeSwitcher's
// navigation and AppShell's ⌘1-4 shortcut both navigate by setting
// `window.location.pathname`, so this is the one place that reads it back.
function App() {
  const path = window.location.pathname
  let screen: ReactNode
  if (path === '/') {
    if (new URLSearchParams(window.location.search).has('project')) {
      screen = <WriteScreen />
    } else {
      window.location.replace('/projects')
      return null
    }
  } else if (path === '/projects') screen = <DashboardScreen />
  else if (path === '/projects/new/idea') screen = <IdeaWizardRoute />
  else if (path === '/projects/new/import') screen = <ImportWizardRoute />
  else if (path === '/plan') screen = <PlanScreen />
  else if (path === '/review') screen = <ReviewScreen />
  else if (path === '/ledger') screen = <LedgerScreen />
  else screen = <WriteScreen />

  return (
    <>
      {screen}
      <RecipeHost />
    </>
  )
}

export default App
