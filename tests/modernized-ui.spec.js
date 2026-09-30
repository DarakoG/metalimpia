import { test, expect } from '@playwright/test';

for (const width of [375, 1440]) {
  test(`privacy remains available through the task at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('#dropzone')).toBeFocused();
    expect(await page.locator('#dropzone').evaluate(el =>
      getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.locator('#verifier-toggle').click();
    await expect(page.locator('#verifier-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#verifier-detail')).toBeVisible();
    expect((await page.locator('#verifier-toggle').boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `tests/screenshots/modernized-landing-${width}.png`, fullPage: true });

    await page.setInputFiles('#file-input', {
      name: `${'synthetic-long-name-'.repeat(8)}.png`,
      mimeType: 'image/png',
      buffer: await (await import('node:fs/promises')).readFile('tests/fixtures/sample-with-author.png'),
    });
    await expect(page.locator('.results-card')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.dropzone-section')).toBeHidden();
    await expect(page.locator('#verifier')).toBeVisible();
    await expect(page.locator('#verifier-detail')).toBeVisible();
    const checkbox = page.locator('.metadata-tag-checkbox').first();
    const resultsBox = await page.locator('.results-card').boundingBox();
    const verifierBox = await page.locator('#verifier').boundingBox();
    expect(resultsBox.x).toBe(verifierBox.x);
    expect(resultsBox.width).toBe(verifierBox.width);
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    const group = page.locator('.metadata-group-header-button').first();
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <=
      document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `tests/screenshots/modernized-results-${width}.png`, fullPage: true });

    await page.locator('.results-actions .btn').last().click();
    await expect(page.locator('#dropzone')).toBeVisible();
    await page.setInputFiles('#file-input', {
      name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('local fixture'),
    });
    await expect(page.locator('.error-card')).toBeVisible();
    await expect(page.locator('#verifier')).toBeVisible();
    await page.screenshot({ path: `tests/screenshots/modernized-error-${width}.png`, fullPage: true });
  });
}

test('touch expansion and reduced motion remain usable', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, hasTouch: true, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:4173/metalimpia/');
  await page.locator('#verifier-toggle').tap();
  await expect(page.locator('#verifier-detail')).toBeVisible();
  expect(await page.locator('#dropzone').evaluate(el =>
    parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
  await context.close();
});
