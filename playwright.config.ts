import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never', outputFolder: 'e2e-report' }],
    ['list'],
  ],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/member.json',
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        storageState: 'e2e/.auth/member.json',
      },
    },
    {
      name: 'unauthenticated',
      use: {
        ...devices['Desktop Chrome'],
      },
      testMatch: /.*\.unauth\.spec\.ts/,
    },
  ],
  outputDir: 'e2e-results',
});
