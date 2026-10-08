import { nowIso } from '@/db/ids';
import { db, type SyncedTableName } from '@/db/schema';

/**
 * Queue a change for Plan 4's sync engine. Call this inside the same Dexie
 * transaction as the data write, so a crash can never leave one without the
 * other.
 */
export async function enqueue(
  table: SyncedTableName,
  op: 'put' | 'delete',
  payload: unknown,
): Promise<void> {
  await db.outbox.add({ table, op, payload, createdAt: nowIso(), attempts: 0 });
}
