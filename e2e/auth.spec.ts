import { test as baseTest, expect } from '@playwright/test';
import { test as authTest } from './fixtures/auth';
import pg from 'pg';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';
const DATABASE_URL = process.env.DATABASE_URL || '';
const TEST_EMAIL = process.env.E2E_MEMBER_EMAIL || 'nick@everclub.co';

async function getOtpFromDatabase(email: string): Promise<string | null> {
  if (!DATABASE_URL) return null;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT token FROM magic_links
       WHERE LOWER(email) = LOWER($1) AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    return result.rows[0]?.token || null;
  } finally {
    await client.end();
  }
}

baseTest.describe('Authentication — Unauthenticated', () => {
  baseTest.use({ storageState: { cookies: [], origins: [] } });

  baseTest.describe('Login Page UI', () => {
    baseTest('renders login page with email input', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await expect(emailInput).toHaveAttribute('type', 'email');
    });

    baseTest('email input accepts value and submit button is present', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await emailInput.fill('test@example.com');
      await expect(emailInput).toHaveValue('test@example.com');

      const submitButton = page.locator('button[type="submit"]').first();
      await expect(submitButton).toBeVisible();
      await expect(submitButton).toBeEnabled();
    });

    baseTest('submit button is disabled when email is empty', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await expect(emailInput).toHaveValue('');

      const submitButton = page.locator('button[type="submit"]').first();
      await expect(submitButton).toBeVisible();
      await expect(submitButton).toBeDisabled();
    });

    baseTest('requesting OTP transitions login UI to next step', async ({ page, request }) => {
      const otpResp = await request.post(`${BASE_URL}/api/auth/request-otp`, {
        data: { email: TEST_EMAIL },
        headers: { Origin: BASE_URL },
      });

      if (otpResp.status() === 429) {
        baseTest.skip(true, 'OTP rate limited — cannot test UI transition');
      }

      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await emailInput.fill(TEST_EMAIL);

      const submitButton = page.locator('button[type="submit"]').first();
      await expect(submitButton).toBeEnabled();
      await submitButton.click();

      const otpInput = page.locator('input[inputmode="numeric"]').first();
      await expect(otpInput).toBeVisible({ timeout: 10_000 });
    });
  });

  baseTest.describe('OTP Login E2E', () => {
    baseTest('full OTP login flow: request → retrieve → verify → lands on protected page', async ({ page, request }) => {
      baseTest.skip(!DATABASE_URL, 'DATABASE_URL required for OTP E2E test');

      const otpResp = await request.post(`${BASE_URL}/api/auth/request-otp`, {
        data: { email: TEST_EMAIL },
        headers: { Origin: BASE_URL },
      });
      baseTest.skip(otpResp.status() === 429, 'OTP rate limited, skipping');
      expect(otpResp.ok()).toBe(true);

      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('#login-email');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await emailInput.fill(TEST_EMAIL);

      const submitButton = page.locator('button[type="submit"]').first();
      await expect(submitButton).toBeEnabled();
      await submitButton.click();

      const otpInput = page.locator('input[inputmode="numeric"]').first();
      await expect(otpInput).toBeVisible({ timeout: 10_000 });

      const otpCode = await getOtpFromDatabase(TEST_EMAIL);
      baseTest.skip(!otpCode, 'Could not retrieve OTP from database');

      const digits = otpCode!.split('');
      const otpInputs = page.locator('input[inputmode="numeric"]');
      for (let i = 0; i < digits.length; i++) {
        await otpInputs.nth(i).fill(digits[i]);
      }

      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
      expect(page.url()).not.toContain('/login');
    });
  });

  baseTest.describe('Route Guards — Unauthenticated Redirects', () => {
    baseTest('/dashboard redirects to /login', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/login**', { timeout: 10_000 });
      expect(page.url()).toContain('/login');
    });

    baseTest('/book redirects to /login', async ({ page }) => {
      await page.goto('/book');
      await page.waitForURL('**/login**', { timeout: 10_000 });
      expect(page.url()).toContain('/login');
    });

    baseTest('/admin redirects away', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForURL((url) => !url.pathname.endsWith('/admin'), { timeout: 10_000 });
      expect(page.url()).not.toMatch(/\/admin$/);
    });

    baseTest('/settings redirects away', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForURL((url) => !url.pathname.endsWith('/settings'), { timeout: 10_000 });
      expect(page.url()).not.toMatch(/\/settings$/);
    });
  });

  baseTest.describe('Auth API Endpoints', () => {
    baseTest('dev login endpoint responds', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/auth/dev-login`, {
        data: { email: TEST_EMAIL },
        headers: { Origin: BASE_URL },
      });
      expect([200, 401, 403]).toContain(response.status());
    });

    baseTest('request-otp endpoint responds', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/auth/request-otp`, {
        data: { email: 'nonexistent-e2e-test@example.com' },
        headers: { Origin: BASE_URL },
      });
      expect([200, 400, 404, 429]).toContain(response.status());
    });

    baseTest('verify-otp rejects invalid code', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/auth/verify-otp`, {
        data: { email: 'test@example.com', code: '000000' },
        headers: { Origin: BASE_URL },
      });
      expect([400, 401, 404, 429]).toContain(response.status());
    });

    baseTest('session endpoint indicates unauthenticated for no-cookie request', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/auth/session`);
      const status = response.status();

      if (status === 401) {
        return;
      }

      expect(status).toBe(200);
      const data = await response.json();
      expect(data.authenticated).toBe(false);
    });

    baseTest('logout endpoint responds to unauthenticated request', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/auth/logout`, {
        headers: { Origin: BASE_URL },
      });
      expect([200, 204, 302, 401]).toContain(response.status());
    });
  });
});

authTest.describe('Authentication — Authenticated User', () => {
  authTest('authenticated user can access protected pages', async ({ memberPage }) => {
    await memberPage.goto('/dashboard');
    await memberPage.waitForLoadState('domcontentloaded');

    const url = memberPage.url();
    const isProtected = url.includes('/dashboard') || url.includes('/admin');
    expect(isProtected).toBe(true);

    expect(url).not.toContain('/login');
  });

  authTest('authenticated user is not redirected to login', async ({ memberPage }) => {
    await memberPage.goto('/dashboard');
    await memberPage.waitForLoadState('domcontentloaded');
    expect(memberPage.url()).not.toContain('/login');
  });

  authTest('session endpoint returns authenticated user data', async ({ memberPage }) => {
    const response = await memberPage.request.get(`${BASE_URL}/api/auth/session`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.member || data.authenticated).toBeTruthy();
  });

  authTest('sign out button is visible on profile page', async ({ memberPage }) => {
    await memberPage.goto('/profile');
    await memberPage.waitForLoadState('domcontentloaded');

    const signOutButton = memberPage.getByRole('button', { name: /sign out/i });
    await expect(signOutButton).toBeVisible({ timeout: 10_000 });
  });

  authTest('sign out redirects to login page', async ({ memberPage }) => {
    await memberPage.goto('/profile');
    await memberPage.waitForLoadState('domcontentloaded');

    const signOutButton = memberPage.getByRole('button', { name: /sign out/i });
    await expect(signOutButton).toBeVisible({ timeout: 10_000 });
    await signOutButton.click();

    await memberPage.waitForURL('**/login**', { timeout: 10_000 });
    expect(memberPage.url()).toContain('/login');
  });

  authTest('session is invalid after logout API call', async ({ memberPage }) => {
    const logoutResp = await memberPage.request.post(`${BASE_URL}/api/auth/logout`, {
      headers: { Origin: BASE_URL },
    });
    expect([200, 204, 302]).toContain(logoutResp.status());

    const sessionResp = await memberPage.request.get(`${BASE_URL}/api/auth/session`);
    if (sessionResp.status() === 200) {
      const data = await sessionResp.json();
      expect(data.authenticated === false || !data.member).toBeTruthy();
    } else {
      expect(sessionResp.status()).toBe(401);
    }
  });
});
