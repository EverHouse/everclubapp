import { test as base, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export type TestRole = 'member' | 'staff' | 'admin';

export interface AuthFixtures {
  memberPage: Page;
  staffPage: Page;
  adminPage: Page;
  authenticatedPage: Page;
}

const AUTH_STATE_DIR = path.join(process.cwd(), 'e2e', '.auth');

export function authStatePath(role: TestRole): string {
  return path.join(AUTH_STATE_DIR, `${role}.json`);
}

function requireAuthState(role: TestRole): string {
  const filePath = authStatePath(role);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Auth state file missing for "${role}". Run global setup first.`,
    );
  }
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!content.cookies || content.cookies.length === 0) {
    throw new Error(
      `Auth state for "${role}" has no session cookies. ` +
      `Authentication likely failed during global setup. ` +
      `Check E2E_${role.toUpperCase()}_EMAIL env var and ensure the server is running.`,
    );
  }
  return filePath;
}

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },

  memberPage: async ({ browser }, use) => {
    const statePath = requireAuthState('member');
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  staffPage: async ({ browser }, use) => {
    const statePath = requireAuthState('staff');
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  adminPage: async ({ browser }, use) => {
    const statePath = requireAuthState('admin');
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
