import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_STATE_DIR = path.join(process.cwd(), 'e2e', '.auth');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';
const TEST_MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || 'nick@everclub.co';
const TEST_STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || '';
const TEST_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';

async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

  const browser = await chromium.launch();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const memberResponse = await memberPage.request.post(
    `${BASE_URL}/api/auth/dev-login`,
    {
      data: { email: TEST_MEMBER_EMAIL },
      headers: { Origin: BASE_URL },
    },
  );
  if (!memberResponse.ok()) {
    const body = await memberResponse.text();
    await browser.close();
    throw new Error(
      `E2E auth setup failed for member (${TEST_MEMBER_EMAIL}): ${memberResponse.status()} — ${body}\n` +
      'Ensure DEV_LOGIN_ENABLED=true is set and the dev server is running.',
    );
  }
  await memberContext.storageState({
    path: path.join(AUTH_STATE_DIR, 'member.json'),
  });
  await memberContext.close();

  if (TEST_STAFF_EMAIL) {
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    const staffResponse = await staffPage.request.post(
      `${BASE_URL}/api/auth/dev-login`,
      {
        data: { email: TEST_STAFF_EMAIL },
        headers: { Origin: BASE_URL },
      },
    );
    if (!staffResponse.ok()) {
      console.warn(`Staff auth setup failed for ${TEST_STAFF_EMAIL}, skipping.`);
    }
    await staffContext.storageState({
      path: path.join(AUTH_STATE_DIR, 'staff.json'),
    });
    await staffContext.close();
  } else {
    fs.writeFileSync(
      path.join(AUTH_STATE_DIR, 'staff.json'),
      JSON.stringify({ cookies: [], origins: [] }),
    );
  }

  if (TEST_ADMIN_EMAIL) {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminResponse = await adminPage.request.post(
      `${BASE_URL}/api/auth/dev-login`,
      {
        data: { email: TEST_ADMIN_EMAIL },
        headers: { Origin: BASE_URL },
      },
    );
    if (!adminResponse.ok()) {
      console.warn(`Admin auth setup failed for ${TEST_ADMIN_EMAIL}, skipping.`);
    }
    await adminContext.storageState({
      path: path.join(AUTH_STATE_DIR, 'admin.json'),
    });
    await adminContext.close();
  } else {
    fs.writeFileSync(
      path.join(AUTH_STATE_DIR, 'admin.json'),
      JSON.stringify({ cookies: [], origins: [] }),
    );
  }

  await browser.close();
}

export default globalSetup;
