import { db } from '../../db';
import { getErrorCode, getErrorMessage } from '../../utils/errorUtils';
import { toIntArrayLiteral } from '../../utils/sqlArrayLiteral';
import { pool, safeRelease } from '../db';
import type { PoolClient } from 'pg';
import { 
  bookingSessions, 
  bookingParticipants, 
  bookingRequests,
  usageLedger,
  guests,
  users,
  InsertBookingSession,
  InsertBookingParticipant,
  InsertUsageLedger,
  BookingSession,
  BookingParticipant,
  bookingSourceEnum
} from '../../../shared/schema';
import { eq, and, isNull, sql, sql as drizzleSql, type SQL } from 'drizzle-orm';

export interface TxQueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

function buildSqlFromRaw(text: string, values: unknown[]): SQL {
  if (values.length === 0) return drizzleSql.raw(text);

  const strings: string[] = [];
  const sqlValues: unknown[] = [];
  let lastIndex = 0;
  const regex = /\$(\d+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    strings.push(text.slice(lastIndex, match.index));
    const paramIndex = parseInt(match[1], 10) - 1;
    sqlValues.push(values[paramIndex]);
    lastIndex = match.index + match[0].length;
  }
  strings.push(text.slice(lastIndex));

  const templateStrings = Object.assign([...strings], { raw: [...strings] });
  return drizzleSql(templateStrings as unknown as TemplateStringsArray, ...sqlValues);
}

export function createTxQueryClient(tx: { execute: (query: SQL) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }): TxQueryClient {
  return {
    async query(text: string, values: unknown[] = []) {
      const sqlQuery = buildSqlFromRaw(text, values);
      const result = await tx.execute(sqlQuery);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? null };
    }
  };
}
import { logger } from '../logger';
import { getMemberTierByEmail } from '../tierService';
import { getTodayPacific } from '../../utils/dateUtils';

// Transaction context type - allows functions to participate in an outer transaction
export type TransactionContext = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BookingSource = 'member_request' | 'staff_manual' | 'trackman_import' | 'trackman_webhook' | 'trackman' | 'auto-complete' | 'manual-auto-complete';
export type ParticipantType = 'owner' | 'member' | 'guest';
export type PaymentMethod = 'guest_pass' | 'credit_card' | 'unpaid' | 'waived';

export interface CreateSessionRequest {
  resourceId: number;
  sessionDate: string;
  startTime: string;
  endTime: string;
  trackmanBookingId?: string;
  createdBy?: string;
}

export interface ParticipantInput {
  userId?: string;
  guestId?: number;
  participantType: ParticipantType;
  displayName: string;
  slotDuration?: number;
  trackmanPlayerRowId?: string;
}

export interface RecordUsageInput {
  memberId?: string;
  minutesCharged: number;
  overageFee?: number;
  guestFee?: number;
  tierAtBooking?: string;
  paymentMethod?: PaymentMethod;
}
  