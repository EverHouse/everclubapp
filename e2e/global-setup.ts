import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const AUTH_STATE_DIR = path.join(process.cwd(), 'e2e', '.auth');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';
const DATABASE_URL = process.env.DATABASE_URL || '';

const ROLES = {
  member: process.env.E2E_MEMBER_EMAIL || 'nicholasallanluu@gmail.com',
  staff: process.env.E2E_STAFF_EMAIL || 'nick@everclub.co',
  admin: process.env.E2E_ADMIN_EMAIL || 'nick@everclub.co',
};

const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] });

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

async function authenticateViaOtp(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  email: string,
  role: string,
): Promise<boolean> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();

    const requestResponse = await page.request.post(
      `${BASE_URL}/api/auth/request-otp`,
      {
        data: { email },
        headers: { Origin: BASE_URL },
      },
    );
    if (!requestResponse.ok()) {
      console.warn(`[E2E setup] OTP request failed for ${role} (${email}): ${requestResponse.status()}`);
      return false;
    }

    const otpCode = await getOtpFromDatabase(email);
    if (!otpCode) {
      console.warn(`[E2E setup] Could not retrieve OTP code from database for ${role} (${email})`);
      return false;
    }

    const verifyResponse = await page.request.post(
      `${BASE_URL}/api/auth/verify-otp`,
      {
        data: { email, code: otpCode },
        headers: { Origin: BASE_URL },
      },
    );
    if (!verifyResponse.ok()) {
      console.warn(`[E2E setup] OTP verify failed for ${role} (${email}): ${verifyResponse.status()}`);
      return false;
    }

    await context.storageState({
      path: path.join(AUTH_STATE_DIR, `${role}.json`),
    });
    return true;
  } finally {
    await context.close();
  }
}

async function authenticateViaDevLogin(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  email: string,
  role: string,
): Promise<boolean> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const response = await page.request.post(
      `${BASE_URL}/api/auth/dev-login`,
      {
        data: { email },
        headers: { Origin: BASE_URL },
      },
    );
    if (!response.ok()) {
      return false;
    }
    await context.storageState({
      path: path.join(AUTH_STATE_DIR, `${role}.json`),
    });
    return true;
  } finally {
    await context.close();
  }
}

async function authenticateRole(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  email: string,
  role: string,
): Promise<boolean> {
  if (DATABASE_URL) {
    const otpSuccess = await authenticateViaOtp(browser, email, role);
    if (otpSuccess) return true;
    console.warn(`[E2E setup] OTP auth failed for ${role}, falling back to dev-login`);
  }

  return authenticateViaDevLogin(browser, email, role);
}

async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

  for (const role of Object.keys(ROLES)) {
    fs.writeFileSync(path.join(AUTH_STATE_DIR, `${role}.json`), EMPTY_STATE);
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.warn('[E2E setup] Could not launch browser for auth setup. Unauthenticated tests will still run.');
    return;
  }

  try {
    for (const [role, email] of Object.entries(ROLES)) {
      if (!email) continue;

      const ok = await authenticateRole(browser, email, role);
      if (ok) {
        console.log(`[E2E setup] Authenticated ${role} (${email})`);
      } else {
        console.warn(
          `[E2E setup] Auth failed for ${role} (${email}). ` +
          'Tests requiring this role will fail. ' +
          'Ensure DATABASE_URL or DEV_LOGIN_ENABLED=true is set.',
        );
      }
    }
  } finally {
    await browser.close();
  }
}

export default globalSetup;
