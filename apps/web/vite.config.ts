import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxies the api (port 8000, per Makefile) under the same origin the
    // browser sees, so the write-mode api client can call relative
    // `/api/v1/...` paths with no CORS setup needed on the api side (which
    // has none) — the same trick apps/web/e2e/playwright.config.ts relies on
    // when it runs the real api behind this dev server. Streams SSE
    // responses through untouched (no buffering).
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    // e2e/ holds Playwright specs (`npm run e2e`), which import `@playwright/
    // test`'s own `test`/`expect` — vitest's default include glob would
    // otherwise try to run them too and fail on the mismatched test runner.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
