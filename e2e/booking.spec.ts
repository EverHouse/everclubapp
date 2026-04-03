import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import pg from 'pg';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';
const DATABASE_URL = process.env.DATABASE_URL || '';
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || 'nicholasallanluu@gmail.com';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'nick@everclub.co';
const E2E_NOTE_TAG = 'E2E-auto-cleanup';

interface ResourceRow {
  id: number;
  name: string;
  type: string;
}

async function getTestResources(): Promise<{ simulators: ResourceRow[]; conferenceRoom: ResourceRow | null }> {
  if (!DATABASE_URL) return { simulators: [], conferenceRoom: null };
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    const sims = await client.query(
      `SELECT id, name, type FROM resources WHERE type = 'simulator' ORDER BY id LIMIT 4`,
    );
    const conf = await client.query(
      `SELECT id, name, type FROM resources WHERE type = 'conference_room' ORDER BY id LIMIT 1`,
    );
    return {
      simulators: sims.rows,
      conferenceRoom: conf.rows[0] || null,
    };
  } finally {
    await client.end();
  }
}

function getFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function findAvailableSlot(
  request: APIRequestContext,
  resourceId: number,
  daysRange: number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
): Promise<{ date: string; startTime: string } | null> {
  for (const days of daysRange) {
    const date = getFutureDate(days);
    const response = await request.get(`${BASE_URL}/api/availability`, {
      params: { resource_id: resourceId, date, duration: 60 },
    });
    if (!response.ok()) continue;
    const slots = await response.json();
    if (Array.isArray(slots) && slots.length > 0) {
      const slot = slots.find((s: { available: boolean }) => s.available);
      if (slot) {
        return { date, startTime: slot.start_time };
      }
    }
  }
  return null;
}

async function cleanupTestBookings(bookingIds: number[]) {
  if (!DATABASE_URL || bookingIds.length === 0) return;
  if (process.env.CI && !process.env.E2E_ALLOW_DB_CLEANUP) return;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    for (const id of bookingIds) {
      await client.query(`DELETE FROM guest_pass_holds WHERE booking_id = $1`, [id]).catch(() => {});
      await client.query(
        `DELETE FROM booking_participants WHERE session_id IN (SELECT session_id FROM booking_requests WHERE id = $1 AND session_id IS NOT NULL)`,
        [id],
      ).catch(() => {});
      await client.query(`DELETE FROM booking_sessions WHERE booking_id = $1`, [id]).catch(() => {});
      await client.query(`DELETE FROM booking_requests WHERE id = $1`, [id]).catch(() => {});
    }
  } finally {
    await client.end();
  }
}

async function cleanupStaleE2eBookings() {
  if (!DATABASE_URL) return;
  if (process.env.CI && !process.env.E2E_ALLOW_DB_CLEANUP) return;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    const stale = await client.query(
      `SELECT id FROM booking_requests WHERE notes LIKE $1 AND LOWER(user_email) IN (LOWER($2), LOWER($3))`,
      [`%${E2E_NOTE_TAG}%`, MEMBER_EMAIL, ADMIN_EMAIL],
    );
    for (const row of stale.rows) {
      await client.query(`DELETE FROM guest_pass_holds WHERE booking_id = $1`, [row.id]).catch(() => {});
      await client.query(
        `DELETE FROM booking_participants WHERE session_id IN (SELECT session_id FROM booking_requests WHERE id = $1 AND session_id IS NOT NULL)`,
        [row.id],
      ).catch(() => {});
      await client.query(`DELETE FROM booking_sessions WHERE booking_id = $1`, [row.id]).catch(() => {});
      await client.query(`DELETE FROM booking_requests WHERE id = $1`, [row.id]).catch(() => {});
    }
  } finally {
    await client.end();
  }
}

async function cancelPendingBookingsForMember() {
  if (!DATABASE_URL) return;
  if (process.env.CI && !process.env.E2E_ALLOW_DB_CLEANUP) return;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query(
      `UPDATE booking_requests SET status = 'member_cancelled'
       WHERE LOWER(user_email) = LOWER($1)
       AND status IN ('pending', 'pending_approval')
       AND notes LIKE $2`,
      [MEMBER_EMAIL, `%${E2E_NOTE_TAG}%`],
    );
  } finally {
    await client.end();
  }
}

async function createStaffContext(browser: import('@playwright/test').Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: 'e2e/.auth/staff.json' });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await cleanupStaleE2eBookings();
});

test.describe('Booking — Availability API', () => {
  test('GET /api/availability returns slots for valid resource and date', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    const futureDate = getFutureDate(7);
    const response = await request.get(`${BASE_URL}/api/availability`, {
      params: { resource_id: simulators[0].id, date: futureDate, duration: 60 },
    });

    expect(response.status()).toBe(200);
    const slots = await response.json();
    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    expect(first).toHaveProperty('start_time');
    expect(first).toHaveProperty('end_time');
    expect(typeof first.available).toBe('boolean');
  });

  test('GET /api/availability returns 400 without required params', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/availability`);
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test('POST /api/availability/batch returns slots for multiple resources', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    const futureDate = getFutureDate(7);
    const response = await request.post(`${BASE_URL}/api/availability/batch`, {
      data: {
        resource_ids: simulators.map(s => s.id),
        date: futureDate,
        duration: 60,
      },
      headers: { Origin: BASE_URL },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body[simulators[0].id]).toBeDefined();
    expect(Array.isArray(body[simulators[0].id].slots)).toBe(true);
  });

  test('POST /api/availability/batch returns 400 without resource_ids', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/availability/batch`, {
      data: { date: getFutureDate(7) },
      headers: { Origin: BASE_URL },
    });
    expect(response.status()).toBe(400);
  });

  test('availability returns valid response for past date', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    const response = await request.get(`${BASE_URL}/api/availability`, {
      params: { resource_id: simulators[0].id, date: '2020-01-01', duration: 60 },
    });
    expect(response.status()).toBe(200);
    const slots = await response.json();
    expect(Array.isArray(slots)).toBe(true);
  });
});

test.describe('Booking — Create & List API (Member)', () => {
  const createdBookingIds: number[] = [];

  test.beforeAll(async () => {
    await cancelPendingBookingsForMember();
  });

  test.afterAll(async () => {
    await cleanupTestBookings(createdBookingIds);
  });

  test('POST /api/booking-requests creates a booking as member', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    await cancelPendingBookingsForMember();

    const slot = await findAvailableSlot(request, simulators[0].id, [3, 4]);
    test.skip(!slot, 'No available slots found for booking test');

    const response = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Member Test',
        resource_id: simulators[0].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        declared_player_count: 1,
        notes: `${E2E_NOTE_TAG} — member create test`,
      },
      headers: { Origin: BASE_URL },
    });

    const body = await response.json();
    expect(response.status(), `Booking create failed: ${JSON.stringify(body)}`).toBe(201);
    expect(body.id).toBeDefined();
    expect(body.status).toBe('pending');
    createdBookingIds.push(body.id);
  });

  test('POST /api/booking-requests returns 400 for invalid duration', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    const response = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        resource_id: simulators[0].id,
        request_date: getFutureDate(8),
        start_time: '10:00',
        duration_minutes: 999,
      },
      headers: { Origin: BASE_URL },
    });

    expect(response.status()).toBe(400);
  });

  test('POST /api/booking-requests returns 400 for missing required fields', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: { user_email: MEMBER_EMAIL },
      headers: { Origin: BASE_URL },
    });

    expect(response.status()).toBe(400);
  });

  test('POST /api/booking-requests returns 401 without auth', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      const response = await page.request.post(`${BASE_URL}/api/booking-requests`, {
        data: {
          user_email: MEMBER_EMAIL,
          request_date: getFutureDate(9),
          start_time: '12:00',
          duration_minutes: 60,
        },
        headers: { Origin: BASE_URL },
      });
      expect(response.status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('GET /api/booking-requests lists bookings for the member', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/booking-requests`, {
      params: { user_email: MEMBER_EMAIL },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    const bookings = Array.isArray(body) ? body : body.data;
    expect(Array.isArray(bookings)).toBe(true);
  });

  test('GET /api/booking-requests returns 400 without user_email or include_all', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/booking-requests`);
    expect(response.status()).toBe(400);
  });

  test('GET /api/booking-requests returns 401 without auth', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      const response = await page.request.get(`${BASE_URL}/api/booking-requests`, {
        params: { user_email: MEMBER_EMAIL },
      });
      expect(response.status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('GET /api/booking-requests supports pagination params', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/booking-requests`, {
      params: { user_email: MEMBER_EMAIL, page: '1', limit: '5' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(5);
    expect(typeof body.pagination.total).toBe('number');
    expect(typeof body.pagination.totalPages).toBe('number');
  });
});

test.describe('Booking — Cancel API (Member)', () => {
  let bookingIdToCancel: number | null = null;
  const createdIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    const { simulators } = await getTestResources();
    if (simulators.length < 2) return;

    const context = await browser.newContext({
      storageState: 'e2e/.auth/member.json',
    });
    const page = await context.newPage();
    try {
      const slot = await findAvailableSlot(page.request, simulators[1].id, [10, 11, 12, 13]);
      if (!slot) return;

      const response = await page.request.post(`${BASE_URL}/api/booking-requests`, {
        data: {
          user_email: MEMBER_EMAIL,
          user_name: 'E2E Cancel Test',
          resource_id: simulators[1].id,
          request_date: slot.date,
          start_time: slot.startTime,
          duration_minutes: 60,
          notes: `${E2E_NOTE_TAG} — cancel test`,
        },
        headers: { Origin: BASE_URL },
      });
      if (response.ok()) {
        const body = await response.json();
        bookingIdToCancel = body.id;
        createdIds.push(body.id);
      }
    } finally {
      await context.close();
    }
  });

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('PUT /api/booking-requests/:id/member-cancel cancels own booking', async ({ request }) => {
    test.skip(!bookingIdToCancel, 'No booking was created to cancel');

    const response = await request.put(
      `${BASE_URL}/api/booking-requests/${bookingIdToCancel}/member-cancel`,
      { headers: { Origin: BASE_URL } },
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test('PUT /api/booking-requests/999999/member-cancel returns 404 for non-existent booking', async ({ request }) => {
    const response = await request.put(
      `${BASE_URL}/api/booking-requests/999999/member-cancel`,
      { headers: { Origin: BASE_URL } },
    );

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('not found');
  });

  test('PUT /api/booking-requests/abc/member-cancel returns 400 for invalid ID', async ({ request }) => {
    const response = await request.put(
      `${BASE_URL}/api/booking-requests/abc/member-cancel`,
      { headers: { Origin: BASE_URL } },
    );

    expect(response.status()).toBe(400);
  });

  test('member-cancel returns 401 without auth', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      const response = await page.request.put(
        `${BASE_URL}/api/booking-requests/999999/member-cancel`,
        { headers: { Origin: BASE_URL } },
      );
      expect(response.status()).toBe(401);
    } finally {
      await context.close();
    }
  });
});

test.describe('Booking — Staff Approval API (Admin auth)', () => {
  let bookingIdToApprove: number | null = null;
  let bookingIdToDecline: number | null = null;
  const createdIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    const { simulators } = await getTestResources();
    if (simulators.length < 3) return;

    await cancelPendingBookingsForMember();

    const memberCtx = await browser.newContext({
      storageState: 'e2e/.auth/member.json',
    });
    const memberPage = await memberCtx.newPage();
    try {
      const slot1 = await findAvailableSlot(memberPage.request, simulators[2].id, [5, 6]);
      if (slot1) {
        const resp1 = await memberPage.request.post(`${BASE_URL}/api/booking-requests`, {
          data: {
            user_email: MEMBER_EMAIL,
            user_name: 'E2E Approve Test',
            resource_id: simulators[2].id,
            request_date: slot1.date,
            start_time: slot1.startTime,
            duration_minutes: 60,
            notes: `${E2E_NOTE_TAG} — approve test`,
          },
          headers: { Origin: BASE_URL },
        });
        if (resp1.ok()) {
          const body = await resp1.json();
          bookingIdToApprove = body.id;
          createdIds.push(body.id);
        }
      }

    } finally {
      await memberCtx.close();
    }

    const staffCtx = await createStaffContext(browser);
    const staffPage = await staffCtx.newPage();
    try {
      const slot2 = await findAvailableSlot(staffPage.request, simulators[2].id, [9, 10, 11, 12]);
      if (slot2) {
        const resp2 = await staffPage.request.post(`${BASE_URL}/api/booking-requests`, {
          data: {
            user_email: ADMIN_EMAIL,
            user_name: 'E2E Decline Test (Admin)',
            resource_id: simulators[2].id,
            request_date: slot2.date,
            start_time: slot2.startTime,
            duration_minutes: 60,
            notes: `${E2E_NOTE_TAG} — decline test`,
          },
          headers: { Origin: BASE_URL },
        });
        if (resp2.ok()) {
          const body = await resp2.json();
          bookingIdToDecline = body.id;
          createdIds.push(body.id);
        }
      }
    } finally {
      await staffCtx.close();
    }
  });

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('staff/admin can approve a pending booking', async ({ browser }) => {
    test.skip(!bookingIdToApprove, 'No booking was created to approve');

    const staffCtx = await createStaffContext(browser);
    try {
      const staffPage = await staffCtx.newPage();
      const response = await staffPage.request.put(
        `${BASE_URL}/api/booking-requests/${bookingIdToApprove}`,
        {
          data: {
            status: 'approved',
            staff_notes: 'Approved by E2E staff test',
            reviewed_by: ADMIN_EMAIL,
          },
          headers: { Origin: BASE_URL },
        },
      );

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('approved');
    } finally {
      await staffCtx.close();
    }
  });

  test('member cannot approve bookings (403)', async ({ request }) => {
    test.skip(!bookingIdToDecline, 'No booking was created for authZ test');

    const response = await request.put(
      `${BASE_URL}/api/booking-requests/${bookingIdToDecline}`,
      {
        data: {
          status: 'approved',
          staff_notes: 'Member trying to approve',
          reviewed_by: MEMBER_EMAIL,
        },
        headers: { Origin: BASE_URL },
      },
    );
    expect([401, 403]).toContain(response.status());
  });

  test('unauthenticated cannot approve bookings', async ({ browser }) => {
    test.skip(!bookingIdToDecline, 'No booking was created for unauth test');

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      const response = await page.request.put(
        `${BASE_URL}/api/booking-requests/${bookingIdToDecline}`,
        {
          data: { status: 'approved' },
          headers: { Origin: BASE_URL },
        },
      );
      expect([401, 403]).toContain(response.status());
    } finally {
      await context.close();
    }
  });

  test('staff/admin can decline a pending booking', async ({ browser }) => {
    test.skip(!bookingIdToDecline, 'No booking was created to decline');

    const staffCtx = await createStaffContext(browser);
    try {
      const staffPage = await staffCtx.newPage();
      const response = await staffPage.request.put(
        `${BASE_URL}/api/booking-requests/${bookingIdToDecline}`,
        {
          data: {
            status: 'declined',
            staff_notes: 'Declined by E2E staff test',
            reviewed_by: ADMIN_EMAIL,
          },
          headers: { Origin: BASE_URL },
        },
      );

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('declined');
    } finally {
      await staffCtx.close();
    }
  });
});

test.describe('Booking — Full Lifecycle (member creates, staff approves, member cancels)', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('create → list → staff approve → member cancel lifecycle', async ({ request, browser }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length < 4, 'Need at least 4 simulator bays');

    const slot = await findAvailableSlot(request, simulators[3].id, [3, 4, 5]);
    test.skip(!slot, 'No available slots found');

    const createResponse = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Lifecycle Test',
        resource_id: simulators[3].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — lifecycle test`,
      },
      headers: { Origin: BASE_URL },
    });

    const created = await createResponse.json();
    expect(createResponse.status(), `Create failed: ${JSON.stringify(created)}`).toBe(201);
    expect(created.id).toBeDefined();
    createdIds.push(created.id);
    expect(created.status).toBe('pending');

    const listResponse = await request.get(`${BASE_URL}/api/booking-requests`, {
      params: { user_email: MEMBER_EMAIL },
    });
    expect(listResponse.status()).toBe(200);
    const bookings = await listResponse.json();
    const found = (Array.isArray(bookings) ? bookings : bookings.data).find(
      (b: { id: number }) => b.id === created.id,
    );
    expect(found).toBeDefined();
    expect(found.status).toBe('pending');

    const staffCtx = await createStaffContext(browser);
    try {
      const staffPage = await staffCtx.newPage();
      const approveResponse = await staffPage.request.put(
        `${BASE_URL}/api/booking-requests/${created.id}`,
        {
          data: {
            status: 'approved',
            staff_notes: 'Lifecycle test approval by staff',
            reviewed_by: ADMIN_EMAIL,
            resource_id: simulators[3].id,
          },
          headers: { Origin: BASE_URL },
        },
      );
      expect(approveResponse.status()).toBe(200);
      const approved = await approveResponse.json();
      expect(approved.status).toBe('approved');
    } finally {
      await staffCtx.close();
    }

    const cancelResponse = await request.put(
      `${BASE_URL}/api/booking-requests/${created.id}/member-cancel`,
      { headers: { Origin: BASE_URL } },
    );
    expect(cancelResponse.status()).toBe(200);
    const cancelled = await cancelResponse.json();
    expect(cancelled.success).toBe(true);
  });
});

test.describe('Booking — Conference Room Auto-Confirm', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('conference room booking auto-confirms on creation', async ({ request }) => {
    const { conferenceRoom } = await getTestResources();
    test.skip(!conferenceRoom, 'No conference room resource in DB');

    const slot = await findAvailableSlot(request, conferenceRoom!.id);
    test.skip(!slot, 'No available conference room slots');

    const response = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Conf Room Test',
        resource_id: conferenceRoom!.id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — conf room test`,
      },
      headers: { Origin: BASE_URL },
    });

    const body = await response.json();
    expect(response.status(), `Conf room failed: ${JSON.stringify(body)}`).toBe(201);
    expect(body.id).toBeDefined();
    createdIds.push(body.id);
    expect(body.status).toBe('confirmed');
  });
});

test.describe('Booking — Overlap Prevention', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('cannot create overlapping bookings on same time slot', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    const slot = await findAvailableSlot(request, simulators[0].id, [8, 9]);
    test.skip(!slot, 'No available slots found');

    const first = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Overlap Test 1',
        resource_id: simulators[0].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — overlap test`,
      },
      headers: { Origin: BASE_URL },
    });

    const firstBody = await first.json();
    expect(first.status(), `First booking failed: ${JSON.stringify(firstBody)}`).toBe(201);
    createdIds.push(firstBody.id);

    const second = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Overlap Test 2',
        resource_id: simulators[0].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — overlap test 2`,
      },
      headers: { Origin: BASE_URL },
    });

    expect(second.status()).toBe(409);
    const errorBody = await second.json();
    expect(errorBody.error).toBeTruthy();
    expect(errorBody.error).toMatch(/already have a booking|conflicts with an existing booking|already have a pending request/);
  });
});

test.describe('Booking — UI: /book page booking flow elements', () => {
  test('booking page renders booking type selector and date picker', async ({ page }) => {
    await page.goto('/book');
    await page.waitForLoadState('domcontentloaded');

    const segmented = page.locator('[aria-label="Booking type"]');
    await expect(segmented).toBeVisible({ timeout: 10_000 });

    const body = page.locator('body');
    await expect(body).toContainText(/Golf Simulator|Conference Room/i, { timeout: 10_000 });
  });

  test('booking page shows available time slots for a future date', async ({ page }) => {
    await page.goto('/book');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('[aria-label="Booking type"]')).toBeVisible({ timeout: 10_000 });

    const dateButtons = page.locator('button').filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i });
    const count = await dateButtons.count();
    if (count > 1) {
      await dateButtons.nth(1).click();
      await page.waitForTimeout(1000);
    }

    const body = await page.textContent('body');
    const hasTimeContent =
      body?.includes('AM') || body?.includes('PM') ||
      body?.includes('available') || body?.includes('No availability') ||
      body?.includes(':00') || body?.includes(':30');
    expect(hasTimeContent).toBe(true);
  });

  test('booking page displays bay/resource cards when slots are available', async ({ page }) => {
    await page.goto('/book');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('[aria-label="Booking type"]')).toBeVisible({ timeout: 10_000 });

    const body = await page.textContent('body');
    const hasResourceInfo =
      body?.toLowerCase().includes('simulator') ||
      body?.toLowerCase().includes('bay') ||
      body?.toLowerCase().includes('conference') ||
      body?.toLowerCase().includes('request booking') ||
      body?.toLowerCase().includes('duration');
    expect(hasResourceInfo).toBe(true);
  });

  test('unavailable/requested slots are surfaced in availability response', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    await cancelPendingBookingsForMember();

    const slot = await findAvailableSlot(request, simulators[0].id, [14, 15, 16, 17, 18, 19, 20]);
    test.skip(!slot, 'No available slots to test availability display');

    const createResp = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Availability Display',
        resource_id: simulators[0].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — availability display test`,
      },
      headers: { Origin: BASE_URL },
    });

    if (createResp.status() === 201) {
      const created = await createResp.json();

      const availResp = await request.get(
        `${BASE_URL}/api/availability?resource_id=${simulators[0].id}&date=${slot!.date}`,
      );
      expect(availResp.status()).toBe(200);
      const slots: Array<{ start_time: string; available: boolean; requested?: boolean }> = await availResp.json();
      const matchedSlot = slots.find(s => s.start_time === slot!.startTime);
      expect(matchedSlot).toBeDefined();
      if (matchedSlot) {
        expect(matchedSlot.available === false || matchedSlot.requested === true).toBe(true);
      }

      await cancelPendingBookingsForMember();
    }
  });
});

test.describe('Booking — UI: /dashboard shows member schedule', () => {
  test('dashboard page renders schedule section', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).not.toHaveText(/404|not found/i, { timeout: 5_000 });

    const body = await page.textContent('body');
    const hasDashboardContent =
      body?.includes('Your Schedule') ||
      body?.includes('Schedule') ||
      body?.includes('Book') ||
      body?.includes('Welcome');
    expect(hasDashboardContent).toBe(true);
  });

  test('dashboard booking data API returns member bookings', async ({ request }) => {
    const dashResp = await request.get(`${BASE_URL}/api/member/dashboard/booking-requests`);
    expect(dashResp.status()).toBe(200);
    const data = await dashResp.json();
    expect(Array.isArray(data) || data.bookingRequests !== undefined).toBeTruthy();
  });

  test('member can view booking in list after creation', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    await cancelPendingBookingsForMember();

    const slot = await findAvailableSlot(request, simulators[0].id, [21, 22, 23, 24, 25]);
    test.skip(!slot, 'No available slots found');

    const createResp = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Dashboard Verify',
        resource_id: simulators[0].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — dashboard verify test`,
      },
      headers: { Origin: BASE_URL },
    });

    if (createResp.status() === 201) {
      const created = await createResp.json();

      const listResp = await request.get(`${BASE_URL}/api/booking-requests`);
      expect(listResp.status()).toBe(200);
      const list = await listResp.json();
      const items = Array.isArray(list) ? list : list.data || [];
      const found = items.find((b: { id: number }) => b.id === created.id);
      expect(found).toBeDefined();
      expect(found.status).toBe('pending');

      await cancelPendingBookingsForMember();
    }
  });
});

test.describe('Booking — Staff Dashboard: pending requests visible', () => {
  test('staff /admin page renders command center', async ({ browser }) => {
    const staffCtx = await createStaffContext(browser);
    const page = await staffCtx.newPage();
    try {
      await page.goto('/admin');
      await page.waitForLoadState('domcontentloaded');

      const body = await page.textContent('body');
      const hasStaffContent =
        body?.includes('Booking Requests') ||
        body?.includes('Command Center') ||
        body?.includes('pending') ||
        body?.includes('All caught up') ||
        body?.includes("Today's");
      expect(hasStaffContent).toBe(true);
    } finally {
      await staffCtx.close();
    }
  });

  test('staff can see booking requests queue via API', async ({ browser }) => {
    const staffCtx = await createStaffContext(browser);
    const page = await staffCtx.newPage();
    try {
      const resp = await page.request.get(`${BASE_URL}/api/booking-requests?status=pending`);
      expect(resp.status()).toBe(200);
      const data = await resp.json();
      expect(Array.isArray(data) || data.data !== undefined).toBeTruthy();
    } finally {
      await staffCtx.close();
    }
  });

  test('newly created booking appears in staff pending queue', async ({ request, browser }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    await cancelPendingBookingsForMember();

    const slot = await findAvailableSlot(request, simulators[0].id, [26, 27, 28]);
    test.skip(!slot, 'No available slots found');

    const createResp = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: MEMBER_EMAIL,
        user_name: 'E2E Staff Queue Test',
        resource_id: simulators[0].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — staff queue visibility test`,
      },
      headers: { Origin: BASE_URL },
    });

    if (createResp.status() === 201) {
      const created = await createResp.json();

      const staffCtx = await createStaffContext(browser);
      const page = await staffCtx.newPage();
      try {
        const queueResp = await page.request.get(`${BASE_URL}/api/booking-requests?status=pending`);
        expect(queueResp.status()).toBe(200);
        const queue = await queueResp.json();
        const items = Array.isArray(queue) ? queue : queue.data || [];
        const found = items.find((b: { id: number }) => b.id === created.id);
        expect(found).toBeDefined();
        expect(found.status).toMatch(/pending/);
      } finally {
        await staffCtx.close();
      }

      await cancelPendingBookingsForMember();
    }
  });
});

test.describe('Booking — Participant Roster API', () => {
  let bookingId: number | null = null;
  const createdIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    const { simulators } = await getTestResources();
    if (simulators.length < 2) return;

    const memberCtx = await browser.newContext({
      storageState: 'e2e/.auth/member.json',
    });
    const memberPage = await memberCtx.newPage();
    try {
      const slot = await findAvailableSlot(memberPage.request, simulators[1].id, [7, 8]);
      if (!slot) return;

      const response = await memberPage.request.post(`${BASE_URL}/api/booking-requests`, {
        data: {
          user_email: MEMBER_EMAIL,
          user_name: 'E2E Roster Test',
          resource_id: simulators[1].id,
          request_date: slot.date,
          start_time: slot.startTime,
          duration_minutes: 60,
          declared_player_count: 2,
          notes: `${E2E_NOTE_TAG} — roster test`,
        },
        headers: { Origin: BASE_URL },
      });
      if (response.ok()) {
        const body = await response.json();
        bookingId = body.id;
        createdIds.push(body.id);

        const staffCtx = await createStaffContext(browser);
        try {
          const staffPage = await staffCtx.newPage();
          await staffPage.request.put(
            `${BASE_URL}/api/booking-requests/${body.id}`,
            {
              data: {
                status: 'approved',
                staff_notes: 'Approve for roster test',
                reviewed_by: ADMIN_EMAIL,
              },
              headers: { Origin: BASE_URL },
            },
          );
        } finally {
          await staffCtx.close();
        }
      }
    } finally {
      await memberCtx.close();
    }
  });

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('GET /api/bookings/:id/participants returns roster', async ({ request }) => {
    test.skip(!bookingId, 'No booking was created for roster test');

    const response = await request.get(
      `${BASE_URL}/api/bookings/${bookingId}/participants`,
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body) || body.participants).toBeTruthy();
  });

  test('GET /api/bookings/:id/participants returns 401 without auth', async ({ browser }) => {
    test.skip(!bookingId, 'No booking was created for roster test');

    const unauthCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await unauthCtx.newPage();
    try {
      const response = await page.request.get(
        `${BASE_URL}/api/bookings/${bookingId}/participants`,
      );
      expect([401, 403]).toContain(response.status());
    } finally {
      await unauthCtx.close();
    }
  });

  test('POST /api/bookings/:id/participants/preview-fees estimates costs', async ({ request }) => {
    test.skip(!bookingId, 'No booking was created for fee preview test');

    const response = await request.post(
      `${BASE_URL}/api/bookings/${bookingId}/participants/preview-fees`,
      {
        data: { provisionalParticipants: [] },
        headers: { Origin: BASE_URL },
      },
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toBeDefined();
  });

  test('POST /api/bookings/:id/participants adds a guest participant', async ({ request }) => {
    test.skip(!bookingId, 'No booking was created for add participant test');

    const response = await request.post(
      `${BASE_URL}/api/bookings/${bookingId}/participants`,
      {
        data: {
          type: 'guest',
          guest: { name: 'E2E Test Guest', email: 'e2e-guest@example.com' },
        },
        headers: { Origin: BASE_URL },
      },
    );

    if (response.status() === 201) {
      const body = await response.json();
      expect(body.success).toBe(true);

      const rosterResp = await request.get(
        `${BASE_URL}/api/bookings/${bookingId}/participants`,
      );
      expect(rosterResp.status()).toBe(200);
      const roster = await rosterResp.json();
      const participants = Array.isArray(roster) ? roster : roster.participants || [];
      const guest = participants.find(
        (p: { guest_email?: string; email?: string }) =>
          p.guest_email === 'e2e-guest@example.com' || p.email === 'e2e-guest@example.com',
      );
      expect(guest).toBeDefined();
    } else {
      expect([201, 400, 409]).toContain(response.status());
    }
  });

  test('DELETE /api/bookings/:id/participants/:pid removes a participant', async ({ request }) => {
    test.skip(!bookingId, 'No booking was created for remove participant test');

    const rosterResp = await request.get(
      `${BASE_URL}/api/bookings/${bookingId}/participants`,
    );
    expect(rosterResp.status()).toBe(200);
    const roster = await rosterResp.json();
    const participants = Array.isArray(roster) ? roster : roster.participants || [];
    const guest = participants.find(
      (p: { type?: string; role?: string; guest_email?: string }) =>
        p.type === 'guest' || p.role === 'guest' || p.guest_email,
    );

    if (guest && guest.id) {
      const deleteResp = await request.delete(
        `${BASE_URL}/api/bookings/${bookingId}/participants/${guest.id}`,
        { headers: { Origin: BASE_URL }, data: {} },
      );
      expect([200, 204]).toContain(deleteResp.status());
    }
  });

  test('POST /api/bookings/:id/participants returns 401 without auth', async ({ browser }) => {
    test.skip(!bookingId, 'No booking was created for unauth add test');

    const unauthCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await unauthCtx.newPage();
    try {
      const response = await page.request.post(
        `${BASE_URL}/api/bookings/${bookingId}/participants`,
        {
          data: { type: 'guest', guest: { name: 'Unauth Guest', email: 'unauth@example.com' } },
          headers: { Origin: BASE_URL },
        },
      );
      expect([401, 403]).toContain(response.status());
    } finally {
      await unauthCtx.close();
    }
  });
});
