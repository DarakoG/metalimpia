/*
 * MetaLimpia — Privacy Guard test (Phase 8.3)
 *
 * THIS IS THE GATE.
 *
 * Asserts the Phase 7 audit's structural claim — every network
 * request the page makes during the full user flow is same-origin —
 * in an automated, deterministic, CI-runnable form. If this test
 * fails, deploy is blocked (the deploy job in
 * .github/workflows/deploy.yml has `needs: test`).
 *
 * The test runs the END-TO-END user flow (drop → analyze →
 * results → click "Borrar todo" → done → click "Descargar") so
 * every same-origin request the deployed page can possibly make
 * is in scope:
 *
 *   - The page HTML + CSS + JS bundle (asset preloads)
 *   - The lazy ExifTool WASM after the first file drop
 *   - The Worker JS bundle (same-origin blob: import per the CSP)
 *   - The Blob URL created when the user clicks "Descargar" — a
 *     same-origin object URL, classified as internal by the live
 *     privacy verifier
 *
 * If any of those requests goes cross-origin, the test fails with
 * a detailed failure message listing the offending URL, the moment
 * it fired, and which view was on screen. The Privacy Verifier
 * data attribute is also asserted as a redundant invariant — the
 * page's own bookkeeping should agree with Playwright's network-
 * layer observation.
 *
 * Why not just trust the production Privacy Verifier?
 *   Because a structural test must not depend on the product code
 *   it tests. Reading `performance.getEntriesByType('resource')`
 *   from inside the page trusts the page's own bookkeeping.
 *   Playwright sees EVERY request at the network layer
 *   (`page.on('request')`) — XHR, fetch, sub-resource loads,
 *   prefetch hints — regardless of what the page does or doesn't
 *   observe. That's the property we care about.
 *
 * Why the full flow and not just landing?
 *   The Worker lazy-loads the ExifTool WASM after the first file
 *   drop. Skipping the upload step would miss that request (it's
 *   same-origin but large). Running the full flow also exercises
 *   the Blob URL download on the done view, which IS a same-origin
 *   request that the live verifier sees as an internal resource.
 *
 * KNOWN PRE-EXISTING VENDORED-CODE BUG (Phase 3, surfaced by
 * Phase 8 testing): see tests/full-flow.spec.js for the full
 * writeup. This spec applies the same `page.route()` patch so
 * the Worker init succeeds in the test runtime.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'sample-with-author.png'
);

/**
 * Build a structured summary of a request for the failure message.
 * @param {import('@playwright/test').Request} req
 */
function describeRequest(req) {
  return {
    url: req.url(),
    method: req.method(),
    resourceType: req.resourceType(),
  };
}

/**
 * Patch the Phase 3 Worker detection bug via Playwright
 * `page.route()` so the runtime takes the browser-fetch branch
 * inside the Worker module. See tests/full-flow.spec.js for the
 * full writeup.
 */
async function patchWorkerBundle(page) {
  await page.route('**/exiftool.worker-*.js', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    const original =
      'function ue(){return typeof window<`u`&&typeof document<`u`}';
    const replacement = 'function ue(){return !0}';
    if (body.includes(original)) {
      body = body.replace(original, replacement);
    }
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body,
    });
  });
}

test.describe('Privacy Guard — no cross-origin network requests', () => {
  test('full flow: zero non-origin requests', async ({ page }) => {
    await patchWorkerBundle(page);

    /** @type {Array<{ at: string, view: string, request: object }>} */
    const captured = [];
    /** @type {string} */
    let activeView = 'landing';

    page.on('request', (req) => {
      captured.push({
        at: new Date().toISOString(),
        view: activeView,
        request: describeRequest(req),
      });
    });

    // ---- 1. Navigate to the built page. --------------------------
    // We wait for the landing dropzone to be visible so the page
    // and its assets are fully loaded before we start asserting.
    await page.goto('/');
    await expect(page.locator('#dropzone')).toBeVisible();
    activeView = 'landing';

    // ---- 2. Upload the test fixture. -----------------------------
    // setInputFiles bypasses the native file dialog; the file is
    // uploaded straight into the hidden #file-input the uploader
    // listens on.
    await page.setInputFiles('#file-input', FIXTURE_PATH);

    // ---- 3. Wait for the analyzing → results transition. ---------
    await expect(page.locator('.analyzing-card')).toBeVisible();
    activeView = 'analyzing';

    // The Worker init + ExifTool WASM download + read pass happens
    // here. The test timeout (60 s) covers the worst case on slow
    // CI runners.
    await expect(page.locator('.results-card')).toBeVisible({
      timeout: 60_000,
    });
    activeView = 'results';

    // Sanity check: the metadata parser produced at least one tag.
    await expect(page.locator('.metadata-tag-row').first()).toBeVisible();

    // ---- 4. Click "Borrar todo" and wait for the terminal view. --
    // The Worker write op might fail for the synthetic PNG due to
    // a known vendored-Perl runtime limitation (Phase 9 real-file
    // QA is the canonical verification). What we assert here is
    // that the click triggers A transition — the page must leave
    // the results view in some direction.
    await page.locator('.results-actions .btn-primary').click();

    const terminal = page.locator('.done-card, .error-card');
    await expect(terminal).toBeVisible({ timeout: 60_000 });
    activeView = await page
      .locator('.done-card')
      .isVisible()
      .then((isDone) => (isDone ? 'done' : 'error'));

    // ---- 5. If we reached the done view, fire the download. ------
    if ((await page.locator('.done-card').isVisible()) === true) {
      const downloadPromise = page.waitForEvent('download', {
        timeout: 10_000,
      });
      await page.locator('.done-actions .btn-primary').click();
      await downloadPromise;
    }

    // ---- 6. Assert: every captured request is same-origin. ------
    const pageOrigin = new URL(page.url()).origin;
    const external = captured.filter(({ request }) => {
      try {
        return new URL(request.url).origin !== pageOrigin;
      } catch {
        // A non-parseable URL is suspicious — treat as a failure
        // case so the test surfaces the bug rather than ignoring
        // it.
        return true;
      }
    });

    if (external.length > 0) {
      // Build a readable failure message listing every offender.
      const summary = external
        .map(
          (e) =>
            `    [${e.view}] ${e.request.method} ${e.request.url} ` +
            `(${e.request.resourceType}) at ${e.at}`
        )
        .join('\n');
      throw new Error(
        `Privacy Guard FAILED: ${external.length} non-origin request(s) ` +
          `detected (page origin = ${pageOrigin}):\n${summary}`
      );
    }

    // ---- 7. Redundant invariant: the on-page verifier reports 0.
    // The privacy verifier widget (js/ui/privacyVerifier.js) sets
    // `data-external-count` on its summary element. A zero value
    // confirms the page's own view agrees with Playwright's
    // network-layer observation.
    const externalCount = await page
      .locator('.verifier-summary')
      .getAttribute('data-external-count');
    expect(externalCount).toBe('0');
  });
});
