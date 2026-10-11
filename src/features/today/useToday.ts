import { useLiveQuery } from 'dexie-react-hooks';
import {
  getOrCreateDayLog, getSettings, getWeekPlan, listCalorieEntries,
  listDayLogs, listRuns,
} from '@/db/repos';
import {
  dayCalorieTotal, weekCalorieTotal,
  weeklyBudget as computeWeeklyBudget, weeklyRemaining,
} from '@/domain/budget';
import { datesOfIsoWeek, isoWeekOf, isValidTimeZone, todayIn } from '@/domain/calendar';
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
  // The current day's own row may not be in dayLogs yet: the hook runs
  // getOrCreateDayLog and listDayLogs as two concurrent transactions.
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
 * getOrCreateDayLog returns a tombstoned row as if it were live. This sanitizes
 * the read only: a tombstoned row is shown as an unlogged day, so its stale
 * ticks, steps, joker and validation never reach the view. The write path is
 * NOT guarded - updateDayLog looks the row up by [userId+date] with no
 * deletedAt filter, so a tick still lands on the invisible row and still
 * vanishes; that is the sync phase's problem, not this one's. Only Plan 4's
 * pull can tombstone a row, so neither case is reachable yet.
 */
export function liveDayLog(row: DayLog): DayLog {
  if (row.deletedAt === null) return row;
  return {
    ...row, deletedAt: null, ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null,
  };
}

export function useToday(userId: string): TodayView | undefined {
  return useLiveQuery(async () => {
    const settings = await getSettings(userId);
    if (!settings) return undefined;

    // A stored zone can be one this runtime rejects (synced from a device with
    // a different ICU, or a zone since dropped), and todayIn would then throw a
    // RangeError inside this querier. There is no ErrorBoundary above it, so
    // that is a white screen on the main view. Fall back the way onboarding
    // does for the detected zone.
    const timezone = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
    const date = todayIn(timezone);
    const week = isoWeekOf(date);
    const weekDates = new Set(datesOfIsoWeek(week));

    const [plan, log, dayLogs, runs, calorieEntries] = await Promise.all([
      // Read-only for the plan: opening the app must not invent a week plan.
      getWeekPlan(userId, week),
      // getOrCreate for today's log, deliberately: the user is here to tick it,
      // syncStamps writes to it anyway, and a row for today is a real fact.
      getOrCreateDayLog(userId, date),
      listDayLogs(userId),
      listRuns(userId),
      listCalorieEntries(userId),
    ]);

    return buildTodayView({
      date, settings, plan, log: liveDayLog(log), dayLogs,
      runsToday: runs.filter((r) => r.date === date),
      calorieEntriesToday: calorieEntries.filter((e) => e.date === date),
      calorieEntriesWeek: calorieEntries.filter((e) => weekDates.has(e.date)),
    });
  }, [userId]);
}
