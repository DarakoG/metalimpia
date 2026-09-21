/*
 * MetaLimpia — Playwright config (Phase 9)
 *
 * Phase 9 expands the matrix from Chromium-only (Phase 8) to the
 * full TRD §5 support list: Chromium (Desktop Chrome + mobile
 * Chrome via Pixel 5 emulation), Firefox (Desktop), WebKit
 * (Desktop Safari + iPhone 13 mobile Safari emulation). Edge is
 * Chromium-based since 2020, so the `chromium` desktop project
 * covers it as far as the engine goes (UI shell differences are
 * out of scope for Playwright). Real iOS Safari / Android Chrome
 * / native Edge / Safari on macOS still requires hand-on-device
 * QA — see odd/tasks/metalimpia-mvp.md §"Phase 9" manual list.
 *
 * Per project:
 *   - `chromium`         Desktop Chrome (1280×720, Desktop Chrome UA)
 *   - `firefox`          Desktop Firefox (1280×720, Desktop Firefox UA)
 *   - `webkit`           Desktop Safari ≈ Safari 17+ (1280×720, macOS UA)
 *   - `chromium-mobile`  Pixel 5 viewport + touch + mobile Chrome UA
 *   - `webkit-mobile`    iPhone 13 viewport + touch + iOS Safari UA
 *
 * Notes that survive the Phase 8 → Phase 9 transition:
 *
 *   1. The webServer is `vite preview` against the BUILT artifact
 *      in `dist/`. We never test the dev server because:
 *        a. The dev server has its own module graph and HMR; it can
 *           fetch Vite client assets from URLs that don't match
 *           what ships.
 *        b. The privacy guarantee is a property of the SHIPPED
 *           build, not the dev experience.
 *        c. Tests must catch any pre-deploy regression, which
 *           means running against the same `dist/` that GitHub
 *           Pages will publish.
 *
 *   2. Vite's `base: '/metalimpia/'` means the built index.html
 *      references assets via absolute paths like
 *      `/metalimpia/assets/index-*.js`. `vite preview` serves
 *      those correctly from the dist/ root. The tests therefore
 *      navigate to `http://localhost:4173/metalimpia/` — the
 *      same path shape the deployed site uses.
 *
 *   3. Network origin during a test: http://localhost:4173 (the
 *      base URL). Every built asset resolves to the same origin.
 *      Privacy Guard tests compare `request.url().origin` against
 *      `page.url().origin`, which is exactly the same check the
 *      production privacy verifier does internally.
 *
 * Configuration knobs:
 *   - timeout: 60 s. The full-flow test loads the 25 MB ExifTool
 *     WASM on first use; that initial download takes ~10–20 s
 *     depending on the runner. 60 s leaves headroom for a slow CI.
 *   - workers: 1 locally and in CI. Privacy Guard tests share the
 *     single Chromium instance so the network log is per-test.
 *     With 5 projects in the matrix this means tests run serially
 *     across the matrix, not parallel — acceptable trade for
 *     bounded memory on the CI runner.
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
  // is the long pole. Phase 9 raised this from 60 s to 120 s after
  // the cross-browser matrix showed WebKit's Worker write path
  // takes ~30-40 s on top of the Worker init + read pass — well
  // under 60 s on Chromium / Firefox, but Chromium's V8 is
  // noticeably faster than WebKit's JavaScriptCore at the
  // vendored ZeroPerl runtime. 120 s leaves headroom for the
  // worst WebKit run while still failing fast on a real hang.
  timeout: 120_000,
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
    // ---- Desktop matrix (TRD §5 "last 2 stable") ----
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      // Desktop Safari in Playwright = the WebKit engine with a
      // macOS user agent. Per TRD §5 the supported version is
      // "last 2 stable"; Playwright's WebKit build tracks Safari
      // 17+, which is the right era for "last 2 stable" in 2026.
      use: { ...devices['Desktop Safari'] },
    },
    // ---- Mobile matrix (TRD §5 mobile Safari + mobile Chrome) ----
    //
    // HONEST LIMITATION: Playwright mobile emulation is NOT the
    // same as running on a real device. The browser engine, the
    // JavaScript runtime, and the layout engine are identical to
    // the desktop build; only the viewport + user agent + touch
    // flags differ. Real-device QA (touch gestures, OS file
    // picker, App Clip behaviour, share sheet, etc.) is the
    // user's job — see odd/tasks/metalimpia-mvp.md §"Phase 9".
    {
      name: 'chromium-mobile',
      // Pixel 5 is Playwright's reference Android Chrome device
      // (393×851, Pixel 5 UA, `hasTouch: true`).
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'webkit-mobile',
      // iPhone 13 is Playwright's reference iOS Safari device
      // (390×844, iPhone UA, `hasTouch: true`).
      use: { ...devices['iPhone 13'] },
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
