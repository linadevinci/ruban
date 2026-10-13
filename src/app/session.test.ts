import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { ensureLocalUser, getCurrentUserId } from '@/app/session';

beforeEach(async () => {
  await db.open();
  await db.meta.clear();
});

describe('session', () => {
  it('has no user before first run', async () => {
    expect(await getCurrentUserId()).toBeNull();
  });

  it('creates a user id on first run', async () => {
    const id = await ensureLocalUser();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getCurrentUserId()).toBe(id);
  });

  it('is idempotent \u2014 the id never changes once created', async () => {
    const first = await ensureLocalUser();
    const second = await ensureLocalUser();
    expect(second).toBe(first);
  });

  it('hands concurrent first-run callers the same id', async () => {
    const [a, b] = await Promise.all([ensureLocalUser(), ensureLocalUser()]);
    expect(b).toBe(a);
    expect(await getCurrentUserId()).toBe(a);
  });
});
