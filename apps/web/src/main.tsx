import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import TokensPage from './dev/TokensPage.tsx'

// No router yet (T0.1 scaffold). A single dev route doesn't justify adding
// one — see CLAUDE.md rule 10 — so this switches on pathname directly.
const page = window.location.pathname === '/tokens' ? <TokensPage /> : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>{page}</StrictMode>,
)
