# Ruban Plan 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure domain layer that encodes every rule in the spec, with a full test suite, plus the Dexie local store and outbox it will read and write through — no UI.

**Architecture:** `src/domain/` holds pure functions with no IO, no React and no date library: every rule is a function from plain values to plain values, so each is testable against a table of dates and numbers with nothing mocked. `src/db/` wraps Dexie with typed tables and thin repositories; every write enqueues an outbox row in the same transaction, so Plan 4's sync engine has a queue waiting for it without touching feature code.

**Tech Stack:** Vite 6, React 19, TypeScript 5 (strict), Vitest 2, Dexie 4, `uuidv7`. No date library — see Global Constraints.

**Spec:** `docs/superpowers/specs/2026-10-06-coquette-tracker-design.md`

## Global Constraints

These apply to every task in every Ruban plan. Values are copied verbatim from the spec.

- **Dates** are local calendar strings `YYYY-MM-DD`. Parse them at **UTC noon** (`new Date(Date.UTC(y, m-1, d, 12))`) so no shift crosses a date boundary.
- **Exactly one function converts an instant to a date:** `todayIn(tz)`, via `Intl.DateTimeFormat`. No other code may call `new Date()` to decide what day it is.
- **Weeks are ISO weeks, Monday first.** Weekdays are ISO numbers: Monday = 1 … Sunday = 7.
- **DST:** European DST ends **Sunday 25 October 2026**, inside the goal window. It must appear in tests.
- **Every synced row** carries a client-generated **UUIDv7** `id`, an `updatedAt` (ISO 8601 string) and a `deletedAt` tombstone. **Never hard-delete a synced row.**
- **Derived, never stored:** streak, rolling average, weekly budget and remaining, pace, trajectory values. The only stored event stamps are `validatedAt`, `bonusFiredAt` and `jokerUsedOn`.
- **Defaults:** run days `[1,2,4,6,7]`, no-dinner days `[3,7]`, `runSessionsTarget` 5, `MIN_WEIGH_INS_FOR_AVERAGE` 3, `goalDate` `2026-11-12`.
- **TypeScript is strict.** No `any`, no non-null assertions in domain code.
- **UI language is French, tutoiement.** (Plans 2–3.)
- **Palette:** ground `#F7E3E6`, surface `#FFFBF7`, inset `#FDF2F4`, rose `#E89BB0`, cerise `#C2567A`, ink `#6E2B45`, line `#EDCCD6`. Dark: ground `#1B0F15`, surface `#2A1821`, inset `#231420`, ink `#F7E5EA`, ink-soft `#C098AA`, rose `#EFA6BA`, cerise `#F57FA6`, line `#412833`. (Plan 2.)
- **Type:** Cormorant Garamond (display), Jost (UI/body/labels), Caveat (sparingly). (Plan 2.)
- **Commit after every task.** Conventional Commit prefixes (`feat:`, `test:`, `chore:`).
- **Type-check with `npx tsc -b`, never `npx tsc --noEmit`.** The root `tsconfig.json` is references-only (`files: []`), so `--noEmit` type-checks *nothing* and exits 0 on real errors. Verified on this project: a deliberate `const x: number = "nope"` passed `--noEmit` and failed `tsc -b` with exit 2.
- **Actual toolchain, confirmed at install time** (newer than this plan was written against): Vite 8, TypeScript 6, React 19.2, `@vitejs/plugin-react` 6, Vitest 5, Dexie 4.4, oxlint (no eslint). `compilerOptions` live in **`tsconfig.app.json`** — the root tsconfig has none.
- **The template already sets `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals` and `noUnusedParameters`.** So: type-only imports must say `import type`; no enums or parameter properties; and an unused binding must be `_`-prefixed to be accepted in a destructuring pattern.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/tables.ts` | The synced table names. **Zero imports** — shared by the Dexie schema, the sync protocol and the server. |
| `src/domain/types.ts` | Shared domain types and default constants. No logic. |
| `src/domain/calendar.ts` | Date-string arithmetic and ISO weeks. The only tz-aware function lives here. |
| `src/domain/rollingAverage.ts` | Trailing 7-day mean of weigh-ins. |
| `src/domain/trajectory.ts` | Target line, weekly intermediate goal, implied rate, gap, countdown. |
| `src/domain/budget.ts` | Per-day allowance, weekly budget and remaining, floor warnings. |
| `src/domain/checklist.ts` | Which items apply to a date, whether each is satisfied, whether the day validates. |
| `src/domain/streak.ts` | Coverage, current streak, joker eligibility. |
| `src/domain/running.ts` | Pace, duration formatting, weekly run summary. |
| `src/db/ids.ts` | UUIDv7 and `nowIso()`. |
| `src/db/schema.ts` | Dexie subclass, typed tables, version 1 indexes. |
| `src/db/outbox.ts` | Enqueue a change inside the caller's transaction. |
| `src/db/repos.ts` | Typed put/get/list helpers that always stamp `updatedAt` and enqueue. |

---

### Task 1: Project scaffold — **COMPLETE** (controller, commit e8fad6a)

Executed by the controller as reconnaissance, not by a subagent, because it
installs every dependency and so is the first chance to check the real APIs
against what these plans assume. What it found is recorded in the Global
Constraints above and in the ledger. Recorded here so the plan matches reality:

**Done:**
- Scaffolded `npm create vite@latest ruban -- --template react-ts` **into the
  scratchpad first**, then copied the files in. The in-place form prompts about
  the non-empty directory and one of its options removes existing files — not
  worth pointing at a directory holding `.git` and `docs/`.
- `npm install` plus `dexie uuidv7` and dev `vitest @vitest/coverage-v8 jsdom
  fake-indexeddb`.
- `vite.config.ts` rewritten: `defineConfig` from **`vitest/config`** (the one
  from `vite` rejects the `test` key), the `@` alias, and
  `test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] }`.
- `tsconfig.app.json` — **not** `tsconfig.json` — gained `strict: true`,
  `noUncheckedIndexedAccess: true` and `paths: { "@/*": ["./src/*"] }`. The
  leading `./` is required: without `baseUrl`, a bare `src/*` fails with TS5090.
- `package.json`: `name: "ruban"`, scripts `test` and `test:watch`.
- Verified the alias resolves in **both** toolchains (a temporary module imported
  through `@/`, then deleted), `npm test` green, `npx tsc -b` exit 0.

**Deliberately not done:** the template's `src/App.tsx`, `src/App.css`,
`src/index.css`, `src/assets/` and `public/*` are still in place. Plan 2 Task 1
deletes the stylesheets and Task 11 deletes `App.tsx`.

---

### Task 2: Domain types and constants

**Files:**
- Create: `src/domain/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IsoDate`, `IsoWeek`, `Weekday`, `ChecklistItemId`, `Settings`, `SyncedRow`, `DayLog`, `Weight`, `CalorieEntry`, `Run`, `WeekPlan`, `DEFAULT_RUN_DAYS`, `DEFAULT_NO_DINNER_DAYS`, `MIN_WEIGH_INS_FOR_AVERAGE`. Every later task imports from here.

**Import rule, and it matters:** files under `src/domain/` and `src/shared/` import each other with **relative** paths (`./types`), never the `@/` alias. Vercel builds `api/` functions with its own bundler, which does not know the Vite alias — so any domain file reachable from `api/` must be alias-free. Feature and UI code uses `@/` freely.

This task has no test: it declares types and constants only, and `tsc` is its check.

- [ ] **Step 1: Write the file**

```ts
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
  updatedAt: string;
  deletedAt: string | null;
}

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
```

Also create `src/shared/tables.ts`, which must keep **zero imports** — the Dexie schema, the sync protocol and the server functions all depend on it, and a single import of `dexie` here would pull IndexedDB code into a serverless function:

```ts
export const SYNCED_TABLES = [
  'settings', 'dayLogs', 'weights', 'calorieEntries', 'runs', 'weekPlans', 'cycles',
] as const;

export type SyncedTableName = (typeof SYNCED_TABLES)[number];
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domain/types.ts src/shared/tables.ts
git commit -m "feat: add domain types, defaults and the shared table list"
```

---

### Task 3: Calendar arithmetic

**Files:**
- Create: `src/domain/calendar.ts`
- Test: `src/domain/calendar.test.ts`

**Interfaces:**
- Consumes: `IsoDate`, `IsoWeek`, `Weekday` from `@/domain/types`.
- Produces:
  - `parseIsoDate(d: IsoDate): Date` — UTC noon
  - `formatUtcNoonDate(dt: Date): IsoDate`
  - `addDays(d: IsoDate, n: number): IsoDate`
  - `diffDays(from: IsoDate, to: IsoDate): number`
  - `weekdayOf(d: IsoDate): Weekday`
  - `isoWeekOf(d: IsoDate): IsoWeek`
  - `datesOfIsoWeek(w: IsoWeek): IsoDate[]` — 7 dates, Monday first
  - `todayIn(tz: string, now?: Date): IsoDate`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays, datesOfIsoWeek, diffDays, formatUtcNoonDate, isoWeekOf,
  parseIsoDate, todayIn, weekdayOf,
} from '@/domain/calendar';

describe('parseIsoDate / formatUtcNoonDate', () => {
  it('parses at UTC noon so no shift crosses a date boundary', () => {
    expect(parseIsoDate('2026-10-06').toISOString()).toBe('2026-10-06T12:00:00.000Z');
  });

  it('round-trips', () => {
    expect(formatUtcNoonDate(parseIsoDate('2026-11-12'))).toBe('2026-11-12');
  });
});

describe('weekdayOf', () => {
  it('uses ISO numbering with Monday as 1', () => {
    expect(weekdayOf('2026-10-05')).toBe(1); // Monday
    expect(weekdayOf('2026-10-06')).toBe(2); // Tuesday
    expect(weekdayOf('2026-10-11')).toBe(7); // Sunday
  });
});

describe('addDays / diffDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2026-10-06', '2026-11-12')).toBe(37);
    expect(diffDays('2026-11-12', '2026-10-06')).toBe(-37);
  });

  it('is unaffected by the 25 October 2026 DST change', () => {
    // A 25-hour local day must still be exactly one calendar day.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('isoWeekOf', () => {
  it('keys the spec date to 2026-W41', () => {
    expect(isoWeekOf('2026-10-06')).toBe('2026-W41');
  });

  it('puts Sunday in the week that began the preceding Monday', () => {
    expect(isoWeekOf('2026-10-11')).toBe('2026-W41');
    expect(isoWeekOf('2026-10-12')).toBe('2026-W42');
  });

  it('handles a year boundary where week 1 starts in December', () => {
    // 1 January 2026 is a Thursday, so ISO week 1 of 2026 begins 29 December 2025.
    expect(isoWeekOf('2025-12-29')).toBe('2026-W01');
    expect(isoWeekOf('2026-01-01')).toBe('2026-W01');
  });
});

describe('datesOfIsoWeek', () => {
  it('returns seven dates, Monday first', () => {
    expect(datesOfIsoWeek('2026-W41')).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
      '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
  });

  it('is the inverse of isoWeekOf for every date it returns', () => {
    for (const d of datesOfIsoWeek('2026-W44')) {
      expect(isoWeekOf(d)).toBe('2026-W44');
    }
  });
});

describe('todayIn', () => {
  it('reads the date in the given zone, not UTC', () => {
    // 22:30 UTC is already the next day in Paris (UTC+2 in summer).
    const instant = new Date('2026-07-14T22:30:00Z');
    expect(todayIn('Europe/Paris', instant)).toBe('2026-07-15');
    expect(todayIn('UTC', instant)).toBe('2026-07-14');
  });

  it('is correct on both sides of the 25 October 2026 DST change', () => {
    // Paris is UTC+2 before 01:00 UTC that day and UTC+1 after.
    expect(todayIn('Europe/Paris', new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(todayIn('Europe/Paris', new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- calendar`
Expected: FAIL — `Failed to resolve import "@/domain/calendar"`.

- [ ] **Step 3: Implement**

```ts
import type { IsoDate, IsoWeek, Weekday } from './types';

const DAY_MS = 86_400_000;

/** Parsed at UTC noon: a ±12h shift can never land on another calendar date. */
export function parseIsoDate(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, day ?? 1, 12));
}

export function formatUtcNoonDate(dt: Date): IsoDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return formatUtcNoonDate(new Date(parseIsoDate(d).getTime() + n * DAY_MS));
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);
}

export function weekdayOf(d: IsoDate): Weekday {
  const js = parseIsoDate(d).getUTCDay();
  return (js === 0 ? 7 : js) as Weekday;
}

export function isoWeekOf(d: IsoDate): IsoWeek {
  const dt = parseIsoDate(d);
  // Step to the Thursday of this ISO week; its calendar year is the ISO year.
  dt.setUTCDate(dt.getUTCDate() + 4 - weekdayOf(d));
  const year = dt.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1, 12);
  const days = (dt.getTime() - jan1) / DAY_MS;
  // ceil((days + 1) / 7), NOT round(days / 7) + 1. Let k be the day-of-year
  // index of the ISO year's first Thursday; the Thursday of week N sits at
  // k + 7(N-1), so round(days / 7) + 1 yields N + round(k / 7) — correct only
  // while k <= 3. For k in {4, 5, 6}, i.e. whenever 1 January is a Friday,
  // Saturday or Sunday (three years in seven), every week came out one too
  // high and isoWeekOf stopped inverting datesOfIsoWeek. The original draft of
  // this plan shipped the round form; it survived eleven task reviews because
  // every fixture here lives in 2026, which begins on a Thursday (k = 3).
  const week = Math.ceil((days + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function datesOfIsoWeek(w: IsoWeek): IsoDate[] {
  const [yearPart, weekPart] = w.split('-W');
  const year = Number(yearPart);
  const week = Number(weekPart);
  // 4 January is always in ISO week 1.
  const jan4 = Date.UTC(year, 0, 4, 12);
  const jan4Weekday = weekdayOf(formatUtcNoonDate(new Date(jan4)));
  const week1Monday = jan4 - (jan4Weekday - 1) * DAY_MS;
  const monday = week1Monday + (week - 1) * 7 * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => formatUtcNoonDate(new Date(monday + i * DAY_MS)));
}

/** The only function in the codebase that turns an instant into a date. */
export function todayIn(tz: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- calendar`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/domain/calendar.ts src/domain/calendar.test.ts
git commit -m "feat: add calendar arithmetic with ISO weeks and tz-aware today"
```

---

### Task 4: Rolling average

**Files:**
- Create: `src/domain/rollingAverage.ts`
- Test: `src/domain/rollingAverage.test.ts`

**Interfaces:**
- Consumes: `addDays`, `diffDays` from `@/domain/calendar`; `MIN_WEIGH_INS_FOR_AVERAGE` from `@/domain/types`.
- Produces: `rollingAverage(weighIns: WeighIn[], onDate: IsoDate): number | null`, and `export interface WeighIn { date: IsoDate; kg: number }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { rollingAverage, type WeighIn } from '@/domain/rollingAverage';

const w = (date: string, kg: number): WeighIn => ({ date, kg });

describe('rollingAverage', () => {
  it('returns null below the three weigh-in minimum', () => {
    expect(rollingAverage([], '2026-10-06')).toBeNull();
    expect(rollingAverage([w('2026-10-06', 62)], '2026-10-06')).toBeNull();
    expect(rollingAverage([w('2026-10-05', 62), w('2026-10-06', 62.4)], '2026-10-06')).toBeNull();
  });

  it('averages the trailing seven days inclusive', () => {
    const data = [w('2026-10-04', 63), w('2026-10-05', 62.5), w('2026-10-06', 62)];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo(62.5, 10);
  });

  it('excludes weigh-ins older than the seven-day window', () => {
    // "Trailing seven calendar days inclusive" means {onDate-6 … onDate}, so a
    // weigh-in exactly 7 days back is OUTSIDE the window, not on its edge.
    const data = [
      w('2026-09-29', 70),   // 7 days before — outside
      w('2026-09-30', 63),   // 6 days before — inside
      w('2026-10-05', 62.5),
      w('2026-10-06', 62),
    ];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo((63 + 62.5 + 62) / 3, 10);
  });

  it('excludes weigh-ins after the reference date', () => {
    const data = [
      w('2026-10-04', 63), w('2026-10-05', 62.5), w('2026-10-06', 62),
      w('2026-10-07', 10), // the future must not count
    ];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo(62.5, 10);
  });

  it('tolerates gaps and unsorted input', () => {
    const data = [w('2026-10-06', 62), w('2026-10-01', 63), w('2026-10-03', 62.5)];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo((62 + 63 + 62.5) / 3, 10);
  });

  it('spans the 25 October 2026 DST change unchanged', () => {
    const data = [w('2026-10-23', 61.8), w('2026-10-25', 61.6), w('2026-10-27', 61.4)];
    expect(rollingAverage(data, '2026-10-27')).toBeCloseTo(61.6, 10);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- rollingAverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { diffDays } from './calendar';
import { MIN_WEIGH_INS_FOR_AVERAGE, type IsoDate } from './types';

export interface WeighIn {
  date: IsoDate;
  kg: number;
}

/**
 * Mean of the weigh-ins in the trailing seven calendar days, inclusive of
 * `onDate`. Returns null below MIN_WEIGH_INS_FOR_AVERAGE, so the UI can say
 * "pas encore assez de pesées" rather than draw a misleading line.
 */
export function rollingAverage(weighIns: WeighIn[], onDate: IsoDate): number | null {
  const window = weighIns.filter((entry) => {
    const age = diffDays(entry.date, onDate);
    return age >= 0 && age < 7;
  });
  if (window.length < MIN_WEIGH_INS_FOR_AVERAGE) return null;
  const total = window.reduce((sum, entry) => sum + entry.kg, 0);
  return total / window.length;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- rollingAverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/rollingAverage.ts src/domain/rollingAverage.test.ts
git commit -m "feat: add trailing seven-day rolling weight average"
```

---

### Task 5: Trajectory and countdown

**Files:**
- Create: `src/domain/trajectory.ts`
- Test: `src/domain/trajectory.test.ts`

**Interfaces:**
- Consumes: `addDays`, `datesOfIsoWeek`, `diffDays` from `@/domain/calendar`; `Settings`, `IsoDate`, `IsoWeek` from `@/domain/types`.
- Produces:
  - `trajectoryAt(date: IsoDate, settings: TrajectorySettings): number`
  - `weeklyIntermediateGoal(week: IsoWeek, settings: TrajectorySettings): number`
  - `impliedWeeklyRate(settings: TrajectorySettings): number`
  - `gapToTrajectory(rollingAvg: number, date: IsoDate, settings: TrajectorySettings): number`
  - `daysUntil(goalDate: IsoDate, today: IsoDate): number`
  - `isCycleComplete(goalDate: IsoDate, today: IsoDate): boolean`
  - `export type TrajectorySettings = Pick<Settings, 'startDate' | 'startWeight' | 'targetWeight' | 'goalDate'>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  daysUntil, gapToTrajectory, impliedWeeklyRate, isCycleComplete,
  trajectoryAt, weeklyIntermediateGoal, type TrajectorySettings,
} from '@/domain/trajectory';

// 37 days from 6 October to 12 November; 3.7 kg to lose; 0.1 kg per day.
const s: TrajectorySettings = {
  startDate: '2026-10-06',
  startWeight: 66,
  targetWeight: 62.3,
  goalDate: '2026-11-12',
};

describe('trajectoryAt', () => {
  it('returns the endpoints exactly', () => {
    expect(trajectoryAt('2026-10-06', s)).toBeCloseTo(66, 10);
    expect(trajectoryAt('2026-11-12', s)).toBeCloseTo(62.3, 10);
  });

  it('interpolates linearly', () => {
    expect(trajectoryAt('2026-10-16', s)).toBeCloseTo(65, 10); // 10 days x 0.1
  });

  it('clamps outside the window so the line never runs off', () => {
    expect(trajectoryAt('2026-09-01', s)).toBeCloseTo(66, 10);
    expect(trajectoryAt('2026-12-01', s)).toBeCloseTo(62.3, 10);
  });

  it('returns the start weight when start and goal are the same day', () => {
    const degenerate: TrajectorySettings = { ...s, goalDate: '2026-10-06' };
    expect(trajectoryAt('2026-10-06', degenerate)).toBeCloseTo(66, 10);
  });
});

describe('weeklyIntermediateGoal', () => {
  it('is the trajectory value on that week Sunday', () => {
    // 2026-W41 ends Sunday 11 October: 5 days in.
    expect(weeklyIntermediateGoal('2026-W41', s)).toBeCloseTo(trajectoryAt('2026-10-11', s), 10);
    expect(weeklyIntermediateGoal('2026-W41', s)).toBeCloseTo(65.5, 10);
  });
});

describe('impliedWeeklyRate', () => {
  it('is signed, and negative when the target is below the start', () => {
    expect(impliedWeeklyRate(s)).toBeCloseTo((-3.7 / 37) * 7, 10);
    expect(impliedWeeklyRate(s)).toBeLessThan(0);
  });

  it('is positive when the target is above the start', () => {
    expect(impliedWeeklyRate({ ...s, targetWeight: 69.7 })).toBeCloseTo((3.7 / 37) * 7, 10);
  });

  it('is zero when start and goal coincide', () => {
    expect(impliedWeeklyRate({ ...s, goalDate: '2026-10-06' })).toBe(0);
  });
});

describe('gapToTrajectory', () => {
  it('is negative when ahead of the line', () => {
    // On 16 October the line is 65.0; weighing 64.6 is 0.4 kg ahead.
    expect(gapToTrajectory(64.6, '2026-10-16', s)).toBeCloseTo(-0.4, 10);
  });

  it('is positive when behind', () => {
    expect(gapToTrajectory(65.6, '2026-10-16', s)).toBeCloseTo(0.6, 10);
  });
});

describe('daysUntil / isCycleComplete', () => {
  it('counts down to the goal date', () => {
    expect(daysUntil('2026-11-12', '2026-10-06')).toBe(37);
    expect(daysUntil('2026-11-12', '2026-11-12')).toBe(0);
  });

  it('goes negative past the goal and reports completion the day after', () => {
    expect(daysUntil('2026-11-12', '2026-11-13')).toBe(-1);
    expect(isCycleComplete('2026-11-12', '2026-11-12')).toBe(false);
    expect(isCycleComplete('2026-11-12', '2026-11-13')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- trajectory`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { datesOfIsoWeek, diffDays } from './calendar';
import type { IsoDate, IsoWeek, Settings } from './types';

export type TrajectorySettings = Pick<
  Settings,
  'startDate' | 'startWeight' | 'targetWeight' | 'goalDate'
>;

/** Straight line from (startDate, startWeight) to (goalDate, targetWeight), clamped. */
export function trajectoryAt(date: IsoDate, settings: TrajectorySettings): number {
  const span = diffDays(settings.startDate, settings.goalDate);
  if (span <= 0) return settings.startWeight;
  const elapsed = Math.min(Math.max(diffDays(settings.startDate, date), 0), span);
  const delta = settings.targetWeight - settings.startWeight;
  return settings.startWeight + (delta * elapsed) / span;
}

/** This week's intermediate goal: the trajectory value on its Sunday. */
export function weeklyIntermediateGoal(week: IsoWeek, settings: TrajectorySettings): number {
  const dates = datesOfIsoWeek(week);
  const sunday = dates[6] ?? dates[0] ?? settings.startDate;
  return trajectoryAt(sunday, settings);
}

/** Signed kg per week the target implies. Shown at onboarding, never enforced. */
export function impliedWeeklyRate(settings: TrajectorySettings): number {
  const span = diffDays(settings.startDate, settings.goalDate);
  if (span <= 0) return 0;
  return ((settings.targetWeight - settings.startWeight) / span) * 7;
}

/** Negative = ahead of the line ("d'avance"); positive = behind ("de retard"). */
export function gapToTrajectory(
  rollingAvg: number,
  date: IsoDate,
  settings: TrajectorySettings,
): number {
  return rollingAvg - trajectoryAt(date, settings);
}

export function daysUntil(goalDate: IsoDate, today: IsoDate): number {
  return diffDays(today, goalDate);
}

export function isCycleComplete(goalDate: IsoDate, today: IsoDate): boolean {
  return diffDays(today, goalDate) < 0;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- trajectory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/trajectory.ts src/domain/trajectory.test.ts
git commit -m "feat: add weight trajectory, weekly goal and countdown"
```

---

### Task 6: Calorie budget

**Files:**
- Create: `src/domain/budget.ts`
- Test: `src/domain/budget.test.ts`

**Interfaces:**
- Consumes: `datesOfIsoWeek`, `weekdayOf` from `@/domain/calendar`; `Settings`, `WeekPlan`, `IsoDate`, `IsoWeek` from `@/domain/types`.
- Produces:
  - `dayAllowance(date: IsoDate, plan: BudgetPlan, settings: BudgetSettings): number`
  - `weeklyBudget(week: IsoWeek, plan: BudgetPlan, settings: BudgetSettings): number`
  - `weeklyRemaining(week: IsoWeek, plan: BudgetPlan, settings: BudgetSettings, consumedKcal: number): number`
  - `floorWarnings(settings: BudgetSettings): FloorWarning[]`
  - `export interface FloorWarning { kind: 'daily' | 'noDinner'; value: number; floor: number }`
  - `export type BudgetPlan = Pick<WeekPlan, 'noDinnerDays'>`
  - `export type BudgetSettings = Pick<Settings, 'dailyCalorieTarget' | 'noDinnerAllowance' | 'calorieFloor'>`

**Spec note for the implementer:** the user chose the model where the weekly total *falls* on no-dinner days.

**Corrected arithmetic note.** An earlier draft of this task expected `weeklyRemaining` to be 1800 and −300 against consumed values of 6900 and 9000. Those came from computing the budget as `7 x 1500 − 2 x 900 = 8700` — subtracting the whole no-dinner allowance twice instead of the 600 difference. The budget is `5 x 1500 + 2 x 900 = 9300`, so the right expectations are 2400, and −300 against a consumed value of 9600 (which preserves that test's intent of an actual overshoot). Prefer symbolic expressions like `5 * 1500 + 2 * 900 - consumed` over hardcoded totals in future tests: the other plans write it that way and are self-checking as a result. Each day's allowance is fixed; marking an evening moves the **weekly total**, and the other days stay at `dailyCalorieTarget`. Do not redistribute a surplus — that was the rejected alternative.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  dayAllowance, floorWarnings, weeklyBudget, weeklyRemaining,
  type BudgetPlan, type BudgetSettings,
} from '@/domain/budget';

const settings: BudgetSettings = {
  dailyCalorieTarget: 1500,
  noDinnerAllowance: 900,
  calorieFloor: 1200,
};
const defaultPlan: BudgetPlan = { noDinnerDays: [3, 7] }; // Wednesday, Sunday

describe('dayAllowance', () => {
  it('gives a normal day the daily target', () => {
    expect(dayAllowance('2026-10-06', defaultPlan, settings)).toBe(1500); // Tuesday
  });

  it('gives a no-dinner day the reduced allowance', () => {
    expect(dayAllowance('2026-10-07', defaultPlan, settings)).toBe(900); // Wednesday
    expect(dayAllowance('2026-10-11', defaultPlan, settings)).toBe(900); // Sunday
  });

  it('leaves Friday and Saturday at the daily target, per the chosen model', () => {
    expect(dayAllowance('2026-10-09', defaultPlan, settings)).toBe(1500); // Friday
    expect(dayAllowance('2026-10-10', defaultPlan, settings)).toBe(1500); // Saturday
  });
});

describe('weeklyBudget', () => {
  it('sums the seven per-day allowances', () => {
    expect(weeklyBudget('2026-W41', defaultPlan, settings)).toBe(5 * 1500 + 2 * 900);
  });

  it('falls as no-dinner evenings are added, rather than redistributing', () => {
    const none = weeklyBudget('2026-W41', { noDinnerDays: [] }, settings);
    const one = weeklyBudget('2026-W41', { noDinnerDays: [3] }, settings);
    const two = weeklyBudget('2026-W41', defaultPlan, settings);
    expect(none).toBe(7 * 1500);
    expect(one).toBe(6 * 1500 + 900);
    expect(two).toBe(5 * 1500 + 2 * 900);
    expect(one).toBeLessThan(none);
    expect(two).toBeLessThan(one);
  });

  it('handles all seven evenings marked', () => {
    expect(weeklyBudget('2026-W41', { noDinnerDays: [1, 2, 3, 4, 5, 6, 7] }, settings))
      .toBe(7 * 900);
  });

  it('ignores duplicate entries in noDinnerDays', () => {
    expect(weeklyBudget('2026-W41', { noDinnerDays: [3, 3, 7] }, settings))
      .toBe(5 * 1500 + 2 * 900);
  });
});

describe('weeklyRemaining', () => {
  // The week's budget is 5 x 1500 + 2 x 900 = 9300. Expectations below are
  // written against that figure; see the note under this task on why an
  // earlier draft used 8700.
  it('subtracts what was logged', () => {
    expect(weeklyRemaining('2026-W41', defaultPlan, settings, 6900)).toBe(2400);
  });

  it('goes negative on an overshoot instead of clamping', () => {
    expect(weeklyRemaining('2026-W41', defaultPlan, settings, 9600)).toBe(-300);
  });
});

describe('floorWarnings', () => {
  it('is empty when both allowances clear the floor', () => {
    expect(floorWarnings({ ...settings, calorieFloor: 800 })).toEqual([]);
  });

  it('flags the no-dinner allowance when it sits below the floor', () => {
    expect(floorWarnings(settings)).toEqual([
      { kind: 'noDinner', value: 900, floor: 1200 },
    ]);
  });

  it('flags both allowances when both sit below the floor', () => {
    expect(floorWarnings({ ...settings, calorieFloor: 1600 })).toEqual([
      { kind: 'daily', value: 1500, floor: 1600 },
      { kind: 'noDinner', value: 900, floor: 1600 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- budget`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { datesOfIsoWeek, weekdayOf } from './calendar';
import type { IsoDate, IsoWeek, Settings, WeekPlan } from './types';

export type BudgetPlan = Pick<WeekPlan, 'noDinnerDays'>;
export type BudgetSettings = Pick<
  Settings,
  'dailyCalorieTarget' | 'noDinnerAllowance' | 'calorieFloor'
>;

export interface FloorWarning {
  kind: 'daily' | 'noDinner';
  value: number;
  floor: number;
}

export function dayAllowance(
  date: IsoDate,
  plan: BudgetPlan,
  settings: BudgetSettings,
): number {
  return plan.noDinnerDays.includes(weekdayOf(date))
    ? settings.noDinnerAllowance
    : settings.dailyCalorieTarget;
}

/**
 * The sum of the week's seven per-day allowances. Marking an evening lowers
 * this total; the remaining days keep dailyCalorieTarget. No redistribution.
 */
export function weeklyBudget(
  week: IsoWeek,
  plan: BudgetPlan,
  settings: BudgetSettings,
): number {
  return datesOfIsoWeek(week).reduce(
    (total, date) => total + dayAllowance(date, plan, settings),
    0,
  );
}

/** Negative means an overshoot; the UI shows it rather than hiding it. */
export function weeklyRemaining(
  week: IsoWeek,
  plan: BudgetPlan,
  settings: BudgetSettings,
  consumedKcal: number,
): number {
  return weeklyBudget(week, plan, settings) - consumedKcal;
}

export function floorWarnings(settings: BudgetSettings): FloorWarning[] {
  const warnings: FloorWarning[] = [];
  if (settings.dailyCalorieTarget < settings.calorieFloor) {
    warnings.push({
      kind: 'daily',
      value: settings.dailyCalorieTarget,
      floor: settings.calorieFloor,
    });
  }
  if (settings.noDinnerAllowance < settings.calorieFloor) {
    warnings.push({
      kind: 'noDinner',
      value: settings.noDinnerAllowance,
      floor: settings.calorieFloor,
    });
  }
  return warnings;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- budget`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/budget.ts src/domain/budget.test.ts
git commit -m "feat: add weekly calorie budget with per-day allowances"
```

---

### Task 7: Checklist and day validation

**Files:**
- Create: `src/domain/checklist.ts`
- Test: `src/domain/checklist.test.ts`

**Interfaces:**
- Consumes: `weekdayOf` from `@/domain/calendar`; `dayAllowance`, `BudgetPlan`, `BudgetSettings` from `@/domain/budget`; types from `@/domain/types`.
- Produces:
  - `applicableItems(date: IsoDate, plan: ChecklistPlan): ChecklistItemId[]`
  - `evaluateChecklist(input: DayEvaluation): ChecklistItem[]`
  - `isDayValidated(items: ChecklistItem[]): boolean`
  - `export interface ChecklistItem { id: ChecklistItemId; satisfied: boolean }`
  - `export interface DayEvaluation { date; plan; settings; log; runCount; calorieTotal; calorieEntryCount }`
  - `export type ChecklistPlan = Pick<WeekPlan, 'runDays' | 'noDinnerDays'>`

**Rules, from spec §4.2 and §4.3:**

| Item | Applies when | Satisfied when |
|---|---|---|
| `course` | the weekday is in `plan.runDays` | a run is logged (`runCount > 0`) **or** `ticks.course === true` |
| `calories` | always | `ticks.calories` if present; otherwise `calorieEntryCount > 0 && calorieTotal <= dayAllowance(...)` |
| `no_dinner` | the weekday is in `plan.noDinnerDays` | `ticks.no_dinner === true` |
| `steps` | always | `(log.steps ?? 0) >= settings.stepTarget` |
| `water` | always | `(log.waterGlasses ?? 0) >= settings.waterTarget` |

Order the returned array `course, calories, no_dinner, steps, water`, filtered to the applicable ones, so the UI renders a stable sequence.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  applicableItems, evaluateChecklist, isDayValidated,
  type ChecklistPlan, type DayEvaluation,
} from '@/domain/checklist';
import type { DayLog, Settings } from '@/domain/types';

const plan: ChecklistPlan = { runDays: [1, 2, 4, 6, 7], noDinnerDays: [3, 7] };

const settings = {
  dailyCalorieTarget: 1500,
  noDinnerAllowance: 900,
  calorieFloor: 1200,
  stepTarget: 8000,
  waterTarget: 6,
} as Pick<Settings,
  'dailyCalorieTarget' | 'noDinnerAllowance' | 'calorieFloor' | 'stepTarget' | 'waterTarget'>;

function log(partial: Partial<DayLog> = {}): DayLog {
  return {
    id: 'id', userId: 'u', updatedAt: '', deletedAt: null,
    date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null,
    ...partial,
  };
}

function evaluation(partial: Partial<DayEvaluation> = {}): DayEvaluation {
  return {
    date: '2026-10-06', plan, settings, log: log(),
    runCount: 0, calorieTotal: 0, calorieEntryCount: 0,
    ...partial,
  };
}

describe('applicableItems', () => {
  it('shows course on a planned run day', () => {
    // Tuesday is a run day and not a no-dinner evening.
    expect(applicableItems('2026-10-06', plan)).toEqual(['course', 'calories', 'steps', 'water']);
  });

  it('shows no_dinner and hides course on Wednesday, the rest day', () => {
    expect(applicableItems('2026-10-07', plan)).toEqual(['calories', 'no_dinner', 'steps', 'water']);
  });

  it('shows both on Sunday, which runs and skips dinner', () => {
    expect(applicableItems('2026-10-11', plan))
      .toEqual(['course', 'calories', 'no_dinner', 'steps', 'water']);
  });

  it('shows neither on Friday, which rests and dines', () => {
    expect(applicableItems('2026-10-09', plan)).toEqual(['calories', 'steps', 'water']);
  });
});

describe('evaluateChecklist', () => {
  it('auto-satisfies course from a logged run', () => {
    const items = evaluateChecklist(evaluation({ runCount: 1 }));
    expect(items.find((i) => i.id === 'course')?.satisfied).toBe(true);
  });

  it('satisfies course from a manual tick with no run logged', () => {
    const items = evaluateChecklist(evaluation({ log: log({ ticks: { course: true } }) }));
    expect(items.find((i) => i.id === 'course')?.satisfied).toBe(true);
  });

  it('auto-satisfies calories once entries exist and the total is within allowance', () => {
    const items = evaluateChecklist(evaluation({ calorieTotal: 1400, calorieEntryCount: 3 }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(true);
  });

  it('does not auto-satisfy calories when nothing was logged', () => {
    const items = evaluateChecklist(evaluation({ calorieTotal: 0, calorieEntryCount: 0 }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(false);
  });

  it('auto-unsatisfies calories once the total passes the allowance', () => {
    const items = evaluateChecklist(evaluation({ calorieTotal: 1700, calorieEntryCount: 4 }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(false);
  });

  it('lets a manual override win in both directions', () => {
    const forcedOn = evaluateChecklist(evaluation({
      calorieTotal: 1700, calorieEntryCount: 4, log: log({ ticks: { calories: true } }),
    }));
    expect(forcedOn.find((i) => i.id === 'calories')?.satisfied).toBe(true);

    const forcedOff = evaluateChecklist(evaluation({
      calorieTotal: 1000, calorieEntryCount: 2, log: log({ ticks: { calories: false } }),
    }));
    expect(forcedOff.find((i) => i.id === 'calories')?.satisfied).toBe(false);
  });

  it('measures calories against the no-dinner allowance on a no-dinner day', () => {
    const items = evaluateChecklist(evaluation({
      date: '2026-10-07', calorieTotal: 1000, calorieEntryCount: 2,
    }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(false); // 1000 > 900
  });

  it('derives steps and water from logged amounts, not from ticks', () => {
    const items = evaluateChecklist(evaluation({
      log: log({ steps: 8200, waterGlasses: 6 }),
    }));
    expect(items.find((i) => i.id === 'steps')?.satisfied).toBe(true);
    expect(items.find((i) => i.id === 'water')?.satisfied).toBe(true);

    const short = evaluateChecklist(evaluation({ log: log({ steps: 7999, waterGlasses: 5 }) }));
    expect(short.find((i) => i.id === 'steps')?.satisfied).toBe(false);
    expect(short.find((i) => i.id === 'water')?.satisfied).toBe(false);
  });

  it('treats a missing log as nothing satisfied', () => {
    const items = evaluateChecklist(evaluation({ log: undefined }));
    expect(items.every((i) => !i.satisfied)).toBe(true);
  });
});

describe('isDayValidated', () => {
  it('requires every applicable item, and a rest day needs fewer', () => {
    // Wednesday: calories, no_dinner, steps, water. No run required.
    const wednesday = evaluateChecklist(evaluation({
      date: '2026-10-07',
      calorieTotal: 800, calorieEntryCount: 2,
      log: log({ date: '2026-10-07', ticks: { no_dinner: true }, steps: 8000, waterGlasses: 6 }),
    }));
    expect(isDayValidated(wednesday)).toBe(true);
  });

  it('fails a run day with no run', () => {
    const tuesday = evaluateChecklist(evaluation({
      calorieTotal: 1400, calorieEntryCount: 2,
      log: log({ steps: 8000, waterGlasses: 6 }),
      runCount: 0,
    }));
    expect(isDayValidated(tuesday)).toBe(false);
  });

  it('validates a full run day', () => {
    const tuesday = evaluateChecklist(evaluation({
      calorieTotal: 1400, calorieEntryCount: 2, runCount: 1,
      log: log({ steps: 8000, waterGlasses: 6 }),
    }));
    expect(isDayValidated(tuesday)).toBe(true);
  });

  it('is false for an empty list, so an unknown day never counts', () => {
    expect(isDayValidated([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- checklist`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { dayAllowance, type BudgetSettings } from './budget';
import { weekdayOf } from './calendar';
import type { ChecklistItemId, DayLog, IsoDate, Settings, WeekPlan } from './types';

export type ChecklistPlan = Pick<WeekPlan, 'runDays' | 'noDinnerDays'>;

export type ChecklistSettings = BudgetSettings &
  Pick<Settings, 'stepTarget' | 'waterTarget'>;

export interface ChecklistItem {
  id: ChecklistItemId;
  satisfied: boolean;
}

export interface DayEvaluation {
  date: IsoDate;
  plan: ChecklistPlan;
  settings: ChecklistSettings;
  log: DayLog | undefined;
  runCount: number;
  calorieTotal: number;
  calorieEntryCount: number;
}

/** Stable render order; the UI never re-sorts. */
const ITEM_ORDER: ChecklistItemId[] = ['course', 'calories', 'no_dinner', 'steps', 'water'];

export function applicableItems(date: IsoDate, plan: ChecklistPlan): ChecklistItemId[] {
  const weekday = weekdayOf(date);
  return ITEM_ORDER.filter((id) => {
    if (id === 'course') return plan.runDays.includes(weekday);
    if (id === 'no_dinner') return plan.noDinnerDays.includes(weekday);
    return true;
  });
}

function isSatisfied(id: ChecklistItemId, input: DayEvaluation): boolean {
  const { log, settings, plan, date } = input;
  switch (id) {
    case 'course':
      return input.runCount > 0 || log?.ticks.course === true;
    case 'calories': {
      const override = log?.ticks.calories;
      if (override !== undefined) return override;
      if (input.calorieEntryCount === 0) return false;
      return input.calorieTotal <= dayAllowance(date, plan, settings);
    }
    case 'no_dinner':
      return log?.ticks.no_dinner === true;
    case 'steps':
      return (log?.steps ?? 0) >= settings.stepTarget;
    case 'water':
      return (log?.waterGlasses ?? 0) >= settings.waterTarget;
  }
}

export function evaluateChecklist(input: DayEvaluation): ChecklistItem[] {
  return applicableItems(input.date, input.plan).map((id) => ({
    id,
    satisfied: isSatisfied(id, input),
  }));
}

/** An empty list is never a validated day. */
export function isDayValidated(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.satisfied);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- checklist`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/checklist.ts src/domain/checklist.test.ts
git commit -m "feat: add day-aware checklist evaluation and validation"
```

---

### Task 8: Streak and joker

**Files:**
- Create: `src/domain/streak.ts`
- Test: `src/domain/streak.test.ts`

**Interfaces:**
- Consumes: `addDays`, `diffDays`, `isoWeekOf` from `@/domain/calendar`; types from `@/domain/types`.
- Produces:
  - `isCovered(day: DayCoverage): boolean`
  - `currentStreak(days: DayCoverage[], today: IsoDate, startDate: IsoDate): number`
  - `canUseJoker(input: JokerCheck): boolean`
  - `export interface DayCoverage { date: IsoDate; validatedAt: string | null; jokered: boolean }`
  - `export interface JokerCheck { date; today; startDate; coverage; weekPlanJokerUsedOn }`

**Rules, from spec §4.3 and §4.4:** a date is covered when `validatedAt !== null || jokered`. The streak is the run of consecutive covered dates ending at today if today is covered, else ending at yesterday if yesterday is covered, else 0 — never reaching before `startDate`. A joker may be spent only on an uncovered date that is today or yesterday, not before `startDate`, and only when that date's own ISO week has not already spent one.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { canUseJoker, currentStreak, isCovered, type DayCoverage } from '@/domain/streak';

const validated = (date: string): DayCoverage => ({ date, validatedAt: '2026-10-06T21:00:00Z', jokered: false });
const jokered = (date: string): DayCoverage => ({ date, validatedAt: null, jokered: true });
const failed = (date: string): DayCoverage => ({ date, validatedAt: null, jokered: false });

describe('isCovered', () => {
  it('counts validated and jokered days, not failed ones', () => {
    expect(isCovered(validated('2026-10-06'))).toBe(true);
    expect(isCovered(jokered('2026-10-06'))).toBe(true);
    expect(isCovered(failed('2026-10-06'))).toBe(false);
  });
});

describe('currentStreak', () => {
  const start = '2026-10-01';

  it('is zero with no days', () => {
    expect(currentStreak([], '2026-10-06', start)).toBe(0);
  });

  it('counts a run ending today', () => {
    const days = [validated('2026-10-04'), validated('2026-10-05'), validated('2026-10-06')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(3);
  });

  it('counts through yesterday when today is not yet validated', () => {
    const days = [validated('2026-10-04'), validated('2026-10-05')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });

  it('is zero when neither today nor yesterday is covered', () => {
    const days = [validated('2026-10-03'), validated('2026-10-04')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(0);
  });

  it('survives a spent joker in the middle of the run', () => {
    const days = [
      validated('2026-10-03'), jokered('2026-10-04'),
      validated('2026-10-05'), validated('2026-10-06'),
    ];
    expect(currentStreak(days, '2026-10-06', start)).toBe(4);
  });

  it('breaks on a failed day', () => {
    const days = [
      validated('2026-10-03'), failed('2026-10-04'),
      validated('2026-10-05'), validated('2026-10-06'),
    ];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });

  it('breaks on a missing day, not just an explicitly failed one', () => {
    const days = [validated('2026-10-03'), validated('2026-10-05'), validated('2026-10-06')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });

  it('never counts before startDate', () => {
    const days = [
      validated('2026-09-29'), validated('2026-09-30'),
      validated('2026-10-01'), validated('2026-10-02'),
    ];
    expect(currentStreak(days, '2026-10-02', '2026-10-01')).toBe(2);
  });

  it('counts the 25 October 2026 DST day as exactly one day', () => {
    const days = [
      validated('2026-10-23'), validated('2026-10-24'),
      validated('2026-10-25'), validated('2026-10-26'),
    ];
    expect(currentStreak(days, '2026-10-26', '2026-10-01')).toBe(4);
  });

  it('ignores duplicate rows for the same date', () => {
    const days = [validated('2026-10-05'), validated('2026-10-05'), validated('2026-10-06')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });
});

describe('canUseJoker', () => {
  const base = {
    today: '2026-10-08',
    startDate: '2026-10-01',
    coverage: failed('2026-10-08'),
    weekPlanJokerUsedOn: null,
  };

  it('allows it on an uncovered today', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08' })).toBe(true);
  });

  it('allows it on an uncovered yesterday', () => {
    expect(canUseJoker({ ...base, date: '2026-10-07', coverage: failed('2026-10-07') })).toBe(true);
  });

  it('refuses a day further back, which would be retroactive self-deception', () => {
    expect(canUseJoker({ ...base, date: '2026-10-06', coverage: failed('2026-10-06') })).toBe(false);
  });

  it('refuses a future date', () => {
    expect(canUseJoker({ ...base, date: '2026-10-09', coverage: failed('2026-10-09') })).toBe(false);
  });

  it('refuses a day that is already covered', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08', coverage: validated('2026-10-08') })).toBe(false);
    expect(canUseJoker({ ...base, date: '2026-10-08', coverage: jokered('2026-10-08') })).toBe(false);
  });

  it('refuses when that date own ISO week has already spent its joker', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08', weekPlanJokerUsedOn: '2026-10-05' })).toBe(false);
  });

  it('refuses a date before startDate', () => {
    expect(canUseJoker({
      ...base, today: '2026-10-01', date: '2026-09-30',
      coverage: failed('2026-09-30'), startDate: '2026-10-01',
    })).toBe(false);
  });

  it('allows yesterday across a week boundary, judged by that date own week', () => {
    // Monday 12 October; yesterday was Sunday 11 October, in 2026-W41.
    // W41 has not spent its joker even though W42 might have.
    expect(canUseJoker({
      ...base, today: '2026-10-12', date: '2026-10-11',
      coverage: failed('2026-10-11'), weekPlanJokerUsedOn: null,
    })).toBe(true);
  });

  it('allows a date with no coverage row, since nothing logged means uncovered', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08', coverage: undefined })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- streak`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { addDays, diffDays } from './calendar';
import type { IsoDate } from './types';

export interface DayCoverage {
  date: IsoDate;
  validatedAt: string | null;
  jokered: boolean;
}

export interface JokerCheck {
  date: IsoDate;
  today: IsoDate;
  startDate: IsoDate;
  /** Coverage for `date`, if a row exists. Absent means nothing logged yet. */
  coverage: DayCoverage | undefined;
  /** `jokerUsedOn` from the week plan of `date` own ISO week. */
  weekPlanJokerUsedOn: IsoDate | null;
}

export function isCovered(day: DayCoverage): boolean {
  return day.validatedAt !== null || day.jokered;
}

/**
 * Consecutive covered days ending at today, or at yesterday when today is
 * not covered yet, and never reaching before startDate.
 */
export function currentStreak(
  days: DayCoverage[],
  today: IsoDate,
  startDate: IsoDate,
): number {
  const covered = new Set<IsoDate>();
  for (const day of days) {
    if (isCovered(day)) covered.add(day.date);
  }

  let cursor: IsoDate;
  if (covered.has(today)) cursor = today;
  else if (covered.has(addDays(today, -1))) cursor = addDays(today, -1);
  else return 0;

  let count = 0;
  while (covered.has(cursor) && diffDays(startDate, cursor) >= 0) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function canUseJoker(input: JokerCheck): boolean {
  const age = diffDays(input.date, input.today);
  if (age < 0 || age > 1) return false;
  if (diffDays(input.startDate, input.date) < 0) return false;
  if (input.weekPlanJokerUsedOn !== null) return false;
  if (input.coverage !== undefined && isCovered(input.coverage)) return false;
  return true;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- streak`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/streak.ts src/domain/streak.test.ts
git commit -m "feat: add streak counting and joker eligibility"
```

---

### Task 9: Running metrics

**Files:**
- Create: `src/domain/running.ts`
- Test: `src/domain/running.test.ts`

**Interfaces:**
- Consumes: `datesOfIsoWeek` from `@/domain/calendar`; `Run`, `IsoWeek` from `@/domain/types`.
- Produces:
  - `paceSecondsPerKm(distanceKm: number, durationS: number): number | null`
  - `formatPace(secondsPerKm: number): string`
  - `formatDuration(seconds: number): string`
  - `weeklyRunSummary(runs: RunLike[], week: IsoWeek, sessionsTarget: number): WeeklyRunSummary`
  - `export interface WeeklyRunSummary { sessions: number; target: number; totalKm: number; averagePaceSecondsPerKm: number | null }`
  - `export type RunLike = Pick<Run, 'date' | 'distanceKm' | 'durationS'>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  formatDuration, formatPace, paceSecondsPerKm, weeklyRunSummary, type RunLike,
} from '@/domain/running';

const run = (date: string, distanceKm: number, durationS: number): RunLike =>
  ({ date, distanceKm, durationS });

describe('paceSecondsPerKm', () => {
  it('divides duration by distance', () => {
    expect(paceSecondsPerKm(5, 1500)).toBe(300); // 5:00 /km
  });

  it('returns null for a zero or negative distance instead of Infinity', () => {
    expect(paceSecondsPerKm(0, 1500)).toBeNull();
    expect(paceSecondsPerKm(-1, 1500)).toBeNull();
  });
});

describe('formatPace', () => {
  it('formats as m:ss', () => {
    expect(formatPace(300)).toBe('5:00');
    expect(formatPace(324)).toBe('5:24');
    expect(formatPace(305.6)).toBe('5:06');
  });

  it('rolls 59.6 seconds up into the next minute', () => {
    expect(formatPace(359.6)).toBe('6:00');
  });
});

describe('formatDuration', () => {
  it('formats under an hour as mm:ss', () => {
    expect(formatDuration(1720)).toBe('28:40');
    expect(formatDuration(59)).toBe('0:59');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('weeklyRunSummary', () => {
  it('counts only runs inside the week', () => {
    const runs = [
      run('2026-10-04', 6, 2100),   // Sunday of W40 — excluded
      run('2026-10-05', 5, 1500),
      run('2026-10-06', 5.2, 1600),
      run('2026-10-12', 7, 2400),   // Monday of W42 — excluded
    ];
    const summary = weeklyRunSummary(runs, '2026-W41', 5);
    expect(summary.sessions).toBe(2);
    expect(summary.totalKm).toBeCloseTo(10.2, 10);
    expect(summary.target).toBe(5);
  });

  it('averages pace over total distance and total time, not over runs', () => {
    const runs = [run('2026-10-05', 5, 1500), run('2026-10-06', 5, 1600)];
    const summary = weeklyRunSummary(runs, '2026-W41', 5);
    expect(summary.averagePaceSecondsPerKm).toBeCloseTo(3100 / 10, 10);
  });

  it('reports an empty week without dividing by zero', () => {
    expect(weeklyRunSummary([], '2026-W41', 5)).toEqual({
      sessions: 0, target: 5, totalKm: 0, averagePaceSecondsPerKm: null,
    });
  });

  it('counts two runs on the same day as two sessions', () => {
    const runs = [run('2026-10-06', 5, 1500), run('2026-10-06', 3, 900)];
    expect(weeklyRunSummary(runs, '2026-W41', 5).sessions).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- running`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { datesOfIsoWeek } from './calendar';
import type { IsoWeek, Run } from './types';

export type RunLike = Pick<Run, 'date' | 'distanceKm' | 'durationS'>;

export interface WeeklyRunSummary {
  sessions: number;
  target: number;
  totalKm: number;
  averagePaceSecondsPerKm: number | null;
}

export function paceSecondsPerKm(distanceKm: number, durationS: number): number | null {
  if (distanceKm <= 0) return null;
  return durationS / distanceKm;
}

export function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function weeklyRunSummary(
  runs: RunLike[],
  week: IsoWeek,
  sessionsTarget: number,
): WeeklyRunSummary {
  const dates = new Set(datesOfIsoWeek(week));
  const inWeek = runs.filter((r) => dates.has(r.date));
  const totalKm = inWeek.reduce((sum, r) => sum + r.distanceKm, 0);
  const totalS = inWeek.reduce((sum, r) => sum + r.durationS, 0);
  return {
    sessions: inWeek.length,
    target: sessionsTarget,
    totalKm,
    averagePaceSecondsPerKm: paceSecondsPerKm(totalKm, totalS),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- running`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/running.ts src/domain/running.test.ts
git commit -m "feat: add pace formatting and weekly run summary"
```

---

### Task 10: Dexie schema, ids and outbox

**Files:**
- Create: `src/db/ids.ts`, `src/db/schema.ts`, `src/db/outbox.ts`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: domain types.
- Produces:
  - `newId(): string` and `nowIso(): string` from `@/db/ids`
  - `db` (a `RubanDb` instance) and `type SyncedTableName` from `@/db/schema`
  - `enqueue(table: SyncedTableName, op: 'put' | 'delete', payload: unknown): Promise<void>` from `@/db/outbox`
  - `export interface OutboxRow { seq?: number; table: SyncedTableName; op: 'put' | 'delete'; payload: unknown; createdAt: string; attempts: number }`
  - `export interface MetaRow { key: string; value: unknown }`

Install the fake IndexedDB backend this task needs:

```bash
npm install -D fake-indexeddb
```

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@/db/ids';
import { db } from '@/db/schema';
import { enqueue } from '@/db/outbox';

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.dayLogs.clear(), db.weights.clear(), db.calorieEntries.clear(),
    db.runs.clear(), db.weekPlans.clear(), db.settings.clear(),
    db.cycles.clear(), db.outbox.clear(), db.meta.clear(),
  ]);
});

describe('newId', () => {
  it('produces distinct, time-sortable ids', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('nowIso', () => {
  it('produces a parseable ISO 8601 string', () => {
    expect(Number.isNaN(Date.parse(nowIso()))).toBe(false);
  });
});

describe('db schema', () => {
  it('stores and reads a day log by user and date', async () => {
    const id = newId();
    await db.dayLogs.put({
      id, userId: 'u1', updatedAt: nowIso(), deletedAt: null,
      date: '2026-10-06', ticks: { course: true }, steps: 8200, waterGlasses: 6,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
    });
    const found = await db.dayLogs.where('[userId+date]').equals(['u1', '2026-10-06']).first();
    expect(found?.id).toBe(id);
    expect(found?.ticks.course).toBe(true);
  });

  it('keeps one settings row per user', async () => {
    const base = {
      userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-06',
      startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
      weighInCadence: 'daily' as const, dailyCalorieTarget: 1500,
      noDinnerAllowance: 900, calorieFloor: 1200, stepTarget: 8000,
      waterTarget: 6, runSessionsTarget: 5, soundEnabled: false, updatedAt: nowIso(),
    };
    await db.settings.put(base);
    await db.settings.put({ ...base, stepTarget: 9000 });
    expect(await db.settings.count()).toBe(1);
    expect((await db.settings.get('u1'))?.stepTarget).toBe(9000);
  });

  it('stores meta values by key', async () => {
    await db.meta.put({ key: 'lastPulledAt', value: '2026-10-06T20:00:00Z' });
    expect((await db.meta.get('lastPulledAt'))?.value).toBe('2026-10-06T20:00:00Z');
  });
});

describe('enqueue', () => {
  it('appends outbox rows in call order', async () => {
    await enqueue('weights', 'put', { id: 'a' });
    await enqueue('runs', 'put', { id: 'b' });
    const rows = await db.outbox.orderBy('seq').toArray();
    expect(rows.map((r) => r.table)).toEqual(['weights', 'runs']);
    expect(rows[0]?.attempts).toBe(0);
    expect(rows[0]?.op).toBe('put');
  });

  it('records a delete as a tombstone op rather than removing anything', async () => {
    await enqueue('runs', 'delete', { id: 'b', deletedAt: nowIso() });
    const row = await db.outbox.orderBy('seq').last();
    expect(row?.op).toBe('delete');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- schema`
Expected: FAIL — `Failed to resolve import "@/db/ids"`.

- [ ] **Step 3: Implement the three files**

`src/db/ids.ts`:

```ts
import { uuidv7 } from 'uuidv7';

/** Time-sortable id, generated on the client so no server round trip is needed. */
export function newId(): string {
  return uuidv7();
}

export function nowIso(): string {
  return new Date().toISOString();
}
```

`src/db/schema.ts`:

```ts
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
      dayLogs: 'id, [userId+date], updatedAt',
      weights: 'id, [userId+date], updatedAt',
      calorieEntries: 'id, [userId+date], updatedAt',
      runs: 'id, [userId+date], updatedAt',
      weekPlans: 'id, [userId+isoWeek], updatedAt',
      cycles: 'id, [userId+startDate], updatedAt',
      outbox: '++seq, table, createdAt',
      meta: 'key',
    });
  }
}

export const db = new RubanDb();
```

`src/db/outbox.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db package.json package-lock.json src/db/schema.test.ts
git commit -m "feat: add Dexie schema, UUIDv7 ids and the sync outbox"
```

---

### Task 11: Repositories

**Files:**
- Create: `src/db/repos.ts`
- Test: `src/db/repos.test.ts`

**Interfaces:**
- Consumes: `db`, `enqueue`, `newId`, `nowIso`, domain types.
- Produces:
  - `saveCycle(userId, input): Promise<Cycle>`, `listCycles(userId): Promise<Cycle[]>`
  - `saveWeight(userId, date, kg): Promise<Weight>`
  - `saveRun(userId, input): Promise<Run>`
  - `saveCalorieEntry(userId, date, kcal, label): Promise<CalorieEntry>`
  - `softDelete(table, id): Promise<void>`
  - `getOrCreateDayLog(userId, date): Promise<DayLog>`
  - `getOrCreateWeekPlan(userId, isoWeek): Promise<WeekPlan>`
  - `updateDayLog(userId, date, patch): Promise<DayLog>`
  - `listWeights(userId): Promise<Weight[]>`, `listRuns(userId)`, `listCalorieEntries(userId)`, `listDayLogs(userId)`
  - `saveSettings(settings): Promise<Settings>`, `getSettings(userId)`

Every mutating call stamps `updatedAt`, leaves `deletedAt` alone unless deleting, and enqueues an outbox row in the same transaction. Every list call filters out tombstones.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import {
  getOrCreateDayLog, getOrCreateWeekPlan, listCycles, listRuns, listWeights,
  saveCycle, saveRun, saveWeight, softDelete, updateDayLog,
} from '@/db/repos';
import { DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS } from '@/domain/types';

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.dayLogs.clear(), db.weights.clear(), db.runs.clear(),
    db.weekPlans.clear(), db.calorieEntries.clear(), db.settings.clear(),
    db.cycles.clear(), db.outbox.clear(),
  ]);
});

describe('saveWeight', () => {
  it('stamps updatedAt and enqueues one outbox row', async () => {
    const saved = await saveWeight('u1', '2026-10-06', 62.4);
    expect(saved.kg).toBe(62.4);
    expect(saved.deletedAt).toBeNull();
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false);
    expect(await db.outbox.count()).toBe(1);
  });

  it('replaces the existing weigh-in for that date rather than adding a second', async () => {
    const first = await saveWeight('u1', '2026-10-06', 62.4);
    const second = await saveWeight('u1', '2026-10-06', 62.1);
    expect(second.id).toBe(first.id);
    expect(await listWeights('u1')).toHaveLength(1);
    expect((await listWeights('u1'))[0]?.kg).toBe(62.1);
  });
});

describe('saveRun', () => {
  it('allows two runs on one date', async () => {
    await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    await saveRun('u1', { date: '2026-10-06', distanceKm: 3, durationS: 900, note: null });
    expect(await listRuns('u1')).toHaveLength(2);
  });
});

describe('softDelete', () => {
  it('tombstones instead of removing, and hides the row from lists', async () => {
    const run = await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    await softDelete('runs', run.id);
    expect(await db.runs.get(run.id)).toBeDefined();
    expect((await db.runs.get(run.id))?.deletedAt).not.toBeNull();
    expect(await listRuns('u1')).toHaveLength(0);
  });

  it('enqueues a delete op', async () => {
    const run = await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    await db.outbox.clear();
    await softDelete('runs', run.id);
    expect((await db.outbox.orderBy('seq').last())?.op).toBe('delete');
  });
});

describe('getOrCreateDayLog', () => {
  it('creates once then returns the same row', async () => {
    const a = await getOrCreateDayLog('u1', '2026-10-06');
    const b = await getOrCreateDayLog('u1', '2026-10-06');
    expect(b.id).toBe(a.id);
    expect(await db.dayLogs.count()).toBe(1);
  });

  it('starts with nothing ticked and no stamps', async () => {
    const log = await getOrCreateDayLog('u1', '2026-10-06');
    expect(log.ticks).toEqual({});
    expect(log.validatedAt).toBeNull();
    expect(log.bonusFiredAt).toBeNull();
    expect(log.jokered).toBe(false);
  });
});

describe('updateDayLog', () => {
  it('merges a patch and bumps updatedAt', async () => {
    const created = await getOrCreateDayLog('u1', '2026-10-06');
    const patched = await updateDayLog('u1', '2026-10-06', { steps: 8200 });
    expect(patched.id).toBe(created.id);
    expect(patched.steps).toBe(8200);
    expect(Date.parse(patched.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it('merges ticks rather than replacing the whole map', async () => {
    await updateDayLog('u1', '2026-10-06', { ticks: { course: true } });
    const after = await updateDayLog('u1', '2026-10-06', { ticks: { no_dinner: true } });
    expect(after.ticks).toEqual({ course: true, no_dinner: true });
  });

  it('enqueues exactly one outbox row when the day did not exist yet', async () => {
    await db.outbox.clear();
    await updateDayLog('u1', '2026-10-09', { steps: 8000 });
    // Two rows here would mean the create and the update ran as separate
    // writes, which is the two-transaction shape this guards against.
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps both ticks when two updates race', async () => {
    await Promise.all([
      updateDayLog('u1', '2026-10-10', { ticks: { course: true } }),
      updateDayLog('u1', '2026-10-10', { ticks: { calories: true } }),
    ]);
    const log = await getOrCreateDayLog('u1', '2026-10-10');
    expect(log.ticks).toEqual({ course: true, calories: true });
  });
});

describe('saveCycle', () => {
  it('stamps closedAt and enqueues one outbox row', async () => {
    const cycle = await saveCycle('u1', {
      startDate: '2026-10-06', goalDate: '2026-11-12',
      startWeight: 66, targetWeight: 62.3, endWeight: 62.5,
    });
    expect(cycle.closedAt).not.toBe('');
    expect(Number.isNaN(Date.parse(cycle.closedAt))).toBe(false);
    expect(cycle.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps each closed cycle rather than replacing the previous one', async () => {
    await saveCycle('u1', {
      startDate: '2026-10-06', goalDate: '2026-11-12',
      startWeight: 66, targetWeight: 62.3, endWeight: 62.5,
    });
    await saveCycle('u1', {
      startDate: '2026-11-13', goalDate: '2026-12-24',
      startWeight: 62.5, targetWeight: 61, endWeight: null,
    });
    const cycles = await listCycles('u1');
    expect(cycles).toHaveLength(2);
    expect(cycles.map((c) => c.startDate).sort())
      .toEqual(['2026-10-06', '2026-11-13']);
  });

  it('accepts a null end weight, for a cycle that was never weighed', async () => {
    const cycle = await saveCycle('u1', {
      startDate: '2026-10-06', goalDate: '2026-11-12',
      startWeight: 66, targetWeight: 62.3, endWeight: null,
    });
    expect(cycle.endWeight).toBeNull();
  });
});

describe('getOrCreateWeekPlan', () => {
  it('seeds the spec defaults', async () => {
    const plan = await getOrCreateWeekPlan('u1', '2026-W41');
    expect(plan.runDays).toEqual([...DEFAULT_RUN_DAYS]);
    expect(plan.noDinnerDays).toEqual([...DEFAULT_NO_DINNER_DAYS]);
    expect(plan.jokerUsedOn).toBeNull();
  });

  it('does not re-seed an edited week', async () => {
    const created = await getOrCreateWeekPlan('u1', '2026-W41');
    await db.weekPlans.update(created.id, { noDinnerDays: [3] });
    const again = await getOrCreateWeekPlan('u1', '2026-W41');
    expect(again.noDinnerDays).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- repos`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
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
    await db[table].update(id, { deletedAt, updatedAt: deletedAt });
    const row = await db[table].get(id);
    await enqueue(table, 'delete', row);
  });
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
  patch: Partial<Omit<DayLog, 'id' | 'userId' | 'date'>>,
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- repos`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test && npx tsc -b`
Expected: all tests PASS, no type errors.

```bash
git add src/db/repos.ts src/db/repos.test.ts
git commit -m "feat: add repositories that stamp updatedAt and enqueue sync"
```

---

## Plan 1 Done When

- `npm test` passes with coverage of the spec §4 rules **allocated to this plan**: §4.1 (time), §4.2 (checklist applicability and satisfaction), §4.4 (joker eligibility, less the week-selection the caller resolves — see Plan 2), §4.6 (rolling average and trajectory), §4.7 (budget) and §4.8 (running). **Not** §4.3's validation stamping or §4.5's one-time bonus (Plan 2) or §4.9's cycle summary (Plan 3) — those have no domain home here, and the earlier wording invited a false tick.
- `npx tsc -b` is clean.
- `src/domain/` imports nothing from `src/db/`, React, or any date library. Verify: `grep -rE "from '(dexie|react|date-fns)" src/domain/` returns nothing.
- `src/domain/` and `src/shared/` use no `@/` alias, so `api/` can import them. Verify: `grep -rn "from '@/" src/domain/ src/shared/` returns nothing.
- Every mutating repo call produces exactly one outbox row.
