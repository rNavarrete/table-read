import { PlanScreen } from './plan/PlanScreen'
import { ReviewScreen } from './review/ReviewScreen'
import { WriteScreen } from './write/WriteScreen'

// No router (T0.1 scaffold; see main.tsx's /tokens switch for the same
// precedent) — Plan (T3.1) and Review (T4.3) add pathname branches alongside
// Write's default. ModeSwitcher's navigation and AppShell's ⌘1-4 shortcut
// both navigate by setting `window.location.pathname`, so this is the one
// place that reads it back.
function App() {
  const path = window.location.pathname
  if (path === '/plan') return <PlanScreen />
  if (path === '/review') return <ReviewScreen />
  return <WriteScreen />
}

export default App
