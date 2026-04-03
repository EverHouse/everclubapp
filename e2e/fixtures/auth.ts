import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'path';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';

export type TestRole = 'member' | 'staff' | 'admin';

export interface AuthFixtures {
  memberPage: Page;
  staffPage: Page;
  adminPage: Page;
  authenticatedPage: Page;
}

async function loginViaDevEndpoint(
  page: Page,
  email: string,
): Promise<void> {
  const response = await page.request.post(`${BASE_URL}/api/auth/dev-login`, {
    data: { email },
    headers: {
      Origin: BASE_URL,
    },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `Dev login failed for ${email}: ${response.status()} — ${body}`,
    );
  }
}

async function loginAndSaveState(
  page: Page,
  email: string,
  statePath: string,
): Promise<void> {
  await loginViaDevEndpoint(page, email);
  await page.context().storageState({ path: statePath });
}

export const AUTH_STATE_DIR = path.join(process.cwd(), 'e2e', '.auth');

export function authStatePath(role: TestRole): string {
  return path.join(AUTH_STATE_DIR, `${role}.json`);
}

export async function setupAuthState(
  page: Page,
  role: TestRole,
  email: string,
): Promise<void> {
  await loginAndSaveState(page, email, authStatePath(role));
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
