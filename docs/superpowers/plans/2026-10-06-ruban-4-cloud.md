# Ruban Plan 4 — Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the data in the cloud without taking the app offline: a Postgres schema on Neon, username-only auth with a recovery code, and a last-write-wins sync engine driven by the outbox Plan 1 has been filling all along.

**Architecture:** One endpoint moves data (`POST /api/sync`), three move identity. The client stays the source of truth for reads; the server is a merge point and a backup. The last-write-wins decision lives in **one pure function shared by both sides**, so the client and the server can never disagree about who won.

**Tech Stack:** Vercel serverless functions (`@vercel/node`), Drizzle ORM, `@neondatabase/serverless`, `bcryptjs` (pure JS — a native `bcrypt` will not build on Vercel's runtime), `jose` for JWT.

**Spec:** `docs/superpowers/specs/2026-10-06-coquette-tracker-design.md` — §5, §7, §8.

**Depends on:** Plans 1–3 complete.

## Global Constraints

Plan 1's Global Constraints apply in full. Added here:

- **`bcryptjs`, not `bcrypt`.** Cost 12, per spec §8.
- **Cursors use server time; last-write-wins uses client time** (spec §7). Realised by a `serverUpdatedAt` column that **only the database ever writes**: pulls filter on it, merges compare the client's `updatedAt`. This is what makes "a skewed phone clock must never cause a row to be *missed*" actually true.
- **Nothing is ever hard-deleted.** Tombstones sync like any other change.
- **A tombstoned `dayLogs` or `weekPlans` row needs a resurrect path, and this plan is where
  it becomes reachable.** Note what Task 7 of Plan 2 already does and does not solve: its
  `liveDayLog` helper stops a tombstoned row being *displayed* as today's log, but the
  placeholder it substitutes **keeps the tombstoned row's id**, so a subsequent tick still
  writes through `getOrCreateDayLog` to the invisible row. The read is guarded; the write is
  not. Whatever resurrect rule this plan settles on has to cover the write path too, or a
  user's ticks will land somewhere no screen ever shows them. `softDelete`'s table union excludes both, and `updateDayLog`'s
  patch type omits `deletedAt`, so neither can be tombstoned locally — but a pull can
  tombstone either. Once that happens the unique natural-key index forbids creating a fresh
  row for that date, and `updateDayLog` would write to a row every read filters out: the
  user's ticks would silently vanish. Define the behaviour explicitly — the straightforward
  answer is that applying a local write to a tombstoned natural key clears `deletedAt` on
  the existing row rather than inserting a new one — and test it.
- **Conflicts are per record, not per field.**
- **Auth never gates launching the app** (spec §8). The cookie is checked on sync, never on boot.
- **Secrets live in Vercel environment variables**, never in the repo: `DATABASE_URL`, `JWT_SECRET`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. `.env*` is already git-ignored.
- **The deployment URL is public** — Hobby has no password protection — so the login backoff is a requirement, not ceremony.
- **Validate dates arriving from the server, or a corrupt row blanks a screen.** Plan 2 made `parseIsoDate` strict: it throws on anything that is not a real `YYYY-MM-DD`. Onboarding validates what the user types, but **this plan is the other way dates get in**, and the pull path writes rows straight into Dexie. A single bad `goalDate`, `date` or `isoWeek` — from a partial write, a hand-edited row, or a future server bug — then throws during render wherever it is read, and the screen goes white with an unhandled error. Two earlier findings on this project turned out to be exactly this failure, so it is not hypothetical. Use `isIsoDate` from `@/domain/calendar` to reject or quarantine a row whose date fields are malformed, rather than applying it and discovering the problem at render time.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/sync/merge.ts` | `shouldApply()` — the single last-write-wins rule. Shared by client and server. Pure. |
| `src/sync/protocol.ts` | Request/response types for `/api/sync`. Shared by client and server — so it imports `src/shared/tables.ts`, never `src/db/schema.ts`. |
| `src/sync/engine.ts` | Client engine: drain the outbox, pull since the cursor, apply. Transport injected. |
| `src/sync/useSyncStatus.ts` | Pending count, last sync time, online state. |
| `db/schema.ts` | Drizzle table definitions. |
| `db/client.ts` | Neon connection. |
| `drizzle.config.ts` | Migration config. |
| `api/_lib/auth.ts` | Username validation, recovery codes, backoff, JWT issue/verify. Pure parts exported for test. |
| `api/_lib/session.ts` | Read the cookie, return the user id or 401. |
| `api/auth/signup.ts`, `api/auth/login.ts`, `api/auth/recover.ts`, `api/auth/me.ts` | Identity. |
| `api/sync.ts` | The merge point. |
| `src/features/account/Account.tsx` | Sign-up / sign-in / recovery UI, inside the "Moi" tab. |
| `playwright.config.ts`, `e2e/*.spec.ts` | End-to-end flows against the built app with a routed fake API. |

---

### Task 1: The shared merge rule

**Files:**
- Create: `src/sync/merge.ts`, `src/sync/protocol.ts`
- Test: `src/sync/merge.test.ts`

**Interfaces:**
- Produces:
  - `shouldApply(storedUpdatedAt: string | null, incomingUpdatedAt: string): boolean`
  - re-exports `SYNCED_TABLES` and `SyncedTableName` from `@/shared/tables` (declared there in Plan 1, with zero imports, so `api/` can use them without dragging in Dexie)
  - `export interface Change { table: SyncedTableName; row: Record<string, unknown> }`
  - `export interface SyncRequest { since: string | null; changes: Change[] }`
  - `export interface SyncResponse { serverTime: string; rows: Partial<Record<SyncedTableName, Record<string, unknown>[]>> }`

Both sides import `shouldApply`. That is the whole point of this task: a merge rule implemented twice is a merge rule that will eventually disagree with itself.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { shouldApply } from '@/sync/merge';

describe('shouldApply', () => {
  it('applies anything over a row that does not exist', () => {
    expect(shouldApply(null, '2026-10-06T10:00:00.000Z')).toBe(true);
  });

  it('applies a strictly newer write', () => {
    expect(shouldApply('2026-10-06T10:00:00.000Z', '2026-10-06T10:00:01.000Z')).toBe(true);
  });

  it('rejects an older write', () => {
    expect(shouldApply('2026-10-06T10:00:01.000Z', '2026-10-06T10:00:00.000Z')).toBe(false);
  });

  it('rejects an equal timestamp, so a replayed outbox row is a no-op', () => {
    expect(shouldApply('2026-10-06T10:00:00.000Z', '2026-10-06T10:00:00.000Z')).toBe(false);
  });

  it('compares instants, not strings, across offset formats', () => {
    // Same instant written two ways.
    expect(shouldApply('2026-10-06T12:00:00.000+02:00', '2026-10-06T10:00:00.000Z')).toBe(false);
    expect(shouldApply('2026-10-06T10:00:00.000Z', '2026-10-06T12:00:01.000+02:00')).toBe(true);
  });

  it('rejects an unparseable incoming timestamp rather than guessing', () => {
    expect(shouldApply('2026-10-06T10:00:00.000Z', 'not-a-date')).toBe(false);
  });

  it('applies over an unparseable stored timestamp, which is corrupt data', () => {
    expect(shouldApply('garbage', '2026-10-06T10:00:00.000Z')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- sync/merge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/sync/merge.ts`:

```ts
/**
 * The single last-write-wins rule, shared by the client engine and the server
 * endpoint. Implemented once on purpose: two copies would eventually disagree.
 *
 * Strictly newer wins, so replaying an outbox row is a no-op rather than a
 * pointless write.
 */
export function shouldApply(
  storedUpdatedAt: string | null,
  incomingUpdatedAt: string,
): boolean {
  const incoming = Date.parse(incomingUpdatedAt);
  if (Number.isNaN(incoming)) return false;
  if (storedUpdatedAt === null) return true;
  const stored = Date.parse(storedUpdatedAt);
  if (Number.isNaN(stored)) return true;
  return incoming > stored;
}
```

`src/sync/protocol.ts`:

```ts
// Relative, not '@/shared/tables': api/sync.ts imports this file, and Vercel
// builds api/ with its own bundler, which does not know the Vite alias.
// Reaching for '@/db/schema' here would also pull Dexie into every function.
import { SYNCED_TABLES, type SyncedTableName } from '../shared/tables';

export { SYNCED_TABLES };
export type { SyncedTableName };

export interface Change {
  table: SyncedTableName;
  row: Record<string, unknown>;
}

export interface SyncRequest {
  since: string | null;
  changes: Change[];
}

export interface SyncResponse {
  /** Server clock. Store it as the next cursor; never use the client clock here. */
  serverTime: string;
  rows: Partial<Record<SyncedTableName, Record<string, unknown>[]>>;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- sync/merge`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sync
git commit -m "feat: add the shared last-write-wins rule and sync protocol"
```

---

### Task 2: Database schema on Neon

**Files:**
- Create: `db/schema.ts`, `db/client.ts`, `drizzle.config.ts`, `.env.example`
- Modify: `package.json` (migration scripts)

```bash
npm install drizzle-orm @neondatabase/serverless bcryptjs jose
npm install -D drizzle-kit @vercel/node
```

**Do not install `@types/bcryptjs`.** Verified on npm: it is published only as a deprecated stub ("bcryptjs provides its own type definitions, so you do not need this installed"), and bcryptjs 3 ships `umd/index.d.ts` itself.

```bash
# nothing further to install
```

**Interfaces:**
- Produces: Drizzle tables `users`, `settings`, `dayLogs`, `weights`, `calorieEntries`, `runs`, `weekPlans`, `cycles`, `pushSubscriptions`, `reminders`, `sentReminders`, `loginAttempts`; `getDb()` from `db/client.ts`; `SERVER_TABLES` mapping a `SyncedTableName` to its Drizzle table.

Every synced table carries both timestamps:

- `updatedAt text not null` — the **client's** clock. The merge rule reads this.
- `serverUpdatedAt timestamptz not null default now()` — the **database's** clock. Pulls filter on this, and only the database ever writes it.

- [ ] **Step 1: Write the schema**

`db/schema.ts`:

```ts
import {
  boolean, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Columns every synced table shares. */
const synced = {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  serverUpdatedAt: timestamp('server_updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  recoveryCodeHash: text('recovery_code_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  userId: text('user_id').primaryKey(),
  timezone: text('timezone').notNull(),
  startDate: text('start_date').notNull(),
  startWeight: real('start_weight').notNull(),
  targetWeight: real('target_weight').notNull(),
  goalDate: text('goal_date').notNull(),
  weighInCadence: text('weigh_in_cadence').notNull(),
  dailyCalorieTarget: integer('daily_calorie_target').notNull(),
  noDinnerAllowance: integer('no_dinner_allowance').notNull(),
  calorieFloor: integer('calorie_floor').notNull(),
  stepTarget: integer('step_target').notNull(),
  waterTarget: integer('water_target').notNull(),
  runSessionsTarget: integer('run_sessions_target').notNull(),
  soundEnabled: boolean('sound_enabled').notNull(),
  updatedAt: text('updated_at').notNull(),
  serverUpdatedAt: timestamp('server_updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dayLogs = pgTable('day_logs', {
  ...synced,
  date: text('date').notNull(),
  ticks: jsonb('ticks').notNull().default({}),
  steps: integer('steps'),
  waterGlasses: integer('water_glasses'),
  jokered: boolean('jokered').notNull().default(false),
  validatedAt: text('validated_at'),
  bonusFiredAt: text('bonus_fired_at'),
  mood: integer('mood'),
  energy: integer('energy'),
  note: text('note'),
}, (table) => ({
  userDate: uniqueIndex('day_logs_user_date').on(table.userId, table.date),
}));

export const weights = pgTable('weights', {
  ...synced,
  date: text('date').notNull(),
  kg: real('kg').notNull(),
}, (table) => ({
  userDate: uniqueIndex('weights_user_date').on(table.userId, table.date),
}));

export const calorieEntries = pgTable('calorie_entries', {
  ...synced,
  date: text('date').notNull(),
  label: text('label'),
  kcal: integer('kcal').notNull(),
});

export const runs = pgTable('runs', {
  ...synced,
  date: text('date').notNull(),
  distanceKm: real('distance_km').notNull(),
  durationS: integer('duration_s').notNull(),
  note: text('note'),
});

/** Closed goal periods. See the Cycle type in src/domain/types.ts for why. */
export const cycles = pgTable('cycles', {
  ...synced,
  startDate: text('start_date').notNull(),
  goalDate: text('goal_date').notNull(),
  startWeight: real('start_weight').notNull(),
  targetWeight: real('target_weight').notNull(),
  endWeight: real('end_weight'),
  closedAt: text('closed_at').notNull(),
});

export const weekPlans = pgTable('week_plans', {
  ...synced,
  isoWeek: text('iso_week').notNull(),
  noDinnerDays: jsonb('no_dinner_days').notNull().default([]),
  runDays: jsonb('run_days').notNull().default([]),
  jokerUsedOn: text('joker_used_on'),
}, (table) => ({
  userWeek: uniqueIndex('week_plans_user_week').on(table.userId, table.isoWeek),
}));

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable('reminders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  daysOfWeek: jsonb('days_of_week').notNull().default([]),
  localTime: text('local_time').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});

/** Makes the hourly dispatcher idempotent. Server-only; never synced. */
export const sentReminders = pgTable('sent_reminders', {
  userId: text('user_id').notNull(),
  date: text('date').notNull(),
  kind: text('kind').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  once: uniqueIndex('sent_reminders_once').on(table.userId, table.date, table.kind),
}));

/** Server-only. The deployment URL is public, so this is not optional. */
export const loginAttempts = pgTable('login_attempts', {
  username: text('username').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

export const SERVER_TABLES = {
  settings, dayLogs, weights, calorieEntries, runs, weekPlans, cycles,
} as const;
```

- [ ] **Step 2: Write the client and config**

`db/client.ts`:

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(neon(url), { schema });
}
```

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
```

`.env.example`:

```
DATABASE_URL=postgres://user:password@host/db?sslmode=require
JWT_SECRET=generate-with-openssl-rand-base64-48
CRON_SECRET=generate-with-openssl-rand-base64-32
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

Add to `package.json` `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

- [ ] **Step 3: Create the Neon database and migrate**

1. Create a free Neon project; copy the pooled connection string.
2. `echo 'DATABASE_URL=...' >> .env.local` (git-ignored).
3. `openssl rand -base64 48` → `JWT_SECRET` in `.env.local`.
4. Generate and apply:

```bash
npm run db:generate
npm run db:migrate
```

5. Add `DATABASE_URL` and `JWT_SECRET` to the Vercel project's environment variables for Production, Preview and Development.

- [ ] **Step 4: Verify the schema landed**

Run: `npx drizzle-kit check`
Expected: no pending differences between `db/schema.ts` and the migrations.

- [ ] **Step 5: Commit**

```bash
git add db drizzle.config.ts .env.example package.json package-lock.json
git commit -m "feat: add Postgres schema on Neon with dual timestamps"
```

---

### Task 3: Auth helpers

**Files:**
- Create: `api/_lib/auth.ts`
- Test: `api/_lib/auth.test.ts`

**Interfaces:**
- Produces:
  - `validateUsername(raw: string): { ok: true; username: string } | { ok: false; reason: string }`
  - `validatePassword(raw: string): { ok: true } | { ok: false; reason: string }`
  - `generateRecoveryCode(): string` — `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
  - `normaliseRecoveryCode(raw: string): string`
  - `lockDurationSeconds(attempts: number): number`
  - `hashSecret(plain: string): Promise<string>`, `verifySecret(plain, hash): Promise<boolean>`
  - `issueToken(userId: string): Promise<string>`, `verifyToken(token: string): Promise<string | null>`
  - `sessionCookie(token: string): string`, `clearCookie(): string`

The recovery alphabet excludes `0 O 1 I L` — this code gets written on paper and read back months later.

Add to `vite.config.ts` `test.include`: `'api/**/*.test.ts'`.

**Also extend `tsconfig.node.json`'s `include`** to `["vite.config.ts", "api/**/*.ts", "db/**/*.ts", "drizzle.config.ts"]`, and add `"strict": true` to its `compilerOptions`. As scaffolded it includes only `vite.config.ts` and is not strict, so `npx tsc -b` would never type-check a single serverless function — the same false-pass trap as `--noEmit`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  clearCookie, generateRecoveryCode, hashSecret, issueToken, lockDurationSeconds,
  normaliseRecoveryCode, sessionCookie, validatePassword, validateUsername,
  verifySecret, verifyToken,
} from './auth';

process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-xxxxx';

describe('validateUsername', () => {
  it('accepts a simple name and lowercases it', () => {
    expect(validateUsername('Lina_10')).toEqual({ ok: true, username: 'lina_10' });
  });

  it('trims surrounding whitespace', () => {
    expect(validateUsername('  lina  ')).toEqual({ ok: true, username: 'lina' });
  });

  it('rejects too short, too long and illegal characters', () => {
    expect(validateUsername('ab').ok).toBe(false);
    expect(validateUsername('a'.repeat(33)).ok).toBe(false);
    expect(validateUsername('lina!').ok).toBe(false);
    expect(validateUsername('li na').ok).toBe(false);
  });
});

describe('validatePassword', () => {
  it('requires at least eight characters', () => {
    expect(validatePassword('1234567').ok).toBe(false);
    expect(validatePassword('12345678').ok).toBe(true);
  });

  it('does not silently trim a password', () => {
    expect(validatePassword(' 1234567 ').ok).toBe(true);
  });
});

describe('recovery codes', () => {
  it('has six groups of four from an unambiguous alphabet', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}(-[A-HJ-KM-NP-Z2-9]{4}){5}$/);
  });

  it('is different every time', () => {
    const codes = new Set(Array.from({ length: 40 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(40);
  });

  it('normalises casing, spaces and missing dashes when read back', () => {
    const code = generateRecoveryCode();
    const messy = code.toLowerCase().replace(/-/g, ' ');
    expect(normaliseRecoveryCode(messy)).toBe(code);
  });
});

describe('lockDurationSeconds', () => {
  it('does not lock the first few attempts', () => {
    expect(lockDurationSeconds(1)).toBe(0);
    expect(lockDurationSeconds(3)).toBe(0);
  });

  it('backs off exponentially and then caps', () => {
    expect(lockDurationSeconds(4)).toBeGreaterThan(0);
    expect(lockDurationSeconds(6)).toBeGreaterThan(lockDurationSeconds(5));
    expect(lockDurationSeconds(50)).toBe(lockDurationSeconds(12));
  });
});

describe('hashSecret / verifySecret', () => {
  it('round-trips and rejects a wrong secret', async () => {
    const hash = await hashSecret('correct horse battery');
    expect(await verifySecret('correct horse battery', hash)).toBe(true);
    expect(await verifySecret('wrong', hash)).toBe(false);
  });

  it('produces a different hash for the same input', async () => {
    expect(await hashSecret('abc')).not.toBe(await hashSecret('abc'));
  });
});

describe('issueToken / verifyToken', () => {
  it('round-trips a user id', async () => {
    const token = await issueToken('user-1');
    expect(await verifyToken(token)).toBe('user-1');
  });

  it('rejects a tampered or absent token', async () => {
    const token = await issueToken('user-1');
    expect(await verifyToken(`${token}x`)).toBeNull();
    expect(await verifyToken('')).toBeNull();
  });
});

describe('cookies', () => {
  it('sets httpOnly, Secure, SameSite=Lax and a 90-day life', () => {
    const cookie = sessionCookie('abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=7776000');
  });

  it('clears by expiring immediately', () => {
    expect(clearCookie()).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- api/_lib/auth`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

const BCRYPT_COST = 12;
const COOKIE_NAME = 'ruban_session';
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;
/** No 0 O 1 I L — this gets written on paper and read back months later. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function validateUsername(
  raw: string,
): { ok: true; username: string } | { ok: false; reason: string } {
  const username = raw.trim().toLowerCase();
  if (username.length < 3) return { ok: false, reason: 'Trois caractères minimum.' };
  if (username.length > 32) return { ok: false, reason: 'Trente-deux caractères maximum.' };
  if (!/^[a-z0-9_.-]+$/.test(username)) {
    return { ok: false, reason: 'Lettres, chiffres, point, tiret et underscore seulement.' };
  }
  return { ok: true, username };
}

export function validatePassword(raw: string): { ok: true } | { ok: false; reason: string } {
  // Deliberately not trimmed: a leading space is part of the password.
  if (raw.length < 8) return { ok: false, reason: 'Huit caractères minimum.' };
  return { ok: true };
}

export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]!);
  return Array.from({ length: 6 }, (_, g) => chars.slice(g * 4, g * 4 + 4).join('')).join('-');
}

export function normaliseRecoveryCode(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters.match(/.{1,4}/g) ?? []).join('-');
}

/** No lock for the first three tries; then exponential, capped at attempt 12. */
export function lockDurationSeconds(attempts: number): number {
  if (attempts <= 3) return 0;
  return 2 ** Math.min(attempts - 3, 9);
}

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(value);
}

export async function issueToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${NINETY_DAYS_SECONDS}s`)
    .sign(secret());
}

export async function verifyToken(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${NINETY_DAYS_SECONDS}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(header: string | undefined): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return '';
}

export { COOKIE_NAME };
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- api/_lib/auth`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/auth.ts api/_lib/auth.test.ts vite.config.ts
git commit -m "feat: add auth helpers with recovery codes and login backoff"
```

---

### Task 4: Auth endpoints

**Files:**
- Create: `api/_lib/session.ts`, `api/auth/signup.ts`, `api/auth/login.ts`, `api/auth/recover.ts`, `api/auth/me.ts`

**Interfaces:**
- Consumes: `api/_lib/auth`, `db/client`, `db/schema`.
- Produces: four endpoints, and `requireUser(req, res): Promise<string | null>` from `api/_lib/session.ts`.

**Signup takes the client's existing `userId`.** That is how the local data from Plans 2–3 claims the account with no migration — the id was a client-generated UUIDv7 from the first run, exactly as spec §5 intends. Signup rejects a `userId` already present.

These endpoints are verified by the manual smoke test in Task 7 rather than by unit tests: their logic is thin, and the parts worth testing — validation, hashing, backoff, token round-trip — are already covered as pure functions in Task 3.

- [ ] **Step 1: Write the session helper**

`api/_lib/session.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readCookie, verifyToken } from './auth';

/** Returns the user id, or writes a 401 and returns null. */
export async function requireUser(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const userId = await verifyToken(readCookie(req.headers.cookie));
  if (!userId) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  return userId;
}
```

- [ ] **Step 2: Write signup**

`api/auth/signup.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { users } from '../../db/schema';
import {
  generateRecoveryCode, hashSecret, issueToken, sessionCookie,
  validatePassword, validateUsername,
} from '../_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { username: rawUsername, password, userId } = req.body ?? {};
  if (typeof rawUsername !== 'string' || typeof password !== 'string' || typeof userId !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }

  const name = validateUsername(rawUsername);
  if (!name.ok) return res.status(400).json({ error: 'invalid_username', reason: name.reason });

  const pass = validatePassword(password);
  if (!pass.ok) return res.status(400).json({ error: 'invalid_password', reason: pass.reason });

  const db = getDb();

  const [takenName] = await db.select({ id: users.id }).from(users)
    .where(eq(users.username, name.username)).limit(1);
  if (takenName) return res.status(409).json({ error: 'username_taken' });

  const [takenId] = await db.select({ id: users.id }).from(users)
    .where(eq(users.id, userId)).limit(1);
  if (takenId) return res.status(409).json({ error: 'device_already_claimed' });

  const recoveryCode = generateRecoveryCode();
  await db.insert(users).values({
    id: userId,
    username: name.username,
    passwordHash: await hashSecret(password),
    recoveryCodeHash: await hashSecret(recoveryCode),
  });

  res.setHeader('Set-Cookie', sessionCookie(await issueToken(userId)));
  // The only time this value is ever readable. It is stored hashed.
  return res.status(201).json({ userId, username: name.username, recoveryCode });
}
```

- [ ] **Step 3: Write login, recover and me**

`api/auth/login.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { loginAttempts, users } from '../../db/schema';
import {
  issueToken, lockDurationSeconds, sessionCookie, validateUsername, verifySecret,
} from '../_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { username: rawUsername, password } = req.body ?? {};
  if (typeof rawUsername !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const name = validateUsername(rawUsername);
  if (!name.ok) return res.status(401).json({ error: 'invalid_credentials' });

  const db = getDb();

  const [lock] = await db.select().from(loginAttempts)
    .where(eq(loginAttempts.username, name.username)).limit(1);
  if (lock?.lockedUntil && lock.lockedUntil > new Date()) {
    return res.status(429).json({
      error: 'too_many_attempts',
      retryAfterSeconds: Math.ceil((lock.lockedUntil.getTime() - Date.now()) / 1000),
    });
  }

  const [user] = await db.select().from(users)
    .where(eq(users.username, name.username)).limit(1);
  const ok = user ? await verifySecret(password, user.passwordHash) : false;

  if (!ok) {
    const attempts = (lock?.attempts ?? 0) + 1;
    const seconds = lockDurationSeconds(attempts);
    await db.insert(loginAttempts)
      .values({
        username: name.username,
        attempts,
        lockedUntil: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
      })
      .onConflictDoUpdate({
        target: loginAttempts.username,
        set: {
          attempts,
          lockedUntil: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
        },
      });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  await db.delete(loginAttempts).where(eq(loginAttempts.username, name.username));
  res.setHeader('Set-Cookie', sessionCookie(await issueToken(user!.id)));
  return res.status(200).json({ userId: user!.id, username: user!.username });
}
```

`api/auth/recover.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { loginAttempts, users } from '../../db/schema';
import {
  hashSecret, issueToken, normaliseRecoveryCode, sessionCookie,
  validatePassword, validateUsername, verifySecret,
} from '../_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { username: rawUsername, recoveryCode, newPassword } = req.body ?? {};
  if (typeof rawUsername !== 'string' || typeof recoveryCode !== 'string'
      || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const name = validateUsername(rawUsername);
  if (!name.ok) return res.status(401).json({ error: 'invalid_recovery' });

  const pass = validatePassword(newPassword);
  if (!pass.ok) return res.status(400).json({ error: 'invalid_password', reason: pass.reason });

  const db = getDb();
  const [user] = await db.select().from(users)
    .where(eq(users.username, name.username)).limit(1);

  const ok = user
    ? await verifySecret(normaliseRecoveryCode(recoveryCode), user.recoveryCodeHash)
    : false;
  if (!ok) return res.status(401).json({ error: 'invalid_recovery' });

  // The code is single-use: a successful recovery issues a new one.
  await db.update(users)
    .set({ passwordHash: await hashSecret(newPassword) })
    .where(eq(users.id, user!.id));
  await db.delete(loginAttempts).where(eq(loginAttempts.username, name.username));

  res.setHeader('Set-Cookie', sessionCookie(await issueToken(user!.id)));
  return res.status(200).json({ userId: user!.id, username: user!.username });
}
```

`api/auth/me.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { users } from '../../db/schema';
import { readCookie, verifyToken } from '../_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await verifyToken(readCookie(req.headers.cookie));
  if (!userId) return res.status(200).json({ userId: null, username: null });

  const [user] = await getDb().select({ username: users.username }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return res.status(200).json({ userId, username: user?.username ?? null });
}
```

`/api/auth/me` answers 200 with nulls rather than 401, because the client asks it on boot and a 401 there is not an error — it is the normal offline-or-anonymous state.

- [ ] **Step 4: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat: add username-only auth endpoints with recovery codes"
```

---

### Task 5: The sync endpoint

**Files:**
- Create: `api/sync.ts`

**Interfaces:**
- Consumes: `requireUser`, `shouldApply`, `SERVER_TABLES`, `SyncRequest`, `SyncResponse`.
- Produces: `POST /api/sync`.

Three rules the implementation must not bend:

1. **Every incoming row's `userId` is overwritten with the authenticated id**, never trusted from the body. Otherwise one account could write into another's rows.
2. **`serverUpdatedAt` is set by the database on every write** (`new Date()` on the upsert), and is stripped from rows before they are sent back — the client has no use for it and must not start storing it.
3. **The upsert applies only when the incoming client `updatedAt` is strictly newer**, enforced in SQL so two concurrent requests cannot interleave into a lost update.

- [ ] **Step 1: Implement**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { SERVER_TABLES } from '../db/schema';
import type { SyncRequest, SyncResponse } from '../src/sync/protocol';
import { requireUser } from './_lib/session';

type TableName = keyof typeof SERVER_TABLES;

function isTableName(value: unknown): value is TableName {
  return typeof value === 'string' && value in SERVER_TABLES;
}

/** The client has no use for the server clock except as a cursor. */
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const { serverUpdatedAt, ...rest } = row;
  return rest;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const userId = await requireUser(req, res);
  if (!userId) return undefined;

  const body = req.body as SyncRequest | undefined;
  const changes = Array.isArray(body?.changes) ? body!.changes : [];
  const since = typeof body?.since === 'string' ? new Date(body.since) : null;
  if (since !== null && Number.isNaN(since.getTime())) {
    return res.status(400).json({ error: 'bad_cursor' });
  }

  const db = getDb();
  // neon-http has returned both a bare array and a { rows } object across
  // versions; accept either rather than pinning to one.
  const executed = await db.execute<{ now: string }>(sql`select now()::text as now`);
  const nowRow = (Array.isArray(executed) ? executed[0] : executed.rows?.[0]) as
    | { now: string } | undefined;
  const now = nowRow?.now ?? new Date().toISOString();

  // --- push -------------------------------------------------------------
  for (const change of changes) {
    if (!isTableName(change.table) || typeof change.row !== 'object' || change.row === null) {
      continue;
    }
    const table = SERVER_TABLES[change.table];
    const key = change.table === 'settings' ? 'userId' : 'id';

    // Never trust the body's userId.
    const row = { ...change.row, userId, serverUpdatedAt: new Date() };
    if (typeof row.updatedAt !== 'string') continue;

    const { serverUpdatedAt: _ignored, ...updatable } = row;

    await db.insert(table).values(row as never).onConflictDoUpdate({
      target: key === 'userId' ? table.userId : (table as { id: never }).id,
      set: { ...(updatable as never), serverUpdatedAt: new Date() },
      // Strictly newer wins — the same rule as shouldApply, enforced in SQL so
      // two concurrent requests cannot interleave into a lost update.
      setWhere: sql`${table.updatedAt} < ${row.updatedAt}`,
    });
  }

  // --- pull -------------------------------------------------------------
  const rows: SyncResponse['rows'] = {};
  for (const name of Object.keys(SERVER_TABLES) as TableName[]) {
    const table = SERVER_TABLES[name];
    const where = since === null
      ? eq(table.userId, userId)
      : and(eq(table.userId, userId), gt(table.serverUpdatedAt, since));
    const found = await db.select().from(table).where(where);
    rows[name] = found.map((r) => strip(r as Record<string, unknown>));
  }

  const response: SyncResponse = { serverTime: now, rows };
  return res.status(200).json(response);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors. If Drizzle's generic upsert types fight the dynamic table lookup, narrow with a `switch` over the six table names rather than widening to `any` — the cast must stay at the row level, never the table level.

- [ ] **Step 3: Commit**

```bash
git add api/sync.ts
git commit -m "feat: add the sync endpoint with SQL-enforced last-write-wins"
```

---

### Task 6: The client sync engine

**Files:**
- Create: `src/sync/engine.ts`, `src/sync/useSyncStatus.ts`
- Test: `src/sync/engine.test.ts`

**Interfaces:**
- Consumes: `db`, `shouldApply`, `SYNCED_TABLES`, protocol types.
- Produces:
  - `export type Transport = (request: SyncRequest) => Promise<SyncResponse>`
  - `syncOnce(transport: Transport): Promise<SyncOutcome>`
  - `export interface SyncOutcome { pushed: number; pulled: number; skipped: number; collisions: number; cursor: string | null }`
  - `findByNaturalKey(table: SyncedTableName, row: Record<string, unknown>): Promise<{ id: string; updatedAt: string } | undefined>` — looks a row up by `[userId+date]` for `dayLogs`/`weights`, `[userId+isoWeek]` for `weekPlans`, and returns `undefined` for every other table, which has no natural-key constraint

**New requirement, from Plan 1's hardening.** Plan 1 made `dayLogs`, `weights` and `weekPlans` **unique** on their natural key, which changes this endpoint's pull path: `put`ting a server row whose `(userId, date)` is already held locally under a *different* id now rejects with `ConstraintError` instead of silently creating a second row. The engine must catch that, resolve it by the same client-`updatedAt` rule, tombstone the loser, and count it. A test must cover it: seed a local row, pull a server row with the same natural key, a different id and a newer `updatedAt`, and assert the server row wins, the local one is tombstoned, and `collisions` is 1. Without this branch the outbox wedges on the first two-device collision — which is the failure spec §5 says is currently unresolved.
  - `httpTransport: Transport`
  - `useSyncStatus(): { pending: number; lastSyncAt: string | null; online: boolean }`
  - meta keys `SYNC_CURSOR_KEY`, `LAST_SYNC_KEY`

The transport is a parameter so the whole engine is tested against a fake server, as spec §11 requires — no network, no mocking framework.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { saveRun, saveWeight, softDelete } from '@/db/repos';
import { SYNC_CURSOR_KEY, syncOnce, type Transport } from '@/sync/engine';
import type { SyncRequest, SyncResponse } from '@/sync/protocol';

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.weights.clear(), db.runs.clear(), db.dayLogs.clear(),
    db.calorieEntries.clear(), db.weekPlans.clear(), db.settings.clear(),
    db.cycles.clear(), db.outbox.clear(), db.meta.clear(),
  ]);
});

/** A fake server that records what it was sent and replies with what it is told. */
function fakeServer(reply: Partial<SyncResponse> = {}) {
  const seen: SyncRequest[] = [];
  const transport: Transport = async (request) => {
    seen.push(request);
    return {
      serverTime: reply.serverTime ?? '2026-10-06T20:00:00.000Z',
      rows: reply.rows ?? {},
    };
  };
  return { seen, transport };
}

describe('syncOnce — push', () => {
  it('drains the outbox and reports what it pushed', async () => {
    await saveWeight('u1', '2026-10-06', 62.4);
    await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });

    const { seen, transport } = fakeServer();
    const outcome = await syncOnce(transport);

    expect(outcome.pushed).toBe(2);
    expect(seen[0]?.changes.map((c) => c.table)).toEqual(['weights', 'runs']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('pushes in outbox order so a later edit cannot be overtaken', async () => {
    await saveWeight('u1', '2026-10-06', 62.4);
    await saveWeight('u1', '2026-10-06', 62.1);
    const { seen, transport } = fakeServer();
    await syncOnce(transport);
    const kgs = seen[0]!.changes.map((c) => (c.row as { kg: number }).kg);
    expect(kgs).toEqual([62.4, 62.1]);
  });

  it('keeps the outbox intact when the transport throws', async () => {
    await saveWeight('u1', '2026-10-06', 62.4);
    const failing: Transport = async () => { throw new Error('offline'); };
    await expect(syncOnce(failing)).rejects.toThrow('offline');
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0]?.attempts).toBe(1);
  });

  it('sends a tombstone as an ordinary change', async () => {
    const run = await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    await db.outbox.clear();
    await softDelete('runs', run.id);
    const { seen, transport } = fakeServer();
    await syncOnce(transport);
    expect((seen[0]?.changes[0]?.row as { deletedAt: string | null }).deletedAt).not.toBeNull();
  });

  it('sends null as the first cursor and the server time thereafter', async () => {
    const first = fakeServer({ serverTime: '2026-10-06T20:00:00.000Z' });
    await syncOnce(first.transport);
    expect(first.seen[0]?.since).toBeNull();

    const second = fakeServer();
    await syncOnce(second.transport);
    expect(second.seen[0]?.since).toBe('2026-10-06T20:00:00.000Z');
  });

  it('stores the server clock as the cursor, never the local clock', async () => {
    const { transport } = fakeServer({ serverTime: '2030-01-01T00:00:00.000Z' });
    const outcome = await syncOnce(transport);
    expect(outcome.cursor).toBe('2030-01-01T00:00:00.000Z');
    expect((await db.meta.get(SYNC_CURSOR_KEY))?.value).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('syncOnce — pull', () => {
  it('applies a server row that does not exist locally', async () => {
    const { transport } = fakeServer({
      rows: {
        runs: [{
          id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 7, durationS: 2400,
          note: null, updatedAt: '2026-10-07T09:00:00.000Z', deletedAt: null,
        }],
      },
    });
    const outcome = await syncOnce(transport);
    expect(outcome.pulled).toBe(1);
    expect((await db.runs.get('r1'))?.distanceKm).toBe(7);
  });

  it('overwrites a local row the server edited more recently', async () => {
    await db.runs.put({
      id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 5, durationS: 1500,
      note: null, updatedAt: '2026-10-07T08:00:00.000Z', deletedAt: null,
    });
    const { transport } = fakeServer({
      rows: {
        runs: [{
          id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 7, durationS: 2400,
          note: null, updatedAt: '2026-10-07T09:00:00.000Z', deletedAt: null,
        }],
      },
    });
    await syncOnce(transport);
    expect((await db.runs.get('r1'))?.distanceKm).toBe(7);
  });

  it('keeps a local row that is newer than the server copy', async () => {
    await db.runs.put({
      id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 9, durationS: 3000,
      note: null, updatedAt: '2026-10-07T10:00:00.000Z', deletedAt: null,
    });
    const { transport } = fakeServer({
      rows: {
        runs: [{
          id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 7, durationS: 2400,
          note: null, updatedAt: '2026-10-07T09:00:00.000Z', deletedAt: null,
        }],
      },
    });
    const outcome = await syncOnce(transport);
    expect(outcome.skipped).toBe(1);
    expect((await db.runs.get('r1'))?.distanceKm).toBe(9);
  });

  it('applies an incoming tombstone', async () => {
    await db.runs.put({
      id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 5, durationS: 1500,
      note: null, updatedAt: '2026-10-07T08:00:00.000Z', deletedAt: null,
    });
    const { transport } = fakeServer({
      rows: {
        runs: [{
          id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 5, durationS: 1500,
          note: null, updatedAt: '2026-10-07T09:00:00.000Z',
          deletedAt: '2026-10-07T09:00:00.000Z',
        }],
      },
    });
    await syncOnce(transport);
    expect((await db.runs.get('r1'))?.deletedAt).not.toBeNull();
  });

  it('does not re-enqueue applied server rows, which would loop forever', async () => {
    const { transport } = fakeServer({
      rows: {
        runs: [{
          id: 'r1', userId: 'u1', date: '2026-10-07', distanceKm: 7, durationS: 2400,
          note: null, updatedAt: '2026-10-07T09:00:00.000Z', deletedAt: null,
        }],
      },
    });
    await syncOnce(transport);
    expect(await db.outbox.count()).toBe(0);
  });

  it('applies settings, which is keyed by userId rather than id', async () => {
    const { transport } = fakeServer({
      rows: {
        settings: [{
          userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-01',
          startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
          weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
          calorieFloor: 1200, stepTarget: 8000, waterTarget: 6,
          runSessionsTarget: 5, soundEnabled: false,
          updatedAt: '2026-10-06T09:00:00.000Z',
        }],
      },
    });
    await syncOnce(transport);
    expect((await db.settings.get('u1'))?.stepTarget).toBe(8000);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- sync/engine`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/sync/engine.ts`:

```ts
import { db, type SyncedTableName } from '@/db/schema';
import { shouldApply } from '@/sync/merge';
import { SYNCED_TABLES, type Change, type SyncRequest, type SyncResponse } from '@/sync/protocol';

export const SYNC_CURSOR_KEY = 'syncCursor';
export const LAST_SYNC_KEY = 'lastSyncAt';

export type Transport = (request: SyncRequest) => Promise<SyncResponse>;

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  skipped: number;
  /** Natural-key collisions resolved during the pull. Non-zero means two
   *  devices minted different ids for one logical row — see spec §5. */
  collisions: number;
  cursor: string | null;
}

export const httpTransport: Transport = async (request) => {
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`sync failed: ${response.status}`);
  return (await response.json()) as SyncResponse;
};

function keyOf(table: SyncedTableName): 'userId' | 'id' {
  return table === 'settings' ? 'userId' : 'id';
}

async function readCursor(): Promise<string | null> {
  const row = await db.meta.get(SYNC_CURSOR_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * One round trip: drain the outbox, then apply what the server returns.
 *
 * On failure the outbox is left intact and attempt counters are bumped, so a
 * lost connection mid-save loses nothing.
 */
export async function syncOnce(transport: Transport): Promise<SyncOutcome> {
  const queued = await db.outbox.orderBy('seq').toArray();
  const changes: Change[] = queued.map((row) => ({
    table: row.table,
    row: row.payload as Record<string, unknown>,
  }));

  const since = await readCursor();

  let response: SyncResponse;
  try {
    response = await transport({ since, changes });
  } catch (error) {
    await db.transaction('rw', db.outbox, async () => {
      for (const row of queued) {
        if (row.seq !== undefined) {
          await db.outbox.update(row.seq, { attempts: row.attempts + 1 });
        }
      }
    });
    throw error;
  }

  // The server accepted them; drop exactly the rows we sent, not any that
  // arrived while the request was in flight.
  await db.transaction('rw', db.outbox, async () => {
    for (const row of queued) {
      if (row.seq !== undefined) await db.outbox.delete(row.seq);
    }
  });

  let pulled = 0;
  let skipped = 0;

  for (const table of SYNCED_TABLES) {
    const incoming = response.rows[table] ?? [];
    if (incoming.length === 0) continue;
    const key = keyOf(table);

    // Written outside the outbox on purpose: re-enqueueing a pulled row would
    // push it straight back and loop forever.
    await db.transaction('rw', db[table], async () => {
      for (const row of incoming) {
        const id = row[key];
        if (typeof id !== 'string' || typeof row.updatedAt !== 'string') continue;
        const stored = await db[table].get(id as never) as { updatedAt?: string } | undefined;
        if (!shouldApply(stored?.updatedAt ?? null, row.updatedAt)) {
          skipped += 1;
          continue;
        }
        try {
          await db[table].put(row as never);
          pulled += 1;
        } catch (error) {
          // Plan 1 made dayLogs, weights and weekPlans UNIQUE on their natural
          // key, so this put rejects when a *different* local id already holds
          // that key — the two-device collision spec §5 records. Resolve it the
          // same way as any other conflict, by client updatedAt, and tombstone
          // the loser so the duplicate stops being resurrected.
          if ((error as { name?: string }).name !== 'ConstraintError') throw error;
          const rival = await findByNaturalKey(table, row);
          if (rival && shouldApply(rival.updatedAt, row.updatedAt)) {
            await db[table].update(rival.id as never, {
              deletedAt: row.updatedAt, updatedAt: row.updatedAt,
            });
            await db[table].put(row as never);
            pulled += 1;
          } else {
            skipped += 1;
          }
          collisions += 1;
        }
      }
    });
  }

  await db.meta.bulkPut([
    { key: SYNC_CURSOR_KEY, value: response.serverTime },
    { key: LAST_SYNC_KEY, value: new Date().toISOString() },
  ]);

  return { pushed: changes.length, pulled, skipped, cursor: response.serverTime };
}
```

`src/sync/useSyncStatus.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/schema';
import { LAST_SYNC_KEY } from '@/sync/engine';

export function useSyncStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const data = useLiveQuery(async () => ({
    pending: await db.outbox.count(),
    lastSyncAt: (await db.meta.get(LAST_SYNC_KEY))?.value ?? null,
  }), []);

  return {
    pending: data?.pending ?? 0,
    lastSyncAt: typeof data?.lastSyncAt === 'string' ? data.lastSyncAt : null,
    online,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- sync/engine`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sync
git commit -m "feat: add the client sync engine with an injectable transport"
```

---

### Task 7: Account UI and the smoke test

**Files:**
- Create: `src/features/account/Account.tsx`
- Modify: `src/features/settings/Settings.tsx` (mount `<Account />`), `src/app/App.tsx` (sync on boot, on reconnect, on focus)

**Interfaces:**
- Produces: `<Account userId />` — signed-out state offers sign-up and sign-in; signed-in state shows the username, pending count, last sync and a "Synchroniser" button. Sign-up shows the recovery code **once**, with a confirmation checkbox before dismissing it.

- [ ] **Step 1: Implement the account panel**

```tsx
import { useEffect, useState } from 'react';
import { httpTransport, syncOnce } from '@/sync/engine';
import { useSyncStatus } from '@/sync/useSyncStatus';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { BowCheckbox } from '@/ui/BowCheckbox';

type Mode = 'signin' | 'signup' | 'recover';

export function Account({ userId }: { userId: string }) {
  const { pending, lastSyncAt, online } = useSyncStatus();
  const [username, setUsername] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [noted, setNoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data: { username: string | null }) => setUsername(data.username))
      .catch(() => setUsername(null));
  }, []);

  const inputStyle = {
    font: 'inherit', color: 'var(--ink)', background: 'var(--inset)',
    border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', width: '100%',
  } as const;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'signup' ? 'signup' : mode === 'signin' ? 'login' : 'recover';
      const body = mode === 'signup'
        ? { username: name, password, userId }
        : mode === 'signin'
          ? { username: name, password }
          : { username: name, recoveryCode: code, newPassword: password };

      const response = await fetch(`/api/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
      const data = await response.json();

      if (!response.ok) {
        setError(
          data.error === 'username_taken' ? 'Ce nom est déjà pris.'
          : data.error === 'device_already_claimed' ? 'Cet appareil a déjà un compte.'
          : data.error === 'too_many_attempts' ? 'Trop d’essais. Réessaie dans un moment.'
          : data.error === 'invalid_recovery' ? 'Ce code ne correspond pas.'
          : data.reason ?? 'Identifiants incorrects.',
        );
        return;
      }

      setUsername(data.username);
      if (data.recoveryCode) setRecoveryCode(data.recoveryCode);
      setPassword('');
      setCode('');
      await syncOnce(httpTransport);
    } catch {
      setError('Pas de connexion pour l’instant. Tes données restent sur le téléphone.');
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCode && !noted) {
    return (
      <Card>
        <span className="label">Note ce code</span>
        <p style={{ color: 'var(--ink-soft)', margin: '6px 0 10px' }}>
          Sans e-mail, c’est la seule façon de retrouver ton compte si tu oublies
          ton mot de passe. Il ne sera plus affiché.
        </p>
        <p
          className="display"
          style={{ fontSize: 'var(--step-1)', letterSpacing: '0.08em', margin: '0 0 12px' }}
        >
          {recoveryCode}
        </p>
        <BowCheckbox label="Je l’ai noté" checked={noted} onChange={setNoted} />
      </Card>
    );
  }

  if (username) {
    return (
      <Card>
        <span className="label">Compte</span>
        <p style={{ margin: '6px 0 0' }}>{username}</p>
        <p style={{ color: 'var(--ink-soft)', margin: '6px 0 10px' }}>
          {pending === 0 ? 'Tout est synchronisé.' : `${pending} changement${pending > 1 ? 's' : ''} en attente.`}
          {lastSyncAt && ` Dernière synchro à ${new Date(lastSyncAt).toLocaleTimeString('fr-FR')}.`}
          {!online && ' Hors ligne.'}
        </p>
        <Button
          variant="quiet"
          disabled={busy || !online}
          onClick={() => {
            setBusy(true);
            void syncOnce(httpTransport).catch(() => {}).finally(() => setBusy(false));
          }}
        >
          Synchroniser
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <span className="label">
        {mode === 'signup' ? 'Créer un compte' : mode === 'signin' ? 'Se connecter' : 'Mot de passe oublié'}
      </span>
      <p style={{ color: 'var(--ink-soft)', margin: '6px 0 10px' }}>
        Facultatif. Sans compte, tout fonctionne mais rien n’est sauvegardé ailleurs.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input aria-label="Nom d’utilisateur" value={name}
               onChange={(e) => setName(e.target.value)} style={inputStyle} />
        {mode === 'recover' && (
          <input aria-label="Code de récupération" value={code}
                 onChange={(e) => setCode(e.target.value)} style={inputStyle} />
        )}
        <input aria-label={mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'}
               type="password" value={password}
               onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        {error && <p style={{ color: 'var(--cerise)', margin: 0 }}>{error}</p>}
        <Button onClick={submit} disabled={busy}>
          {mode === 'signup' ? 'Créer' : mode === 'signin' ? 'Se connecter' : 'Réinitialiser'}
        </Button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {mode !== 'signup' && (
            <Button variant="quiet" onClick={() => setMode('signup')}>Créer un compte</Button>
          )}
          {mode !== 'signin' && (
            <Button variant="quiet" onClick={() => setMode('signin')}>J’ai déjà un compte</Button>
          )}
          {mode !== 'recover' && (
            <Button variant="quiet" onClick={() => setMode('recover')}>Mot de passe oublié</Button>
          )}
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it and sync on the right events**

In `src/features/settings/Settings.tsx`, add `import { Account } from '@/features/account/Account';` and render `<Account userId={userId} />` as the first card.

In `src/app/App.tsx`, inside the authenticated branch, add:

```tsx
useEffect(() => {
  const run = () => { void syncOnce(httpTransport).catch(() => {}); };
  run();
  window.addEventListener('online', run);
  window.addEventListener('focus', run);
  return () => {
    window.removeEventListener('online', run);
    window.removeEventListener('focus', run);
  };
}, []);
```

with `import { useEffect } from 'react';` and `import { httpTransport, syncOnce } from '@/sync/engine';`. The `.catch(() => {})` is deliberate: a failed sync is a normal offline state, not an error worth showing.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npx tsc -b`
Expected: everything PASS.

- [ ] **Step 4: Smoke-test against a real deployment**

The endpoints have no unit tests, so this step is their test. Deploy and work through it in order:

```bash
npx vercel --prod
```

1. **Sign up.** Confirm the recovery code appears exactly once and cannot be dismissed without ticking "Je l'ai noté".
2. **Check the claim.** In the Neon console, confirm `users.id` equals the `currentUserId` in the phone's IndexedDB — the local data claimed the account rather than starting fresh.
3. **Push.** Log a weight, tap Synchroniser, confirm the row in Neon.
4. **Pull.** Edit that row's `kg` directly in Neon *and* bump its `updated_at` to a later instant. Sync. The app must show the new value.
5. **Last-write-wins both ways.** Edit the same row in Neon with an *older* `updated_at`. Sync. The app must keep its own value.
6. **Offline.** Turn on airplane mode, tick a full day, confirm everything still works. Re-enable, confirm the pending count falls to zero.
7. **Backoff.** Enter a wrong password five times. The fifth must be refused with "Trop d'essais".
8. **Recovery.** Reset the password with the noted code, and confirm the old password no longer works.

- [ ] **Step 5: Record and commit**

Write anything that failed into `docs/superpowers/notes/plan-4-smoke.md`, fix it, then:

```bash
git add -A
git commit -m "feat: wire the account panel and sync triggers"
```

---

### Task 8: End-to-end tests

**Files:**
- Create: `playwright.config.ts`, `e2e/onboarding.spec.ts`, `e2e/offline-sync.spec.ts`
- Modify: `.gitignore` (add `test-results/`, `playwright-report/`)

```bash
npm install -D @playwright/test
npx playwright install chromium
```

**Interfaces:**
- Produces: `npm run e2e`.

Spec §11 asks for three Playwright flows. **Two are automated here; the third is not automatable and is done on the device in Plan 5, Task 9** — Playwright cannot add a PWA to an iOS home screen, and on iOS push is impossible until it is there. Pretending otherwise would mean a passing test that proves nothing about the riskiest part of the project.

Both specs run against the built app with `/api/*` **routed to an in-page fake server**, so they need no database and no deployment. That keeps them deterministic and makes them exercise the real sync engine and the real UI rather than a mock of either.

- [ ] **Step 1: Configure Playwright**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // A phone viewport: the app is mobile-first and the tab bar is fixed.
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

Add to `package.json` `"scripts"`:

```json
"e2e": "playwright test"
```

Playwright's own files must not be picked up by Vitest. Confirm `vite.config.ts` `test.include` still lists only `src/**` and `api/**` patterns — it does, so `e2e/` is already excluded.

- [ ] **Step 2: Write the onboarding flow**

`e2e/onboarding.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('onboarding through to a first tick', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Poids de départ').fill('66');
  await page.getByLabel('Objectif').fill('62,3');
  await expect(page.getByText(/par semaine/)).toBeVisible();
  await page.getByRole('button', { name: 'Commencer' }).click();

  // The Today screen replaces onboarding without a reload.
  await expect(page.getByTestId('countdown')).toBeVisible();
  await expect(page.getByTestId('streak')).toContainText('0');

  const calories = page.getByRole('checkbox', { name: 'Calories respectées' });
  await expect(calories).not.toBeChecked();
  await calories.click();
  await expect(calories).toBeChecked();

  // The tick survives a reload, which is the real claim being made.
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Calories respectées' })).toBeChecked();
});
```

- [ ] **Step 3: Write the offline-then-sync flow**

`e2e/offline-sync.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('a tick made offline reaches the server once connectivity returns', async ({ page, context }) => {
  const pushed: unknown[] = [];

  // An in-page fake server: no database, no deployment, but the real client
  // engine and the real UI.
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { userId: 'e2e-user', username: 'lina' } }));

  await page.route('**/api/sync', async (route) => {
    const body = route.request().postDataJSON() as { changes: unknown[] };
    pushed.push(...body.changes);
    await route.fulfill({ json: { serverTime: new Date().toISOString(), rows: {} } });
  });

  await page.goto('/');
  await page.getByLabel('Poids de départ').fill('66');
  await page.getByLabel('Objectif').fill('62,3');
  await page.getByRole('button', { name: 'Commencer' }).click();
  await expect(page.getByTestId('countdown')).toBeVisible();

  // Go offline and keep working.
  await context.setOffline(true);
  await page.getByRole('checkbox', { name: 'Calories respectées' }).click();
  await expect(page.getByRole('checkbox', { name: 'Calories respectées' })).toBeChecked();

  await page.getByRole('link', { name: 'Moi' }).click();
  await expect(page.getByText(/en attente/)).toBeVisible();

  // Reconnect: the engine drains the outbox on the online event.
  await context.setOffline(false);
  await expect(page.getByText('Tout est synchronisé.')).toBeVisible({ timeout: 15_000 });

  expect(pushed.length).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run them**

Run: `npm run e2e`
Expected: 2 passed.

If the offline spec hangs at "en attente", the `online` listener from Task 7 is not wired. If onboarding cannot find "Poids de départ", a previous run's IndexedDB survived — Playwright gives each test a fresh context, so this means the app was served from a stale service worker; add `await context.clearCookies()` and run with `--headed` to inspect.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'test-results/' 'playwright-report/' >> .gitignore
git add playwright.config.ts e2e .gitignore package.json package-lock.json
git commit -m "test: add end-to-end onboarding and offline-sync flows"
```

---

## Plan 4 Done When

- `npm test` and `npx tsc -b` are clean.
- The merge rule exists exactly once: `grep -rn "shouldApply" src/ api/ | wc -l` shows only the definition and its two call sites.
- No serverless function reaches Dexie: `grep -rn "db/schema" api/` returns nothing.
- Nothing `api/` imports uses the Vite alias: `grep -rn "from '@/" src/sync/ src/shared/ src/domain/` returns nothing.
- No endpoint trusts a `userId` from a request body. Verify by reading `api/sync.ts`: the row's `userId` is overwritten before every write.
- `serverUpdatedAt` never reaches the client: `grep -rn "serverUpdatedAt" src/` returns nothing.
- All eight smoke-test steps pass on the deployed app, including both last-write-wins directions.
- Ticking a day in airplane mode still works, and syncs when connectivity returns.
- `npm run e2e` passes both flows. The third flow from spec §11 (install → push) is device-manual in Plan 5, Task 9, because Playwright cannot install a PWA to an iOS home screen.
