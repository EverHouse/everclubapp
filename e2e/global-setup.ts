import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_STATE_DIR = path.join(process.cwd(), 'e2e', '.auth');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';
const TEST_MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || 'nick@everclub.co';
const TEST_STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || '';
const TEST_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';

const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] });

async function authenticateRole(
  browser: ReturnType<typeof chromium.launch> extends Promise<infer T> ? T : never,
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
      console.warn(`[E2E setup] Auth failed for ${role} (${email}): ${response.status()}`);
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

async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

  fs.writeFileSync(path.join(AUTH_STATE_DIR, 'member.json'), EMPTY_STATE);
  fs.writeFileSync(path.join(AUTH_STATE_DIR, 'staff.json'), EMPTY_STATE);
  fs.writeFileSync(path.join(AUTH_STATE_DIR, 'admin.json'), EMPTY_STATE);

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.warn('[E2E setup] Could not launch browser for auth setup. Unauthenticated tests will still run.');
    return;
  }

  try {
    const memberOk = await authenticateRole(browser, TEST_MEMBER_EMAIL, 'member');
    if (!memberOk) {
      console.warn(
        '[E2E setup] Member auth failed. Authenticated tests will be skipped.\n' +
        'Ensure DEV_LOGIN_ENABLED=true and the dev server is running.',
      );
    }

    if (TEST_STAFF_EMAIL) {
      await authenticateRole(browser, TEST_STAFF_EMAIL, 'staff');
    }

    if (TEST_ADMIN_EMAIL) {
      await authenticateRole(browser, TEST_ADMIN_EMAIL, 'admin');
    }
  } finally {
    await browser.close();
  }
}

export default globalSetup;
