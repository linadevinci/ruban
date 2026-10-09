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
