import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.resolve(__dirname, '..')

// Overridable for machines where these ports are taken (for example by a
// running `make dev`): E2E_API_PORT=8100 E2E_WEB_PORT=5180 npm run e2e.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8000)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173)

/**
 * Playwright e2e (data contract's own harness for T2.3's acceptance
 * criterion). Design, in brief (full rationale in the task report):
 *
 * - **Real api, real endpoints, seeded temp DB, `MockLlmClient`** —
 *   `start-api.sh` runs the actual FastAPI app against a disposable SQLite
 *   copy of the fixture, with `ANTHROPIC_API_KEY` explicitly unset so
 *   `llm/dependency.py`'s no-key fallback selects `MockLlmClient` (hard rule
 *   1 holds for e2e too — this process can never reach the real network).
 *   This exercises the real SSE/accept/tune wiring, not a hand-rolled stub.
 * - **Playwright route interception** layers on top for the handful of
 *   error-state scenarios `MockLlmClient`'s deterministic, always-succeeds
 *   responses can't produce on their own (a dropped connection, an accept
 *   503) — see error-states.spec.ts.
 * - **One worker.** All specs share the one seeded project the api starts
 *   with; running them serially keeps the suite deterministic without
 *   needing per-test project isolation plumbing this task doesn't call for.
 */
export default defineConfig({
  testDir: __dirname,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bash e2e/start-api.sh',
      cwd: WEB_DIR,
      env: { E2E_API_PORT: String(API_PORT) },
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      cwd: WEB_DIR,
      env: { TABLEREAD_API_URL: `http://127.0.0.1:${API_PORT}` }, // not localhost: vite.config.ts
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
