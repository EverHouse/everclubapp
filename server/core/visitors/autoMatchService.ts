import { pool } from '../db';
import { findMatchingUser, upsertVisitor } from './matchingService';
import { updateVisitorType, VisitorType } from './typeService';

export interface BookingTypeInfo {
  keyword: string | null;
  visitorType: VisitorType;
  legacyCategories: string[];
}

export interface ParsedBookingNotes {
  bookingType: BookingTypeInfo | null;
  memberEmail: string | null;
  playerNames: string[];
  rawNotes: string;
}

export interface PurchaseMatch {
  userId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  mindbodyClientId: string | null;
  purchaseId: number;
  itemName: string;
  itemCategory: string;
  saleDate: Date;
}

export interface AutoMatchResult {
  bookingId: number;
  matched: boolean;
  matchType: 'purchase' | 'private_event' | 'golfnow_fallback' | 'failed';
  visitorEmail?: string;
  visitorType?: VisitorType;
  purchaseId?: number;
  reason?: string;
}

const BOOKING_TYPE_MAPPINGS: Record<string, BookingTypeInfo> = {
  classpass: {
    keyword: 'classpass',
    visitorType: 'classpass',
    legacyCategories: ['lesson']
  },
  golfnow: {
    keyword: 'golfnow',
    visitorType: 'golfnow',
    legacyCategories: []
  },
  day_pass: {
    keyword: 'day pass',
    visitorType: 'day_pass',
    legacyCategories: ['guest_pass', 'day_pass']
  },
  private_lesson: {
    keyword: 'private lesson',
    visitorType: 'private_lesson',
    legacyCategories: ['lesson']
  },
  kids_lesson: {
    keyword: 'kids lesson',
    visitorType: 'private_lesson',
    legacyCategories: ['lesson']
  },
  sim_walkin: {
    keyword: 'sim walk-in',
    visitorType: 'sim_walkin',
    legacyCategories: ['sim_walk_in', 'guest_sim_fee']
  },
  sim_walkin_alt: {
    keyword: 'walk-in',
    visitorType: 'sim_walkin',
    legacyCategories: ['sim_walk_in', 'guest_sim_fee']
  },
  sim_walkin_alt2: {
    keyword: 'simulator walk',
    visitorType: 'sim_walkin',
    legacyCategories: ['sim_walk_in', 'guest_sim_fee']
  },
  guest_sim: {
    keyword: 'guest simulator',
    visitorType: 'guest',
    legacyCategories: ['guest_sim_fee']
  },
  guest_fee: {
    keyword: 'guest fee',
    visitorType: 'guest',
    legacyCategories: ['guest_sim_fee']
  }
};

export function parseBookingNotes(notes: string | null | undefined): ParsedBookingNotes {
  const result: ParsedBookingNotes = {
    bookingType: null,
    memberEmail: null,
    playerNames: [],
    rawNotes: notes || ''
  };

  if (!notes) return result;

  const lowerNotes = notes.toLowerCase();

  const emailMatch = notes.match(/M:\s*([^\s|]+@[^\s|]+)/i);
  if (emailMatch) {
    result.memberEmail = emailMatch[1].trim().toLowerCase();
  }

  for (const [key, typeInfo] of Object.entries(BOOKING_TYPE_MAPPINGS)) {
    if (typeInfo.keyword && lowerNotes.includes(typeInfo.keyword)) {
      result.bookingType = typeInfo;
      break;
    }
  }

  const namePatterns = [
    /playing with\s+([^.]+)/i,
    /for\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/,
  ];
  
  for (const pattern of namePatterns) {
    const match = notes.match(pattern);
    if (match) {
      const names = match[1].split(/,\s*|\s+and\s+/i).map(n => n.trim()).filter(Boolean);
      result.playerNames.push(...names);
    }
  }

  return result;
}

export function mapNotesToLegacyCategories(notes: string | null | undefined): string[] {
  const parsed = parseBookingNotes(notes);
  if (parsed.bookingType) {
    return parsed.bookingType.legacyCategories;
  }
  return ['guest_sim_fee', 'sim_walk_in', 'guest_pass', 'lesson'];
}

export async function matchBookingToPurchase(
  bookingDate: Date | string,
  startTime: string,
  notes: string | null | undefined
): Promise<PurchaseMatch | null> {
  try {
    const dateStr = typeof bookingDate === 'string' 
      ? bookingDate.split('T')[0] 
      : bookingDate.toISOString().split('T')[0];

    const categories = mapNotesToLegacyCategories(notes);
    
    if (categories.length === 0) {
      return null;
    }

    const timeParts = startTime.split(':');
    const bookingHour = parseInt(timeParts[0], 10);
    const bookingMinute = parseInt(timeParts[1] || '0', 10);
    
    const minHour = Math.max(0, bookingHour - 2);
    const maxHour = Math.min(23, bookingHour + 2);
    
    const minTime = `${String(minHour).padStart(2, '0')}:00:00`;
    const maxTime = `${String(maxHour).padStart(2, '0')}:59:59`;

    const query = `
      SELECT 
        lp.id as purchase_id,
        lp.item_name,
        lp.item_category,
        lp.sale_date,
        lp.member_email,
        lp.mindbody_client_id,
        u.id as user_id,
        u.email,
        u.first_name,
        u.last_name
      FROM legacy_purchases lp
      LEFT JOIN users u ON LOWER(u.email) = LOWER(lp.member_email) 
        OR u.mindbody_client_id = lp.mindbody_client_id
      WHERE DATE(lp.sale_date) = $1
        AND lp.item_category = ANY($2)
        AND lp.linked_booking_session_id IS NULL
        AND lp.sale_date::time BETWEEN $4::time AND $5::time
      ORDER BY 
        ABS(EXTRACT(EPOCH FROM (lp.sale_date::time - $3::time))) ASC
      LIMIT 1
    `;

    const result = await pool.query(query, [dateStr, categories, startTime, minTime, maxTime]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      userId: row.user_id,
      email: row.email || row.member_email,
      firstName: row.first_name,
      lastName: row.last_name,
      mindbodyClientId: row.mindbody_client_id,
      purchaseId: row.purchase_id,
      itemName: row.item_name,
      itemCategory: row.item_category,
      saleDate: row.sale_date
    };
  } catch (error) {
    console.error('[AutoMatch] Error matching booking to purchase:', error);
    return null;
  }
}

export function isAfterClosingHours(startTime: string): boolean {
  const hour = parseInt(startTime.split(':')[0], 10);
  return hour >= 22 || hour < 6;
}

export async function autoMatchSingleBooking(
  bookingId: number,
  bookingDate: Date | string,
  startTime: string,
  userName: string | null,
  notes: string | null,
  staffEmail?: string
): Promise<AutoMatchResult> {
  const result: AutoMatchResult = {
    bookingId,
    matched: false,
    matchType: 'failed'
  };

  try {
    const parsed = parseBookingNotes(notes);
    
    if (parsed.memberEmail) {
      const user = await findMatchingUser({ email: parsed.memberEmail });
      if (user) {
        await resolveBookingWithUser(bookingId, user.id, user.email, staffEmail);
        result.matched = true;
        result.matchType = 'purchase';
        result.visitorEmail = user.email;
        return result;
      }
    }

    const purchaseMatch = await matchBookingToPurchase(bookingDate, startTime, notes);
    
    if (purchaseMatch && purchaseMatch.email) {
      let userId = purchaseMatch.userId;
      
      if (!userId) {
        const visitor = await upsertVisitor({
          email: purchaseMatch.email,
          firstName: purchaseMatch.firstName || undefined,
          lastName: purchaseMatch.lastName || undefined,
          mindbodyClientId: purchaseMatch.mindbodyClientId || undefined
        });
        userId = visitor.id;
      }
      
      await resolveBookingWithUser(bookingId, userId, purchaseMatch.email, staffEmail);
      
      await linkPurchaseToBooking(purchaseMatch.purchaseId, bookingId);
      
      const visitorType = parsed.bookingType?.visitorType || 'guest';
      await updateVisitorType({
        email: purchaseMatch.email,
        type: visitorType,
        activitySource: 'trackman_auto_match',
        activityDate: typeof bookingDate === 'string' ? new Date(bookingDate) : bookingDate
      });
      
      result.matched = true;
      result.matchType = 'purchase';
      result.visitorEmail = purchaseMatch.email;
      result.visitorType = visitorType;
      result.purchaseId = purchaseMatch.purchaseId;
      return result;
    }

    if (isAfterClosingHours(startTime)) {
      await markBookingAsPrivateEvent(bookingId, staffEmail);
      result.matched = true;
      result.matchType = 'private_event';
      result.reason = 'After hours booking (10 PM - 6 AM)';
      return result;
    }

    if (parsed.bookingType?.keyword === 'golfnow' || !parsed.bookingType) {
      const visitorEmail = await createGolfNowVisitor(userName, bookingDate, startTime);
      if (visitorEmail) {
        const user = await findMatchingUser({ email: visitorEmail });
        if (user) {
          await resolveBookingWithUser(bookingId, user.id, visitorEmail, staffEmail);
          result.matched = true;
          result.matchType = 'golfnow_fallback';
          result.visitorEmail = visitorEmail;
          result.visitorType = 'golfnow';
          return result;
        }
      }
    }

    result.reason = 'No matching purchase found and no fallback applicable';
    return result;
  } catch (error) {
    console.error('[AutoMatch] Error auto-matching booking:', error);
    result.reason = error instanceof Error ? error.message : 'Unknown error';
    return result;
  }
}

async function resolveBookingWithUser(
  bookingId: number,
  userId: number,
  email: string,
  staffEmail?: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE trackman_unmatched_bookings
      SET 
        status = 'resolved',
        resolved_email = $2,
        resolved_at = NOW(),
        resolved_by = $3,
        match_attempt_reason = 'auto_matched'
      WHERE id = $1
    `, [bookingId, email, staffEmail || 'system']);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function linkPurchaseToBooking(purchaseId: number, bookingId: number): Promise<void> {
  await pool.query(`
    UPDATE legacy_purchases
    SET linked_booking_session_id = $2
    WHERE id = $1
  `, [purchaseId, bookingId]);
}

async function markBookingAsPrivateEvent(bookingId: number, staffEmail?: string): Promise<void> {
  await pool.query(`
    UPDATE trackman_unmatched_bookings
    SET 
      status = 'resolved',
      match_attempt_reason = 'private_event',
      resolved_at = NOW(),
      resolved_by = $2
    WHERE id = $1
  `, [bookingId, staffEmail || 'system']);
}

async function createGolfNowVisitor(
  userName: string | null,
  bookingDate: Date | string,
  startTime: string
): Promise<string | null> {
  if (!userName) return null;
  
  const nameParts = userName.split(/[,\s]+/).filter(Boolean);
  let firstName = nameParts[0] || 'GolfNow';
  let lastName = nameParts.slice(1).join(' ') || 'Visitor';
  
  if (userName.includes(',')) {
    lastName = nameParts[0] || 'Visitor';
    firstName = nameParts.slice(1).join(' ') || 'GolfNow';
  }
  
  const dateStr = typeof bookingDate === 'string' 
    ? bookingDate.replace(/-/g, '') 
    : bookingDate.toISOString().split('T')[0].replace(/-/g, '');
  const timeStr = startTime.replace(/:/g, '').substring(0, 4);
  const generatedEmail = `golfnow-${dateStr}-${timeStr}@visitors.evenhouse.club`;
  
  try {
    const visitor = await upsertVisitor({
      email: generatedEmail,
      firstName,
      lastName
    }, false);
    
    await updateVisitorType({
      email: generatedEmail,
      type: 'golfnow',
      activitySource: 'trackman_auto_match',
      activityDate: typeof bookingDate === 'string' ? new Date(bookingDate) : bookingDate
    });
    
    return generatedEmail;
  } catch (error) {
    console.error('[AutoMatch] Error creating GolfNow visitor:', error);
    return null;
  }
}

export async function autoMatchAllUnmatchedBookings(
  staffEmail?: string
): Promise<{ matched: number; failed: number; results: AutoMatchResult[] }> {
  const results: AutoMatchResult[] = [];
  let matched = 0;
  let failed = 0;

  try {
    const query = `
      SELECT id, booking_date, start_time, user_name, notes
      FROM trackman_unmatched_bookings
      WHERE status = 'pending' OR status = 'unmatched'
      ORDER BY booking_date DESC, start_time DESC
    `;
    
    const { rows } = await pool.query(query);
    
    console.log(`[AutoMatch] Processing ${rows.length} unmatched bookings...`);
    
    for (const row of rows) {
      const result = await autoMatchSingleBooking(
        row.id,
        row.booking_date,
        row.start_time,
        row.user_name,
        row.notes,
        staffEmail
      );
      
      results.push(result);
      
      if (result.matched) {
        matched++;
        console.log(`[AutoMatch] Matched booking #${row.id}: ${result.matchType} -> ${result.visitorEmail || 'private_event'}`);
      } else {
        failed++;
      }
    }
    
    console.log(`[AutoMatch] Complete: ${matched} matched, ${failed} failed`);
    
    return { matched, failed, results };
  } catch (error) {
    console.error('[AutoMatch] Error in batch auto-match:', error);
    throw error;
  }
}
