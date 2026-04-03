import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';

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
    test('FAQ accordion items expand on click', async ({ page }) => {
      await page.goto('/faq');
      await page.waitForLoadState('domcontentloaded');

      const firstQuestion = page.locator('.accordion-item-wrapper button').first();
      await expect(firstQuestion).toBeVisible({ timeout: 10_000 });

      await firstQuestion.click();
      const openContent = page.locator('.accordion-content.is-open').first();
      await expect(openContent).toBeVisible({ timeout: 5_000 });
    });

    test('FAQ category filter buttons filter content', async ({ page }) => {
      await page.goto('/faq');
      await page.waitForLoadState('domcontentloaded');

      const allButton = page.getByRole('button', { name: 'All' });
      await expect(allButton).toBeVisible({ timeout: 10_000 });

      const accordionItems = page.locator('.accordion-item-wrapper');
      const initialCount = await accordionItems.count();
      expect(initialCount).toBeGreaterThan(0);

      const categoryButtons = page.locator('button').filter({ hasText: /^(Membership|Booking|General|Amenities|Events|Policies|House Rules)$/ });
      const catCount = await categoryButtons.count();
      expect(catCount).toBeGreaterThan(0);

      await categoryButtons.first().click();
      await expect(allButton).not.toHaveClass(/bg-primary/);

      await allButton.click();
      await expect(allButton).toHaveClass(/bg-primary/);
    });
  });

  test.describe('Membership Apply Form', () => {
    test('step 1 renders all required fields', async ({ page }) => {
      await page.goto('/membership/apply');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#apply-firstname')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#apply-lastname')).toBeVisible();
      await expect(page.locator('#apply-email')).toBeVisible();
      await expect(page.locator('#apply-phone')).toBeVisible();
    });

    test('step 1 blocks advancement with empty fields', async ({ page }) => {
      await page.goto('/membership/apply');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#apply-firstname')).toBeVisible({ timeout: 10_000 });

      const nextButton = page.getByRole('button', { name: /next|continue/i }).first();
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      await expect(page.locator('#apply-firstname')).toBeVisible();
    });

    test('advances to step 2 with valid data showing tier select', async ({ page }) => {
      await page.goto('/membership/apply');
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#apply-firstname').fill('Test');
      await page.locator('#apply-lastname').fill('User');
      await page.locator('#apply-email').fill('e2e-test-apply@example.com');
      await page.locator('#apply-phone').fill('5551234567');

      const nextButton = page.getByRole('button', { name: /next|continue/i }).first();
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      const step2Element = page.locator('#apply-tier, #apply-message');
      await expect(step2Element.first()).toBeVisible({ timeout: 10_000 });
    });

    test('step 2 submit button is present for form submission', async ({ page }) => {
      await page.goto('/membership/apply');
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#apply-firstname').fill('Test');
      await page.locator('#apply-lastname').fill('User');
      await page.locator('#apply-email').fill('e2e-test-apply@example.com');
      await page.locator('#apply-phone').fill('5551234567');

      const nextButton = page.getByRole('button', { name: /next|continue/i }).first();
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      const step2Element = page.locator('#apply-tier, #apply-message');
      await expect(step2Element.first()).toBeVisible({ timeout: 10_000 });

      const submitButton = page.getByRole('button', { name: /submit|apply|send/i }).first();
      await expect(submitButton).toBeVisible();
    });
  });

  test.describe('Book Tour Form', () => {
    test('step 1 renders all required fields', async ({ page }) => {
      await page.goto('/tour');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#tour-firstName')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#tour-lastName')).toBeVisible();
      await expect(page.locator('#tour-email')).toBeVisible();
      await expect(page.locator('#tour-phone')).toBeVisible();
    });

    test('step 1 blocks advancement with empty fields', async ({ page }) => {
      await page.goto('/tour');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#tour-firstName')).toBeVisible({ timeout: 10_000 });

      const nextButton = page.getByRole('button', { name: /next|continue|choose/i }).first();
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      await expect(page.locator('#tour-firstName')).toBeVisible();
    });

    test('advances to step 2 (date picker) with valid data', async ({ page }) => {
      await page.goto('/tour');
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#tour-firstName').fill('Test');
      await page.locator('#tour-lastName').fill('User');
      await page.locator('#tour-email').fill('e2e-test-tour@example.com');
      await page.locator('#tour-phone').fill('5551234567');

      const nextButton = page.getByRole('button', { name: /next|continue|choose/i }).first();
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      await expect(page.locator('#tour-firstName')).not.toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Day Pass Page', () => {
    test('renders day pass page with heading and info section', async ({ page }) => {
      await page.goto('/day-pass');
      await page.waitForLoadState('domcontentloaded');

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible({ timeout: 10_000 });
      await expect(h1).toHaveText(/day pass/i);

      await expect(page.getByText(/your information/i)).toBeVisible();
    });

    test('shows available passes heading', async ({ page }) => {
      await page.goto('/day-pass');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', { name: /available passes/i })).toBeVisible({ timeout: 10_000 });
    });

    test('email input accepts value', async ({ page }) => {
      await page.goto('/day-pass');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('input[type="email"]').first();
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await emailInput.fill('test@example.com');
      await expect(emailInput).toHaveValue('test@example.com');
    });

    test('email input has placeholder', async ({ page }) => {
      await page.goto('/day-pass');
      await page.waitForLoadState('domcontentloaded');

      const emailInput = page.locator('input[type="email"]').first();
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      const placeholder = await emailInput.getAttribute('placeholder');
      expect(placeholder).toBeTruthy();
    });
  });

  test.describe('Contact Form', () => {
    test('renders contact form with all required fields', async ({ page }) => {
      await page.goto('/contact');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.locator('#contact-message')).toBeVisible();

      const sendButton = page.getByRole('button', { name: /send message/i });
      await expect(sendButton).toBeVisible();
    });

    test('contact form accepts input and submits', async ({ page }) => {
      await page.goto('/contact');
      await page.waitForLoadState('domcontentloaded');

      await page.getByLabel(/full name/i).fill('E2E Test User');
      await page.getByLabel(/email/i).fill('e2e-contact-test@example.com');
      await page.locator('#contact-message').fill('This is an automated E2E test message.');

      const sendButton = page.getByRole('button', { name: /send message/i });
      await expect(sendButton).toBeVisible();
      await expect(sendButton).toBeEnabled();

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/api/') && resp.request().method() === 'POST',
        { timeout: 10_000 },
      ).catch(() => null);

      await sendButton.click();
      await responsePromise;

      const feedbackIndicator = page.locator('[role="alert"], .text-green-500, .text-green-400, .text-red-500, .text-red-700').first();
      await expect(feedbackIndicator).toBeVisible({ timeout: 5_000 });
    });

    test('displays hours of operation section', async ({ page }) => {
      await page.goto('/contact');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Hours of Operation').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Monday').first()).toBeVisible();
    });

    test('shows contact information cards', async ({ page }) => {
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
    test('renders all content sections', async ({ page }) => {
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

  test.describe('Navigation', () => {
    test('landing page has links to key public pages', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const membershipLink = page.getByRole('link', { name: /membership/i }).first();
      await expect(membershipLink).toBeVisible({ timeout: 10_000 });
    });

    test('membership page has link to apply', async ({ page }) => {
      await page.goto('/membership');
      await page.waitForLoadState('domcontentloaded');

      const applyLink = page.getByRole('link', { name: /apply|join|get started/i }).first();
      await expect(applyLink).toBeVisible({ timeout: 10_000 });
    });
  });
});
