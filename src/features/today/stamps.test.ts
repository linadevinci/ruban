import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDayLog, updateDayLog } from '@/db/repos';
import { db } from '@/db/schema';
import { syncStamps } from '@/features/today/stamps';
import type { TodayView } from '@/features/today/useToday';

const DATE = '2026-10-06';
/** An earlier instant than any nowIso() this run can return, so a re-stamp shows. */
const EARLIER = '2026-10-06T19:00:00.000Z';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.dayLogs.clear(), db.outbox.clear()]);
});

/**
 * Only the two fields syncStamps reads. The narrowed parameter type is what
 * lets this be a real value rather than a cast through unknown: a cast would
 * keep compiling after a field was added to or removed from TodayView.
 */
function view(validated: boolean): Pick<TodayView, 'date' | 'validated'> {
  return { date: DATE, validated };
}

describe('syncStamps', () => {
  it('does nothing while the day is incomplete', async () => {
    const result = await syncStamps('u1', view(false));
    expect(result).toEqual({ validatedNow: false, fireBonus: false });
    // Not even a row: an unfinished day the user only looked at is not an event.
    expect(await getDayLog('u1', DATE)).toBeUndefined();
    expect(await db.dayLogs.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('stamps validatedAt and fires the bonus on first completion', async () => {
    const result = await syncStamps('u1', view(true));
    expect(result).toEqual({ validatedNow: true, fireBonus: true });
    const log = await getDayLog('u1', DATE);
    // typeof, not not.toBeNull(): on a row that was never written log is
    // undefined, and expect(undefined).not.toBeNull() passes.
    expect(typeof log?.validatedAt).toBe('string');
    expect(typeof log?.bonusFiredAt).toBe('string');
    expect(await db.outbox.count()).toBe(1);
  });

  it('never fires the bonus twice', async () => {
    const first = await syncStamps('u1', view(true));
    const again = await syncStamps('u1', view(true));
    expect(first.fireBonus).toBe(true);
    expect(again).toEqual({ validatedNow: false, fireBonus: false });
  });

  it('never clears validatedAt once stamped', async () => {
    await syncStamps('u1', view(true));
    const stamped = (await getDayLog('u1', DATE))?.validatedAt;
    expect(typeof stamped).toBe('string');
    // A raised target can stop the day evaluating as validated; the stamp it
    // earned stays, because stamps record what happened (spec 4.3).
    await syncStamps('u1', view(false));
    expect((await getDayLog('u1', DATE))?.validatedAt).toBe(stamped);
  });

  it('fires the bonus exactly once when two calls race', async () => {
    // The realistic setup: the last tick created the row, and Task 10 then
    // calls syncStamps from an effect that StrictMode double-invokes, so two
    // calls are in flight before either has written. Deciding from a value
    // read before the transaction - view.log, or any read in its own
    // transaction - lets both see validatedAt: null and both fire.
    await updateDayLog('u1', DATE, { ticks: { course: true } });
    await db.outbox.clear();

    const results = await Promise.all([
      syncStamps('u1', view(true)),
      syncStamps('u1', view(true)),
    ]);

    expect(results.filter((r) => r.fireBonus)).toHaveLength(1);
    expect(results.filter((r) => r.validatedNow)).toHaveLength(1);
    expect(await db.dayLogs.count()).toBe(1);
    // One real write, so one sync push.
    expect(await db.outbox.count()).toBe(1);
  });

  it('does not move the validatedAt a previous call already wrote', async () => {
    await syncStamps('u1', view(true));
    const stamped = (await getDayLog('u1', DATE))?.validatedAt;
    expect(await db.outbox.count()).toBe(1);

    const again = await syncStamps('u1', view(true));

    expect(again).toEqual({ validatedNow: false, fireBonus: false });
    // nowIso() never repeats a value, so a re-stamp would read as a strictly
    // later string here.
    expect((await getDayLog('u1', DATE))?.validatedAt).toBe(stamped);
    // And a second outbox row would be a sync push for a day nothing changed on.
    expect(await db.outbox.count()).toBe(1);
  });

  it('records a missing bonus without moving an already stamped validatedAt', async () => {
    // A day validated earlier whose bonus never fired - a sync pull can
    // deliver exactly this. Only the null field may be filled.
    await updateDayLog('u1', DATE, { validatedAt: EARLIER });
    await db.outbox.clear();

    const result = await syncStamps('u1', view(true));

    expect(result).toEqual({ validatedNow: false, fireBonus: true });
    const log = await getDayLog('u1', DATE);
    expect(log?.validatedAt).toBe(EARLIER);
    expect(typeof log?.bonusFiredAt).toBe('string');
  });
});
