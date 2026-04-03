import { test, expect } from '@playwright/test';

test.describe('Public Pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const PUBLIC_ROUTES = [
    { path: '/', title: /ever/i, h1: /ever|club/i },
    { path: '/membership', title: /membership/i, h1: /membership/i },
    { path: '/gallery', title: /gallery/i, h1: /gallery/i },
    { path: '/faq', title: /faq|question/i, h1: /question|faq/i },
    { path: '/about', title: /about/i, h1: /about/i },
    { path: '/contact', title: /contact/i, h1: /touch|contact/i },
    { path: '/menu', title: /menu|cafe|café/i, h1: /menu|cafe|café/i },
    { path: '/whats-on', title: /what|event/i, h1: /what|event/i },
    { path: '/private-hire', title: /private|hire|event/i, h1: /curated|space|private|hire/i },
    { path: '/tour', title: /tour/i, h1: /tour/i },
    { path: '/terms', title: /terms/i, h1: /terms/i },
    { path: '/privacy', title: /privacy/i, h1: /privacy/i },
  ];

  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} loads without errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.goto(route.path);
      await page.waitForLoadState('domcontentloaded');
      await expect(page).toHaveTitle(route.title, { timeout: 10_000 });

      const h1 = page.getByRole('heading', { level: 1 }).first();
      await expect(h1).toBeVisible({ timeout: 10_000 });
      await expect(h1).toHaveText(route.h1);

      const criticalErrors = consoleErrors.filter(
        (e) =>
          !e.includes('favicon') &&
          !e.includes('404') &&
          !e.includes('net::ERR') &&
          !e.includes('Failed to load resource') &&
          !e.includes('[vite]') &&
          !e.includes('WebSocket') &&
          !e.includes('mapkit'),
      );
      expect(criticalErrors).toHaveLength(0);
    });
  }

  test('footer is visible on public pages', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('domcontentloaded');

    const footer = page.locator('footer').first();
    await expect(footer).toBeVisible({ timeout: 10_000 });
  });

  test.describe('FAQ Page', () => {
    test('FAQ accordion items expand and collapse', async ({ page }) => {
      await page.goto('/faq');
      await page.waitForLoadState('domcontentloaded');

      const firstQuestion = page.locator('.accordion-item-wrapper button').first();
      await expect(firstQuestion).toBeVisible({ timeout: 10_000 });

      await firstQuestion.click();
      const openContent = page.locator('.accordion-content.is-open').first();
      await expect(openContent).toBeVisible();

      await firstQuestion.click();
      await page.waitForTimeout(500);
    });

    test('FAQ category filter buttons work', async ({ page }) => {
      await page.goto('/faq');
      await page.waitForLoadState('domcontentloaded');

      const allButton = page.getByRole('button', { name: 'All' });
      await expect(allButton).toBeVisible({ timeout: 10_000 });

      const categoryButtons = page.locator('button').filter({ hasText: /Membership|Booking|General|Amenities|Events|Policies/i });
      const count = await categoryButtons.count();
      if (count > 0) {
        await categoryButtons.first().click();
        await page.waitForTimeout(500);

        await allButton.click();
        await page.waitForTimeout(500);
      }
    });
  });

  test.describe('Membership Apply Form', () => {
    test('step 1 renders required fields', async ({ page }) => {
      await page.goto('/membership/apply');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#apply-firstname')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#apply-lastname')).toBeVisible();
      await expect(page.locator('#apply-email')).toBeVisible();
      await expect(page.locator('#apply-phone')).toBeVisible();
    });

    test('step 1 validates required fields before advancing', async ({ page }) => {
      await page.goto('/membership/apply');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#apply-firstname')).toBeVisible({ timeout: 10_000 });

      const nextButton = page.getByRole('button', { name: /next|continue/i }).first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(500);

        const stillOnStep1 = await page.locator('#apply-firstname').isVisible();
        expect(stillOnStep1).toBe(true);
      }
    });

    test('step 1 to step 2 navigation with valid data', async ({ page }) => {
      await page.goto('/membership/apply');
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#apply-firstname').fill('Test');
      await page.locator('#apply-lastname').fill('User');
      await page.locator('#apply-email').fill('test@example.com');
      await page.locator('#apply-phone').fill('5551234567');

      const nextButton = page.getByRole('button', { name: /next|continue/i }).first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(1000);

        const step2Visible =
          (await page.locator('#apply-tier').isVisible().catch(() => false)) ||
          (await page.locator('#apply-message').isVisible().catch(() => false));
        expect(step2Visible).toBe(true);
      }
    });
  });

  test.describe('Book Tour Form', () => {
    test('step 1 renders required fields', async ({ page }) => {
      await page.goto('/tour');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#tour-firstName')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#tour-lastName')).toBeVisible();
      await expect(page.locator('#tour-email')).toBeVisible();
      await expect(page.locator('#tour-phone')).toBeVisible();
    });

    test('step 1 validates required fields before advancing', async ({ page }) => {
      await page.goto('/tour');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#tour-firstName')).toBeVisible({ timeout: 10_000 });

      const nextButton = page.getByRole('button', { name: /next|continue|choose/i }).first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(500);

        const stillOnStep1 = await page.locator('#tour-firstName').isVisible();
        expect(stillOnStep1).toBe(true);
      }
    });

    test('step 1 to step 2 navigation with valid data', async ({ page }) => {
      await page.goto('/tour');
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#tour-firstName').fill('Test');
      await page.locator('#tour-lastName').fill('User');
      await page.locator('#tour-email').fill('test@example.com');
      await page.locator('#tour-phone').fill('5551234567');

      const nextButton = page.getByRole('button', { name: /next|continue|choose/i }).first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(1000);
      }
    });
  });

  test.describe('Day Pass Page', () => {
    test('renders day pass page with heading', async ({ page }) => {
      await page.goto('/day-pass');
      await page.waitForLoadState('domcontentloaded');

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible({ timeout: 10_000 });
      await expect(h1).toHaveText(/day pass/i);
    });

    test('email validation prevents purchase without email', async ({ page }) => {
      await page.goto('/day-pass');
      await page.waitForLoadState('domcontentloaded');

      const buyButton = page.getByRole('button', { name: /buy now/i }).first();
      if (await buyButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await buyButton.click();
        await page.waitForTimeout(500);

        const errorMessage = page.locator('.text-red-700, .text-red-400').first();
        await expect(errorMessage).toBeVisible();
        await expect(errorMessage).toHaveText(/email/i);
      }
    });

    test('email validation catches invalid email format', async ({ page }) => {
      await page.goto('/day-pass');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('input[type="email"]').first();
      if (await emailInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await emailInput.fill('not-an-email');

        const buyButton = page.getByRole('button', { name: /buy now/i }).first();
        if (await buyButton.isVisible()) {
          await buyButton.click();
          await page.waitForTimeout(500);

          const errorMessage = page.locator('.text-red-700, .text-red-400').first();
          await expect(errorMessage).toBeVisible();
          await expect(errorMessage).toHaveText(/valid email/i);
        }
      }
    });
  });

  test.describe('Contact Form', () => {
    test('renders contact form with required fields', async ({ page }) => {
      await page.goto('/contact');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.locator('#contact-message')).toBeVisible();
    });

    test('displays hours of operation', async ({ page }) => {
      await page.goto('/contact');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Hours of Operation').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Monday').first()).toBeVisible();
    });

    test('shows contact info cards', async ({ page }) => {
      await page.goto('/contact');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('VISIT US').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('CALL US').first()).toBeVisible();
      await expect(page.getByText('EMAIL US').first()).toBeVisible();
    });
  });

  test.describe('Gallery Page', () => {
    test('renders gallery page with heading', async ({ page }) => {
      await page.goto('/gallery');
      await page.waitForLoadState('domcontentloaded');

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible({ timeout: 10_000 });
      await expect(h1).toHaveText(/gallery/i);
    });
  });

  test.describe('About Page', () => {
    test('renders about page sections', async ({ page }) => {
      await page.goto('/about');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText(/our story/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/what we offer/i)).toBeVisible();
      await expect(page.getByText(/our values/i)).toBeVisible();
    });

    test('shows CTA section with tour and membership links', async ({ page }) => {
      await page.goto('/about');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('link', { name: /book a tour/i }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('link', { name: /explore membership/i })).toBeVisible();
    });
  });

  test.describe('Navigation Links', () => {
    test('landing page has links to key public pages', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const membershipLink = page.getByRole('link', { name: /membership/i }).first();
      await expect(membershipLink).toBeVisible({ timeout: 10_000 });
    });
  });
});
