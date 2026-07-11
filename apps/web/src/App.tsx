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
  if (path === '/') {
    if (new URLSearchParams(window.location.search).has('project')) {
      return <WriteScreen />
    }
    window.location.replace('/projects')
    return null
  }
  if (path === '/projects') return <DashboardScreen />
  if (path === '/projects/new/idea') {
    return <IdeaWizardRoute />
  }
  if (path === '/projects/new/import') {
    return <ImportWizardRoute />
  }
  if (path === '/plan') return <PlanScreen />
  if (path === '/review') return <ReviewScreen />
  if (path === '/ledger') return <LedgerScreen />
  return <WriteScreen />
}

export default App
