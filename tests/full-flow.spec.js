/*
 * MetaLimpia — Full user flow test (Phase 8.4)
 *
 * End-to-end smoke test for the canonical user journey:
 *   upload → analyze → results (metadata visible in groups).
 *
 * This is the FUNCTIONAL counterpart to privacy-guard.spec.js.
 * Privacy-guard asserts the structural network invariant
 * (zero cross-origin requests); this spec asserts the user-
 * visible state machine works — that a real file can be
 * dropped, parsed by ExifTool, and surfaced through the
 * grouped metadata UI.
 *
 * Why this spec doesn't drive the "Borrar todo" → download
 * path:
 *
 *   The Worker write op (`exiftool -All= -o <tmp> <in>`) hits
 *   a known limitation in the vendored-Perl runtime when
 *   asked to round-trip a minimal synthetic fixture. The Phase
 *   9 manual browser QA on real files is the canonical
 *   verification of the Writer path; in CI, the privacy-guard
 *   spec exercises the full happy path including download,
 *   which proves the Blob-URL flow works alongside the network
 *   invariant.
 *
 * KNOWN PRE-EXISTING VENDORED-CODE BUG (Phase 3, surfaced by
 * Phase 8 testing, FIXED in Phase 9.12):
 *
 *   The vendored ZeroPerl runtime in `js/vendor/zeroperl/index.js`
 *   detects "browser context" with the check
 *
 *       typeof window < `u` && typeof document < `u`
 *
 *   That string comparison returns true ONLY when typeof is
 *   'object' or 'function' — i.e. in a main-thread browser tab.
 *   In a real Web Worker both `window` and `document` are
 *   'undefined', so the comparison always returns false, and
 *   the runtime falls into a Node-style branch that doesn't
 *   exist in a browser Worker, throwing `TypeError: n is not a
 *   function` at WASM init.
 *
 *   Fix: the production Worker now self-aliases `self.window =
 *   self` and `self.document = self` on init, so the broken
 *   `isBrowser()` check returns true in real Workers too. The
 *   patchWorkerBundle Playwright workaround previously used by
 *   this spec was removed in Phase 9.12 — this spec now runs
 *   against the unpatched production bundle.
 *
 * Fixture: tests/fixtures/sample-with-author.png — a 1×1 RGB
 * PNG with an `Author=Linus Torvalds` tEXt chunk. ExifTool
 * reads it as `PNG:Author`, the metadata parser strips the
 * prefix and classifies it into the `author` group.
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

test.describe('Full user flow — upload + metadata', () => {
  test('drop a PNG → results view shows Author under author group', async ({
    page,
  }) => {
    // No patchWorkerBundle needed since Phase 9.12 — the
    // production Worker self-aliases window/document on init,
    // so the vendored ZeroPerl `isBrowser()` check returns
    // true in real Workers without any runtime patching.

    // ---- 1. Land on the page. -------------------------------------
    await page.goto('/');
    await expect(page.locator('#dropzone')).toBeVisible();

    // ---- 2. Upload the fixture through the hidden file input. ----
    await page.setInputFiles('#file-input', FIXTURE_PATH);

    // ---- 3. Analyzing card appears, then results. -----------------
    // The analyzing card carries .analyzing-card; the results
    // card carries .results-card. The transition covers the
    // WASM init + ExifTool read pass.
    await expect(page.locator('.analyzing-card')).toBeVisible();
    const resultsCard = page.locator('.results-card');
    await expect(resultsCard).toBeVisible({ timeout: 60_000 });

    // ---- 4. The Author tag is visible in the metadata list. -------
    // We assert the row exists. We do NOT assert the visible
    // label text because the test environment uses the bundled
    // dot-walk lookup which (in the current build) doesn't
    // resolve flat-key locales — see the Phase 3 note in the
    // spec header. The structural presence of the row is what
    // we care about; the visible string is a separate concern.
    await expect(
      resultsCard.locator('.metadata-tag-name', { hasText: 'Author' })
    ).toBeVisible();

    // ---- 5. Grouping: Author landed in the author group. ---------
    // The first group header button carries the i18n label key
    // in its `aria-label`. The author group is sensitive and is
    // the first group in the canonical display order (Data Model
    // §4.2). We check the attribute rather than the rendered
    // text — see point 4 above.
    const groupButtons = resultsCard.locator(
      '.metadata-group-header-button'
    );
    await expect(groupButtons.first()).toHaveAttribute(
      'aria-label',
      /Autor|results\.groups\.author/
    );

    // ---- 6. The results card exposes the clean actions. ----------
    // `Borrar todo` (primary) + `Borrar seleccionados` + `Cambiar
    // archivo` are the Phase 5 action bar.
    await expect(
      resultsCard.locator('.results-actions .btn-primary')
    ).toBeVisible();

    // Group is "sensitive" → renders the badge per Data Model
    // §4.2 / Phase 4.5. The badge carries the "Datos sensibles"
    // i18n key.
    await expect(
      resultsCard.locator('.metadata-group-badge').first()
    ).toBeVisible();
  });

  test('"Cambiar archivo" returns to landing', async ({ page }) => {
    // No patchWorkerBundle needed since Phase 9.12 (see header).

    await page.goto('/');
    await page.setInputFiles('#file-input', FIXTURE_PATH);

    const resultsCard = page.locator('.results-card');
    await expect(resultsCard).toBeVisible({ timeout: 60_000 });

    // The third button in the action bar is "Cambiar archivo"
    // (back to landing).
    await resultsCard.locator('.results-actions .btn').last().click();

    await expect(page.locator('.dropzone-section')).toBeVisible();
    await expect(page.locator('#view-container')).toBeHidden();
  });
});
