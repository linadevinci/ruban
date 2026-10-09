import { newId, nowIso } from '@/db/ids';
import { enqueue } from '@/db/outbox';
import { db, type SyncedTableName } from '@/db/schema';
import {
  DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS,
  type CalorieEntry, type Cycle, type DayLog, type IsoDate, type IsoWeek,
  type Run, type Settings, type Weight, type WeekPlan,
} from '@/domain/types';

function live<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt === null);
}

export async function getSettings(userId: string): Promise<Settings | undefined> {
  return db.settings.get(userId);
}

export async function saveSettings(settings: Omit<Settings, 'updatedAt'>): Promise<Settings> {
  const row: Settings = { ...settings, updatedAt: nowIso() };
  await db.transaction('rw', db.settings, db.outbox, async () => {
    await db.settings.put(row);
    await enqueue('settings', 'put', row);
  });
  return row;
}

/** One weigh-in per date: a second save for the same date replaces the first. */
export async function saveWeight(userId: string, date: IsoDate, kg: number): Promise<Weight> {
  let row!: Weight;
  await db.transaction('rw', db.weights, db.outbox, async () => {
    const existing = await db.weights.where('[userId+date]').equals([userId, date]).first();
    row = {
      id: existing?.id ?? newId(),
      userId, date, kg, updatedAt: nowIso(), deletedAt: null,
    };
    await db.weights.put(row);
    await enqueue('weights', 'put', row);
  });
  return row;
}

export async function saveRun(
  userId: string,
  input: Pick<Run, 'date' | 'distanceKm' | 'durationS' | 'note'> & { id?: string },
): Promise<Run> {
  const row: Run = {
    id: input.id ?? newId(),
    userId, date: input.date, distanceKm: input.distanceKm,
    durationS: input.durationS, note: input.note,
    updatedAt: nowIso(), deletedAt: null,
  };
  await db.transaction('rw', db.runs, db.outbox, async () => {
    await db.runs.put(row);
    await enqueue('runs', 'put', row);
  });
  return row;
}

export async function saveCalorieEntry(
  userId: string,
  date: IsoDate,
  kcal: number,
  label: string | null,
  id?: string,
): Promise<CalorieEntry> {
  const row: CalorieEntry = {
    id: id ?? newId(), userId, date, kcal, label,
    updatedAt: nowIso(), deletedAt: null,
  };
  await db.transaction('rw', db.calorieEntries, db.outbox, async () => {
    await db.calorieEntries.put(row);
    await enqueue('calorieEntries', 'put', row);
  });
  return row;
}

/** Tombstone only. Synced rows are never removed from the table. */
export async function softDelete(
  table: Extract<SyncedTableName, 'weights' | 'runs' | 'calorieEntries'>,
  id: string,
): Promise<void> {
  await db.transaction('rw', db[table], db.outbox, async () => {
    const deletedAt = nowIso();
    const updated = await db[table].update(id, { deletedAt, updatedAt: deletedAt });
    // update() resolves 0 for a missing key without throwing, and get() then
    // returns undefined. Enqueuing anyway would hand Plan 4's engine a change
    // carrying no id — reachable by double-tapping a delete button, or by a
    // delete racing a pull that already tombstoned the row.
    if (updated === 0) return;
    const row = await db[table].get(id);
    await enqueue(table, 'delete', row);
  });
}

/**
 * Read-only: never writes, so a reactive read inside useLiveQuery cannot
 * trigger the table it observes. Returns undefined for a tombstoned row, the
 * same way the list helpers filter it out.
 */
export async function getDayLog(userId: string, date: IsoDate): Promise<DayLog | undefined> {
  const row = await db.dayLogs.where('[userId+date]').equals([userId, date]).first();
  return row !== undefined && row.deletedAt === null ? row : undefined;
}

export async function getOrCreateDayLog(userId: string, date: IsoDate): Promise<DayLog> {
  let row!: DayLog;
  await db.transaction('rw', db.dayLogs, db.outbox, async () => {
    const existing = await db.dayLogs.where('[userId+date]').equals([userId, date]).first();
    if (existing) {
      row = existing;
      return;
    }
    row = {
      id: newId(), userId, date, ticks: {}, steps: null, waterGlasses: null,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
      updatedAt: nowIso(), deletedAt: null,
    };
    await db.dayLogs.put(row);
    await enqueue('dayLogs', 'put', row);
  });
  return row;
}

export async function updateDayLog(
  userId: string,
  date: IsoDate,
  // deletedAt is excluded on purpose: tombstoning belongs to softDelete, whose
  // table union is deliberately narrow. updatedAt is always set here.
  patch: Partial<Omit<DayLog, 'id' | 'userId' | 'date' | 'deletedAt' | 'updatedAt'>>,
): Promise<DayLog> {
  let row!: DayLog;
  // The read and the write share ONE transaction. Reading via
  // getOrCreateDayLog first would open a second transaction, leaving a window
  // in which two rapid taps both read the old ticks and the later write
  // clobbers the earlier tick. It would also enqueue two outbox rows for a
  // day that did not exist yet: one for the create, one for the update.
  await db.transaction('rw', db.dayLogs, db.outbox, async () => {
    const existing = await db.dayLogs.where('[userId+date]').equals([userId, date]).first();
    const base: DayLog = existing ?? {
      id: newId(), userId, date, ticks: {}, steps: null, waterGlasses: null,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
      updatedAt: nowIso(), deletedAt: null,
    };
    row = {
      ...base,
      ...patch,
      // ticks merge rather than replace, so one tap never clears another.
      ticks: { ...base.ticks, ...(patch.ticks ?? {}) },
      updatedAt: nowIso(),
    };
    await db.dayLogs.put(row);
    await enqueue('dayLogs', 'put', row);
  });
  return row;
}

/** Read-only counterpart to getOrCreateWeekPlan; see getDayLog. */
export async function getWeekPlan(
  userId: string,
  isoWeek: IsoWeek,
): Promise<WeekPlan | undefined> {
  const row = await db.weekPlans.where('[userId+isoWeek]').equals([userId, isoWeek]).first();
  return row !== undefined && row.deletedAt === null ? row : undefined;
}

export async function getOrCreateWeekPlan(userId: string, isoWeek: IsoWeek): Promise<WeekPlan> {
  let row!: WeekPlan;
  await db.transaction('rw', db.weekPlans, db.outbox, async () => {
    const existing = await db.weekPlans.where('[userId+isoWeek]').equals([userId, isoWeek]).first();
    if (existing) {
      row = existing;
      return;
    }
    row = {
      id: newId(), userId, isoWeek,
      runDays: [...DEFAULT_RUN_DAYS],
      noDinnerDays: [...DEFAULT_NO_DINNER_DAYS],
      jokerUsedOn: null,
      updatedAt: nowIso(), deletedAt: null,
    };
    await db.weekPlans.put(row);
    await enqueue('weekPlans', 'put', row);
  });
  return row;
}

export async function updateWeekPlan(
  userId: string,
  isoWeek: IsoWeek,
  patch: Partial<Pick<WeekPlan, 'runDays' | 'noDinnerDays' | 'jokerUsedOn'>>,
): Promise<WeekPlan> {
  let row!: WeekPlan;
  // One transaction, for the same reasons as updateDayLog above.
  await db.transaction('rw', db.weekPlans, db.outbox, async () => {
    const existing = await db.weekPlans.where('[userId+isoWeek]').equals([userId, isoWeek]).first();
    const base: WeekPlan = existing ?? {
      id: newId(), userId, isoWeek,
      runDays: [...DEFAULT_RUN_DAYS],
      noDinnerDays: [...DEFAULT_NO_DINNER_DAYS],
      jokerUsedOn: null,
      updatedAt: nowIso(), deletedAt: null,
    };
    row = { ...base, ...patch, updatedAt: nowIso() };
    await db.weekPlans.put(row);
    await enqueue('weekPlans', 'put', row);
  });
  return row;
}

export async function listWeights(userId: string): Promise<Weight[]> {
  return live(await db.weights.where('[userId+date]').between([userId, ''], [userId, '\uffff']).toArray());
}

export async function listRuns(userId: string): Promise<Run[]> {
  return live(await db.runs.where('[userId+date]').between([userId, ''], [userId, '\uffff']).toArray());
}

export async function listCalorieEntries(userId: string): Promise<CalorieEntry[]> {
  return live(await db.calorieEntries.where('[userId+date]').between([userId, ''], [userId, '\uffff']).toArray());
}

export async function listDayLogs(userId: string): Promise<DayLog[]> {
  return live(await db.dayLogs.where('[userId+date]').between([userId, ''], [userId, '\uffff']).toArray());
}

export async function saveCycle(
  userId: string,
  input: Pick<Cycle, 'startDate' | 'goalDate' | 'startWeight' | 'targetWeight' | 'endWeight'>,
): Promise<Cycle> {
  const row: Cycle = {
    id: newId(), userId, ...input,
    closedAt: nowIso(), updatedAt: nowIso(), deletedAt: null,
  };
  await db.transaction('rw', db.cycles, db.outbox, async () => {
    await db.cycles.put(row);
    await enqueue('cycles', 'put', row);
  });
  return row;
}

export async function listCycles(userId: string): Promise<Cycle[]> {
  return live(await db.cycles.where('[userId+startDate]').between([userId, ''], [userId, '\uffff']).toArray());
}
