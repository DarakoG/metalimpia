import { test, expect } from '@playwright/test';

test.describe('Privacy page delivery', () => {
  test('loads both stylesheets and returns within the project base', async ({ page }) => {
    const cspErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /refused to apply style/i.test(message.text())) {
        cspErrors.push(message.text());
      }
    });

    await page.goto('/metalimpia/privacidad.html');
    await expect(page.locator('.policy-page')).toBeVisible();
    await expect(page.locator('.policy-back')).toHaveAttribute('href', '/metalimpia/');
    await expect(page.locator('link[href="/metalimpia/css/privacy.css"]')).toHaveCount(1);
    await expect(page.locator('link[href="/metalimpia/css/styles.css"]')).toHaveCount(1);
    expect(await page.locator('.policy-page').evaluate((element) =>
      getComputedStyle(element).maxWidth)).toBe('640px');
    expect(cspErrors).toEqual([]);

    await page.locator('.policy-back').click();
    await expect(page.locator('#dropzone')).toBeVisible();
  });
});
