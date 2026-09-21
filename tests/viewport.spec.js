/*
 * MetaLimpia — Viewport matrix spec (Phase 9.7)
 *
 * Confirms the page renders correctly at the seven viewport
 * widths Implementation Plan §12 task 9.7 calls out: 320, 375,
 * 414, 768, 1024, 1440, 1920. Per the brief, the WASM-heavy
 * full-flow spec does not run at every width (it would take
 * ~5x as long as the desktop matrix for marginal benefit).
 * This spec runs the LANDING view only at each width and
 * asserts structural correctness:
 *
 *   1. The four key landmarks are visible (header, dropzone,
 *      verifier, footer).
 *   2. There is NO horizontal scroll (page fits its viewport).
 *   3. A screenshot is captured for visual review.
 *
 * Screenshots land in `tests/screenshots/viewport-<width>.png`
 * (gitignored — generated artifacts, not source). The first
 * 1-2 viewports also get a visual marker in the console so a
 * quick eye can confirm the screenshots are reasonable without
 * opening them.
 *
 * We deliberately skip the file-upload flow here — the
 * full-flow.spec.js already covers the WASM path at desktop
 * defaults, and viewport assertions belong on the static
 * layout, not on the dynamic Worker state.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Viewport widths Implementation Plan §12 task 9.7 enumerates.
 * These cover the smallest mainstream phone (320 = iPhone SE 1st
 * gen), the modern Android default (375), the iPhone Plus tier
 * (414), the small-tablet breakpoint (768), the laptop default
 * (1024), the desktop default (1440), and a full-HD display
 * (1920).
 */
const VIEWPORTS = [
  { width: 320, height: 568, label: 'iPhone-SE-1' },
  { width: 375, height: 667, label: 'iPhone-8' },
  { width: 414, height: 896, label: 'iPhone-11' },
  { width: 768, height: 1024, label: 'iPad' },
  { width: 1024, height: 768, label: 'Laptop' },
  { width: 1440, height: 900, label: 'Desktop' },
  { width: 1920, height: 1080, label: 'Full-HD' },
];

/**
 * Screenshots are written to `tests/screenshots/` so the
 * visual reviewer can flip through them. The directory is
 * gitignored (see .gitignore) — these are generated artifacts,
 * not source.
 */
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

test.describe('Viewport matrix — landing layout at each width', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}x${viewport.height} (${viewport.label}) — landmarks visible, no horizontal scroll`, async ({
      page,
    }, testInfo) => {
      // The viewport applies to THIS test (and any future page
      // navigation within it). The page itself does not change
      // — we just resize the viewport before navigating.
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      await page.goto('/');

      // ---- 1. Landmarks visible. ---------------------------------
      // We assert the four landmarks the landing layout must
      // expose at every width: the header (brand), the dropzone,
      // the privacy verifier, and the footer.
      await expect(page.locator('.site-header')).toBeVisible();
      await expect(page.locator('#dropzone')).toBeVisible();
      await expect(page.locator('.verifier')).toBeVisible();
      await expect(page.locator('.site-footer')).toBeVisible();

      // ---- 2. No horizontal scroll. ------------------------------
      // `scrollWidth > clientWidth` means the page content
      // overflows the viewport horizontally — exactly the bug
      // the breakpoint iteration is trying to prevent.
      const overflow = await page.evaluate(() => ({
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      }));
      expect(
        overflow.documentScrollWidth,
        `document scroll width (${overflow.documentScrollWidth}) ` +
          `should not exceed client width (${overflow.documentClientWidth}) ` +
          `at viewport ${viewport.width}x${viewport.height}`
      ).toBeLessThanOrEqual(overflow.documentClientWidth);

      // ---- 3. Screenshot for visual review. ----------------------
      // Write to the gitignored screenshots dir so the parent
      // can flip through them without polluting the repo. The
      // path includes the testInfo's project + browser so the
      // cross-browser matrix doesn't overwrite each other.
      const projectName = testInfo.project.name;
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `viewport-${projectName}-${viewport.width}.png`
      );
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
    });
  }
});
