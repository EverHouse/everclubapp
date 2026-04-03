import type { Page, Locator } from '@playwright/test';

export class Modal {
  readonly page: Page;
  readonly overlay: Locator;
  readonly content: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.overlay = page.locator('[role="dialog"], [data-testid="modal-overlay"]');
    this.content = this.overlay.locator('[data-testid="modal-content"], > div').first();
    this.closeButton = this.overlay.getByRole('button', { name: /close|dismiss|cancel/i }).first();
  }

  async isVisible(): Promise<boolean> {
    return this.overlay.isVisible();
  }

  async close() {
    if (await this.isVisible()) {
      await this.closeButton.click();
      await this.overlay.waitFor({ state: 'hidden', timeout: 5000 });
    }
  }

  async waitForOpen() {
    await this.overlay.waitFor({ state: 'visible', timeout: 10000 });
  }
}

export class SlideUpDrawer {
  readonly page: Page;
  readonly drawer: Locator;

  constructor(page: Page, titlePattern?: RegExp) {
    this.page = page;
    if (titlePattern) {
      this.drawer = page.locator('[role="dialog"]').filter({ hasText: titlePattern });
    } else {
      this.drawer = page.locator('[role="dialog"]').last();
    }
  }

  async isVisible(): Promise<boolean> {
    return this.drawer.isVisible();
  }

  async waitForOpen() {
    await this.drawer.waitFor({ state: 'visible', timeout: 10000 });
  }

  async close() {
    const closeBtn = this.drawer.getByRole('button', { name: /close|dismiss|cancel/i }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
  }
}

export class Toast {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForToast(textPattern: RegExp, timeout = 5000): Promise<Locator> {
    const toast = this.page.locator('[data-testid="toast"], [role="alert"], [role="status"]')
      .filter({ hasText: textPattern });
    await toast.first().waitFor({ state: 'visible', timeout });
    return toast.first();
  }

  async expectSuccess(textPattern?: RegExp) {
    const pattern = textPattern || /success|saved|updated|created|done/i;
    await this.waitForToast(pattern);
  }

  async expectError(textPattern?: RegExp) {
    const pattern = textPattern || /error|failed|unable/i;
    await this.waitForToast(pattern);
  }
}
