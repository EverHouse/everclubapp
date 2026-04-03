import type { Page, Locator } from '@playwright/test';

export class MemberBottomNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly homeTab: Locator;
  readonly bookTab: Locator;
  readonly wellnessTab: Locator;
  readonly eventsTab: Locator;
  readonly historyTab: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('nav[role="navigation"]');
    this.homeTab = this.nav.getByRole('button', { name: /home/i });
    this.bookTab = this.nav.getByRole('button', { name: /book/i });
    this.wellnessTab = this.nav.getByRole('button', { name: /wellness/i });
    this.eventsTab = this.nav.getByRole('button', { name: /events/i });
    this.historyTab = this.nav.getByRole('button', { name: /history/i });
  }

  async goToHome() {
    await this.homeTab.click();
    await this.page.waitForURL('**/dashboard');
  }

  async goToBook() {
    await this.bookTab.click();
    await this.page.waitForURL('**/book');
  }

  async goToWellness() {
    await this.wellnessTab.click();
    await this.page.waitForURL('**/wellness');
  }

  async goToEvents() {
    await this.eventsTab.click();
    await this.page.waitForURL('**/events');
  }

  async goToHistory() {
    await this.historyTab.click();
    await this.page.waitForURL('**/history');
  }
}

export class StaffSidebar {
  readonly page: Page;
  readonly sidebar: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator('[data-testid="staff-sidebar"], aside, nav').first();
  }

  async navigateTo(tabName: string) {
    const link = this.sidebar.getByRole('link', { name: new RegExp(tabName, 'i') });
    await link.click();
  }
}
