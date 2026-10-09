# Ruban — design spec

**Date:** 2026-10-06
**Status:** approved (brainstorming complete, pending implementation plan)
**Working title:** Ruban (French for *ribbon*, after the bow motif). Renameable at any point; nothing depends on it.

## 1. Purpose

A personal, installable web app (PWA) that drives one person's daily habit loop towards a weight and fitness goal dated **12 November 2026** — 37 days from the spec date. It tracks a daily checklist with a streak, weight against a target trajectory, a weekly calorie budget, and running volume. It must be pleasant enough to open five times a day; the aesthetic is load-bearing, not decoration.

Single-user by intent, but the data model is multi-user-capable because auth requires it anyway.

## 2. Decisions

These were settled during brainstorming. They are not open for re-litigation during implementation; changing one means revisiting this spec.

| Decision | Choice | Notes |
|---|---|---|
| Hosting | Vercel, Hobby (free) plan | Non-commercial use; deployment password protection unavailable |
| Stack | Vite + React + TypeScript SPA, Vercel serverless functions under `/api` | Local-first app has nothing to server-render; Next.js SSR/RSC would be paid for and unused |
| Data location | Full cloud sync, with local-first reads/writes | |
| Local store | IndexedDB via Dexie | Working copy; UI never waits on network |
| Server store | Postgres on Neon (free tier) via Drizzle ORM | Preferred over Supabase: auth is hand-rolled, so Supabase's main advantage does not apply, and Neon does not pause projects for inactivity |
| Sync model | Last-write-wins per record on `updated_at` | Honest for one person on one device; CRDTs rejected as over-engineering |
| Auth | Username + password, **no email**, bcrypt cost 12, JWT in httpOnly cookie | Hand-rolled (~80 lines) rather than bending an email-centric provider into a username shape |
| Password recovery | One-time recovery code shown at signup, stored hashed | No email means no reset link; without this, a forgotten password destroys the data |
| Reminder scheduling | Hourly GitHub Actions workflow POSTing to `/api/cron/reminders` | Vercel Hobby crons are limited to 2 jobs at hour granularity; GitHub Actions is free and the endpoint does the timezone thinking |
| Calorie model | Fixed per-day allowances; weekly total **falls** on no-dinner days | User's explicit choice over the redistribute-the-surplus alternative. Friday/Saturday stay at the plain daily target |
| Food logging | Daily total plus optional labelled quick-add entries | No food database, no barcode scanning |
| Steps | Manual entry, counts towards day validation | Browsers cannot read Apple Health or Google Fit. Hard limitation, accepted |
| Joker | Manual, usable on today or yesterday only, one per ISO week, day stays visibly marked | Rejected: automatic spending, and invisible marking |
| End of cycle | On `goal_date + 1`, archive the cycle with a summary and prompt for a new goal | |
| Aesthetic | Pink coquette, designer's discretion, reviewed early against a real screen | "mplus" in the original brief was a typo and carries no meaning |
| Typography | Cormorant Garamond (display) + Jost (UI, body, labels); Caveat sparingly | Chosen over Cormorant + Nunito from rendered specimens of five candidates; see §10 |
| UI language | French, tutoiement | |

## 3. Scope

### Phase 1 — the daily loop (ship first, use immediately)
Onboarding and auth with recovery code; day-aware checklist with bow ticks and reward animations; streak and weekly joker; countdown to 12 November; weight tracking with 7-day rolling average against the target trajectory; weekly calorie budget with the no-dinner planner and quick-add entries; run logging with the weekly gauge; PWA install, offline operation and sync; push notifications via the hourly dispatcher; the design system.

### Phase 2 — scheduling and nudges
The run planner over the default Mon/Tue/Thu + Sat/Sun template; slot-swapping to recover a missed session within the week; pilates and other complementary classes with their own slots.

### Phase 3 — motivation and reflection
Badges (7 days consecutive, 100 km cumulative, first complete week); user-defined custom rewards tied to milestones; Sunday *bilan* with a weekly score; progress photos; body measurements; mood and energy notes; full data export; the "salle" mode that substitutes strength sessions for some runs.

### Explicitly out of scope
Food database or barcode search; health-platform integration; social or sharing features; multi-user households; native apps; anything resembling medical or nutritional advice. The app reports the numbers its user enters and the targets its user sets.

## 4. Domain rules

Normative. These live in `src/domain/` as pure functions and are the primary test surface.

### 4.1 Time

A "day" is a local calendar date (`YYYY-MM-DD`). Weeks are ISO weeks beginning Monday, per French convention.

Exactly one function converts an instant into a local date: `todayIn(tz)`, built on `Intl.DateTimeFormat` with the user's stored IANA timezone — never UTC, never the browser's ambient zone. Every other date operation is pure calendar arithmetic over `YYYY-MM-DD` strings, parsed at **UTC noon** so no shift can cross a date boundary. Timezones and DST therefore cannot reach the rest of the domain layer, which is why no date library is required.

**European DST ends on Sunday 25 October 2026**, inside the goal window, and begins again on Sunday 29 March. Both dates get test cases.

**A correction worth carrying, found while hardening the tests:** 25 October is the *fall-back* transition, and a wrong implementation — one that parses dates at local midnight and floors the difference — still gets a 25-hour day right. So a test dated 25 October passes whether the code is correct or not, which is why six such cases sat in the suite proving nothing. **Spring forward is the direction that discriminates:** a 23-hour day is where local-midnight parsing rounds to zero and a day silently disappears. Date tests that mean to prove DST safety must use a spring-forward window (29 March 2026, 28 March 2027), and the suite must pin `TZ` to a zone that observes it — under the default `TZ` even a correct assertion cannot fail. The 25 October cases are kept as regression documentation, not as proof.

### 4.2 The checklist is day-aware

Each day generates only the items that apply to it, derived from that week's `week_plan`:

| Item | Appears when | Satisfied when |
|---|---|---|
| `course` | the date is a planned run day | a run is logged for that date (auto-ticks), or ticked manually |
| `calories` | always | auto-ticks once entries exist and the day's total ≤ its allowance; auto-unticks if the total passes it. A manual override is always permitted in either direction — this is a self-report system, not an audit |
| `no_dinner` | the date is marked no-dinner | ticked manually |
| `steps` | always | logged steps ≥ `step_target` |
| `water` | always | logged glasses ≥ `water_target` |

Defaults: run days Mon/Tue/Thu/Sat/Sun; no-dinner evenings Wed/Sun. Both editable per week.

A rest day therefore has a shorter list than a run day. This is intended behaviour.

### 4.3 Validation and the streak

A day is **validated** when every item applying to it is satisfied. On first validation, `day_logs.validated_at` is **stamped** with the timestamp.

Validation is stamped rather than derived because targets are mutable: re-deriving would let a raised `step_target` in November retroactively un-validate October and silently destroy an earned streak. Stamps record what happened; settings describe what is currently asked.

A date is **covered** when `validated_at IS NOT NULL OR jokered = true`.

```
streak = length of the longest run of consecutive covered dates
         ending at today      if today is covered
         ending at yesterday   otherwise
         0                     if neither today nor yesterday is covered
```

Dates before `settings.start_date` never count.

### 4.4 The joker

One per ISO week, recorded as `week_plans.joker_used_on`, reset implicitly by the week key. Offered only on an uncovered day that is today or yesterday — never further back, because a retroactive excuse hollows out the streak it exists to protect. Spending it sets `day_logs.jokered = true`.

A jokered day is covered but **not validated**: the streak survives, no full-day bonus fires, and the day renders with a distinct jokered mark in history.

### 4.5 Rewards

Two tiers. Per tick: a spring animation and an optional sound (default off — the app is used in public). Per completed day: a one-time celebration, guarded by `day_logs.bonus_fired_at` so it cannot re-fire on revisit or after a sync.

### 4.6 Weight

- `start_date` defaults to the onboarding date and stays editable in settings. It anchors both the trajectory and the earliest date the streak can reach.
- Cadence is `daily` or `weekly`, a user setting; it affects prompting only, never storage.
- **Target trajectory** is the straight line from `(start_date, start_weight)` to `(goal_date, target_weight)`.
- **This week's intermediate goal** is the trajectory's value on that ISO week's Sunday.
- **Rolling average** is the mean of weigh-ins within the trailing 7 calendar days inclusive. With fewer than 3 weigh-ins it is not drawn; the UI shows the raw value and *"pas encore assez de pesées"*.
- **Gap** = rolling average − trajectory value for today, rendered as *"0,4 kg d'avance"* / *"0,6 kg de retard"*.
- At onboarding, the implied weekly rate is displayed so the target is chosen knowingly. It is shown, never enforced, and never editorialised.

### 4.7 Calories

Per the chosen model, each day carries a fixed allowance:

```
allowance(day)   = day.no_dinner ? no_dinner_allowance : daily_target
weekly_budget    = Σ allowance(day) for the 7 days of the ISO week
weekly_remaining = weekly_budget − Σ kcal of the week's calorie_entries
```

A plain daily total is stored as a single unlabelled `calorie_entries` row, so the two logging styles share one code path and can be mixed within a week.

Toggling a no-dinner evening therefore moves the **weekly total**; the other days stay at `daily_target`.

`calorie_floor` is a settings-level guard: if `daily_target` or `no_dinner_allowance` falls below it, settings says so plainly. A negative `weekly_remaining` is displayed as an overshoot, not hidden.

Each `week_plan` is its own snapshot keyed by ISO week, so editing next week's evenings can never rewrite what a past week asked.

### 4.8 Running

Logged as date, distance (km) and duration (seconds); pace is derived (`duration_s / distance_km`, rendered mm:ss/km) and never stored. The weekly gauge counts runs in the ISO week against `settings.run_sessions_target` (default 5), alongside total km and the 5–7 km per-session range. Progression charts show pace over time and weekly km.

### 4.9 End of cycle

From `goal_date + 1`, the app presents a cycle summary — weight delta, run count and distance, longest streak, badges — files it as a completed cycle, and prompts for a new `goal_date` and `target_weight`.

## 5. Data model

Ten tables in Phase 1, mirrored between Dexie and Postgres. Every synced row carries a client-generated **UUIDv7** `id` (time-sortable, collision-free without a server round trip), an `updated_at`, and a `deleted_at` tombstone. **Nothing is ever hard-deleted** — a hard delete racing a pending sync resurrects the row.

**`settings` is the one exception, deliberately.** It is a per-user singleton keyed by `user_id`, so it carries no separate `id` — the user id *is* the key — and no `deleted_at`, because deleting your settings is deleting your account, not an operation the app offers. Every layer that walks the synced tables therefore branches on it: the Dexie table is keyed `userId`, the sync engine and the sync endpoint pick the key per table, and `softDelete`'s type signature excludes `settings` outright. Do not “fix” this by giving `settings` an `id`; that breaks its primary key in Dexie and Postgres both.

- `users` — id, username (unique), password_hash, recovery_code_hash, created_at
- `settings` — user_id (pk), timezone, start_date, start_weight, target_weight, goal_date, weigh_in_cadence, daily_calorie_target, no_dinner_allowance, calorie_floor, step_target, water_target, run_sessions_target, sound_enabled, updated_at
- `day_logs` — id, user_id, date, ticks (jsonb map of item → bool), steps, water_glasses, jokered, validated_at, bonus_fired_at, mood, energy, note, updated_at, deleted_at. Unique on (user_id, date)
- `weights` — id, user_id, date, kg, updated_at, deleted_at. Unique on (user_id, date)
- `calorie_entries` — id, user_id, date, label, kcal, updated_at, deleted_at
- `runs` — id, user_id, date, distance_km, duration_s, note, updated_at, deleted_at
- `week_plans` — id, user_id, iso_week (`2026-W41`), no_dinner_days (int[]), run_days (int[]), joker_used_on, updated_at. Unique on (user_id, iso_week)
- `cycles` — id, user_id, start_date, goal_date, start_weight, target_weight, end_weight, closed_at, updated_at, deleted_at. One row per closed goal period. Required by §4.9: starting a new goal overwrites `settings.start_date`, so without this the finished cycle's own boundaries are lost. Only the boundaries are stored — every figure in the summary stays derived from the day logs, runs and weigh-ins.
- `push_subscriptions` — id, user_id, endpoint, p256dh, auth, user_agent, created_at
- `reminders` — id, user_id, kind, days_of_week (int[]), local_time, enabled, updated_at

Server-only, not synced to the client:

- `sent_reminders` — user_id, date, kind. Unique together; makes the hourly dispatcher idempotent
- `login_attempts` — username, attempts, locked_until

`ticks` is a jsonb map rather than fixed columns so Phase 2's pilates and class items need no migration.

**The uniqueness constraints above and the client-generated-id rule are in tension, deliberately recorded rather than resolved here.** `day_logs`, `weights` and `week_plans` are singletons per key: one row per (user, date) or (user, ISO week). But each client mints its own UUIDv7, so two devices that open the app offline on the same day each create a *different* id for the same logical row. Locally both rows exist and a `.first()` lookup silently picks one, losing the other's data; on sync the second violates the unique constraint and the outbox stops draining.

Phase 1 mitigates this by declaring the Dexie compound indexes unique, which turns a silent split into a loud `ConstraintError` at the point of creation. That is a guard, not a fix. **Plan 4 must settle it before multi-device sync ships**, and the two candidate answers conflict with rules stated elsewhere in this document: either these three tables get a *deterministic* id derived from their key (contradicting the UUIDv7 rule above), or §7's merge gains a defined rule for two ids claiming one key (contradicting "conflicts are per record"). Until then the app is single-device-safe and multi-device-unsafe, which is acceptable only because §7's own premise is one person on one phone.

**Derived, never stored:** streak, rolling average, weekly budget and remaining, pace, trajectory values, badge eligibility. Computed on read so a settings change recalculates cleanly with nothing to fall out of sync. The deliberate exceptions are the event stamps `validated_at`, `bonus_fired_at` and `joker_used_on` — those are facts about what happened, not derivations from current settings.

## 6. Architecture

```
src/
  domain/      streak, validation, budget, trajectory, rollingAverage, pace, week
               — pure functions, no IO, no React
  db/          dexie schema, outbox, sync engine
  features/    onboarding/ today/ weight/ calories/ running/ settings/
  ui/          design system primitives
api/
  auth/        signup, login, recover
  sync.ts
  push/        subscribe
  cron/        reminders
db/            drizzle schema + migrations
.github/workflows/reminders.yml
```

A pure `domain/` layer is the central structural decision: the rules above are where the bugs will be and where the brief is most opinionated. Keeping them free of IO makes each one testable against a table of dates and numbers with nothing mocked.

Features own their screens and read through `db/`; they never reach into each other. `ui/` holds no business logic.

## 7. Sync protocol

Single endpoint, `POST /api/sync`, body `{ since, changes[] }`.

1. Every local write lands in a Dexie `outbox` row `{ seq, table, op, payload, created_at, attempts }` inside the same transaction as the data write, then the UI returns. **`seq` is an auto-increment integer, not a uuid** — that is what gives the queue its ordering guarantee, so replay happens in the order the writes were made. An opaque id would not, and ordering matters here: two edits to one field must reach the server in the order the user made them. The network is never on the critical path.
2. The server applies each incoming change **only where its `updated_at` is strictly newer** than the stored row's, then returns every row of that user changed since `since`.
3. The client applies the returned rows, clears the acknowledged outbox entries, and stores the new cursor.

**Cursors use server time; last-write-wins uses client time.** A skewed phone clock can misorder two edits to the same field — acceptable for one user — but must never cause a row to be *missed*, which a client-time cursor would allow.

Conflicts are per record, not per field. Tombstones sync like any other change.

## 8. Auth

Three endpoints: `signup` (username + password → bcrypt cost 12; generates a recovery code, displays it exactly once, stores only its hash), `login` (→ JWT via `jose` in an httpOnly, Secure, SameSite=Lax cookie, 90-day life), and `recover` (username + recovery code + new password).

`login_attempts` applies a per-username backoff. The deployment URL is public — Hobby has no password protection — so this is a requirement, not ceremony, even for a one-user app.

**Auth never gates launching the app.** The cookie is checked when syncing, not when opening. An expired session still permits ticking boxes offline; the app queues the writes and asks for a re-login when it next has connectivity and something to push.

## 9. Notifications

A VAPID keypair lives in Vercel environment variables; `web-push` sends from the server.

Subscription must originate in a user gesture, and **on iOS web push works only once the PWA is installed to the home screen**. The app therefore detects `display-mode: standalone` and walks the user through installing *before* offering to enable notifications, rather than requesting a permission that cannot be granted.

`.github/workflows/reminders.yml` runs **hourly** and POSTs to `/api/cron/reminders` with `CRON_SECRET` as a header. The endpoint converts to each user's timezone, selects the reminders due in that local hour, and writes `sent_reminders` to guarantee at-most-once delivery per `(user, date, kind)`.

Hourly polling rather than a precise schedule is deliberate: GitHub Actions crons are UTC-only with no DST awareness, so a fixed time silently shifts by an hour on 25 October 2026. Polling also survives travel, and a new reminder becomes a table row rather than a workflow edit. Cost is 24 trivial runs a day — unlimited on a public repo, roughly 700 of 2,000 free minutes a month if private.

Phase 1 reminders: *pas de dîner ce soir* on no-dinner evenings; an evening nudge when the day is not yet validated; the Sunday bilan.

## 10. Design system

**Palette.** Coquette is dustier and warmer than candy pink, which is the trap that makes this genre read as a toy. Blush paper ground `#F7E3E6`, cream card surfaces `#FFFBF7`, rose primary `#E89BB0`, cerise `#C2567A` for emphasis, and — the decision that carries the most weight — body text in deep plum-brown `#6E2B45` rather than black. A dark theme in plum-black with the roses raised in chroma, because the checklist gets ticked at 23h in bed. Both themes are first-class.

**Type.** Cormorant Garamond for display — the weight number, the streak count, the countdown — because a high-contrast serif at size reads as composed rather than cute. **Jost** for UI, body and labels: a geometric sans whose circular forms contrast with the serif instead of echoing it, and whose letterspaced small caps carry the uppercase labels. Caveat for handwritten notes, used perhaps three times in the entire app.

This pairing replaced Cormorant + Nunito after rendering five candidates on the real home screen. Nunito's rounded softness *agrees* with Cormorant rather than counterbalancing it, and two gentle voices read young rather than considered. Also rejected, with reasons, so they need not be revisited: **Bodoni Moda** (the most beautiful numerals of the five, but its hairlines fail at small sizes and in dark mode, so it could only ever be the big-number face); **Italiana** (a single weight, therefore no heading hierarchy anywhere); **Lora** as a body face (a serif on form labels and small numerals is lovely to read and tiring to use quickly).

**Signature.** A ticked box ties a bow: the checked state is a small SVG ribbon that springs in, not a checkmark. It costs nothing and it is the interaction felt five times a day. Around it: faint paper grain, generous radii, hairline rose borders, and a scalloped lace edge on the Today card — one motif, used once, so it reads as intentional rather than decorated.

**Motion.** Framer Motion. Spring on tick; a one-time shower of small bows and hearts on a completed day; a slow shimmer on the streak number. Everything behind `prefers-reduced-motion`, degrading to crossfades.

**Charts are hand-built in SVG, not library defaults** — a default chart theme would undo the entire aesthetic in one screen.

**Colour carries no meaning in any chart.** This is forced, not stylistic: the palette is deliberately monochromatic, and running the categorical-palette validator over it shows cerise and muted plum separating by ΔE 0.6 under protanopia and only 7.6 with normal vision, against a floor of 15. No pair of pinks can encode identity, and no re-stepping fixes it without leaving the palette. Identity is therefore carried entirely by **mark type**, with every mark in one hue family:

- **Raw weigh-ins** — small hollow circles, cerise stroke on a surface-coloured fill.
- **7-day rolling average** — 2px solid cerise line. Same entity as the dots, so deliberately the same colour.
- **Target trajectory** — 2px dashed line in muted ink. A *reference line*, not a series: recessive by design, direct-labelled at its right end.

Consequences that are requirements, not polish: no legend box (a single series is named by its title, and the reference line is direct-labelled); no gridlines except a hairline at each weekly target; every chart carries a "voir les chiffres" table view so values can be read without interpreting any mark; and a pointer/touch crosshair reports the date and value under the finger. **Never a dual-axis chart** — pace and weekly distance are two separate single-series charts, never two y-scales on one.

**Layout.** Mobile-first single column; bottom tab bar — Aujourd'hui / Poids / Calories / Course / Moi — safe-area aware; the countdown as a small persistent pill in the header. All copy French, tutoiement, warm without being saccharine.

## 11. Testing

Tests go where the rules are.

**Vitest over `src/domain/`**, table-driven: streak continuity across a spent joker; streak across 25 October 2026; validation when a day's applicable items differ; budget at 0, 1, 2 and 7 no-dinner days; trajectory before the first weigh-in; rolling average with gaps and with fewer than 3 points; pace formatting; ISO week boundaries across a year change.

**Sync engine against a fake server:** offline writes replay in order; last-write-wins in both directions; tombstones propagate; a mid-flight failure loses nothing; a skewed client clock never drops a row.

**Playwright, two flows only:** onboarding through first tick, and offline tick → reconnect → synced. Both run against the built app with `/api/*` routed to an in-page fake server, so they need no database and no deployment.

A third flow — install → push enabled — is deliberately **not** automated: Playwright cannot add a PWA to an iOS home screen, and on iOS push is impossible until it is there. An automated version would pass while proving nothing about the riskiest part of the project, so that flow is verified by hand on the real device. No coverage targets.

## 12. Risks

- **iOS web push** is the highest-risk item and cannot be fully verified without the real device. Mitigation: the install-first flow, and treating push as an enhancement the app works without.
- **DST on 25 October 2026** falls inside the goal window. Mitigated by routing all date handling through the stored timezone and by the hourly idempotent dispatcher; explicitly tested.
- **Free-tier drift.** Vercel and Neon change their limits. The cron design already avoids Vercel's cron limits entirely; the remaining exposure is Neon's storage ceiling, which this data volume will not approach.
- **Local-only data loss.** Cloud sync is the backup, which makes the sync engine the thing that must not be subtly wrong. Hence its own test suite, and Phase 3's export as the independent escape hatch.
