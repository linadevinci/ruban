# Plan 1 fix wave — whole-branch review

Branch `phase-1`, from `d51d487` (112 tests) to `674a640` (**149 tests**).
`npx tsc -b` exits 0. `npx oxlint` exits 0.

Method: every new test was written, then its subject was deliberately broken
and the test watched to fail, then the subject restored and the test watched to
pass. The failure output is recorded under each group. One new test did not
discriminate on the first attempt and was strengthened — see Group 6.

| group | commit | subject |
| --- | --- | --- |
| 1 | `3a53349` | fix(calendar): correct the ISO week number, guard datesOfIsoWeek, read todayIn by part |
| 2 | `0eeeed9` | test: pin TZ=Europe/Paris and make the rollingAverage DST case discriminate |
| 3 | `37c9abf` | test: make four boundary cases discriminate against a flipped operator |
| 4 | `d6ccf13` | feat(domain): add effectiveWeekPlan, calorie totals and totalDurationS |
| 5 | `d4166b1` | fix(db): make the singleton indexes unique and nowIso monotonic |
| 6 | `b346b36` | fix(repos): guard softDelete, add read-only accessors, narrow the day-log patch |
| 7 | `674a640` | docs: fix the possessive in the joker rule and rename a misdescribed test |

Test count after each group: 116, 116, 119, 126, 128, 149, 149.

---

## Group 1 — `src/domain/calendar.ts` — commit `3a53349`

### Changed

- **1a** `isoWeekOf`: `Math.round((dt - jan1) / DAY_MS / 7) + 1` → `Math.ceil((days + 1) / 7)`,
  with the explanatory comment about the first-Thursday index `k`.
- **1b** `datesOfIsoWeek`: parses `^(\d{4})-W(\d{2})$`, throws an `Error` naming the
  bad input otherwise, and rejects a week outside 1–53. Week 53 in a 52-week
  year is deliberately *not* rejected, as instructed.
- **1c** `todayIn`: reads `formatToParts` by part type instead of relying on
  `en-CA`'s layout.
- **1d** `formatIsoDate` → `formatUtcNoonDate`, with a doc comment pointing at
  `todayIn`. Internal callers (`addDays`, `datesOfIsoWeek`) and the test updated.

### New tests (4)

1. `isoWeekOf > numbers 2027, whose 1 January is a Friday, from week 1` — the five
   direct assertions from the brief.
2. `isoWeekOf and datesOfIsoWeek invert each other > holds for every date from
   2026-01-01 to 2029-12-31` — the property test, spanning 2027 and 2028.
3. `datesOfIsoWeek > rejects a key that is not YYYY-Www instead of throwing from toISOString`
4. `datesOfIsoWeek > rejects a week number outside 1-53`

### Negative-first evidence

**1a — reverted to `Math.round(days / 7) + 1`:**

```
     × numbers 2027, whose 1 January is a Friday, from week 1
     × holds for every date from 2026-01-01 to 2029-12-31
AssertionError: expected '2027-W02' to be '2027-W01' // Object.is equality
AssertionError: expected [ '2027-01-04 -> 2027-W02', …(727) ] to deeply equal []
 Test Files  1 failed | 8 passed (9)
      Tests  2 failed | 114 passed (116)
```

**This is the contrast the brief asked me to state explicitly: with the broken
formula restored, exactly 2 tests failed and 114 passed. The 114 are the 112
pre-existing tests plus the two new `datesOfIsoWeek` guard tests, which do not
depend on the week formula. So all 112 pre-existing tests passed against the
wrong implementation.** The property test reported exactly 728 failing dates
(1 shown + 727 elided), matching the empirical sweep in the brief, and the run
begins at `2027-01-04`, the first date of the contiguous run.

**1b — guard removed (back to `w.split('-W')`):**

```
     × rejects a key that is not YYYY-Www instead of throwing from toISOString
     × rejects a week number outside 1-53
AssertionError: expected [Function] to throw error matching /garbage/ but got 'Invalid time value'
AssertionError: expected [Function] to throw an error    (received: undefined)
      Tests  2 failed | 14 passed (16)
```

The first failure reproduces the original opaque `RangeError: Invalid time value`
from `toISOString`; the second shows `'2026-W54'` previously returning dates
silently.

**1c — no behavioural test is possible here** (that is the finding: `en-CA` really
does render `YYYY-MM-DD`, so the old and new forms agree on every input). To
prove the new code path is live rather than dead, I scrambled the part order to
`day-month-year`:

```
     × reads the date in the given zone, not UTC
     × is correct on both sides of the 25 October 2026 DST change
AssertionError: expected '15-07-2026' to be '2026-07-15'
AssertionError: expected '25-10-2026' to be '2026-10-25'
```

Both existing `todayIn` tests, including both 25 October 2026 DST cases, pass
unchanged with the real implementation.

**1d — `slice(0, 10)` → `slice(0, 9)`:**

```
     × round-trips
     × crosses month and year boundaries
     × is unaffected by the 25 October 2026 DST change
     × returns seven dates, Monday first
     × is the inverse of isoWeekOf for every date it returns
     × holds for every date from 2026-01-01 to 2029-12-31
AssertionError: expected '2026-11-1' to be '2026-11-12'
AssertionError: expected '2026-W40' to be '2026-W44'
      Tests  6 failed | 10 passed (16)
```

### Judged differently

The property test was first written as a chained `while (date <= '2029-12-31')
{ … date = addDays(date, 1) }`. Under the `slice(0, 9)` probe that loop never
terminated and hung the suite. I rewrote it as a bounded `for` loop over
`diffDays('2026-01-01', '2029-12-31')` with `addDays('2026-01-01', i)`, and
asserted the span is 1460 so the bound itself is checked. Same coverage, but a
broken `addDays` can no longer hang the run. The 1a evidence above was
re-collected after this change.

---

## Group 2 — DST tests able to fail — commit `0eeeed9`

### Changed

- `vite.config.ts` `test` block: `env: { TZ: 'Europe/Paris' }`, with a comment
  saying why.
- `src/domain/rollingAverage.test.ts`: **kept but rewritten.** The old case
  (`2026-10-23 / 25 / 27` averaged on `2026-10-27`) could not fail, and 25
  October is the *fall-back* transition — a 25-hour day — which almost any wrong
  implementation gets right: a local-midnight age of 6 days across it is
  `145h / 24 = 6.04`, and both `floor` and `round` give 6. The direction that
  actually breaks is **spring forward**, where a 7-day span is 167 hours and
  floors to 6, pulling the out-of-window weigh-in *inside*.

  New case: `keeps the window edge exact across the 29 March 2026 DST change`,
  averaging on `2026-04-01` with a weigh-in at `2026-03-25` (exactly 7 days
  back, must stay outside) and one at `2026-03-26` (6 days back, inside).

### What wrong implementation it now catches

An age computed from local midnights with `Math.floor` instead of from
`parseIsoDate`'s UTC noon — i.e. the exact class of bug `parseIsoDate` exists to
prevent.

### Negative-first evidence

`diffDays` replaced with a local-midnight + `Math.floor` version:

```
### under the pinned TZ=Europe/Paris:
     × keeps the window edge exact across the 29 March 2026 DST change
AssertionError: expected 64.375 to be close to 62.5, received difference is 1.875, but expected 5e-11
      Tests  1 failed | 5 passed (6)

### the same break, env pin removed, TZ=UTC (what the suite did before this group):
      Tests  6 passed (6)
```

That pair is the strongest evidence available for both halves of this group: the
same wrong `diffDays` is invisible without the `TZ` pin and loud with it.

### Concern recorded

While the broken `diffDays` was in place I ran the whole suite to see which
DST-named cases it catches:

```
     × crosses month and year boundaries            (calendar.test.ts)
     × keeps the window edge exact across the 29 March 2026 DST change
      Tests  2 failed | 114 passed (116)
```

So the **other three** DST-named cases still cannot fail even with `TZ` pinned:
`calendar.test.ts > addDays / diffDays > is unaffected by the 25 October 2026 DST
change` and `streak.test.ts > counts the 25 October 2026 DST day as exactly one
day`. The reason is the one above — the fall-back direction is harmless for
essentially any implementation. The brief only scoped the `rollingAverage` case,
so I left those alone, but their names still claim protection they do not
provide. They would need to move to the spring-forward boundary too.

---

## Group 3 — four non-discriminating boundary tests — commit `37c9abf`

I probed all four claims against the **pre-change** suite before writing anything.
Three reproduced. **One did not — finding 3 is wrong; see below.**

```
### budget: < -> <=                                 Tests  12 passed (12)   (non-discriminating ✓)
### checklist: <= -> <                              Tests  17 passed (17)   (non-discriminating ✓)
### running: mean-of-per-run-paces                  Tests  10 passed (10)   (non-discriminating ✓)
### streak: >= -> >      × never counts before startDate
                                                    Tests  1 failed | 115 passed (116)
```

### Changed

1. `budget.test.ts` — new `does not flag an allowance that sits exactly on the
   floor`: `calorieFloor: 900` (equal to `noDinnerAllowance`) yields `[]`, and
   `calorieFloor: 1500` (equal to `dailyCalorieTarget`) yields only the
   `noDinner` warning. Covers both comparisons.
2. `checklist.test.ts` — new `satisfies calories when the total lands exactly on
   the allowance`: `calorieTotal: 1500` on Tuesday, whose allowance is 1500.
3. `streak.test.ts` — new `counts startDate itself, the day the streak can reach
   but not pass`.
4. `running.test.ts` — fixture changed to 1 km / 240 s and 9 km / 3150 s,
   asserting 339 (mean of paces would be 295).

### Negative-first evidence

```
=== budget: < -> <= ===
     × does not flag an allowance that sits exactly on the floor
AssertionError: expected [ { kind: 'noDinner', …(2) } ] to deeply equal []
      Tests  1 failed | 12 passed (13)

=== checklist: <= -> < ===
     × satisfies calories when the total lands exactly on the allowance
AssertionError: expected false to be true
      Tests  1 failed | 17 passed (18)

=== streak: >= -> > ===
     × never counts before startDate
     × counts startDate itself, the day the streak can reach but not pass
AssertionError: expected 1 to be 2
AssertionError: expected 2 to be 3
      Tests  2 failed | 19 passed (21)

=== running: mean-of-per-run-paces ===
     × averages pace over total distance and total time, not over runs
AssertionError: expected 295 to be close to 339, received difference is 44
      Tests  1 failed | 9 passed (10)
```

### Finding 3 was wrong — reported rather than forced through

> "`currentStreak`'s terminator is `diffDays(startDate, cursor) >= 0` and no test
> lands the cursor exactly on `startDate`, so flipping `>=` to `>` silently
> shortens every streak by one."

The existing `never counts before startDate` case **already lands the cursor
exactly on `startDate` and already catches the flip.** Its data is
`2026-09-29 … 2026-10-02` with `today = 2026-10-02`, `startDate = 2026-10-01`:
the walk counts `10-02` (diff 1), then `10-01` (diff 0, the exact boundary), then
stops at `09-30` (diff −1), giving 2. With `>` it stops at `10-01` and returns 1,
so the assertion `toBe(2)` fails — confirmed above, `expected 1 to be 2`.

I added the new case anyway: it is cheap, it names the boundary explicitly
instead of leaving it as a side effect of a test about `startDate` exclusion, and
it also fails under the flip (`expected 2 to be 3`). But the review's premise for
this one was incorrect — this is the only Group 3 item where the suite was
already protected.

---

## Group 4 — three new domain functions — commit `d6ccf13`

### Changed

- **4a** `effectiveWeekPlan(plan: WeekPlan | undefined): ChecklistPlan` in
  `src/domain/checklist.ts`, importing `DEFAULT_RUN_DAYS` /
  `DEFAULT_NO_DINNER_DAYS` from `./types` as values.
- **4b** `CalorieEntryLike`, `dayCalorieTotal`, `weekCalorieTotal` in
  `src/domain/budget.ts`; the week version builds a `Set` from
  `datesOfIsoWeek(week)`.
- **4c** `totalDurationS: number` added to `WeeklyRunSummary` and returned from
  `weeklyRunSummary`.

### New tests (7)

`effectiveWeekPlan`: returns the stored plan unchanged / supplies the spec
defaults / returns copies. `dayCalorieTotal` + `weekCalorieTotal`: day total,
week total with an entry one day outside on each side (`2026-10-04` and
`2026-10-12` around `2026-W41`), and both returning 0 for no entries.
`weeklyRunSummary`: `totals the duration of the in-week runs only`.

### Negative-first evidence

The existing empty-week shape assertion failed the moment the field was added,
before I touched the test — which is itself evidence it is a real shape
assertion:

```
     × reports an empty week without dividing by zero
AssertionError: expected { sessions: +0, target: 5, …(3) } to deeply equal { sessions: +0, target: 5, …(2) }
```

```
=== 4a-i: effectiveWeekPlan returns the default even when a plan exists ===
     × returns the stored plan unchanged
AssertionError: expected { runDays: [ 1, 2, 4, 6, 7 ], …(1) } to be { id: 'w', userId: 'u', …(6) }

=== 4a-ii: effectiveWeekPlan hands back the shared constants instead of copies ===
     × returns copies, so mutating the result cannot alter the shared constants
AssertionError: expected [ 1, 2, 4, 6, 7, 3 ] to deeply equal [ 1, 2, 4, 6, 7 ]

=== 4a-iii: swap the two default day sets ===
     × supplies the spec defaults for a week that was never planned
     × returns copies, so mutating the result cannot alter the shared constants
AssertionError: expected { runDays: [ 3, 7 ], …(1) } to deeply equal { runDays: [ 1, 2, 4, 6, 7 ], …(1) }

=== 4b-i: dayCalorieTotal ignores the date filter ===
     × sums a day and ignores every other date
AssertionError: expected 2200 to be 800

=== 4b-ii: weekCalorieTotal sums everything instead of the week ===
     × sums a week and ignores the day on either side of it
AssertionError: expected 3500 to be 1500

=== 4b-iii: non-zero reduce seed ===
     × sums a day and ignores every other date
     × sums a week and ignores the day on either side of it
     × returns 0 for no entries rather than NaN
AssertionError: expected 1 to be +0

=== 4c: totalDurationS sums all runs, not just in-week ===
     × totals the duration of the in-week runs only
AssertionError: expected 7600 to be 3100
```

### Judged differently

The brief's wording for 4a was "returns the stored plan unchanged when given
one". `toEqual({ runDays, noDinnerDays })` fails, because `effectiveWeekPlan`
returns the whole `WeekPlan` (structurally a `ChecklistPlan`, with the extra
`SyncedRow` fields present) and `toEqual` rejects extra properties. I assert
`toBe(stored)` — object identity, i.e. nothing merged in or copied — plus the two
field values. That is a stronger reading of "unchanged" and it is what makes the
4a-i probe fail.

---

## Group 5 — `src/db/schema.ts`, `src/db/ids.ts` — commit `d4166b1`

### Changed

- **5a** `version(1)`: `dayLogs` and `weights` → `'id, &[userId+date], updatedAt'`,
  `weekPlans` → `'id, &[userId+isoWeek], updatedAt'`, with the comment about two
  offline devices. `calorieEntries`, `runs` and `cycles` untouched.
- **5b** `nowIso()` made monotonic via module-level `lastNowMs`.
- **5c** The tombstone assertion also checks `table`, `payload.id` and a non-null
  `payload.deletedAt` equal to the stamp passed in.

**No existing fixture was relying on the non-unique index.** All 128 tests passed
immediately after the schema change, before any new test was added. In
particular the `updateDayLog` `Promise.all` race test still passes, which
confirms IndexedDB serialises the two `rw` transactions over `dayLogs` so only
one row is ever created.

### New tests (2)

`db schema > rejects a second day log for the same user and date`;
`nowIso > is strictly increasing, so two writes in one millisecond differ`
(500 successive calls: no tie, no duplicate, each parseable).

### Negative-first evidence

```
=== 5a: revert dayLogs to a non-unique compound index ===
     × rejects a second day log for the same user and date
AssertionError: promise resolved "'01a121c0-bbd2-7233-a377-b373080b44a8'" instead of rejecting
      Tests  1 failed | 8 passed (9)

=== 5b: revert nowIso to new Date().toISOString() ===
     × is strictly increasing, so two writes in one millisecond differ
AssertionError: expected [ '2026-10-09T17:40:42.790Z', …(497) ] to deeply equal []
      Tests  1 failed | 8 passed (9)
```

498 of 500 stamps were ties under the old implementation — the dropped-write
window is not theoretical.

```
=== 5c: enqueue drops deletedAt from the payload ===
     × records a delete as a tombstone op rather than removing anything
AssertionError: expected null to be '2026-10-09T17:40:44.628Z'
      Tests  1 failed | 8 passed (9)
```

---

## Group 6 — `src/db/repos.ts` — commit `b346b36`

### Changed

- **6a** `softDelete` captures `update()`'s return and early-returns on `0`,
  leaving the outbox untouched.
- **6b** `getDayLog` and `getWeekPlan` added next to the get-or-create pair,
  which is unchanged. Both query the compound index and return `undefined` for a
  tombstoned row.
- **6c** `updateDayLog`'s patch is now
  `Partial<Omit<DayLog, 'id' | 'userId' | 'date' | 'deletedAt' | 'updatedAt'>>`.
- **6d** 21 new tests.

### New tests (21)

`saveRun` outbox count (1); `softDelete` for `weights` and `calorieEntries` plus
the unknown-id case (3); `saveCalorieEntry` / `listCalorieEntries` (2);
`listDayLogs` tombstone exclusion (1); `saveSettings` / `getSettings` (3);
`updateWeekPlan` merge, single outbox row, racing updates (3); `getDayLog` (4);
`getWeekPlan` (4).

### Negative-first evidence

```
=== 6a: restore the old softDelete body (no early return) ===
     × queues nothing for an unknown id instead of a change with no payload
AssertionError: expected 1 to be +0
      Tests  1 failed | 36 passed (37)

=== 6b-i: getDayLog / getWeekPlan stop filtering tombstones ===
     × returns undefined once the row is tombstoned   (getDayLog)
     × returns undefined once the row is tombstoned   (getWeekPlan)
AssertionError: expected { …(14) } to be undefined
AssertionError: expected { …(8) } to be undefined
      Tests  2 failed | 35 passed (37)

=== 6b-ii: getDayLog / getWeekPlan delegate to the get-or-create pair ===
     × returns undefined for a day that was never logged
     × writes nothing, so a reactive read cannot mutate what it observes   (getDayLog)
     × returns undefined for a week that was never planned
     × writes nothing, so a reactive read cannot mutate what it observes   (getWeekPlan)
      Tests  4 failed | 33 passed (37)

=== 6b-iii: getDayLog / getWeekPlan always return undefined ===
     × returns the stored row when one exists   (x2)
AssertionError: expected undefined to be '01a121c3-5180-75ce-b545-34d930c77d0f'
      Tests  2 failed | 35 passed (37)
```

The 6b-ii probe is the one that matters: it is the exact mistake these functions
exist to prevent, and only the before/after count assertions catch it.

**6c is a type-level change, so the check is a type-level one.** A temporary
`src/db/__typeprobe.ts` calling `updateDayLog` with each field:

```
src/db/__typeprobe.ts(2,41): error TS2353: Object literal may only specify known properties, and 'deletedAt' does not exist in type 'Partial<Omit<DayLog, "id" | "userId" | "updatedAt" | "date" | "deletedAt">>'.
src/db/__typeprobe.ts(3,41): error TS2353: Object literal may only specify known properties, and 'updatedAt' does not exist in type 'Partial<Omit<DayLog, "id" | "userId" | "updatedAt" | "date" | "deletedAt">>'.
```

`{ steps: 8000 }` in the same file produced no error. The probe file was deleted;
it is not in any commit.

```
=== 6d: revert updateWeekPlan to the two-transaction shape (read via getOrCreateWeekPlan first) ===
     × enqueues exactly one outbox row when the week did not exist yet
     × keeps both fields when two updates race
AssertionError: expected 2 to be 1
AssertionError: expected null to be '2026-10-20'
      Tests  2 failed | 35 passed (37)
```

That second failure is the half of the lost-update fix that guards the
one-joker-per-week invariant — previously untested, now covered.

```
=== 6d: saveSettings stops enqueuing ===
     × round-trips and enqueues one outbox row
     × replaces the row on a second save rather than duplicating it
AssertionError: expected +0 to be 1 / expected +0 to be 2

=== 6d: getSettings always returns undefined ===
     × round-trips and enqueues one outbox row
     × replaces the row on a second save rather than duplicating it

=== 6d: saveSettings writes under a fresh key, duplicating the row ===
     × round-trips and enqueues one outbox row
     × replaces the row on a second save rather than duplicating it
AssertionError: expected 2 to be 1

=== 6d: listCalorieEntries / listDayLogs stop filtering tombstones (live() neutered) ===
     × tombstones instead of removing, and hides the row from lists
     × tombstones a weigh-in and hides it from the list
     × tombstones a calorie entry and hides it from the list
     × drops a tombstoned entry from the list but keeps the row
     × excludes a tombstoned day log
      Tests  5 failed | 32 passed (37)

=== 6d: softDelete leaves deletedAt null ===
     × tombstones instead of removing, and hides the row from lists
     × tombstones a weigh-in and hides it from the list
     × tombstones a calorie entry and hides it from the list
     × drops a tombstoned entry from the list but keeps the row
AssertionError: expected null not to be null
      Tests  4 failed | 33 passed (37)

=== 6d: saveRun stops enqueuing ===
     × enqueues exactly one outbox row
AssertionError: expected +0 to be 1

=== 6d: updateWeekPlan lets the base win over the patch ===
     × merges a patch and bumps updatedAt
     × keeps both fields when two updates race
AssertionError: expected [ 3, 7 ] to deeply equal [ 3 ]

=== 6d: saveCalorieEntry reuses the date's existing row ===
     × allows several entries on one date
     × drops a tombstoned entry from the list but keeps the row
AssertionError: expected [ { …(7) } ] to have a length of 2 but got 1
```

### One new test did not discriminate, and was strengthened

As first written, `saveSettings / getSettings > returns undefined for a user with
no settings` was just `expect(await getSettings('nobody')).toBeUndefined()`. I
broke `getSettings` to ignore its argument
(`db.settings.toCollection().first()`), and:

```
=== 6d: getSettings ignores the user id and returns any row ===
      Tests  37 passed (37)
```

The test passed both before and after breaking its subject — the table was empty
in that test, so an empty result proved nothing. I rewrote it to save settings
for `u1` first and then assert that `'nobody'` still gets `undefined` while `u1`
gets its own row. Re-probed:

```
     × returns undefined for a user with no settings, even when another has some
AssertionError: expected { userId: 'u1', …(14) } to be undefined
      Tests  1 failed | 36 passed (37)
```

Every other new test in this wave failed on the first probe of its subject.

---

## Group 7 — naming — commit `674a640`

- `src/domain/streak.ts`: the `JokerCheck.weekPlanJokerUsedOn` doc comment now
  reads ``from the week plan of `date`'s own ISO week``.
- `src/domain/streak.test.ts`: **two** test names carried the same error, not one
  — `refuses when that date own ISO week has already spent its joker` and
  `allows yesterday across a week boundary, judged by that date own week`. Both
  fixed; the strings switched to double quotes to carry the apostrophe.
- `src/domain/checklist.test.ts`: `derives steps and water from logged amounts,
  not from ticks` → `satisfies steps and water once the logged amounts reach
  their targets`. Assertions untouched.

No negative-first evidence applies: these are comment and test-name strings with
no behaviour attached. `oxlint`, `tsc -b` and all 149 tests pass after them.

---

## Final state

```
 Test Files  9 passed (9)
      Tests  149 passed (149)
```

`npx tsc -b` → exit 0. `npx oxlint` → exit 0.

112 before this wave, 149 after: **37 new tests**, 2 rewritten in place
(the running average-pace fixture and the rollingAverage DST case), 3 renamed.

Constraint checks run at the end:

- no `any`, no non-null assertion in `src/domain/` implementations
- no `@/` alias in `src/domain/` or `src/shared/` implementations
- `src/shared/tables.ts` still has zero imports
- all 7 commits carry `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` as
  the last line after a blank line
- nothing under `docs/` touched; nothing under `.superpowers/` touched except
  this report, which the brief asked for

## Concerns

1. **Group 3 finding 3 was wrong.** `currentStreak`'s `>=` terminator was already
   covered by `never counts before startDate`, which does land the cursor on
   `startDate` and does catch the flip. I added the explicit case anyway, but the
   premise did not hold. Full evidence above.
2. **Three DST-named tests still cannot fail, even with `TZ` pinned.**
   `calendar.test.ts > is unaffected by the 25 October 2026 DST change` and
   `streak.test.ts > counts the 25 October 2026 DST day as exactly one day` both
   survive a local-midnight `diffDays`, because 25 October is the fall-back
   transition and both `floor` and `round` get a 25-hour day right. Only the
   spring-forward boundary (29 March) discriminates, which is why I moved the
   `rollingAverage` case there. Out of scope for this wave; worth a follow-up.
3. **`datesOfIsoWeek` still accepts week 53 in a 52-week year**, as instructed.
   `datesOfIsoWeek('2027-W53')` returns January 2028 dates. With `isoWeekOf` now
   correct, nothing in the domain *produces* such a key, so the only route in is
   a hand-written or stored key. Rejecting it needs an `isoWeeksInYear` helper.
4. **The unique indexes turn a silent split into a rejected promise, which no
   caller handles yet.** `saveWeight`, `updateDayLog` and `updateWeekPlan` read
   within the same transaction, so they cannot hit it. But Plan 4's pull path
   will apply server rows by id, and inserting a server row whose
   `(userId, date)` already exists locally under a different id will now
   *reject*. That is the correct, loud behaviour the finding asked for, and it is
   much better than the silent split — but the sync engine will need an explicit
   `ConstraintError` branch that merges the two rows by `updatedAt` rather than
   letting the transaction fail. Worth carrying into Plan 4's brief.
5. **`nowIso()`'s monotonic counter is per module instance.** It guards
   same-millisecond collisions within one tab, which is the case spec §7 drops.
   Two tabs of the same browser each hold their own counter, so they can still
   mint the same stamp; that collision is between different writes to possibly
   different records and is not what §7's strict comparison drops, but it is not
   eliminated either. If it matters later, the counter would need to live in
   `meta`.
