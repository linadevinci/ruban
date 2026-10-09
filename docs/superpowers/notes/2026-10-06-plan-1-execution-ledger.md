# SDD ledger — plan: docs/superpowers/plans/2026-10-06-ruban-1-foundation.md

Spec: docs/superpowers/specs/2026-10-06-coquette-tracker-design.md (read; binding authority)
Branch: phase-1 (branch in the main checkout, not a worktree — the user runs and
deploys the app from ~/site-sport, so a separate worktree directory would get in the way)
Harness note: no TodoWrite tool in this session. This ledger is the sole progress record.

## Pre-flight scan

### Cross-task rows (pairs sharing a file or an interface)

| A | B | A produces | B consumes | Found |
|---|---|---|---|---|
| T1 | T3-T11 | vite.config.ts (`@/` alias, test.include, environment:'node'), tsconfig strict + noUncheckedIndexedAccess | every test file and every `@/` import | OK. include globs `src/**/*.test.ts` cover `src/db/*.test.ts`. fake-indexeddb supplies IDB under environment:'node', so T10/T11 need no jsdom. |
| T2 | T3 | IsoDate, IsoWeek, Weekday | calendar.ts | OK (relative `./types` after the alias fix) |
| T2 | T4 | IsoDate, MIN_WEIGH_INS_FOR_AVERAGE | rollingAverage.ts | OK |
| T2 | T5 | Settings, IsoDate, IsoWeek | trajectory.ts | OK |
| T2 | T6 | Settings, WeekPlan, IsoDate, IsoWeek | budget.ts | OK |
| T2 | T7 | ChecklistItemId, DayLog, Settings, WeekPlan | checklist.ts | OK |
| T2 | T8 | IsoDate | streak.ts | OK |
| T2 | T9 | IsoWeek, Run | running.ts | OK |
| T2 | T10 | entity types + SyncedTableName (src/shared/tables.ts) | db/schema.ts | OK. shared/tables.ts has zero imports, as required by Plan 4. |
| T2 | T11 | DEFAULT_RUN_DAYS, DEFAULT_NO_DINNER_DAYS, Cycle | db/repos.ts | OK |
| T3 | T4 | diffDays | rollingAverage | OK |
| T3 | T5 | datesOfIsoWeek, diffDays | trajectory | OK |
| T3 | T6 | datesOfIsoWeek, weekdayOf | budget | OK |
| T3 | T7 | weekdayOf | checklist | OK |
| T3 | T8 | addDays, diffDays | streak | OK |
| T3 | T9 | datesOfIsoWeek | running | OK |
| T6 | T7 | dayAllowance, BudgetSettings | checklist (calories item) | OK — checklist importing budget is the only intra-domain dependency beyond calendar |
| T10 | T11 | db, enqueue, newId, nowIso | repos | OK, no file overlap (T10 creates schema/ids/outbox, T11 creates repos) |
| T10 | T11 | both own `src/db/*.test.ts` | — | FINDING F3 (below): T11's beforeEach clears a narrower set of tables than it writes |

### Self-agreement rows (does each task's own text agree with itself)

| Task | Tests vs code | Files created vs later touched | Found |
|---|---|---|---|
| T1 | smoke test created in Step 3, deleted in Step 4 | creates src/App.tsx (Plan 2 T11 deletes it — out of scope here) | OK |
| T2 | no test by design (types only; tsc is the check) | — | OK |
| T3 | verified by hand: W41 for 2026-10-06, W01 for 2025-12-29, Monday-first week, DST day | — | OK |
| T4 | **MISMATCH** | — | **FINDING F1** |
| T5 | **MISMATCH** | — | **FINDING F2** |
| T6 | verified: 5x1500+2x900, duplicate weekday harmless, floor order [daily, noDinner] matches impl | — | OK |
| T7 | verified all 13 cases against the rule table, incl. no-dinner allowance and missing-log | — | OK |
| T8 | verified streak + all 8 joker cases incl. week-boundary and pre-startDate | — | OK |
| T9 | verified pace rounding (305.6→5:06, 359.6→6:00) and pace-over-totals | — | OK |
| T10 | verified uuidv7 monotonic sort, settings single-row, outbox ++seq ordering | — | OK |
| T11 | produces saveCycle/listCycles with **no test** | — | **FINDING F3** |

### Findings and rulings

F1 — T4 rolling average: the test labels a weigh-in 7 days back ("2026-09-29" against
onDate "2026-10-06") as inside the window and expects it averaged, but the
implementation filters `age >= 0 && age < 7`. Spec §4.6 says "the trailing 7 calendar
days inclusive", i.e. {onDate-6 … onDate} — seven days, ages 0-6. So age 7 is correctly
excluded and the TEST is wrong; as written it would get 2 weigh-ins, fall below the
3-weigh-in minimum, return null, and fail.
Ruling: fix the test, not the code — shift the boundary case to 2026-09-30 (age 6, inside)
and keep a 2026-09-29 row asserting exclusion. Spec is the authority and the
implementation already matches it. Cost if wrong: the rolling average covers an 8-day
window instead of 7, biasing the displayed average slightly stale.

F2 — T5 trajectory: the test asserts `impliedWeeklyRate(s)` is `(3.7/37)*7` (positive)
but the implementation returns `(targetWeight - startWeight)/span*7`, which is negative
for weight loss. The doc comment says "Signed", and Onboarding renders
`kg(Math.abs(rate))`, so signed-negative is the intent and the TEST is wrong.
Ruling: fix the test to expect the negative value, and add a case asserting the sign is
negative when the target is below the start. Cost if wrong: the onboarding rate line
loses its sign, which only matters if a future screen stops calling Math.abs.
F3 — T11 repositories: `saveCycle` and `listCycles` are in the task's Produces list and
its implementation, but the task specifies no test for either, and its `beforeEach`
clears only dayLogs/weights/runs/weekPlans/outbox — omitting cycles, settings and
calorieEntries that the same file's helpers write.
Ruling: add a saveCycle/listCycles test to T11 and widen its beforeEach to clear every
table the file touches. An untested exported repo function violates the plan's own TDD
contract, and the narrow beforeEach is latent cross-test pollution. Cost if wrong:
nothing is lost; this only adds coverage.

Ruling — Task 1 executed by the controller, not a subagent. The user approved this
explicitly as reconnaissance: Task 1 installs every dependency, which is the first
chance to check the real installed APIs (Dexie EntityTable, React Router import path,
framer-motion package name, Drizzle setWhere, vite-plugin-pwa options) against what the
plans assume, and to patch drift across all five plans before any subagent reads them.
It also has an interactive prompt that subagents handle badly. Cost if wrong: controller
context spent on one mechanical task, and Task 1 skips the task-review gate.

## Execution

Task 1: complete (commit e8fad6a, controller-executed reconnaissance, no task review)

### Reconnaissance findings — library/toolchain drift, patched across all five plans (commit pending)

D1 (CRITICAL) — every task in all five plans used `npx tsc --noEmit` as its type-check
gate. The template's root `tsconfig.json` is references-only (`files: []`), so that
command type-checks nothing: a deliberate `const broken: number = "nope"` passed it with
exit 0 and failed `npx tsc -b` with exit 2. 16 occurrences replaced with `tsc -b`.
Ruling: without this, every subagent for ~50 tasks would have reported a clean type check
having never type-checked anything. Cost if wrong: none; `tsc -b` is strictly stronger.

D2 — the scaffold is much newer than assumed: Vite 8 (not 6), TypeScript 6 (not 5),
plugin-react 6, Vitest 5, oxlint instead of eslint, and `compilerOptions` live in
`tsconfig.app.json` with a references-only root. The plan's "add to tsconfig.json
compilerOptions" instruction had no target. Patched into Global Constraints.

D3 — `paths` targets need a leading `./` when `baseUrl` is unset (TS5090). Plan said
`["src/*"]`; actual working value is `["./src/*"]`.

D4 — the template enables `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`
and `noUnusedParameters`, none of which the plans accounted for. Recorded in Global
Constraints: type-only imports must be `import type`, no enums or parameter properties,
unused destructured bindings must be `_`-prefixed.

D5 — Plan 4 installed `@types/bcryptjs`, which npm publishes only as a deprecated stub
("bcryptjs provides its own type definitions"). Removed; bcryptjs 3 ships its own types.

D6 — Plan 4 added `api/**/*.test.ts` to vitest but nothing to any tsconfig, and
`tsconfig.node.json` includes only `vite.config.ts` and is not strict. `tsc -b` would
never have checked a serverless function. Patched to include `api/**` and `db/**` + strict.

D7 — `vite-plugin-pwa` 2.x peers on `workbox-build` and `workbox-window`, which Plan 5
did not install. Added. Confirmed it accepts Vite 8.

D8 — Plan 5 told the implementer to add `"WebWorker"` to `compilerOptions.lib` in
`tsconfig.json`: wrong file, and DOM+WebWorker together conflict. Replaced with an
explicit do-not, since `sw.ts` already scopes worker types via a triple-slash reference.
Also changed "add vite-plugin-pwa/client to types" to *append*, not replace.

Verified compatible, no change needed: Dexie `EntityTable` exists (4.4.6); `uuidv7` named
export exists (1.2.1); `vitest/config` exists; framer-motion 14 peers on React 19;
react-router 8 peers on React >=19.2.7 (have 19.2.8).

Deferred to their own tasks (need the package installed to confirm): Drizzle's
`onConflictDoUpdate({ setWhere })` signature in drizzle-orm 0.45 (Plan 4 Task 5), and the
`@vite-pwa/assets-generator` CLI name (Plan 5 Task 1).

Task 2: dispatched (haiku, BASE=cb0339f) — types + shared/tables, no test by design (tsc is the check)
Task 2: implementer DONE (commit fd46562); reviewer dispatched (sonnet)

Task 2: review returned spec ✅ / quality Approved, with one Important finding
(plan-mandated) and two Minors.

Ruling: `Settings` not extending `SyncedRow` is correct and stays. settings is a
per-user singleton keyed by userId — the user id IS the key, and it is never
tombstoned, since deleting settings means deleting the account. The reviewer's stated
risk ("a generic layer walking SyncedTableName will fail on row.id/row.deletedAt") does
not materialise: every such layer already branches on it — Dexie keys the table
`userId`, `keyOf()` in the sync engine and the `key` branch in api/sync.ts pick per
table, and softDelete's type excludes settings. So: no code defect.
But the finding is valid about the *cause* — the spec stated a blanket rule that
contradicted its own settings line, which is exactly what invites a future agent to
"fix" settings by adding an id and silently break its primary key in Dexie and Postgres.
Fixed at the source: spec §5 now names the exception and forbids that change.
Cost if wrong: if some later layer really does need uniform row shape, settings needs a
synthetic id and a migration — cheap now, cheaper than an id nothing uses.

Ruling (second defect, found while checking the spec, not by the reviewer): the spec had
NO `cycles` table. I added it to Plans 1 and 4 in the previous session when covering
§4.9 and never back-ported it, so spec and plans had drifted. Added to spec §5 and the
table count corrected from nine to ten. Cost if wrong: none; this records what the plans
already build.

Task 2: minor (deferred): WeekPlan.runDays/noDinnerDays are mutable Weekday[] while the
DEFAULT_* constants are readonly — intentional, repos already copy with [...DEFAULT_*].
Task 2: fix round 1 dispatched (resumed original implementer) — document the settings singleton + the ISO-8601 format of updatedAt/deletedAt; no type or value changes. FIX_BASE=fd46562
Task 2: fix round 1 implemented (commit 886d199); scoped re-review dispatched (sonnet)
Task 2: fix round 1/5 (2 addressed, 0 open; commits fd46562..886d199)
Task 2: complete (commits cb0339f..886d199, review clean)
Task 3: dispatched (haiku, BASE=886d199) — calendar arithmetic, TDD required
Task 3: implementer DONE (commit 9d6af50, 12/12); reviewer dispatched (sonnet)
Task 3: complete (commits 886d199..9d6af50, review clean — reviewer independently
  re-derived the ISO-week arithmetic for 2026-10-06 → W41 and 2025-12-29 → 2026-W01,
  and confirmed the UTC-noon invariant at every Date construction)
Task 3: minor (deferred): isoWeekOf/datesOfIsoWeek inverse property is only tested on a
  mid-year week (2026-W44); a year-boundary week (2026-W01 → starts 2025-12-29) and a
  53-week year (2026-W53) would prove it. Arithmetic is correct; the tests don't show it.
Task 3: minor (deferred): todayIn depends on the en-CA locale yielding YYYY-MM-DD, and
  throws RangeError on an invalid IANA tz. Callers reading a stored timezone should guard.
Task 3: minor (deferred): datesOfIsoWeek does not validate its input; a malformed IsoWeek
  yields NaN dates.

Ruling: subagent commits carry a Co-Authored-By trailer naming their own model, because
the briefs' commit commands specify no trailer and each implementer invents one. The
project's required trailer is `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
Not rewriting 9d6af50 or fd46562/886d199 — their SHAs are referenced by review artifacts
and the ledger, and a history rewrite to correct a trailer costs more than it fixes.
Every dispatch from Task 4 on states the exact trailer. Cost if wrong: three early
commits carry a wrong co-author line; `git log` still attributes the work correctly.
Task 4: dispatched (haiku, BASE=9d6af50) — rolling average, TDD required

Ruling: Tasks 4 and 5 batched into one implementer dispatch instead of two. Both are leaf
pure-domain modules — nothing in Plan 1 imports either, and they do not import each other
— so a finding on one cannot invalidate the other and the review surface stays separable
per module. The skill reserves per-task dispatch for work needing its own judgment, tests
or review surface; these need their own tests but not their own judgment, since both
briefs carry the complete code. Batching halves the agent seats for identical work.
Not batching further: Task 7 imports Task 6, so those stay sequential, and Task 8 is the
densest logic in the plan so it gets its own dispatch. Cost if wrong: a finding in one
module drags the other into the same fix round, costing one extra round at most.
Tasks 4-5: implementer DONE (commits f0c9beb, e41692d; 6/6 and 12/12); batch reviewer dispatched (sonnet)
Tasks 4-5: complete (commits 9d6af50..e41692d, review clean — both approved; reviewer
  re-derived the window boundary, the trajectory clamping and the Sunday lookup itself)
  ⚠️ items resolved by controller: commit trailers confirmed correct
  (Co-Authored-By: Claude Opus 5) on both commits; full suite independently re-run —
  30/30 passing across 3 files, npx tsc -b exit 0. 12+6+12 matches the briefs exactly.
Tasks 4-5: minor (deferred): the implementer's report stated file line counts that
  contradicted its own diff (claimed 356 total vs 197 actual insertions). Code was fine,
  but it means report numbers are not evidence — later dispatches now say so explicitly.
Tasks 4-5: minor (deferred): rollingAverage.ts local `window` shadows the DOM global, and
  the literal 7 is unnamed — both plan-mandated.
Tasks 4-5: minor (deferred): the DST case in rollingAverage.test.ts does not discriminate;
  real DST protection lives in calendar.test.ts via UTC-noon diffDays.
Tasks 4-5: minor (deferred): trajectory.ts `?? dates[0] ?? startDate` fallback is
  unreachable, present only to satisfy noUncheckedIndexedAccess.
Tasks 4-5: minor (deferred): daysUntil and isCycleComplete lack doc comments.
Task 6: dispatched (haiku, BASE=e41692d) — calorie budget, TDD required. Dispatch
  restates the owner's calorie-model decision (weekly total FALLS on no-dinner days,
  never redistribute) since inverting it would be this module's worst failure mode.

Task 6: implementer returned NEEDS_CONTEXT with a genuine arithmetic contradiction in the
brief — 10/12 passing, the two weeklyRemaining cases failing. It was correct, and it did
the right thing: it escalated instead of editing the test to match, which is exactly the
behaviour the dispatch asked for.

Ruling: the plan was wrong, not the implementation. My expectations (1800 and -300 against
consumed 6900/9000) were computed against a weekly budget of 8700, which comes from
7 x 1500 - 2 x 900 — subtracting the whole no-dinner allowance twice instead of the 600
difference. The budget is 5 x 1500 + 2 x 900 = 9300. Corrected to 2400, and -300 against
consumed 9600 so the overshoot test still tests an actual overshoot. Plan patched, brief
regenerated, implementer resumed with the correction.
Cost if wrong: none — the corrected figures are arithmetically forced by weeklyBudget,
which has its own passing test.

Note on my own pre-flight scan: it recorded budget as "verified: 5x1500+2x900, duplicate
weekday harmless, floor order matches impl" — I checked weeklyBudget and floorWarnings and
never checked weeklyRemaining. The scan's table rows should be per-function for a module
with several, not per-module.
Checked the other plans for the same defect: Plans 2 and 3 express the same assertion
symbolically (5 * 1500 + 2 * 900 - consumed), so they are self-checking and unaffected.
Lesson carried into later dispatches: prefer symbolic expressions over hardcoded totals.

### Per-function arithmetic audit of the remaining briefs (prompted by the Task 6 defect)

Re-checked every numeric expectation in Tasks 7-11 by hand, looking for the same class of
error: a *derived* total hardcoded rather than expressed symbolically.

Task 7 (checklist) — no derived totals. Every number is a direct threshold comparison:
  1400 <= 1500 true; 1700 > 1500 false; on Wednesday 1000 > 900 false (no-dinner
  allowance); steps 8200 >= 8000 true and 7999 false; water 6 >= 6 true and 5 false. OK.
Task 8 (streak/joker) — date arithmetic only, no sums. Already verified in pre-flight. OK.
Task 9 (running) — verified each: pace 1500/5 = 300; formatPace 305.6 -> 306 -> "5:06" and
  359.6 -> 360 -> "6:00"; formatDuration 1720 -> "28:40" (28 min + 40 s), 59 -> "0:59",
  3661 -> "1:01:01"; weeklyRunSummary sessions 2 and totalKm 10.2 for W41 with 10-04 and
  10-12 excluded; average pace written symbolically as 3100 / 10. OK.
Task 10 (Dexie schema) — no arithmetic. OK.
Task 11 (repos) — no derived totals; assertions are identity and count based. OK.

Conclusion: Task 6 was the only brief in Plan 1 with a derived total hardcoded, and it is
now corrected. Plans 2 and 3 already express the equivalent assertion symbolically.
Task 6: complete (commits e41692d..0df1018, review clean — reviewer re-derived the week
  dates, the 9300 budget and both weeklyRemaining figures from dayAllowance upward, and
  confirmed no redistribution and that duplicate weekdays cannot double-count by
  construction). ⚠️ items resolved by controller: suite independently re-run 42/42 with
  npx tsc -b exit 0; commit trailer confirmed; datesOfIsoWeek's 7-Monday-first contract
  was verified in Task 3's review.
Task 6: minor (deferred): floorWarnings has no boundary test — it uses strict `<`, which is
  correct (an allowance equal to the floor warns nothing), but a flip to `<=` would still
  pass the suite. One case with calorieFloor equal to an allowance would pin it. Worth
  raising at the final review: this is a user-facing guard on a health-adjacent number.
Task 6: minor (deferred): dayAllowance and floorWarnings lack doc comments while the other
  two functions have them.
Task 7: dispatched (haiku, BASE=0df1018) — day-aware checklist and validation, TDD. First
  task with an intra-plan dependency: it imports dayAllowance/BudgetSettings from Task 6.
Task 7: implementer DONE (commit 06d6864, 17 new / 59 total — matches the brief case count 4+9+4); suite independently re-run 59/59, npx tsc -b exit 0, no any/non-null/alias leak. Reviewer dispatched (sonnet).
Task 7: complete (commits 0df1018..06d6864, review clean — reviewer worked the
  applicability table out by hand for all four named weekdays and confirmed the three
  high-risk constructs: explicit-undefined override so a stored false wins, the
  items.length > 0 guard against [].every() being true, and the no-dinner test using
  1000 kcal, which passes a 1500 allowance and fails a 900 one so it actually
  discriminates). ⚠️ resolved: trailer confirmed; tsc -b independently re-run exit 0.
Task 7: minor (deferred): checklist.test.ts "derives steps and water ... not from ticks"
  never sets ticks.steps/ticks.water, so the name overstates what it proves.
Task 7: minor (deferred): no test at calorieTotal === allowance, so a regression from <=
  to < would pass.

THEME for the final review (now flagged twice, so recording it as a pattern rather than
two isolated minors): comparison operators at their boundary are systematically untested.
Task 6's floorWarnings uses strict `<` with no equality case; Task 7's calories rule uses
`<=` with no equality case. Both are currently correct, and in both a flip of the operator
would pass the whole suite. The briefs are the cause — I wrote their test tables without
equality cases. Worth one sweep adding boundary cases across the domain layer rather than
patching them task by task.
Task 8: dispatched (haiku, BASE=06d6864) — streak and joker, TDD. Densest logic in the
  plan, so it gets its own dispatch rather than being batched.
Task 8: implementer DONE (commit 6483ce7, 20 new / 79 total — matches brief count 1+10+9); suite independently re-run 79/79, tsc -b exit 0, joker age bound confirmed as (age < 0 || age > 1). Reviewer dispatched (sonnet).
Task 8: complete (commits 06d6864..6483ce7, review clean — reviewer independently confirmed
  both loop terminators, the cursor selection, the rule-3 gap trace giving 2 not 3, and the
  joker age bound rejecting both sides. I traced the same two cases separately and agree.)
  ⚠️ resolved: diffDays sign convention is verified by Task 3's own tests and by my trace;
  commit trailer confirmed present with a blank line before it.
Task 8: minor (deferred): the implementer's report line counts are off by one on each file
  (claimed 59/132, actual 58/133). Second report in this plan with wrong figures — the
  dispatches already say to report only what was read off the terminal.
Task 8: minor (deferred): isCovered and canUseJoker lack doc comments; "date own ISO week"
  in a comment should read "date's own".
Task 8: minor (deferred): no test for today itself being jokered, nor a yesterday-start
  streak landing exactly on startDate (part of the boundary-test theme).

CARRY INTO PLAN 2 — rule 6 of the joker is effectively untested, and cannot be tested here.
canUseJoker receives `weekPlanJokerUsedOn` already resolved, so its test passes with null
regardless of whether the caller picked the right week. The rule that matters — that the
joker consulted belongs to the ISO week of the date being EXCUSED, not of today, which
differs when excusing a Sunday from a Monday — lives entirely in the caller. Plan 2's
useToday/Today must carry a test that excuses yesterday across a Monday boundary and
asserts the previous week's plan was the one consulted. Spec §4.4 depends on this.
Tasks 9-10: dispatched as one batch (haiku, BASE=6483ce7) — running metrics + Dexie schema.
  Independent of each other, different files, both with complete code in their briefs.

Ruling (commit message format): two commits have the Co-Authored-By trailer folded into
the SUBJECT line because no blank line separates them — 9d6af50 (also with the wrong model
name) and 6483ce7. Verified with `git log -1 --format='%s'` and
`%(trailers:key=Co-Authored-By,valueonly)`: for both, the subject runs to ~100 chars and
the trailer parses as empty. The other four commits (f0c9beb, e41692d, 0df1018, 06d6864)
parse correctly.
Decision: not rewriting history. Those SHAs are referenced by the ledger, by six review
package filenames and by every completion line above; rewriting to fix a trailer would
invalidate the whole audit trail for a cosmetic gain. Instead the cause is fixed forward —
every dispatch from Tasks 9-10 on states explicitly that a BLANK LINE must precede the
trailer. Surfacing it at branch finish so the user can decide, since a squash merge would
collapse it anyway.
Cost if wrong: two commits have an overlong subject and no machine-readable co-author;
`git log` still attributes the work correctly and the diffs are unaffected.
Tasks 9-10: implementer DONE (commits cda1d12, e2c6fd2; 10 and 7 new — both match their
  brief counts; 96/96 total). Suite independently re-run 96/96, npx tsc -b exit 0, all
  domain implementations alias-free, src/shared/tables.ts still zero-import.
Note: the blank-line-before-trailer instruction worked (subjects are short, trailers now
  parse non-empty), but the agent substituted its own model name — the trailers read
  "Claude Haiku 4.5" despite the dispatch giving the exact required string
  "Claude Opus 5 <noreply@anthropic.com>". Format fixed, content still wrong. Four commits
  now carry a wrong or unparseable co-author. Same ruling as before: not rewriting history
  over a trailer; surfacing at branch finish.
Tasks 9-10: batch reviewer dispatched (sonnet).
Tasks 9-10: complete (commits 6483ce7..e2c6fd2, review clean — both approved; reviewer
  independently checked every Dexie store string against its EntityTable key parameter,
  confirmed average pace is total-over-total with no divide-by-zero on an empty week, and
  confirmed enqueue never sets seq so ++seq preserves call order).
  ⚠️ resolved: fake-indexeddb is in package.json, committed back in Task 1 (hence absent
  from this diff); src/shared/tables.ts still has zero imports.

THEME for the final review, broadened from the earlier boundary-operator note — the real
class is NON-DISCRIMINATING TESTS: cases that would pass just as well against a wrong
implementation. Three instances so far, all caused by fixtures I wrote in the briefs:
  1. budget floorWarnings uses `<` with no equality case; a flip to `<=` passes.
  2. checklist calories uses `<=` with no equality case; a flip to `<` passes.
  3. running weeklyRunSummary's average-pace test uses EQUAL distances (5 km and 5 km), so
     a mean-of-per-run-paces implementation yields the identical 310 and passes. Unequal
     distances (e.g. 1 km in 240 s + 9 km in 3150 s) would separate the two algorithms.
Also weak rather than wrong: schema.test.ts's "tombstone op" case asserts only op ===
  'delete' without checking the payload carries deletedAt.
This is worth one deliberate sweep over the domain layer's tests rather than task-by-task
patches, and it is a better use of effort than broadening coverage: each of these tests
currently proves less than its name claims.
Task 11: dispatched (sonnet, BASE=e2c6fd2) — repositories. Largest brief in the plan (404
  lines, 11 exported functions, transactional) and the most interdependent, so it gets a
  standard-tier model rather than the cheap tier used for transcription tasks.

Task 11: implementer returned DONE_WITH_CONCERNS (commit ec58316, 14/14, 110/110) raising
two defects in the brief's own code. Both were real and both were mine.

Ruling (correctness, so addressed before review per the skill's DONE_WITH_CONCERNS path):
  (a) updateDayLog and updateWeekPlan read through getOrCreate* in one transaction and
      wrote in a second. The data write and the outbox row were atomic with each other,
      but the read-modify-write was not — so two rapid checklist taps could both read the
      old ticks and the later write would clobber the earlier tick. That defeats the exact
      tick-merging those functions exist for, and it is user-visible: tick two boxes
      quickly and one comes undone.
  (b) On a day with no log yet, the create enqueued one outbox row and the update another,
      contradicting this plan's own "exactly one outbox row per mutating call" criterion.
      Harmless for correctness under last-write-wins, but the criterion was the thing in
      the wrong.
Fix: both functions now read, merge, write and enqueue inside ONE transaction, building
the row with the patch pre-applied when none exists. getOrCreate* left unchanged — still
used directly elsewhere and correct. Added two tests that fail against the old shape: an
outbox-count assertion on a fresh day, and two racing updates that must both survive.
Plan patched and committed (2ab65a4), brief regenerated, implementer resumed.
Cost if wrong: the single transaction holds dayLogs and outbox slightly longer, which for
a single-user app is immaterial; the previous shape's cost was a silently lost tick.

Also committed in 2ab65a4: the Task 6 arithmetic correction, which I had left uncommitted
in the working tree. The implementer noticed it and correctly declined to stage it.
Task 11: fix round 1 implemented (commit 7365b26). Implementer ran both new tests against
  the OLD code first and they failed as intended — outbox count 2 instead of 1, and the
  race lost `course`. That negative-first evidence is what makes these two tests
  discriminating, which is exactly the weakness the non-discriminating-tests theme names.
  Suite independently re-run 112/112, npx tsc -b exit 0, updateDayLog confirmed to hold
  exactly one db.transaction and no getOrCreate call. Scoped re-review dispatched (sonnet).
Task 11: fix round 1/5 (2 addressed, 0 open; commits ec58316..7365b26)
Task 11: complete (commits e2c6fd2..7365b26, review clean)
  ⚠️ resolved by controller: the re-reviewer could not diff the new `base` fallback against
  the original create path, since that code sits outside the fix diff. I compared both
  field lists directly — they are character-for-character identical (id, userId, date,
  ticks:{}, steps:null, waterGlasses:null, jokered:false, validatedAt:null,
  bonusFiredAt:null, mood:null, energy:null, note:null, updatedAt, deletedAt:null). No
  field was dropped.
Task 11: minor (deferred): the `base` fallback sets updatedAt and the row sets it again, so
  the base value is redundant. Harmless.

PLAN 1 COMPLETE — 11 tasks, 17 commits on branch phase-1 from merge-base 196ad12,
112/112 tests passing across 9 files, npx tsc -b exit 0.
Final whole-branch review dispatched (opus, the most capable tier, per Model Selection).

## Final whole-branch review (opus) — Needs work before merge

Interrupted by the previous session ending; resumed and completed. Returned 1 Critical,
6 Important, 11 Minor, a full triage of all 19 deferred minors, and a declined-to-judge
list of 16 items.

CRITICAL C1 — isoWeekOf returns a week number one too high for every date in any ISO year
beginning on a Friday, Saturday or Sunday. VERIFIED INDEPENDENTLY by me before acting,
both algebraically and empirically: with k = day-of-year index of the ISO year's first
Thursday, the Thursday of week N sits at k + 7(N-1), so round(days/7) + 1 yields
N + round(k/7) — correct only while k <= 3, and k >= 4 exactly when 1 January is Fri/Sat/Sun.
A 2025-2030 sweep gives 728 mismatches against the correct ceil((days+1)/7) form, a
contiguous run from 2027-01-04 to 2028-12-31 (ISO years 2027 and 2028), and 728 failures of
the datesOfIsoWeek(isoWeekOf(d)).includes(d) inverse property. The ceil form: 0 failures
across 2020-2040. 2026-01-01 is a Thursday (k=0), which is the ONLY reason all 112 tests
are green — every fixture in the branch lives in 2026.
Consequence: the ISO week is the key addressing week plans, the weekly budget, the joker
reset, the run gauge and the weekly weight goal. From 2027-01-04 the run gauge reads zero
for the whole week, the weekly weight goal reads one week ahead, and 2027-12-31 resolves to
2027-W53 — a week that does not exist in a 52-week ISO year. Spec §4.9 prompts for a new
goal cycle from 13 Nov 2026, so a 2027 window is the expected next state, not a far edge.
Ruling: fix now, with the year-boundary property test the ledger had already flagged as
missing at Task 3 (deferred item 2). Cost if wrong: none — the ceil form is provably
equivalent for k <= 3 and correct for k >= 4.

Five of the review's findings were defects in the SPEC or PLANS, not the code. Fixed by me
in d51d487: spec §5 asked for uniqueness constraints its own client-UUIDv7 rule cannot
honour (recorded in full, Phase 1 mitigation marked as a guard, decision handed to Plan 4
with both candidate answers and what each contradicts); spec §7 documented an outbox shape
the code improved on (seq, not id — the ordering guarantee); Plan 1's Done-When over-claimed
§4 coverage; Plan 4's sync test cleared every table but cycles. Plus M4 (Task 2's Produces
list omitted the spec's remaining defaults) left as deferred.

ONE fix wave dispatched (opus, FIX_BASE=d51d487), per the skill's single-wave rule, in 7
ordered groups: C1 + calendar hardening; TZ pinned so four decorative DST cases can fail;
the four non-discriminating boundary tests; three new domain functions the review found had
no home (effectiveWeekPlan, dayCalorieTotal/weekCalorieTotal, totalDurationS); unique Dexie
indexes + monotonic nowIso + tombstone payload; repos (softDelete early-return, read-only
getDayLog/getWeekPlan, narrowed patch type, 6 untested functions incl. updateWeekPlan which
carries the joker invariant); two naming fixes.
The dispatch requires negative-first evidence for every new test — break the subject, watch
it fail, restore — which is the condition the reviewer set and the only thing that stops a
sweep against non-discriminating tests producing more of them.

Deliberately LEFT STANDING from the triage: items 1, 3 (tz-guard half, belongs with Plan 2's
first read of settings.timezone), 5, 6, 8, 9, 11, 14, 19, plus M8 (ChecklistSettings
requires an unused calorieFloor — narrowing it would ripple into dayAllowance's signature
and five screens' fixtures) and M10 (an oxlint no-restricted-imports rule on @/db/schema;
worth doing once screens exist, not now).

## Fix wave applied (7 commits, d51d487..674a640) — verified independently

149/149 tests (112 + 37 new), npx tsc -b exit 0, npx oxlint exit 0, tree clean. I re-ran all
three myself and spot-checked the five previously-broken dates: 2027-01-04 → 2027-W01,
2027-06-15 → 2027-W24, 2027-12-31 → 2027-W52, 2028-01-01 → 2027-W52, 2026-10-06 → 2026-W41,
and the inverse property now holds for 2027-06-15.

THE DECISIVE DATUM: with the wrong isoWeekOf restored, exactly 2 tests failed and 114 passed
— ALL 112 PRE-EXISTING TESTS PASSED AGAINST THE WRONG IMPLEMENTATION. The property test
reported exactly 728 failing dates starting 2027-01-04, matching my own sweep. That is the
clearest possible statement of what the original suite was worth on this function, and of
why the deferred "inverse property is only tested mid-year" minor should not have been
deferred.

The wave also self-caught a non-discriminating test of its own: `getSettings > returns
undefined for a user with no settings` passed both before and after breaking getSettings to
ignore its user id, because the table was empty so an empty result proved nothing. Rewritten
to save another user's settings first. That is the required method working as intended.

### Carry-forwards from the wave, applied by me (858b24f, d012d64)

Ruling — spec §4.1 named the wrong DST direction. 25 October is fall-back, and a wrong
implementation that parses at local midnight and floors still gets a 25-hour day right, so
six tests dated 25 October proved nothing. Spring forward (23-hour day) is where a day
silently disappears and is the only direction that discriminates. Spec now says so, requires
a pinned TZ, and keeps the October cases as regression documentation rather than proof.
Cost if wrong: none; the October cases remain.

Ruling — Plan 1's unique indexes change Plan 4's pull path. Putting a server row whose
natural key is held locally under a different id now rejects with ConstraintError instead of
silently duplicating. Plan 4's engine gains a ConstraintError branch resolving by client
updatedAt, tombstoning the loser and counting it, plus findByNaturalKey and a test, and
SyncOutcome gains `collisions`. Without this the outbox wedges on the first two-device
collision — the exact failure spec §5 records as unresolved. Cost if wrong: Plan 4 carries a
branch for a case a single-device user never hits.

Ruling — Plans 2 and 3 now read with getWeekPlan rather than getOrCreateWeekPlan, use
dayCalorieTotal/weekCalorieTotal instead of inline reduces, and render the run gauge's time
from totalDurationS. Today's own log deliberately keeps getOrCreate, with the reason stated
in the plan: the user is there to tick it, syncStamps writes to it regardless, and a row for
today is a real fact rather than an invented snapshot. buildTodayView's `plan` widened to
`WeekPlan | undefined` and resolves defaults through effectiveWeekPlan.
Cost if wrong: a week the user only browsed has no stored row, so a later feature wanting
"which weeks have I seen" would need its own record — which is correct anyway.

Noted, not changed: Plan 3's WeekPlanner test still reads back with getOrCreateWeekPlan,
where getWeekPlan expecting undefined would be a stronger assertion that an untouched week
was never created at all. Test detail in an unexecuted plan; left for its implementer.

Scoped re-review of the wave dispatched (opus, FIX_BASE=d51d487). Per the skill this is the
only re-review and there is no second fix wave; residuals get adjudicated and surfaced.

## Scoped re-review of the fix wave (opus) — All findings addressed; ready to merge

C1 and I1-I6 all ADDRESSED, judged structurally rather than from passing tests, plus all 12
minors. The re-reviewer re-derived C1's algebra independently (k = {3,2,1,0,6,5,4} for
Mon..Sun, so ceil((k+1)/7) = 1 for every k in 0..6 and the ceil form is N for all six, while
round(k/7) makes the old form N+1 exactly when k >= 4) and confirmed 728 is arithmetically
right: 2027+2028 is 731 days minus the 3 days of 2027-01-01..03 that belong to ISO 2026-W53.

Ruling — triage item 16 (currentStreak's `>=` boundary untested) was WRONG, and I am
recording it against my own name because I passed the reviewer's premise through without
checking it. The boundary was already covered: `never counts before startDate` lands the
cursor exactly on startDate (diffDays = 0) and fails under the flip with "expected 1 to be
2". Both the implementer and the re-reviewer traced it by hand and agree. The extra case the
wave added is harmless and better named. Cost if wrong: one redundant test.

### Residuals adjudicated (no second fix wave, per the skill)

Ruling — the unique indexes make an ALREADY-SPLIT database unopenable, not merely
reject-on-insert. Probed by the re-reviewer against real Dexie + fake-indexeddb: db.open()
rejects with AbortError/ConstraintError, and bumping to version(2) does NOT help, because
IndexedDB cannot build a unique index over data that already violates it. Latent here (Plan
1 has no runtime db consumer; nothing outside src/db imports a repo function and src/App.tsx
is still the Vite template). Carried to Plan 2 as a required precondition: a version(2)
upgrade that merges duplicates by updatedAt BEFORE declaring the unique index, plus a
db.open() rejection path, since nothing in src/ handles one today.
Cost if wrong: a user who somehow split a row before Plan 2 ships sees a dead app; no such
user exists, since no screen opens the database yet.

Ruling — todayIn's `?? ''` can return a malformed date like "2026--06" instead of throwing.
Carried to Plan 2 alongside the IANA-timezone guard rather than fixed here: both live in the
same function and both belong with the first code that reads settings.timezone. No realistic
input triggers it for numeric year/month/day. Cost if wrong: a malformed date would surface
as a wrong day rather than an error.

Ruling — a tombstoned dayLogs/weekPlans row has no resurrect path, and the unique index means
no fresh row can be created for that date, so updates would write to a row every read filters
out and the user's ticks would silently vanish. Only reachable once a pull can tombstone,
which is Plan 4. Carried there with the straightforward answer named (a local write to a
tombstoned natural key clears deletedAt rather than inserting) and a test required.

Ruling — Plan 1's own plan text still specified round(days/7)+1 and formatIsoDate. FIXED
immediately (a8c3f47) rather than carried: a future reader executing or consulting that plan
would have copied the Critical bug straight back. The replacement carries the derivation and
the reason it survived eleven reviews.

Carried as deferred, not fixed (recorded so they are not lost):
  - the property test's span (2026-2029) covers k=6 (2027) and k=5 (2028) but not k=4
    (1 January on a Sunday: 2023, 2034, 2040). The algebra, the re-reviewer's 2020-2040 sweep
    and my own all confirm the shipped form is correct there; only the regression net is thin.
    Starting the span at 2022-01-01 would close it.
  - only dayLogs' `&` is test-covered; dropping weights' or weekPlans' would still pass.
  - the two `writes nothing` tests take their counts on an EMPTY table, so they can only
    detect a write on the absent-row path. A read that returns an existing row and also wrote
    would be caught by nothing. One assertion (outbox.count() unchanged across a getDayLog on
    an existing row) closes it; recorded for Plan 2.
  - the two 25-October test names claim DST protection they cannot provide; the fix is
    spring-forward twins, not renaming them away.
  - nowIso's counter is per module instance, so two tabs can still mint the same stamp.
