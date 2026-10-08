/** A local calendar date, "2026-10-06". Never an instant. */
export type IsoDate = string;
/** An ISO week key, "2026-W41". */
export type IsoWeek = string;
/** ISO weekday: Monday = 1 … Sunday = 7. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ChecklistItemId = 'course' | 'calories' | 'no_dinner' | 'steps' | 'water';

/** Items the user can override by hand. The other two are derived from logged amounts. */
export type TickableItemId = 'course' | 'calories' | 'no_dinner';

export interface SyncedRow {
  id: string;
  userId: string;
  /** ISO 8601 instant (e.g., 2026-10-08T20:36:51.000Z). */
  updatedAt: string;
  /** ISO 8601 instant or null if not deleted (e.g., 2026-10-08T20:36:51.000Z). */
  deletedAt: string | null;
}

/**
 * Per-user singleton keyed by userId. Deliberately does not extend SyncedRow because the user id
 * is the primary key and settings are never tombstoned—deleting settings means deleting the account,
 * which the app does not offer. Adding an id field would break the primary key in both Dexie and
 * Postgres, so Settings must not have id and deletedAt fields.
 */
export interface Settings {
  userId: string;
  timezone: string;
  startDate: IsoDate;
  startWeight: number;
  targetWeight: number;
  goalDate: IsoDate;
  weighInCadence: 'daily' | 'weekly';
  dailyCalorieTarget: number;
  noDinnerAllowance: number;
  calorieFloor: number;
  stepTarget: number;
  waterTarget: number;
  runSessionsTarget: number;
  soundEnabled: boolean;
  updatedAt: string;
}

export interface DayLog extends SyncedRow {
  date: IsoDate;
  /** Absent means "derive it"; present means the user overrode it. */
  ticks: Partial<Record<TickableItemId, boolean>>;
  steps: number | null;
  waterGlasses: number | null;
  jokered: boolean;
  validatedAt: string | null;
  bonusFiredAt: string | null;
  mood: number | null;
  energy: number | null;
  note: string | null;
}

export interface Weight extends SyncedRow {
  date: IsoDate;
  kg: number;
}

export interface CalorieEntry extends SyncedRow {
  date: IsoDate;
  label: string | null;
  kcal: number;
}

export interface Run extends SyncedRow {
  date: IsoDate;
  distanceKm: number;
  durationS: number;
  note: string | null;
}

export interface WeekPlan extends SyncedRow {
  isoWeek: IsoWeek;
  noDinnerDays: Weekday[];
  runDays: Weekday[];
  /** The date this week's single joker was spent on, or null. */
  jokerUsedOn: IsoDate | null;
}

/**
 * A closed goal period. Written once when a cycle ends, because starting a new
 * goal overwrites settings.startDate and would otherwise erase the old one's
 * boundaries. The summary itself stays derived — only the boundaries are stored.
 */
export interface Cycle extends SyncedRow {
  startDate: IsoDate;
  goalDate: IsoDate;
  startWeight: number;
  targetWeight: number;
  endWeight: number | null;
  closedAt: string;
}

export const DEFAULT_RUN_DAYS: readonly Weekday[] = [1, 2, 4, 6, 7];
export const DEFAULT_NO_DINNER_DAYS: readonly Weekday[] = [3, 7];
export const MIN_WEIGH_INS_FOR_AVERAGE = 3;
