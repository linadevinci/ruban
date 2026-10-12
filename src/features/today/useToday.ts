import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import {
  getDayLog, getSettings, getWeekPlan, listCalorieEntries,
  listDayLogs, listRuns,
} from '@/db/repos';
import {
  dayCalorieTotal, weekCalorieTotal,
  weeklyBudget as computeWeeklyBudget, weeklyRemaining,
} from '@/domain/budget';
import {
  addDays, datesOfIsoWeek, isoWeekOf, isValidTimeZone, todayIn,
} from '@/domain/calendar';
import {
  effectiveWeekPlan, evaluateChecklist, isDayValidated,
  type ChecklistItem, type ChecklistPlan,
} from '@/domain/checklist';
import { canUseJoker, currentStreak } from '@/domain/streak';
import { daysUntil, isCycleComplete } from '@/domain/trajectory';
import type { DayLog, IsoDate, Settings, WeekPlan } from '@/domain/types';

interface RunRow { date: IsoDate; distanceKm: number; durationS: number }
interface CalorieRow { date: IsoDate; kcal: number }

/**
 * Coherence invariant, which the caller owes and this module does not re-check:
 * `log.date === date`, `plan` is the plan of `isoWeekOf(date)` (or undefined),
 * and `calorieEntriesWeek` covers that same week. useToday derives all four
 * from one `date`, so the only way to break it is a hand-built input.
 */
export interface TodayInputs {
  date: IsoDate;
  settings: Settings;
  /** Absent until the week is first edited; effectiveWeekPlan supplies defaults. */
  plan: WeekPlan | undefined;
  log: DayLog;
  dayLogs: DayLog[];
  runsToday: RunRow[];
  calorieEntriesToday: CalorieRow[];
  calorieEntriesWeek: CalorieRow[];
}

export interface TodayView {
  date: IsoDate;
  settings: Settings;
  /** Resolved through effectiveWeekPlan, so it is the narrow shape, not the
   *  stored row; the row may not exist until the week is first edited. */
  plan: ChecklistPlan;
  /** The stored row, or blankDayLog's placeholder on a day with none; the id is
   *  then empty, so a write keys off `date`, never off this. */
  log: DayLog;
  items: ChecklistItem[];
  validated: boolean;
  streak: number;
  daysLeft: number;
  cycleComplete: boolean;
  jokerAvailable: boolean;
  weeklyBudget: number;
  weeklyRemaining: number;
}

/** Pure assembler: plain values in, a view out. No IO, so it is directly testable. */
export function buildTodayView(input: TodayInputs): TodayView {
  const { date, settings, log } = input;
  const plan = effectiveWeekPlan(input.plan);
  const week = isoWeekOf(date);
  // Section 4.7's sums come from the domain, not from each screen re-deriving them.
  const calorieTotal = dayCalorieTotal(input.calorieEntriesToday, date);
  const consumedThisWeek = weekCalorieTotal(input.calorieEntriesWeek, week);

  const items = evaluateChecklist({
    date, plan, settings, log,
    runCount: input.runsToday.length,
    calorieTotal,
    calorieEntryCount: input.calorieEntriesToday.length,
  });

  const coverage = input.dayLogs.map((row) => ({
    date: row.date, validatedAt: row.validatedAt, jokered: row.jokered,
  }));
  // listDayLogs lists them all, today's row included, so this push is usually
  // a duplicate - and an idempotent one, because currentStreak reduces the
  // coverage to a Set of dates. It is here for the day that has no stored row
  // at all: `log` is then blankDayLog's placeholder, which no list can supply.
  coverage.push({ date, validatedAt: log.validatedAt, jokered: log.jokered });

  return {
    date, settings, plan, log, items,
    validated: isDayValidated(items),
    streak: currentStreak(coverage, date, settings.startDate),
    daysLeft: daysUntil(settings.goalDate, date),
    cycleComplete: isCycleComplete(settings.goalDate, date),
    jokerAvailable: canUseJoker({
      date, today: date, startDate: settings.startDate,
      coverage: { date, validatedAt: log.validatedAt, jokered: log.jokered },
      // ChecklistPlan is narrow; the joker lives on the stored row, if any.
      weekPlanJokerUsedOn: input.plan?.jokerUsedOn ?? null,
    }),
    weeklyBudget: computeWeeklyBudget(week, plan, settings),
    weeklyRemaining: weeklyRemaining(week, plan, settings, consumedThisWeek),
  };
}

/**
 * The unlogged day a date with no stored row is shown as. Pure, and never
 * persisted: opening the app must not create a row, so the querier reads with
 * the read-only getDayLog and falls back to this. getDayLog also returns
 * undefined for a tombstoned row, so a tombstoned day lands here too and its
 * stale ticks, steps, joker and validation never reach the view.
 *
 * The id is deliberately an empty string, because this row does not exist in
 * the database: every write must key off `date`, which is what
 * updateDayLog(userId, date, patch) takes, and never off `view.log.id`. What
 * the empty string buys is an id no caller can mistake for a real row's, where
 * a tombstoned row's id would be indistinguishable from a live one, and no
 * fresh id minted on every re-run of the querier.
 *
 * It buys no protection against a write reaching a tombstoned row. Writes look
 * rows up by `[userId+date]`, which does not filter `deletedAt`, so a tick on
 * a tombstoned day lands on the invisible row whatever id this carries. That
 * is unreachable until the sync phase can tombstone a day log, and the fix
 * belongs to the repo layer rather than here.
 */
export function blankDayLog(userId: string, date: IsoDate): DayLog {
  return {
    id: '', userId, date, ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null,
    updatedAt: '', deletedAt: null,
  };
}

/**
 * The zone's offset from UTC, in milliseconds, AT the given instant - so a
 * DST change moves it. Read by rendering the instant in the zone and reading
 * the wall-clock parts back as if they were UTC.
 */
function zoneOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const part = (type: string): number => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`Intl omitted the "${type}" part for ${tz}`);
    return Number(value);
  };
  const wallAsUtc = Date.UTC(
    part('year'), part('month') - 1, part('day'),
    part('hour'), part('minute'), part('second'),
  );
  // The instant truncated to the second, because the parts carry no millis.
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Milliseconds from `now` until 00:00 of the next day IN `tz` - the stored
 * zone, never the device's, which is a different date for half the planet.
 *
 * Local midnight is an instant, and its offset from UTC is the zone's offset
 * at that instant rather than at `now`: on the night the clocks go back, the
 * two differ by an hour. So the first guess uses the current offset and the
 * second re-reads the offset at that guess, which lands on the real midnight
 * for every zone a device can be in.
 *
 * Never returns zero or less. A timer at zero would spin, and a guess that
 * lands a touch early is harmless: the caller re-reads the date, finds it
 * unchanged and schedules again for what is left.
 */
export function msUntilNextMidnight(tz: string, now: Date = new Date()): number {
  const tomorrow = addDays(todayIn(tz, now), 1);
  const wallMidnight = Date.parse(`${tomorrow}T00:00:00.000Z`);
  const guess = wallMidnight - zoneOffsetMs(tz, new Date(wallMidnight - zoneOffsetMs(tz, now)));
  return Math.max(guess - now.getTime(), 1000);
}

/**
 * Today's date in `tz`, kept current while the screen stays mounted, and
 * undefined until a zone is known.
 *
 * This cannot live inside the useLiveQuery querier below. A querier re-runs
 * when an observed TABLE changes and at no other time, so a date computed in
 * there is frozen at whatever it was when the screen opened: at 23h in bed -
 * spec 10's own example - the checklist keeps stamping yesterday after
 * midnight, which silently re-validates a day already stamped, leaves the new
 * day empty and breaks the streak, with only the heading as a clue.
 *
 * Two refreshes, because neither covers the other. The timer catches midnight
 * on a screen that stays awake. visibilitychange catches the iOS home-screen
 * PWA, which is RESUMED from the background rather than reloaded - a timer in
 * a frozen tab does not fire on time, and without this the stale date would
 * survive for days.
 */
export function useCurrentDate(timezone: string | undefined): IsoDate | undefined {
  const [date, setDate] = useState<IsoDate | undefined>(undefined);

  useEffect(() => {
    if (timezone === undefined) return;
    let timer = 0;
    const tick = () => {
      // setState with the same string is a no-op in React, so the ordinary
      // case - a resume on the same day - costs no re-render and no re-query.
      setDate(todayIn(timezone));
      timer = window.setTimeout(tick, msUntilNextMidnight(timezone));
    };
    const onVisible = () => {
      if (document.visibilityState === 'hidden') return;
      // Rescheduled from the real clock: the pending timer was measured
      // against a midnight that may be hours past.
      window.clearTimeout(timer);
      tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [timezone]);

  return date;
}

export function useToday(userId: string): TodayView | undefined {
  // The zone comes from its own live read, because the date has to be known
  // before the querier below runs rather than computed inside it.
  const settingsRow = useLiveQuery(() => getSettings(userId), [userId]);
  // A stored zone can be one this runtime rejects (synced from a device with
  // a different ICU, or a zone since dropped), and todayIn would then throw a
  // RangeError out of the hook below. There is no ErrorBoundary above this
  // screen, so that is a white screen on the main view. Fall back the way
  // onboarding does for the detected zone.
  const timezone = settingsRow === undefined
    ? undefined
    : (isValidTimeZone(settingsRow.timezone) ? settingsRow.timezone : 'UTC');
  const date = useCurrentDate(timezone);

  return useLiveQuery(async () => {
    // Undefined only until the zone has been read; the view would otherwise
    // flash a date computed in the wrong zone, which near midnight is the
    // wrong DAY, and the stamping effect would stamp it.
    if (date === undefined) return undefined;
    // Re-read rather than closed over: the view's settings and its rows then
    // come from one consistent moment, and the querier observes the settings
    // table, so an edited target re-runs it.
    const settings = await getSettings(userId);
    if (!settings) return undefined;

    const week = isoWeekOf(date);
    const weekDates = new Set(datesOfIsoWeek(week));

    const [plan, log, dayLogs, runs, calorieEntries] = await Promise.all([
      // Read-only for the plan: opening the app must not invent a week plan.
      getWeekPlan(userId, week),
      // Read-only for the log too, for the same reason and one more: Dexie's
      // observability middleware rejects any readwrite transaction opened in a
      // liveQuery context, so a getOrCreate here would make this querier
      // reject forever and leave Today stuck on undefined. Nothing is lost -
      // updateDayLog creates the row on the first tick.
      getDayLog(userId, date),
      listDayLogs(userId),
      listRuns(userId),
      listCalorieEntries(userId),
    ]);

    return buildTodayView({
      date, settings, plan, log: log ?? blankDayLog(userId, date), dayLogs,
      runsToday: runs.filter((r) => r.date === date),
      calorieEntriesToday: calorieEntries.filter((e) => e.date === date),
      // This one keeps the input contract at the top of the file rather than
      // changing a result: weekCalorieTotal filters by the same week, so no
      // test can tell the filtered list from the unfiltered one.
      calorieEntriesWeek: calorieEntries.filter((e) => weekDates.has(e.date)),
    });
    // `date` is a dep, not just a closure read: a querier re-runs on an
    // observed table change and on a dep change, and midnight is neither a
    // table change nor a render of its own.
  }, [userId, date]);
}
