import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxies the api (port 8000, per Makefile) under the same origin the
    // browser sees, so the write-mode api client can call relative
    // `/api/v1/...` paths with no CORS setup needed on the api side (which
    // has none) — the same trick apps/web/e2e/playwright.config.ts relies on
    // when it runs the real api behind this dev server. Streams SSE
    // responses through untouched (no buffering). TABLEREAD_API_URL points it
    // elsewhere when port 8000 is taken.
    //
    // 127.0.0.1, not `localhost`: uvicorn listens on IPv4 loopback only, and
    // `localhost` resolves to ::1 first, so every proxied request had to fail
    // over from a refused ::1. A few in every thousand never came back,
    // leaving a fetch unanswered and Plan stuck on "Loading…" (2 in 1,000
    // reloads). Keep any TABLEREAD_API_URL on 127.0.0.1 too.
    proxy: {
      '/api': process.env.TABLEREAD_API_URL ?? 'http://127.0.0.1:8000',
    },
    fs: { allow: [rootDir] },
  },
  test: {
    // e2e/ holds Playwright specs (`npm run e2e`), which import `@playwright/
    // test`'s own `test`/`expect` — vitest's default include glob would
    // otherwise try to run them too and fail on the mismatched test runner.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Polyfills for jsdom's missing layout methods — see src/test-setup.ts.
    setupFiles: ['./src/test-setup.ts'],
  },
})
