import fs from 'fs';
import path from 'path';
import type { FullConfig } from '@playwright/test';

const AUTH_STATE_DIR = path.join(process.cwd(), 'e2e', '.auth');

async function globalTeardown(_config: FullConfig) {
  if (fs.existsSync(AUTH_STATE_DIR)) {
    fs.rmSync(AUTH_STATE_DIR, { recursive: true, force: true });
  }
}

export default globalTeardown;
