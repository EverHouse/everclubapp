import { db } from '../db';
import { failedSideEffects } from '../../shared/schema';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';

export interface SideEffectFailure {
  actionType: string;
  errorMessage: string;
  stripePaymentIntentId?: string | null;
  context?: Record<string, unknown>;
}

interface DeferredAction {
  actionType: string;
  fn: () => Promise<void>;
  stripePaymentIntentId?: string;
  context?: Record<string, unknown>;
}

export class DeferredSideEffects {
  private actions: DeferredAction[] = [];
  private bookingId: number;
  private flow: string;

  constructor(bookingId: number, flow: string) {
    this.bookingId = bookingId;
    this.flow = flow;
  }

  add(
    actionType: string,
    fn: () => Promise<void>,
    options?: { stripePaymentIntentId?: string; context?: Record<string, unknown> }
  ): void {
    this.actions.push({
      actionType,
      fn,
      stripePaymentIntentId: options?.stripePaymentIntentId,
      context: options?.context,
    });
  }

  async executeAll(): Promise<{ failures: SideEffectFailure[] }> {
    const failures: SideEffectFailure[] = [];

    for (const action of this.actions) {
      try {
        await action.fn();
      } catch (err: unknown) {
        const errorMessage = getErrorMessage(err);
        failures.push({
          actionType: action.actionType,
          errorMessage,
          stripePaymentIntentId: action.stripePaymentIntentId || null,
          context: { ...action.context, flow: this.flow },
        });
        logger.error(`[DeferredSideEffects] ${action.actionType} failed in ${this.flow}`, {
          extra: { bookingId: this.bookingId, actionType: action.actionType, error: errorMessage }
        });
      }
    }

    if (failures.length > 0) {
      await persistSideEffectFailures(this.bookingId, this.flow, failures);
    }

    return { failures };
  }
}

export async function persistSideEffectFailures(
  bookingId: number,
  flow: string,
  failures: SideEffectFailure[]
): Promise<void> {
  if (failures.length === 0) return;

  try {
    for (const failure of failures) {
      await db.insert(failedSideEffects).values({
        bookingId,
        actionType: failure.actionType,
        stripePaymentIntentId: failure.stripePaymentIntentId || null,
        errorMessage: failure.errorMessage,
        context: { ...failure.context, flow },
      });
    }
    logger.warn(`[DeferredSideEffects] Persisted ${failures.length} failed side effect(s) for retry`, {
      extra: { bookingId, flow, failureCount: failures.length }
    });
  } catch (persistErr: unknown) {
    logger.error('[DeferredSideEffects] CRITICAL: Failed to persist side effect failures', {
      extra: { bookingId, flow, failures, persistError: getErrorMessage(persistErr) }
    });
  }
}
