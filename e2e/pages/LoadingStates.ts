import type { Page } from '@playwright/test';

export class LoadingStates {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForPageLoad(timeout = 15000) {
    await this.page.waitForLoadState('domcontentloaded', { timeout });

    const skeleton = this.page.locator('.animate-pulse').first();
    const skeletonExists = await skeleton.isVisible().catch(() => false);
    if (skeletonExists) {
      await skeleton.waitFor({ state: 'hidden', timeout });
    }
  }

  async waitForNetworkIdle(timeout = 10000) {
    await this.page.waitForLoadState('networkidle', { timeout });
  }

  async waitForContentVisible(selector: string, timeout = 10000) {
    await this.page.locator(selector).first().waitFor({ state: 'visible', timeout });
  }

  async waitForNoSkeletons(timeout = 10000) {
    const skeleton = this.page.locator('.animate-pulse');
    const count = await skeleton.count();
    if (count > 0) {
      await skeleton.first().waitFor({ state: 'hidden', timeout });
    }
  }

  async hasErrorBoundary(): Promise<boolean> {
    const errorFallback = this.page.locator('[data-testid="error-fallback"], text=/something went wrong/i');
    const count = await errorFallback.count();
    if (count === 0) return false;
    return errorFallback.first().isVisible();
  }
}
