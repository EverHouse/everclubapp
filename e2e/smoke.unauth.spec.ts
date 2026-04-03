import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('landing page loads and renders key content', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveTitle(/ever/i);

    const body = page.locator('body');
    await expect(body).toBeVisible();

    const hasContent = await page.locator('main, [role="main"], #root').first().isVisible();
    expect(hasContent).toBe(true);

    await page.waitForTimeout(2000);

    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('net::ERR') &&
        !e.includes('Failed to load resource') &&
        !e.includes('[vite]') &&
        !e.includes('WebSocket'),
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await expect(emailInput.first()).toBeVisible({ timeout: 10000 });
  });

  test('API health check responds', async ({ request }) => {
    const response = await request.get('/healthz');
    expect(response.ok()).toBe(true);
  });
});
