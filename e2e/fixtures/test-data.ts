import type { APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';

export interface TestMember {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface TestBooking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  resourceName: string;
  status: string;
}

export interface CreateBookingParams {
  resourceId: number;
  date: string;
  startTime: string;
  endTime: string;
  participants?: Array<{ email?: string; name?: string }>;
}

export class TestDataHelper {
  private createdBookingIds: string[] = [];

  constructor(private request: APIRequestContext) {}

  async getSessionUser(): Promise<TestMember | null> {
    const response = await this.request.get(`${BASE_URL}/api/auth/session`);
    if (!response.ok()) return null;
    const data = await response.json();
    return data.member || null;
  }

  async getResources(): Promise<Array<{ id: number; name: string; type: string }>> {
    const response = await this.request.get(`${BASE_URL}/api/resources`);
    if (!response.ok()) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : data.resources || [];
  }

  async getAvailability(
    date: string,
    resourceIds: number[],
  ): Promise<Record<number, { slots: Array<{ start: string; end: string }> }>> {
    const response = await this.request.post(
      `${BASE_URL}/api/availability`,
      {
        data: { resource_ids: resourceIds, date },
        headers: { Origin: BASE_URL },
      },
    );
    if (!response.ok()) return {};
    return await response.json();
  }

  async getBookings(userEmail?: string): Promise<TestBooking[]> {
    const params = new URLSearchParams();
    if (userEmail) {
      params.set('user_email', userEmail);
    } else {
      params.set('include_all', 'true');
    }
    const response = await this.request.get(
      `${BASE_URL}/api/booking-requests?${params.toString()}`,
    );
    if (!response.ok()) {
      throw new Error(
        `getBookings failed: ${response.status()} ${await response.text()}`,
      );
    }
    const data = await response.json();
    return Array.isArray(data) ? data : data.bookings || [];
  }

  async createBooking(params: CreateBookingParams): Promise<TestBooking> {
    const response = await this.request.post(
      `${BASE_URL}/api/booking-requests`,
      {
        data: {
          resource_id: params.resourceId,
          request_date: params.date,
          start_time: params.startTime,
          end_time: params.endTime,
          participants: params.participants || [],
        },
        headers: { Origin: BASE_URL },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `createBooking failed: ${response.status()} ${await response.text()}`,
      );
    }
    const data = await response.json();
    const booking = data.booking || data;
    if (booking.id) {
      this.createdBookingIds.push(booking.id);
    }
    return booking;
  }

  async cancelBooking(bookingId: string): Promise<void> {
    const response = await this.request.post(
      `${BASE_URL}/api/booking-requests/${bookingId}/cancel`,
      {
        headers: { Origin: BASE_URL },
      },
    );
    if (!response.ok()) {
      const body = await response.text();
      console.warn(`cancelBooking ${bookingId} failed: ${response.status()} ${body}`);
    }
  }

  async getEvents(): Promise<Array<{ id: string; title: string }>> {
    const response = await this.request.get(`${BASE_URL}/api/events`);
    if (!response.ok()) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : data.events || [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request.get(`${BASE_URL}/healthz`);
      return response.ok();
    } catch {
      return false;
    }
  }

  async cleanupCreatedBookings(): Promise<void> {
    for (const id of this.createdBookingIds) {
      await this.cancelBooking(id);
    }
    this.createdBookingIds = [];
  }
}
