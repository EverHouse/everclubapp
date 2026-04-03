import { test as teardown } from '@playwright/test';
import fs from 'fs';
import { AUTH_STATE_DIR } from './fixtures/auth';

teardown('clean up auth state', async () => {
  if (fs.existsSync(AUTH_STATE_DIR)) {
    fs.rmSync(AUTH_STATE_DIR, { recursive: true, force: true });
  }
});
