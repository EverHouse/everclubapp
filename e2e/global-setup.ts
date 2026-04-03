import { test as setup } from '@playwright/test';
import { setupAuthState, AUTH_STATE_DIR } from './fixtures/auth';
import fs from 'fs';
import path from 'path';

const TEST_MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || 'nick@everclub.co';
const TEST_STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || '';
const TEST_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';

setup('authenticate as member', async ({ page }) => {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

  await setupAuthState(page, 'member', TEST_MEMBER_EMAIL);

  if (TEST_STAFF_EMAIL) {
    await setupAuthState(page, 'staff', TEST_STAFF_EMAIL);
  } else {
    fs.writeFileSync(
      path.join(AUTH_STATE_DIR, 'staff.json'),
      JSON.stringify({ cookies: [], origins: [] }),
    );
  }

  if (TEST_ADMIN_EMAIL) {
    await setupAuthState(page, 'admin', TEST_ADMIN_EMAIL);
  } else {
    fs.writeFileSync(
      path.join(AUTH_STATE_DIR, 'admin.json'),
      JSON.stringify({ cookies: [], origins: [] }),
    );
  }
});
