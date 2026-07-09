import { LedgerScreen } from './ledger/LedgerScreen'
import { PlanScreen } from './plan/PlanScreen'
import { ReviewScreen } from './review/ReviewScreen'
import { WriteScreen } from './write/WriteScreen'

// No router (T0.1 scaffold; see main.tsx's /tokens switch for the same
// precedent) — each mode adds its own pathname branch. ModeSwitcher's
// navigation and AppShell's ⌘1-4 shortcut both navigate by setting
// `window.location.pathname`, so this is the one place that reads it back.
function App() {
  const path = window.location.pathname
  if (path === '/plan') return <PlanScreen />
  if (path === '/review') return <ReviewScreen />
  if (path === '/ledger') return <LedgerScreen />
  return <WriteScreen />
}

export default App
