/*
 * MetaLimpia — Browser zoom matrix spec (Phase 9.8)
 *
 * Confirms the landing page reflows correctly when the user
 * scales the entire page via the browser zoom control. Per
 * Implementation Plan §12 task 9.8, four zoom levels are in
 * scope: 50%, 100% (default), 150%, 200%.
 *
 * Zoom is applied via `document.body.style.zoom` rather than
 * the DevTools `Emulation.setPageScaleFactor` because:
 *   - The page-zoom factor scales the rasterised output rather
 *     than the layout. The browser's user-zoom (Ctrl+/-) is
 *     semantically a layout transform: the user wants to see
 *     a LARGER version of the same layout, not a rasterised
 *     image at a larger viewport.
 *   - `body.style.zoom` is the closest browser-level hook that
 *     matches what the user actually sees when they hit
 *     Ctrl+Plus. It is supported in Chromium, Firefox (via
 *     `text-size-adjust: auto;` and `-moz-text-size-adjust`)
 *     and WebKit.
 *   - We're testing LAYOUT — does the page reflow correctly
 *     when content is scaled? — not rasterisation.
 *
 * Each zoom level asserts:
 *   1. Landmarks are still visible.
 *   2. The page does not overflow horizontally as a side-effect
 *      of scaled content. (At 200% a page that would otherwise
 *      scroll vertically is the EXPECTED behaviour; we only
 *      assert no horizontal overflow because that breaks the
 *      mobile-first premise.)
 *   3. The dropzone remains interactive (clicking opens the
 *      file picker — we just verify the click handler is
 *      wired, no actual file is selected).
 *
 * Screenshots land in `tests/screenshots/zoom-<project>-<level>.png`
 * for visual review. The directory is gitignored.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Zoom levels in scope per Implementation Plan §12 task 9.8.
 * The 100% entry is the default — we keep it in the loop so
 * the matrix is exhaustive and the screenshot is uniform.
 */
const ZOOM_LEVELS = [
  { factor: 0.5, label: '50pct' },
  { factor: 1.0, label: '100pct' },
  { factor: 1.5, label: '150pct' },
  { factor: 2.0, label: '200pct' },
];

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

test.describe('Zoom matrix — landing layout at each zoom level', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  for (const zoom of ZOOM_LEVELS) {
    test(`zoom ${zoom.label} — landmarks visible, dropzone clickable`, async ({
      page,
    }, testInfo) => {
      // Default desktop viewport. Zoom applies on top of this.
      await page.setViewportSize({ width: 1280, height: 800 });

      await page.goto('/');

      // Apply the zoom level. Setting `body.style.zoom` is the
      // nearest browser-equivalent of the user's Ctrl+Plus. The
      // property cascades the same way the browser's user zoom
      // does — the layout reflows, not just the rasterisation.
      await page.evaluate((factor) => {
        document.body.style.zoom = String(factor);
      }, zoom.factor);

      // Give the browser one frame to settle the reflow before
      // we measure. Setting `style.zoom` is synchronous but the
      // layout pass is asynchronous.
      await page.waitForTimeout(100);

      // ---- 1. Landmarks visible. ---------------------------------
      await expect(page.locator('.site-header')).toBeVisible();
      await expect(page.locator('#dropzone')).toBeVisible();
      await expect(page.locator('.verifier')).toBeVisible();
      await expect(page.locator('.site-footer')).toBeVisible();

      // ---- 2. No horizontal overflow. ---------------------------
      // At 200% the page will legitimately scroll vertically
      // (the layout is 2x taller). What we care about is no
      // HORIZONTAL scroll, which would mean a min-content
      // width > viewport width.
      const overflow = await page.evaluate(() => ({
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.documentScrollWidth,
        `at zoom ${zoom.label}: document scroll width ` +
          `(${overflow.documentScrollWidth}) should not exceed client ` +
          `width (${overflow.documentClientWidth})`
      ).toBeLessThanOrEqual(overflow.documentClientWidth);

      // ---- 3. Dropzone still clickable. --------------------------
      // Wire a one-shot listener on the hidden file input — if
      // the click handler is wired correctly, clicking the
      // dropzone calls input.click() and fires the input's
      // click event (even if the native picker is suppressed
      // in headless contexts).
      await page.evaluate(() => {
        const input = document.getElementById('file-input');
        /** @type {HTMLInputElement} */ (input).dataset.zoomTestFired = 'false';
        input.addEventListener(
          'click',
          () => {
            /** @type {HTMLInputElement} */ (input).dataset.zoomTestFired = 'true';
          },
          { once: true, capture: true }
        );
      });
      // Force the click — at high zoom the dropzone may sit
      // partly below the fold. `.click()` on the locator
      // scrolls into view first.
      await page.locator('#dropzone').click();
      // The capture-phase listener fires before the browser
      // suppresses the picker dialog, so the dataset flag is
      // set regardless of headless mode.
      const fired = await page.evaluate(
        () => document.getElementById('file-input').dataset.zoomTestFired
      );
      expect(fired, 'dropzone click should call input.click()').toBe('true');

      // ---- 4. Screenshot for visual review. ----------------------
      const projectName = testInfo.project.name;
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `zoom-${projectName}-${zoom.label}.png`
      );
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
    });
  }
});
