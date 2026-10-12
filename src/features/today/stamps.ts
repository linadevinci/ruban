import { stampDayLog } from '@/db/repos';
import type { TodayView } from '@/features/today/useToday';

export interface StampResult {
  validatedNow: boolean;
  fireBonus: boolean;
}

/**
 * Stamps are facts about what happened; targets are settings. So validatedAt
 * is written once and never cleared or moved - a step target raised in
 * November cannot retroactively un-validate October - and the celebration
 * fires exactly once (spec 4.3 and 4.5).
 *
 * The view decides only WHETHER the day is validated right now. Which stamps
 * this call applied comes from the stored row, inside stampDayLog's single
 * transaction, never from view.log: that is a snapshot from the last querier
 * run, so two calls in flight together would both read validatedAt: null from
 * it and both return fireBonus: true. Task 10 calls this from an effect that
 * StrictMode double-invokes, which makes that the ordinary case rather than a
 * rare race.
 *
 * This writes, so it is safe in an effect and never in a useLiveQuery querier,
 * where Dexie rejects any readwrite transaction.
 */
export async function syncStamps(
  userId: string,
  view: Pick<TodayView, 'date' | 'validated'>,
): Promise<StampResult> {
  // Nothing to stamp, and nothing to clear either: a day that stops evaluating
  // as validated keeps the stamp it earned. Returning before the write is also
  // what keeps merely opening the app on an unfinished day from creating a row.
  if (!view.validated) return { validatedNow: false, fireBonus: false };
  return stampDayLog(userId, view.date);
}
