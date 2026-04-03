import { test, expect, type APIRequestContext } from '@playwright/test';
import pg from 'pg';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';
const DATABASE_URL = process.env.DATABASE_URL || '';
const TEST_EMAIL = process.env.E2E_MEMBER_EMAIL || 'nick@everclub.co';
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
      await client.query(`DELETE FROM booking_requests WHERE id = $1`, [id]);
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
      `SELECT id FROM booking_requests WHERE notes LIKE $1 AND LOWER(user_email) = LOWER($2)`,
      [`%${E2E_NOTE_TAG}%`, TEST_EMAIL],
    );
    for (const row of stale.rows) {
      await client.query(`DELETE FROM guest_pass_holds WHERE booking_id = $1`, [row.id]).catch(() => {});
      await client.query(
        `DELETE FROM booking_participants WHERE session_id IN (SELECT session_id FROM booking_requests WHERE id = $1 AND session_id IS NOT NULL)`,
        [row.id],
      ).catch(() => {});
      await client.query(`DELETE FROM booking_sessions WHERE booking_id = $1`, [row.id]).catch(() => {});
      await client.query(`DELETE FROM booking_requests WHERE id = $1`, [row.id]);
    }
  } finally {
    await client.end();
  }
}

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

test.describe('Booking — Create & List API', () => {
  const createdBookingIds: number[] = [];

  test.afterAll(async () => {
    await cleanupTestBookings(createdBookingIds);
  });

  test('POST /api/booking-requests creates a booking on available slot', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length === 0, 'No simulator resources in DB');

    const slot = await findAvailableSlot(request, simulators[0].id);
    test.skip(!slot, 'No available slots found for booking test');

    const response = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: TEST_EMAIL,
        user_name: 'E2E Test User',
        resource_id: simulators[0].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        declared_player_count: 1,
        notes: `${E2E_NOTE_TAG} — create test`,
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
        user_email: TEST_EMAIL,
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
      data: { user_email: TEST_EMAIL },
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
          user_email: TEST_EMAIL,
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

  test('GET /api/booking-requests lists bookings for the test user', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/booking-requests`, {
      params: { user_email: TEST_EMAIL },
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
        params: { user_email: TEST_EMAIL },
      });
      expect(response.status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('GET /api/booking-requests supports pagination params', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/booking-requests`, {
      params: { user_email: TEST_EMAIL, page: '1', limit: '5' },
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

test.describe('Booking — Cancel API', () => {
  let bookingIdToCancel: number | null = null;
  const createdIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    const { simulators } = await getTestResources();
    if (simulators.length === 0) return;

    const context = await browser.newContext({
      storageState: 'e2e/.auth/member.json',
    });
    const page = await context.newPage();
    try {
      const slot = await findAvailableSlot(page.request, simulators[0].id, [10, 11, 12, 13]);
      if (!slot) return;

      const response = await page.request.post(`${BASE_URL}/api/booking-requests`, {
        data: {
          user_email: TEST_EMAIL,
          user_name: 'E2E Cancel Test',
          resource_id: simulators[0].id,
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

test.describe('Booking — Staff Approval API', () => {
  let bookingIdToApprove: number | null = null;
  let bookingIdToDecline: number | null = null;
  const createdIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    const { simulators } = await getTestResources();
    if (simulators.length < 2) return;

    const context = await browser.newContext({
      storageState: 'e2e/.auth/member.json',
    });
    const page = await context.newPage();
    try {
      const slot1 = await findAvailableSlot(page.request, simulators[1].id, [5, 6, 7, 8]);
      if (slot1) {
        const resp1 = await page.request.post(`${BASE_URL}/api/booking-requests`, {
          data: {
            user_email: TEST_EMAIL,
            user_name: 'E2E Approve Test',
            resource_id: simulators[1].id,
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

      const slot2 = await findAvailableSlot(page.request, simulators[1].id, [9, 10, 11, 12]);
      if (slot2) {
        const resp2 = await page.request.post(`${BASE_URL}/api/booking-requests`, {
          data: {
            user_email: TEST_EMAIL,
            user_name: 'E2E Decline Test',
            resource_id: simulators[1].id,
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
      await context.close();
    }
  });

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('PUT /api/booking-requests/:id with status=approved approves booking', async ({ request }) => {
    test.skip(!bookingIdToApprove, 'No booking was created to approve');

    const response = await request.put(
      `${BASE_URL}/api/booking-requests/${bookingIdToApprove}`,
      {
        data: {
          status: 'approved',
          staff_notes: 'Approved by E2E test',
          reviewed_by: TEST_EMAIL,
        },
        headers: { Origin: BASE_URL },
      },
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('approved');
  });

  test('PUT /api/booking-requests/:id with status=declined declines booking', async ({ request }) => {
    test.skip(!bookingIdToDecline, 'No booking was created to decline');

    const response = await request.put(
      `${BASE_URL}/api/booking-requests/${bookingIdToDecline}`,
      {
        data: {
          status: 'declined',
          staff_notes: 'Declined by E2E test',
          reviewed_by: TEST_EMAIL,
        },
        headers: { Origin: BASE_URL },
      },
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('declined');
  });

  test('PUT /api/booking-requests/:id returns 401/403 without auth', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      const response = await page.request.put(
        `${BASE_URL}/api/booking-requests/999999`,
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
});

test.describe('Booking — Full Lifecycle', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    await cleanupTestBookings(createdIds);
  });

  test('create → list → approve → cancel lifecycle', async ({ request }) => {
    const { simulators } = await getTestResources();
    test.skip(simulators.length < 3, 'Need at least 3 simulator bays');

    const slot = await findAvailableSlot(request, simulators[2].id);
    test.skip(!slot, 'No available slots found');

    const createResponse = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: TEST_EMAIL,
        user_name: 'E2E Lifecycle Test',
        resource_id: simulators[2].id,
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
      params: { user_email: TEST_EMAIL },
    });
    expect(listResponse.status()).toBe(200);
    const bookings = await listResponse.json();
    const found = (Array.isArray(bookings) ? bookings : bookings.data).find(
      (b: { id: number }) => b.id === created.id,
    );
    expect(found).toBeDefined();
    expect(found.status).toBe('pending');

    const approveResponse = await request.put(
      `${BASE_URL}/api/booking-requests/${created.id}`,
      {
        data: {
          status: 'approved',
          staff_notes: 'Lifecycle test approval',
          reviewed_by: TEST_EMAIL,
          resource_id: simulators[2].id,
        },
        headers: { Origin: BASE_URL },
      },
    );
    expect(approveResponse.status()).toBe(200);
    const approved = await approveResponse.json();
    expect(approved.status).toBe('approved');

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
        user_email: TEST_EMAIL,
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
    test.skip(simulators.length < 4, 'Need at least 4 simulator bays');

    const slot = await findAvailableSlot(request, simulators[3].id);
    test.skip(!slot, 'No available slots found');

    const first = await request.post(`${BASE_URL}/api/booking-requests`, {
      data: {
        user_email: TEST_EMAIL,
        user_name: 'E2E Overlap Test 1',
        resource_id: simulators[3].id,
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
        user_email: TEST_EMAIL,
        user_name: 'E2E Overlap Test 2',
        resource_id: simulators[3].id,
        request_date: slot!.date,
        start_time: slot!.startTime,
        duration_minutes: 60,
        notes: `${E2E_NOTE_TAG} — overlap fail`,
      },
      headers: { Origin: BASE_URL },
    });

    expect(second.status()).toBe(409);
    const errorBody = await second.json();
    expect(errorBody.error).toBeTruthy();
    expect(errorBody.error).toMatch(/already have a booking|conflicts with an existing booking/);
  });
});
