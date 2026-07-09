import { PlanScreen } from './plan/PlanScreen'
import { WriteScreen } from './write/WriteScreen'

// No router (T0.1 scaffold; see main.tsx's /tokens switch for the same
// precedent) — Plan mode (T3.1) adds its own pathname branch alongside
// Write's default. ModeSwitcher's navigation and AppShell's ⌘1-4 shortcut
// both navigate by setting `window.location.pathname`, so this is the one
// place that reads it back.
function App() {
  return window.location.pathname === '/plan' ? <PlanScreen /> : <WriteScreen />
}

export default App
