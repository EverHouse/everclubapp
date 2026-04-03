import { test as base, expect, type Page } from '@playwright/test';
import path from 'path';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';

export type TestRole = 'member' | 'staff' | 'admin';

export interface AuthFixtures {
  memberPage: Page;
  staffPage: Page;
  adminPage: Page;
  authenticatedPage: Page;
}

export const AUTH_STATE_DIR = path.join(process.cwd(), 'e2e', '.auth');

export function authStatePath(role: TestRole): string {
  return path.join(AUTH_STATE_DIR, `${role}.json`);
}

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },

  memberPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: authStatePath('member'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  staffPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: authStatePath('staff'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: authStatePath('admin'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
