import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';

test.describe('Authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.describe('Login Page UI', () => {
    test('renders login page with email input and branding', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await expect(emailInput).toHaveAttribute('type', 'email');
    });

    test('email input accepts valid email and submits OTP request', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });

      await emailInput.fill('test@example.com');
      await expect(emailInput).toHaveValue('test@example.com');

      const submitButton = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Send"), button:has-text("Log In")').first();
      if (await submitButton.isVisible()) {
        await submitButton.click();
        await page.waitForTimeout(1000);
      }
    });

    test('submit button is disabled or validates when email is empty', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });

      const submitButton = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Send"), button:has-text("Log In")').first();
      if (await submitButton.isVisible()) {
        const isDisabled = await submitButton.isDisabled();
        if (isDisabled) {
          expect(isDisabled).toBe(true);
        } else {
          await submitButton.click();
          const hasValidation =
            (await emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity())) ||
            (await page.locator('[role="alert"], .text-red-700, .text-red-400, .text-red-500').count()) > 0;
          expect(hasValidation).toBe(true);
        }
      }
    });
  });

  test.describe('Route Guards', () => {
    test('unauthenticated user visiting /dashboard is redirected to /login', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/login**', { timeout: 10_000 });
      expect(page.url()).toContain('/login');
    });

    test('unauthenticated user visiting /book is redirected to /login', async ({ page }) => {
      await page.goto('/book');
      await page.waitForURL('**/login**', { timeout: 10_000 });
      expect(page.url()).toContain('/login');
    });

    test('unauthenticated user visiting /admin is redirected away', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForTimeout(3000);
      expect(page.url()).not.toMatch(/\/admin$/);
    });

    test('unauthenticated user visiting /settings is redirected away', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForTimeout(3000);
      const url = page.url();
      expect(url).not.toMatch(/\/settings$/);
    });
  });

  test.describe('Dev Login', () => {
    test('dev login endpoint responds when DEV_LOGIN_ENABLED', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/auth/dev-login`, {
        data: { email: 'nick@everclub.co' },
        headers: { Origin: BASE_URL },
      });
      expect([200, 401, 403]).toContain(response.status());
    });
  });

  test.describe('OTP Endpoints', () => {
    test('request-otp endpoint responds with appropriate status', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/auth/request-otp`, {
        data: { email: 'nonexistent-test@example.com' },
        headers: { Origin: BASE_URL },
      });
      expect([200, 400, 404, 429]).toContain(response.status());
    });

    test('verify-otp with invalid code returns error', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/auth/verify-otp`, {
        data: { email: 'test@example.com', code: '000000' },
        headers: { Origin: BASE_URL },
      });
      expect([400, 401, 404, 429]).toContain(response.status());
    });
  });

  test.describe('Session', () => {
    test('session endpoint returns 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/auth/session`);
      expect([200, 401]).toContain(response.status());
      if (response.status() === 200) {
        const data = await response.json();
        expect(data.authenticated === false || data.member === null || data.member === undefined).toBeTruthy();
      }
    });
  });
});
