import type { Page } from '@playwright/test';

export class LoadingStates {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForPageLoad(timeout = 15000) {
    await this.page.waitForLoadState('domcontentloaded', { timeout });

    await Promise.race([
      this.page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout }).catch(() => {}),
      this.page.waitForTimeout(timeout),
    ]);
  }

  async waitForNetworkIdle(timeout = 10000) {
    await this.page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  }

  async waitForContentVisible(selector: string, timeout = 10000) {
    await this.page.locator(selector).first().waitFor({ state: 'visible', timeout });
  }

  async waitForNoSkeletons(timeout = 10000) {
    const skeleton = this.page.locator('.animate-pulse');
    const count = await skeleton.count();
    if (count > 0) {
      await skeleton.first().waitFor({ state: 'hidden', timeout }).catch(() => {});
    }
  }

  async hasErrorBoundary(): Promise<boolean> {
    const errorFallback = this.page.locator('[data-testid="error-fallback"], text=/something went wrong/i');
    return errorFallback.isVisible().catch(() => false);
  }
}
