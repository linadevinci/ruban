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
  const existing = await getCurrentUserId();
  if (existing) return existing;
  const id = newId();
  await db.meta.put({ key: CURRENT_USER_KEY, value: id });
  return id;
}
