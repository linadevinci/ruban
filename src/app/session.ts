import { newId } from '@/db/ids';
import { db } from '@/db/schema';

export const CURRENT_USER_KEY = 'currentUserId';

export async function getCurrentUserId(): Promise<string | null> {
  const row = await db.meta.get(CURRENT_USER_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * The local user id, created once on first run. Plan 4's signup claims this
 * same id on the server, so no data migration is ever needed.
 */
export async function ensureLocalUser(): Promise<string> {
  let id!: string;
  // The read and the write share ONE transaction. Without it, two concurrent
  // first-run callers can both see no user, mint different ids, and the later
  // put overwrites the earlier - after the first caller has already handed its
  // id to the app. Every row written under the losing id would be orphaned,
  // and Plan 4's signup claims this id on the server, so it must never change.
  // React StrictMode double-invokes effects in development and two tabs on a
  // first run do the same; IndexedDB serialises rw transactions on a store, so
  // one transaction covers both cases.
  await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(CURRENT_USER_KEY);
    if (typeof row?.value === 'string' && row.value !== '') {
      id = row.value;
      return;
    }
    id = newId();
    await db.meta.put({ key: CURRENT_USER_KEY, value: id });
  });
  return id;
}
