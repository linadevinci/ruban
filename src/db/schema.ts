import Dexie, { type EntityTable } from 'dexie';
import type {
  CalorieEntry, Cycle, DayLog, Run, Settings, Weight, WeekPlan,
} from '@/domain/types';
import type { SyncedTableName } from '@/shared/tables';

export type { SyncedTableName } from '@/shared/tables';

export interface OutboxRow {
  seq?: number;
  table: SyncedTableName;
  op: 'put' | 'delete';
  payload: unknown;
  createdAt: string;
  attempts: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class RubanDb extends Dexie {
  settings!: EntityTable<Settings, 'userId'>;
  dayLogs!: EntityTable<DayLog, 'id'>;
  weights!: EntityTable<Weight, 'id'>;
  calorieEntries!: EntityTable<CalorieEntry, 'id'>;
  runs!: EntityTable<Run, 'id'>;
  weekPlans!: EntityTable<WeekPlan, 'id'>;
  cycles!: EntityTable<Cycle, 'id'>;
  outbox!: EntityTable<OutboxRow, 'seq'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor() {
    super('ruban');
    this.version(1).stores({
      settings: 'userId, updatedAt',
      // The three singletons are unique: one row per (user, date) or
      // (user, ISO week). Without that, two devices offline on the same day
      // each mint a different UUIDv7 for the same logical row, both rows
      // exist, and .first() silently picks one while the other's data becomes
      // permanently invisible. calorieEntries and runs allow many per date.
      dayLogs: 'id, &[userId+date], updatedAt',
      weights: 'id, &[userId+date], updatedAt',
      calorieEntries: 'id, [userId+date], updatedAt',
      runs: 'id, [userId+date], updatedAt',
      weekPlans: 'id, &[userId+isoWeek], updatedAt',
      cycles: 'id, [userId+startDate], updatedAt',
      outbox: '++seq, table, createdAt',
      meta: 'key',
    });
  }
}

export const db = new RubanDb();

export type OpenResult =
  | { ok: true }
  | { ok: false; reason: 'blocked' | 'unknown'; error: unknown };

/**
 * Opens the database without throwing. db.open() can reject for reasons that have
 * nothing to do with the data: private browsing with site data blocked, a quota
 * refusal, a corrupted store. The first screen to open the database must be able
 * to say something to the user instead of rendering blank.
 */
export async function openDatabase(): Promise<OpenResult> {
  try {
    await db.open();
    return { ok: true };
  } catch (error) {
    // Read the name defensively. A throw inside this catch would defeat the
    // whole point of this function, and a rejection is not guaranteed to be an
    // Error - it can be any value. Duck-typed rather than instanceof Error,
    // because a DOMException from another realm (jsdom, an iframe) is not one.
    const name = typeof error === 'object' && error !== null && 'name' in error
      ? error.name
      : undefined;
    const blocked = name === 'SecurityError'
      || name === 'QuotaExceededError'
      // Firefox's private-browsing failure, the classic one in practice.
      || name === 'InvalidStateError';
    return { ok: false, reason: blocked ? 'blocked' : 'unknown', error };
  }
}
