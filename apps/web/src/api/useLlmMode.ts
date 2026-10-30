import { useEffect, useState } from 'react'

/** The server's `llmMode` from `/health` ("real", "mock" or
 * "unconfigured"); null until it answers or if it can't be reached, which
 * says nothing about the mode. A bare fetch, like AppShell's, so tests that
 * module-mock api/client needn't know about it. */
export function useLlmMode(): string | null {
  const [mode, setMode] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => fetch('/api/v1/health'))
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { llmMode?: string } | null) => {
        if (!cancelled && body?.llmMode) setMode(body.llmMode)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return mode
}
