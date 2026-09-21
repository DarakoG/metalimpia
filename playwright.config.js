/*
 * MetaLimpia — Playwright config (Phase 8)
 *
 * Single project: Chromium-only. The parent decision documented
 * in odd/tasks/metalimpia-mvp.md §"Phase 8" explicitly excludes
 * Firefox and WebKit from this phase — those land in Phase 9
 * (manual cross-browser QA). Chromium is sufficient to gate the
 * "no cross-origin network requests" privacy guarantee that is
 * the Phase 8 deliverable.
 *
 * The webServer is `vite preview` against the BUILT artifact in
 * `dist/`. We never test the dev server because:
 *   1. The dev server has its own module graph and HMR; it can
 *      fetch Vite client assets from a CDN-equivalent URL shape
 *      that the built artifact never emits.
 *   2. The privacy guarantee is a property of the SHIPPED build,
 *      not the dev experience.
 *   3. Tests must catch any pre-deploy regression, which means
 *      running against the same `dist/` that GitHub Pages will
 *      publish.
 *
 * Vite's `base: '/metalimpia/'` means the built index.html
 * references assets via absolute paths like
 * `/metalimpia/assets/index-*.js`. `vite preview` serves those
 * correctly from the dist/ root. The tests therefore navigate to
 * `http://localhost:4173/metalimpia/` — the same path shape the
 * deployed site uses.
 *
 * Network origin during a test: http://localhost:4173 (the base
 * URL). Every built asset resolves to the same origin. Privacy
 * Guard tests compare `request.url().origin` against
 * `page.url().origin`, which is exactly the same check the
 * production privacy verifier does internally.
 *
 * Configuration knobs:
 *   - timeout: 60 s. The full-flow test loads the 25 MB ExifTool
 *     WASM on first use; that initial download takes ~10–20 s
 *     depending on the runner. 60 s leaves headroom for a slow CI.
 *   - workers: 1 locally and in CI. Privacy Guard tests share the
 *     single Chromium instance so the network log is per-test.
 *   - retries: 1 in CI, 0 locally. A flaky network assertion
 *     shouldn't mask a real regression, but a single retry catches
 *     transient CI scheduler hiccups.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}/metalimpia`;

export default defineConfig({
  testDir: 'tests',
  // Per-test default timeout — generous because the WASM download
  // is the long pole.
  timeout: 60_000,
  expect: {
    // Auto-wait assertions are fine; explicit waits for network
    // and the WASM init are handled with Playwright's promises.
    timeout: 10_000,
  },
  fullyParallel: true,
  // One worker in CI to keep memory bounded (the Chromium binary
  // is ~150 MB resident); one locally is enough for the suite.
  workers: process.env.CI ? 1 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Lightweight reporter locally, full HTML in CI for artifacts.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: BASE_URL + '/',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    // CI runners are slower; 120 s headroom for the first vite
    // preview startup (which has to compile + serve 25 MB WASM).
    timeout: 120_000,
  },
});
