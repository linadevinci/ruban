# Ruban Plan 2 — The App You Can Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The design system, onboarding, and the Today screen — checklist with bow ticks, streak, joker, countdown, rewards — running local-only on Plan 1's domain and Dexie layers. At the end of this plan the app is in daily use.

**Architecture:** React reads Dexie through `dexie-react-hooks`' `useLiveQuery`, so a write anywhere re-renders every dependent screen with no state manager. Screens assemble plain values and hand them to Plan 1's pure functions; no rule is re-implemented in a component. The design system is CSS custom properties on `:root` plus a handful of primitives — no CSS framework.

**Tech Stack:** React 19, React Router 7, `dexie-react-hooks`, `framer-motion`, Vitest + `@testing-library/react` + jsdom. Web Audio API for the reward sound (no audio asset, so nothing to load or cache).

**Spec:** `docs/superpowers/specs/2026-10-06-coquette-tracker-design.md`

**Depends on:** Plan 1 complete (`docs/superpowers/plans/2026-10-06-ruban-1-foundation.md`).

**Dispatch note, for whoever runs two agents at once.** Mutation testing edits a source file in place, so two concurrent agents can collide in two ways that both produce false signals. First, the session scratchpad is shared: two agents each writing `mutate.py` overwrite each other, which happened during Tasks 7 and 9. Second, and worse, **a full `npm test` run by either agent can momentarily observe the other's live mutation** and report a failure that belongs to nobody. So: tell each agent to name its scratchpad files after its task, to run only the test files in its own scope while probing, and to take its final full-suite number with `git status --porcelain` showing nothing but its own files. Give concurrent agents non-overlapping files, and say in the dispatch which files the other one holds.

## Required before the first screen reads the database

Three items carried out of Plan 1's final review. All are latent there — Plan 1 has no
runtime database consumer — and all become reachable the moment a screen opens Dexie.

**Each is allocated to the task that first needs it: (1) → Task 5, (2) → Task 6, (3) → Task 7.** They were prose with no task until the pre-flight scan caught it — the same defect as a spec section with no owner.

1. **An open-failure path. The de-duplicating migration was dropped — deliberately, and here is why.**
   Plan 1's final review recommended a `version(2)` upgrade to merge duplicate `(userId, date)`
   rows, because making the index unique *in place* leaves an already-split database unopenable.
   That reasoning is sound but its premise does not hold here: **no such database can exist.**
   Verified before Task 5 was dispatched — nothing outside `src/db` has ever called `db.open()`,
   no non-test code imports a repo function, `src/App.tsx` is still the Vite template, and the
   project has never been deployed. The unique index landed before any consumer and before any
   release, so every database that will ever be created starts clean.

   Building the migration anyway would also be harder than it sounds: IndexedDB populates a
   unique index *during* the upgrade event and fails before any `upgrade` callback could clean
   up, so it would need a three-version chain (v2 non-unique plus a de-duplicating upgrade,
   then v3 unique) — real intricacy guarding a case that cannot arise.

   **If that ever changes** — if a release ships and a later version tightens an existing index
   to unique — the three-version chain above is the shape to use, and this note is the reason it
   is not here already.

   What *is* required is the open-failure path, which is not speculative: `db.open()` can reject
   for reasons that have nothing to do with constraints — private browsing with site data
   blocked, a storage quota refusal, a corrupted store. Nothing in `src/` handles a rejection
   today, so the first screen to open the database would render blank with an unhandled promise
   rejection in the console.

2. **Validate `settings.timezone` at its first read, and make `todayIn` fail loudly.**
   `todayIn` throws `RangeError` on an invalid IANA zone, and its `?? ''` fallback returns a
   malformed date such as `2026--06` if `formatToParts` ever omits a part rather than
   throwing. Both belong with the first code that reads a stored timezone, which is this
   plan.

3. **`getDayLog` and `getOrCreateDayLog` disagree about tombstones.** The read-only accessor
   returns `undefined` for a tombstoned row; the unchanged get-or-create pair returns that
   tombstoned row as if it were live. Harmless until a sync pull can tombstone a day log —
   which is Plan 4 — but this plan's screens use both, so decide deliberately which they
   call rather than discovering the divergence later.

## Global Constraints

- **Never assert a value is present with `.not.toBeNull()` on an optionally-chained read.** `expect((await getDayLog(u, d))?.validatedAt).not.toBeNull()` **passes when the row does not exist at all**, because `?.` yields `undefined` and `undefined` is not `null`. So a test meant to prove a write happened goes green against code that writes nothing. This was caught in Task 8 by a put-removal mutation that stayed green. Assert the type or the value instead — `expect(typeof x).toBe('string')`, or `expect(x).toBe(expected)` — both of which fail on `undefined`. The same trap applies to `.toBeTruthy()`, `.not.toBeUndefined()` on a `?.` chain, and `expect(rows.find(p)).not.toBeNull()`.
- **Never call a `getOrCreate*` repo function inside a `useLiveQuery` querier, or inside anything a querier awaits.** Every `getOrCreate*` opens `db.transaction('rw', ...)`, and Dexie's observability middleware throws `ReadOnlyError: Readwrite transaction in liveQuery context` on any non-readonly transaction in a querier — unconditionally, even when the row already exists and nothing would actually be written. The querier rejects, `useLiveQuery` stays `undefined` forever, and the screen never renders. **This is not theoretical: it shipped in Task 7 and made the Today screen unrenderable while 209 tests passed**, because every test exercised the pure view model and none exercised the hook. Read with the read-only accessor (`getDayLog`, `getWeekPlan`), resolve display defaults through a pure function, and let the `update*` form create the row on the first real edit — all of them already do `existing ?? newRow`.
  There is a second, independent reason, which Plan 3 states for the week planner and which I failed to carry back here: a reactive read that writes to the table it observes invents data nobody entered, and queues a sync push for a row the user never touched. Merely opening the app should not be a syncable event.
  **Any screen with a `useLiveQuery` needs tests that render the hook, assert a defined result, and seed at least one row in every table the querier reads.** Testing the pure view model alone cannot catch this class of failure — but a defined result is necessary, not sufficient. Task 7's six hook tests seeded only a settings row and today's own log, which left seven of the hook's own wiring lines free to be wrong: `getWeekPlan` could return `undefined`, `listDayLogs` could return `[]`, and all three date filters could go unfiltered, with 242 tests green. The `getWeekPlan` one re-ran an earlier Critical finding one level up — the view model was proven to use a stored week plan, while nothing proved the hook ever handed it one.
Identical to Plan 1's Global Constraints section — read it there; every item applies here. The ones this plan exercises directly:

- **Palette:** ground `#F7E3E6`, surface `#FFFBF7`, inset `#FDF2F4`, rose `#E89BB0`, cerise `#A64264`, ink `#6E2B45`, ink-soft `#8A5669`, line `#EDCCD6`. Dark: ground `#1B0F15`, surface `#2A1821`, inset `#231420`, ink `#F7E5EA`, ink-soft `#C098AA`, rose `#EFA6BA`, cerise `#F57FA6`, line `#412833`.
- **Type:** Cormorant Garamond (display — weight, streak, countdown), Jost (UI, body, labels), Caveat (sparingly). Never Nunito.
- **A ticked box ties a bow** — the checked state is an SVG ribbon, not a checkmark.
- **All copy French, tutoiement.** Decimal comma (`62,4`), thin-space thousands (`8 000`).
- **Every animation respects `prefers-reduced-motion`,** degrading to a crossfade.
- **Every text input sets `font-size: 16px` or larger.** The body scale is 0.95rem (~15.2px), and an input inheriting it makes iOS Safari zoom the page on focus — which on a one-handed checklist app reads as the layout jumping every time you tap a field.
- **`--rose` is a fill, never text** (1.75:1 on the ground). `--cerise` is the text accent.
- **Write every *confusable or invisible* character as a `\u` escape, and copy the escape sequence verbatim rather than resolving it to the character it denotes.** The ones that matter are the ones that look like an ASCII neighbour: U+202F narrow no-break space and U+00A0 no-break space (both look like a space), U+2212 minus and U+2014 em dash (both look like a hyphen), U+2019 right single quote (looks like an apostrophe), U+2026 ellipsis (looks like three dots) and U+00B7 middle dot. A literal is invisible in a diff and one normalisation away from becoming its ASCII lookalike. **The cause is the tooling, not carelessness, and I verified it directly: writing a single `\uXXXX` through either the file-writing tool or a shell heredoc lands the resolved character on disk, not the escape.** A quoted heredoc cannot be doing that, so the resolution happens above the shell. Only a *doubled* `\\uXXXX` in the command reaches disk as a real escape sequence. So I must withdraw an attribution: I recorded a defect against an implementer for "resolving an escape while transcribing" when it was handed `{'\u2212'}`, and this mechanism almost certainly did it. The two occasions I wrote literals into the plan myself were the same thing.
  **The recipe is path-dependent, and "just double it" is wrong for one path — I verified both.** Writing `\\uXXXX` *directly* into a source file (a heredoc, or a file-writing tool) lands **two** backslashes on disk, which in a TypeScript string is a literal backslash followed by `uXXXX`, not an escape at all: broken, and it type-checks. Writing `\\uXXXX` *through Python* lands one backslash plus `uXXXX`, a real escape: correct, because Python's own string unescaping collapses the doubling. So either write the file with Python, or write it doubled and then collapse with `LC_ALL=C sed -i 's/\\\\u/\\u/g'` — the sed text itself survives, since the resolver only rewrites un-escaped sequences. Then, whichever path, **verify the bytes** — a byte scan is the only check that catches this, because the runtime value is identical either way and every test still passes. `LC_ALL=C grep -nP '[^\x00-\x7F]' <file>` should show nothing but accented letters in French copy.
  **Accented letters are the exception and stay literal**: write `Poids de départ`, not `Poids de d\u00e9part`. An `é` is visibly distinct from any ASCII character, so it cannot be silently substituted, and escaping it would make every French string in the app unreadable. The shipped code already follows this split — literal accents, escaped `\u2019`. Code comments stay ASCII throughout, accents included.
- **Sound defaults off** (`settings.soundEnabled === false`).
- **No rule logic in components.** Components call `@/domain/*`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/tokens.css` | Palette, type scale and radii as custom properties, all three theme states. |
| `src/ui/base.css` | Reset, body, font loading, focus rings, safe-area padding. |
| `src/ui/Bow.tsx` | The ribbon glyph. Presentational only. |
| `src/ui/BowCheckbox.tsx` | Accessible checkbox whose checked state is a bow. |
| `src/ui/Card.tsx`, `src/ui/Button.tsx`, `src/ui/Pill.tsx`, `src/ui/Stepper.tsx` | Primitives. |
| `src/ui/format.ts` | French number and date formatting. Pure. |
| `src/ui/reward.ts` | Web Audio chime + confetti trigger. Honours reduced motion and the sound setting. |
| `src/app/session.ts` | Which local user is active; create one on first run. |
| `src/app/App.tsx` | Routes, bottom tab bar, onboarding gate. |
| `src/features/onboarding/Onboarding.tsx` | First-run form; writes the settings row. |
| `src/features/today/useToday.ts` | Assembles the Today view from repos + domain. The only place Today's data is gathered. |
| `src/features/today/Today.tsx` | The screen. |
| `src/features/today/Checklist.tsx` | The item list. |
| `src/features/today/StreakCard.tsx` | Streak, joker button, countdown. |

---

### Task 1: Design tokens and base stylesheet

**Files:**
- Create: `src/ui/tokens.css`, `src/ui/base.css`
- Modify: `index.html`, `src/main.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the custom properties `--ground --surface --inset --ink --ink-soft --rose --cerise --line`, `--font-display --font-ui --font-hand`, `--r-card --r-pill`, and `--step--1 … --step-4` on the type scale. Every later component reads only these.

- [ ] **Step 1: Write `src/ui/tokens.css`**

```css
:root {
  --ground: #F7E3E6;
  --surface: #FFFBF7;
  --inset: #FDF2F4;
  --ink: #6E2B45;
  --ink-soft: #8A5669;
  --rose: #E89BB0;
  --cerise: #A64264;
  --line: #EDCCD6;
  --on-rose: #43131F;

  --font-display: "Cormorant Garamond", Georgia, serif;
  --font-ui: "Jost", system-ui, -apple-system, sans-serif;
  --font-hand: "Caveat", cursive;

  --r-card: 20px;
  --r-pill: 999px;

  --step--1: 0.78rem;
  --step-0: 0.95rem;
  --step-1: 1.2rem;
  --step-2: 1.6rem;
  --step-3: 2.4rem;
  --step-4: 4rem;
}

/* System dark, with an explicit light choice still winning. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #1B0F15;
    --surface: #2A1821;
    --inset: #231420;
    --ink: #F7E5EA;
    --ink-soft: #C098AA;
    --rose: #EFA6BA;
    --cerise: #F57FA6;
    --line: #412833;
    --on-rose: #2A1821;
  }
}

/* Explicit dark choice wins over a light OS. */
:root[data-theme="dark"] {
  --ground: #1B0F15;
  --surface: #2A1821;
  --inset: #231420;
  --ink: #F7E5EA;
  --ink-soft: #C098AA;
  --rose: #EFA6BA;
  --cerise: #F57FA6;
  --line: #412833;
  --on-rose: #2A1821;
}
```

- [ ] **Step 2: Write `src/ui/base.css`**

```css
*, *::before, *::after { box-sizing: border-box; }

html, body { height: 100%; }

body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--step-0);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  /* faint paper grain */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E");
}

img { max-width: 100%; }
[hidden] { display: none !important; }

:where(button, a, input, [tabindex]):focus-visible {
  outline: 2px solid var(--cerise);
  outline-offset: 2px;
  border-radius: 4px;
}

.app {
  min-height: 100%;
  padding-inline: 18px;
  padding-block: calc(env(safe-area-inset-top, 0px) + 16px)
                 calc(env(safe-area-inset-bottom, 0px) + 92px);
  max-width: 560px;
  margin-inline: auto;
}

/* The lace edge: one motif, used once, on the Today card. */
.lace {
  height: 9px;
  background-image: radial-gradient(circle at 6px 9px, var(--rose) 4.6px, transparent 5.1px);
  background-size: 12px 9px;
  background-repeat: repeat-x;
}

.label {
  font-size: var(--step--1);
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.display { font-family: var(--font-display); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Load the fonts and stylesheets**

In `index.html`, inside `<head>`, replace the title and add:

```html
<title>Ruban</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&family=Cormorant+Garamond:wght@300;400;600&family=Jost:wght@400;500;600&display=swap">
```

In `src/main.tsx`, replace the `index.css` import with:

```ts
import '@/ui/tokens.css';
import '@/ui/base.css';
```

Delete `src/index.css` and `src/App.css`.

- [ ] **Step 4: Verify both themes render**

Run: `npm run dev`
Open the app, then toggle your OS between light and dark. Expected: the background changes between `#F7E3E6` and `#1B0F15` and text stays legible in both. A white background means `tokens.css` was not imported before `base.css`.

- [ ] **Step 5: Commit**

Also remove the single line `import './App.css';` from `src/App.tsx`. That file is the Vite
template placeholder and Task 11 deletes it outright, but it is still rendered until then, so
its stylesheet has to go with it here — otherwise the template's styles fight the design
system you just added, and `npm run build` fails outright on the unresolved import. Removing
one import line is not "modifying App.tsx" in any meaningful sense; leave the rest of it alone.

```bash
git add src/ui index.html src/main.tsx src/App.tsx
git rm -f src/index.css src/App.css
git commit -m "feat: add coquette design tokens and base stylesheet"
```

---

### Task 2: French formatting helpers

**Files:**
- Create: `src/ui/format.ts`
- Test: `src/ui/format.test.ts`

**Interfaces:**
- Consumes: `IsoDate` from `@/domain/types`; `parseIsoDate` from `@/domain/calendar`.
- Produces:
  - `kg(value: number): string` — `"62,4"`
  - `signedKg(value: number): string` — `"0,4 kg d'avance"` / `"0,6 kg de retard"` / `"pile sur la trajectoire"`
  - `kcal(value: number): string` — `"2 400"` with a narrow no-break space
  - `longDate(date: IsoDate): string` — `"mardi 6 octobre"`
  - `weekdayShort(date: IsoDate): string` — `"mar"`
  - `plural(n: number, one: string, many: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { kcal, kg, longDate, plural, signedKg, weekdayShort } from '@/ui/format';

describe('kg', () => {
  it('uses a decimal comma and one decimal place', () => {
    expect(kg(62.4)).toBe('62,4');
    expect(kg(62)).toBe('62,0');
    expect(kg(62.449)).toBe('62,4');
  });
});

describe('signedKg', () => {
  it('names ahead, behind and exactly on the line', () => {
    expect(signedKg(-0.4)).toBe("0,4 kg d'avance");
    expect(signedKg(0.6)).toBe('0,6 kg de retard');
    expect(signedKg(0)).toBe('pile sur la trajectoire');
  });

  it('treats a rounding-level difference as on the line', () => {
    expect(signedKg(0.04)).toBe('pile sur la trajectoire');
  });
});

describe('kcal', () => {
  it('groups thousands with a narrow no-break space', () => {
    expect(kcal(2400)).toBe('2\u202f400');
    expect(kcal(900)).toBe('900');
    expect(kcal(-300)).toBe('\u2212300');
  });
});

describe('longDate / weekdayShort', () => {
  it('formats in French without the year', () => {
    expect(longDate('2026-10-06')).toBe('mardi 6 octobre');
    expect(longDate('2026-11-12')).toBe('jeudi 12 novembre');
  });

  it('abbreviates the weekday', () => {
    expect(weekdayShort('2026-10-06')).toBe('mar');
  });
});

describe('plural', () => {
  it('treats zero and one as singular, per French usage', () => {
    expect(plural(0, 'jour', 'jours')).toBe('jour');
    expect(plural(1, 'jour', 'jours')).toBe('jour');
    expect(plural(2, 'jour', 'jours')).toBe('jours');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- format`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { parseIsoDate } from '@/domain/calendar';
import type { IsoDate } from '@/domain/types';

const NARROW_NBSP = '\u202f'; // narrow no-break space
const MINUS = '\u2212'; // true minus sign, not a hyphen

export function kg(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** Negative is ahead of the trajectory; positive is behind. */
export function signedKg(delta: number): string {
  if (Math.abs(delta) < 0.05) return 'pile sur la trajectoire';
  const magnitude = kg(Math.abs(delta));
  return delta < 0 ? `${magnitude} kg d'avance` : `${magnitude} kg de retard`;
}

export function kcal(value: number): string {
  const grouped = Math.abs(Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  return value < 0 ? `${MINUS}${grouped}` : grouped;
}

export function longDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(parseIsoDate(date));
}

export function weekdayShort(date: IsoDate): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' })
    .format(parseIsoDate(date))
    .replace('.', '');
}

/** French puts zero in the singular. */
export function plural(n: number, one: string, many: string): string {
  return Math.abs(n) < 2 ? one : many;
}
```

Note the `timeZone: 'UTC'` in both formatters: Plan 1 parses dates at UTC noon, so formatting must read them back in UTC or a westward browser zone would show the previous day.

- [ ] **Step 4: Run the tests**

Run: `npm test -- format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/format.ts src/ui/format.test.ts
git commit -m "feat: add French number and date formatting"
```

---

### Task 3: The bow checkbox

**Files:**
- Create: `src/ui/Bow.tsx`, `src/ui/BowCheckbox.tsx`, `src/ui/BowCheckbox.css`
- Test: `src/ui/BowCheckbox.test.tsx`

Install the React testing stack:

```bash
npm install framer-motion dexie-react-hooks react-router
npm install -D @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom jsdom
```

In `vite.config.ts`, **replace only the `environment: 'node'` line** with the two lines below. Leave `include` and `env` exactly as they are — in particular **keep `env: { TZ: 'Europe/Paris' }`**, which Plan 1's fix wave added so the DST cases can actually fail; dropping it silently returns them to proving nothing. Do not replace the whole `test` block, and do not add a second `environment` key (two would silently keep the first).

```ts
environment: 'jsdom',
setupFiles: ['./src/test-setup.ts'],
```

After editing, confirm the block still contains `include`, `env.TZ` and exactly one `environment` key.

Create `src/test-setup.ts`. **The `afterEach(cleanup)` is not optional:** vitest runs without
globals, so Testing Library cannot register its own automatic cleanup, and without this every
render leaks into the next test — the symptom is "found multiple elements with role checkbox"
across most of a file's cases.

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library cannot register its own
// automatic cleanup; without this, renders leak between tests.
afterEach(cleanup);
```

**Interfaces:**
- Consumes: nothing.
- Produces: `<Bow className?/>`, and `<BowCheckbox label checked onChange disabled? />` where `onChange: (next: boolean) => void`.

- [ ] **Step 1: Write the failing test**

```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BowCheckbox } from '@/ui/BowCheckbox';

describe('BowCheckbox', () => {
  it('exposes a real checkbox to assistive technology', () => {
    render(<BowCheckbox label="Course" checked={false} onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Course' });
    expect(box).not.toBeChecked();
  });

  it('reports the next value on click', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Course' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reports false when unticking', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Course' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('shows the bow only when checked', () => {
    const { rerender } = render(<BowCheckbox label="Course" checked={false} onChange={() => {}} />);
    expect(screen.queryByTestId('bow')).not.toBeInTheDocument();
    rerender(<BowCheckbox label="Course" checked onChange={() => {}} />);
    expect(screen.getByTestId('bow')).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked={false} onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Course' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is operable from the keyboard', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked={false} onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- BowCheckbox`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/ui/Bow.tsx`:

```tsx
export function Bow({ className }: { className?: string }) {
  return (
    <svg className={className} data-testid="bow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12c-1.6-2.6-4-4.2-6.2-3.6C3.9 8.9 3 10.4 3 12s.9 3.1 2.8 3.6C8 16.2 10.4 14.6 12 12z" />
      <path d="M12 12c1.6-2.6 4-4.2 6.2-3.6C20.1 8.9 21 10.4 21 12s-.9 3.1-2.8 3.6C16 16.2 13.6 14.6 12 12z" />
      <circle cx="12" cy="12" r="1.9" />
      <path d="M11 13.4 8.6 20.4l3.4-2.3 3.4 2.3L13 13.4z" />
    </svg>
  );
}
```

`src/ui/BowCheckbox.css`:

```css
.bowbox {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 11px 2px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.bowbox[aria-disabled="true"] { cursor: default; opacity: 0.55; }
.bowbox__mark {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1.6px solid var(--line);
  border-radius: 50%;
  background: var(--surface);
}
.bowbox--on .bowbox__mark { border-color: transparent; background: none; }
.bowbox__bow { width: 26px; height: 26px; fill: var(--cerise); }
.bowbox__label { flex: 1; }
.bowbox--on .bowbox__label { color: var(--ink); }
```

`src/ui/BowCheckbox.tsx`:

```tsx
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bow } from '@/ui/Bow';
import '@/ui/BowCheckbox.css';

export interface BowCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function BowCheckbox({ label, checked, onChange, disabled = false }: BowCheckboxProps) {
  const reduced = useReducedMotion();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      className={`bowbox${checked ? ' bowbox--on' : ''}`}
      onClick={() => { if (!disabled) onChange(!checked); }}
    >
      <span className="bowbox__mark">
        <AnimatePresence initial={false}>
          {checked && (
            <motion.span
              key="bow"
              initial={reduced ? { opacity: 0 } : { scale: 0.3, rotate: -18, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { scale: 1, rotate: 0, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              transition={reduced ? { duration: 0.01 } : { type: 'spring', stiffness: 520, damping: 17 }}
              style={{ display: 'grid' }}
            >
              <Bow className="bowbox__bow" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="bowbox__label">{label}</span>
    </button>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- BowCheckbox`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Bow.tsx src/ui/BowCheckbox.tsx src/ui/BowCheckbox.css src/ui/BowCheckbox.test.tsx src/test-setup.ts vite.config.ts package.json package-lock.json
git commit -m "feat: add the bow checkbox"
```

---

### Task 4: Remaining primitives

**Files:**
- Create: `src/ui/Card.tsx`, `src/ui/Button.tsx`, `src/ui/Pill.tsx`, `src/ui/Stepper.tsx`, `src/ui/primitives.css`
- Test: `src/ui/Stepper.test.tsx`

**Interfaces:**
- Produces:
  - `<Card laced? children />`
  - `<Button variant="solid" | "quiet" onClick children disabled? type? />`
  - `<Pill tone="rose" | "quiet" children />`
  - `<Stepper label value min max step onChange />` where `onChange: (next: number) => void`

- [ ] **Step 1: Write the failing test**

```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from '@/ui/Stepper';

describe('Stepper', () => {
  it('increments and decrements by the step', async () => {
    const onChange = vi.fn();
    render(<Stepper label="Eau" value={3} min={0} max={10} step={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(onChange).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByRole('button', { name: 'Diminuer Eau' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('clamps at both bounds', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper label="Eau" value={10} min={0} max={10} step={1} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(onChange).not.toHaveBeenCalled();

    rerender(<Stepper label="Eau" value={0} min={0} max={10} step={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Diminuer Eau' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stays enabled one step short of each bound, and reaches it exactly', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper label="Eau" value={9} min={0} max={10} step={1} onChange={onChange} />,
    );
    // A `>=` slip in the increment guard would wrongly disable this at max - step.
    await userEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(onChange).toHaveBeenCalledWith(10);

    onChange.mockClear();
    rerender(<Stepper label="Eau" value={1} min={0} max={10} step={1} onChange={onChange} />);
    // A `<=` slip in the decrement guard would wrongly disable this at min + step.
    await userEvent.click(screen.getByRole('button', { name: 'Diminuer Eau' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('shows the current value, and updates when it changes', () => {
    // Two distinct values, neither equal to min, max or step. A single
    // assertion at value={3} passes against a hardcoded 3, and against a
    // render of step, which is also 1 away. Re-rendering is what makes this
    // discriminate.
    const { rerender } = render(
      <Stepper label="Eau" value={7} min={0} max={10} step={1} onChange={() => {}} />,
    );
    expect(screen.getByText('7')).toBeInTheDocument();

    rerender(<Stepper label="Eau" value={2} min={0} max={10} step={1} onChange={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('7')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- Stepper`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the four primitives**

`src/ui/primitives.css`:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  overflow: hidden;
}
.card__body { padding: 18px; }

.btn {
  font: inherit;
  font-weight: 500;
  border-radius: var(--r-pill);
  padding: 11px 20px;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn:disabled { opacity: 0.5; cursor: default; }
.btn--solid { background: var(--cerise); color: var(--surface); }
.btn--quiet { background: none; color: var(--cerise); border-color: var(--line); }

.pill {
  display: inline-block;
  font-size: var(--step--1);
  font-weight: 600;
  letter-spacing: 0.04em;
  border-radius: var(--r-pill);
  padding: 3px 11px;
}
.pill--rose { background: var(--rose); color: var(--on-rose); }
.pill--quiet { background: var(--inset); color: var(--ink-soft); border: 1px solid var(--line); }

.stepper { display: flex; align-items: center; gap: 12px; }
.stepper__btn {
  width: 34px; height: 34px;
  display: grid; place-items: center;
  font: inherit; font-size: var(--step-1); line-height: 1;
  background: var(--inset); color: var(--ink);
  border: 1px solid var(--line); border-radius: 50%;
  cursor: pointer;
}
.stepper__btn:disabled { opacity: 0.4; cursor: default; }
.stepper__value {
  min-width: 2.5ch; text-align: center;
  font-family: var(--font-display); font-size: var(--step-2);
  font-variant-numeric: tabular-nums;
}
```

`src/ui/Card.tsx`:

```tsx
import type { ReactNode } from 'react';
import '@/ui/primitives.css';

export function Card({ laced = false, children }: { laced?: boolean; children: ReactNode }) {
  return (
    <section className="card">
      {laced && <div className="lace" />}
      <div className="card__body">{children}</div>
    </section>
  );
}
```

`src/ui/Button.tsx`:

```tsx
import type { ReactNode } from 'react';
import '@/ui/primitives.css';

export function Button({
  children, onClick, variant = 'solid', disabled = false, type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'solid' | 'quiet';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} className={`btn btn--${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
```

`src/ui/Pill.tsx`:

```tsx
import type { ReactNode } from 'react';
import '@/ui/primitives.css';

export function Pill({ children, tone = 'rose' }: { children: ReactNode; tone?: 'rose' | 'quiet' }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}
```

`src/ui/Stepper.tsx`:

```tsx
import '@/ui/primitives.css';

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}

export function Stepper({ label, value, min, max, step, onChange }: StepperProps) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Diminuer ${label}`}
        disabled={value - step < min}
        onClick={() => onChange(value - step)}
      >
        {'\u2212'}
      </button>
      <span className="stepper__value">{value}</span>
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Augmenter ${label}`}
        disabled={value + step > max}
        onClick={() => onChange(value + step)}
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- Stepper`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat: add card, button, pill and stepper primitives"
```

---

### Task 5: Local session

**Files:**
- Create: `src/app/session.ts`
- Test: `src/app/session.test.ts`

**Interfaces:**
- Consumes: `db` from `@/db/schema`, `newId` from `@/db/ids`.
- Produces:
  - `getCurrentUserId(): Promise<string | null>`
  - `ensureLocalUser(): Promise<string>` — creates and remembers a UUIDv7 on first run
  - `CURRENT_USER_KEY` (the meta key, exported for tests)
  - `openDatabase(): Promise<OpenResult>` in `src/db/schema.ts`, where `OpenResult` is `{ ok: true } | { ok: false; reason: 'blocked' | 'unknown'; error: unknown }` — see the code block below, which is authoritative

**This task also carries precondition 1, because it is the first code that opens the database.**

Plan 1 declared `dayLogs`, `weights` and `weekPlans` unique on their natural key *in place* under `version(1)`. That was probed against real Dexie: a database that already holds two rows sharing a `(userId, date)` **cannot be opened at all** — `db.open()` rejects with `AbortError`/`ConstraintError` — and **bumping the version alone does not fix it**, because IndexedDB cannot build a unique index over data that already violates it. So:

Add `openDatabase()` to `src/db/schema.ts`, wrapping `db.open()` so a rejection becomes a value
rather than an unhandled promise:

```ts
export type OpenResult =
  | { ok: true }
  | { ok: false; reason: 'blocked' | 'unknown'; error: unknown };

/**
 * Opens the database without throwing. db.open() can reject for reasons that have
 * nothing to do with the data: private browsing with site data blocked, a quota
 * refusal, a corrupted store. The first screen to open the database must be able
 * to say something to the user instead of rendering blank.
 */
export async function openDatabase(): Promise<OpenResult> {
  try {
    await db.open();
    return { ok: true };
  } catch (error) {
    // Read the name defensively. A throw inside this catch would defeat the
    // whole point of this function, and a rejection is not guaranteed to be an
    // Error - it can be any value. Duck-typed rather than instanceof Error,
    // because a DOMException is NOT an instanceof Error here: verified by
    // assertion under this project's test environment, and cross-realm
    // DOMExceptions (an iframe) behave the same way in real browsers. Using
    // instanceof would misclassify every blocked-storage failure as 'unknown',
    // which is precisely the case this function exists to report.
    const name = typeof error === 'object' && error !== null && 'name' in error
      ? error.name
      : undefined;
    const blocked = name === 'SecurityError'
      || name === 'QuotaExceededError'
      // Firefox's private-browsing failure, the classic one in practice.
      || name === 'InvalidStateError';
    return { ok: false, reason: blocked ? 'blocked' : 'unknown', error };
  }
}
```

**Do not add a `version(2)`.** See the note above for why the de-duplicating migration was
dropped.

Tests:
- A fresh database opens with `{ ok: true }`. **Call `db.close()` first** — the suite's
  `beforeEach` has already opened it, so without closing, this test passes even against an
  implementation that rethrows, which makes it worthless.
- `SecurityError`, `QuotaExceededError` and `InvalidStateError` each give
  `{ ok: false, reason: 'blocked' }` with `error` preserved by identity.
- A plain `Error` gives `'unknown'`.
- **A rejection that is not an `Error` at all** — reject with `null` — returns
  `{ ok: false, reason: 'unknown' }` and does **not** throw. This is the case that pins the
  defensive name read; `(error as { name?: string }).name` would raise a TypeError inside the
  catch and so defeat the entire function.

Prove the failure cases discriminate by making `openDatabase` rethrow instead of catching.

Also test `ensureLocalUser` under concurrency: `Promise.all([ensureLocalUser(),
ensureLocalUser()])` must return two equal ids. Confirm it fails against the
non-transactional form before the fix — and if `fake-indexeddb` will not interleave enough to
make it fail, say so rather than reporting it as proof.

Plan 4 claims this same id on the server at signup, so it is generated once here and never changes. That is the whole reason auth can be deferred without a migration.

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- session`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/session.ts src/app/session.test.ts
git commit -m "feat: add local session with a stable user id"
```

---

### Task 6: Onboarding

**Files:**
- Create: `src/features/onboarding/Onboarding.tsx`, `src/features/onboarding/Onboarding.css`
- Test: `src/features/onboarding/Onboarding.test.tsx`

**Interfaces:**
- Consumes: `ensureLocalUser`, `saveSettings`, `impliedWeeklyRate`, `todayIn`, `kg`, primitives.
- Produces: `<Onboarding onDone={() => void} />`

**This task also carries the write half of precondition 2. It is the first code to write a timezone — but not to read a stored one, which is where the real hazard is, so the read guard belongs to Task 7.** I allocated the whole precondition here and that was wrong: onboarding validates the *browser-detected* zone, while `useToday` is the first and only code that reads the zone back out of settings and hands it to `todayIn`. An unusable stored value (synced from another device in Plan 4, or a zone dropped from ICU) throws a `RangeError` inside a `useLiveQuery` querier, and there is no ErrorBoundary anywhere in `src/`, so the main screen goes white. Task 7 guards the read site.

Onboarding stores `Intl.DateTimeFormat().resolvedOptions().timeZone`, and every later screen reads it back and hands it to `todayIn`. Two gaps close here:

1. Add `isValidTimeZone(tz: string): boolean` to `src/domain/calendar.ts` — a `try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true } catch { return false }`. Onboarding falls back to `'UTC'` when the detected zone fails it, rather than storing a value that makes `todayIn` throw `RangeError` on every later render.
2. Make `todayIn` **throw** when `formatToParts` omits a part, instead of its current `?? ''`, which would return a malformed date such as `2026--06`. A wrong day is a bug; a malformed string that flows into every date comparison is worse.

Tests: `isValidTimeZone` accepts `'Europe/Paris'` and rejects `'Not/AZone'`; onboarding stores a non-empty, valid zone. Both are one-liners.

Fields, with defaults: poids de départ (empty), objectif (empty), date objectif (`2026-11-12`), cible calories (`1500`), allocation sans dîner (`900`), seuil minimum (`1200`), objectif de pas (`8000`), verres d'eau (`6`), sorties par semaine (`5`). Timezone is detected via `Intl.DateTimeFormat().resolvedOptions().timeZone` and not asked. `startDate` is today. The implied weekly rate is displayed live once both weights are entered — shown, never enforced, never editorialised.

- [ ] **Step 1: Write the failing test**

These cases are copied verbatim from the shipped `Onboarding.test.tsx`, not re-written by hand — an earlier hand-written back-port drifted from the real file, which is how the plan briefly lost the `isValidTimeZone` fallback. They are the versions that actually shipped, after Task 6's implementer found three defects in the originals: `/par semaine/` also matched the "Sorties par semaine" label and threw on multiple matches; the `onDone` assertion ran before the IndexedDB write landed, so it needed `waitFor`; and "refuses to submit" would have passed vacuously, before the guard could even run, until it waited on the error message first. The fifth case — the UTC fallback — was added because without it, deleting the fallback failed no test. Note how it stubs **only** the no-argument detection call and lets real formatter calls through; a blanket stub would break `todayIn` and `longDate` inside the same render.

```ts
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { isValidTimeZone } from '@/domain/calendar';
import { Onboarding } from '@/features/onboarding/Onboarding';

beforeEach(async () => {
  await db.open();
  await db.meta.clear();
  await db.settings.clear();
});

describe('Onboarding', () => {
  it('shows the implied weekly rate once both weights are entered', async () => {
    render(<Onboarding onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66');
    await userEvent.type(screen.getByLabelText('Objectif'), '62.3');
    expect(await screen.findByText(/kg par semaine/)).toBeInTheDocument();
  });

  it('refuses to submit without both weights', async () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    // The message proves submit ran and took the guard; without it the
    // assertions below would pass before any async write could land.
    expect(await screen.findByText(/poids de départ et ton objectif/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(await db.settings.count()).toBe(0);
  });

  it('writes a settings row and calls onDone', async () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66');
    await userEvent.type(screen.getByLabelText('Objectif'), '62.3');
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const settings = (await db.settings.toArray())[0];
    expect(settings?.startWeight).toBe(66);
    expect(settings?.targetWeight).toBe(62.3);
    expect(settings?.goalDate).toBe('2026-11-12');
    expect(settings?.dailyCalorieTarget).toBe(1500);
    expect(settings?.noDinnerAllowance).toBe(900);
    expect(settings?.runSessionsTarget).toBe(5);
    expect(settings?.soundEnabled).toBe(false);
    expect(settings?.timezone.length).toBeGreaterThan(0);
    expect(isValidTimeZone(settings?.timezone ?? '')).toBe(true);
  });

  it('accepts a decimal comma as well as a point', async () => {
    render(<Onboarding onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66,5');
    await userEvent.type(screen.getByLabelText('Objectif'), '62,3');
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    await waitFor(async () => expect(await db.settings.count()).toBe(1));
    expect((await db.settings.toArray())[0]?.startWeight).toBe(66.5);
  });

  it('refuses a cleared or non-numeric target, rather than saving 0 or NaN', async () => {
    render(<Onboarding onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66');
    await userEvent.type(screen.getByLabelText('Objectif'), '62.3');
    await userEvent.clear(screen.getByLabelText('Cible calories'));
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/objectifs/);
    expect(await db.settings.count()).toBe(0);

    await userEvent.type(screen.getByLabelText('Cible calories'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/objectifs/);
    expect(await db.settings.count()).toBe(0);
  });

  it('refuses an emptied goal date, which would otherwise store 1900-01-01', async () => {
    render(<Onboarding onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66');
    await userEvent.type(screen.getByLabelText('Objectif'), '62.3');
    await userEvent.clear(screen.getByLabelText('Date objectif'));
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/date objectif/);
    expect(await db.settings.count()).toBe(0);
  });

  it('survives a five-digit year in the date field and refuses to submit it', async () => {
    render(<Onboarding onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66');
    await userEvent.type(screen.getByLabelText('Objectif'), '62.3');
    // userEvent will not type an invalid date value into a date input.
    fireEvent.change(screen.getByLabelText('Date objectif'), { target: { value: '12026-01-01' } });
    // Still rendered: a throw during render would have removed the form.
    expect(screen.getByRole('button', { name: 'Commencer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/date objectif/);
    expect(await db.settings.count()).toBe(0);
  });

  it('announces its error to assistive technology', async () => {
    render(<Onboarding onDone={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    // role="alert" is what makes a screen reader say anything at all after a
    // failed submit; without it the message is visual only.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('falls back to UTC when the detected zone is unusable', async () => {
    const RealFormat = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      this: unknown, locale?: string | string[], options?: Intl.DateTimeFormatOptions,
    ) {
      const real = new RealFormat(locale, options);
      // Only the no-argument detection call is lied to; real calls pass through.
      if (locale === undefined && options === undefined) {
        return { resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone: 'Not/AZone' }) } as Intl.DateTimeFormat;
      }
      return real;
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      render(<Onboarding onDone={() => {}} />);
      await userEvent.type(screen.getByLabelText('Poids de départ'), '66');
      await userEvent.type(screen.getByLabelText('Objectif'), '62');
      await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
      await waitFor(async () => expect(await db.settings.count()).toBe(1));
    } finally {
      spy.mockRestore();
    }
    expect((await db.settings.toArray())[0]?.timezone).toBe('UTC');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- Onboarding`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/features/onboarding/Onboarding.css`:

```css
.onb { display: flex; flex-direction: column; gap: 22px; }
.onb h1 { font-family: var(--font-display); font-weight: 300; font-size: var(--step-3); margin: 0; }
.onb__intro { color: var(--ink-soft); margin: 0; }
.onb__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
.onb__field { display: flex; flex-direction: column; gap: 5px; }
.onb__field input {
  font: inherit;
  /* After `font: inherit`, which resets size. The body scale is 0.95rem and
     iOS Safari zooms the page on focusing anything under 16px. This rule also
     covers the date input, which sits inside the same label. */
  font-size: 16px;
  color: var(--ink);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 12px; padding: 10px 12px; width: 100%;
}
.onb__rate { font-family: var(--font-hand); font-size: var(--step-1); color: var(--cerise); margin: 0; }
.onb__err { color: var(--cerise); margin: 0; }
```

`src/features/onboarding/Onboarding.tsx`:

```tsx
import { useState } from 'react';
import { ensureLocalUser } from '@/app/session';
import { saveSettings } from '@/db/repos';
import { diffDays, isIsoDate, isValidTimeZone, todayIn } from '@/domain/calendar';
import { impliedWeeklyRate } from '@/domain/trajectory';
import { Button } from '@/ui/Button';
import { kg } from '@/ui/format';
import '@/features/onboarding/Onboarding.css';

/** Accepts "62,3" as well as "62.3". */
function parseDecimal(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(value) ? value : null;
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  inputMode?: 'decimal' | 'numeric';
}

function Field({ label, value, onChange, inputMode = 'decimal' }: NumberFieldProps) {
  const id = `onb-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label className="onb__field" htmlFor={id}>
      <span className="label">{label}</span>
      <input
        id={id}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // An unusable stored zone would make todayIn throw on every later render,
  // so a zone that fails isValidTimeZone is replaced before it is ever stored.
  const timezone = isValidTimeZone(detected) ? detected : 'UTC';
  const [startWeight, setStartWeight] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [goalDate, setGoalDate] = useState('2026-11-12');
  const [dailyCalorieTarget, setDaily] = useState('1500');
  const [noDinnerAllowance, setNoDinner] = useState('900');
  const [calorieFloor, setFloor] = useState('1200');
  const [stepTarget, setSteps] = useState('8000');
  const [waterTarget, setWater] = useState('6');
  const [runSessionsTarget, setRuns] = useState('5');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = parseDecimal(startWeight);
  const target = parseDecimal(targetWeight);
  const startDate = todayIn(timezone);

  // Guarded on goalDate too: parseIsoDate throws on a malformed date, so
  // computing this during render with an emptied date field would blank the
  // screen rather than show a wrong number.
  // isIsoDate, not `!== ''`: a date input can emit a 5-digit year, which the
  // now-strict parseIsoDate would reject by throwing - during render, blanking
  // the screen on the app's very first form.
  const rate = start !== null && target !== null && isIsoDate(goalDate)
    ? impliedWeeklyRate({ startDate, startWeight: start, targetWeight: target, goalDate })
    : null;

  async function submit() {
    if (busy) return;
    if (start === null || start <= 0 || target === null || target <= 0) {
      setError('Il me faut ton poids de départ et ton objectif.');
      return;
    }
    if (!isIsoDate(goalDate) || diffDays(startDate, goalDate) <= 0) {
      setError('Il me faut une date objectif, après aujourd\u2019hui.');
      return;
    }
    // The six target fields are plain text inputs, and inputMode does nothing on
    // a desktop keyboard. Number('') is 0 and Number('abc') is NaN, either of
    // which would be written into the one settings row every screen reads.
    const daily = parseDecimal(dailyCalorieTarget);
    const noDinner = parseDecimal(noDinnerAllowance);
    const floor = parseDecimal(calorieFloor);
    const steps = parseDecimal(stepTarget);
    const water = parseDecimal(waterTarget);
    const runs = parseDecimal(runSessionsTarget);
    if (
      daily === null || noDinner === null || floor === null
      || steps === null || water === null || runs === null
      || daily <= 0 || noDinner <= 0 || floor <= 0
      || steps <= 0 || water <= 0 || runs <= 0
    ) {
      setError('Un de tes objectifs n\u2019est pas un nombre valide.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
    const userId = await ensureLocalUser();
    await saveSettings({
      userId,
      timezone,
      startDate,
      startWeight: start,
      targetWeight: target,
      goalDate,
      weighInCadence: 'daily',
      dailyCalorieTarget: daily,
      noDinnerAllowance: noDinner,
      calorieFloor: floor,
      stepTarget: steps,
      waterTarget: water,
      runSessionsTarget: runs,
      soundEnabled: false,
    });
    onDone();
    } finally {
      // Reset even on a failed write, or the button stays disabled for good.
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <div>
        <h1>On commence&nbsp;?</h1>
        <p className="onb__intro">
          Tout reste modifiable plus tard, dans les réglages.
        </p>
      </div>

      <div className="onb__grid">
        <Field label="Poids de départ" value={startWeight} onChange={setStartWeight} />
        <Field label="Objectif" value={targetWeight} onChange={setTargetWeight} />
      </div>

      <label className="onb__field" htmlFor="onb-goal-date">
        <span className="label">Date objectif</span>
        <input
          id="onb-goal-date"
          type="date"
          value={goalDate}
          onChange={(event) => setGoalDate(event.target.value)}
        />
      </label>

      {rate !== null && (
        <p className="onb__rate">
          Ça fait {kg(Math.abs(rate))} kg par semaine.
        </p>
      )}

      <div className="onb__grid">
        <Field label="Cible calories" value={dailyCalorieTarget} onChange={setDaily} inputMode="numeric" />
        <Field label="Sans dîner" value={noDinnerAllowance} onChange={setNoDinner} inputMode="numeric" />
        <Field label="Seuil minimum" value={calorieFloor} onChange={setFloor} inputMode="numeric" />
        <Field label="Objectif de pas" value={stepTarget} onChange={setSteps} inputMode="numeric" />
        <Field label="Verres d'eau" value={waterTarget} onChange={setWater} inputMode="numeric" />
        <Field label="Sorties par semaine" value={runSessionsTarget} onChange={setRuns} inputMode="numeric" />
      </div>

      {error && <p className="onb__err" role="alert">{error}</p>}

      <Button onClick={submit} disabled={busy}>Commencer</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- Onboarding`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/onboarding
git commit -m "feat: add onboarding that writes the settings row"
```

---

### Task 7: The Today view model

**Files:**
- Create: `src/features/today/useToday.ts`
- Test: `src/features/today/useToday.test.ts`

**One survivor in this file is an equivalent mutant, not a gap — recorded so nobody spends another round on it.** Leaving `calorieEntriesWeek` unfiltered in the hook passes every test and always will: its only consumer is `weekCalorieTotal(entries, week)`, which filters internally with `new Set(datesOfIsoWeek(week))` using the same week the hook filtered by, so the unfiltered list yields an identical sum for every possible input. The filter stays because it keeps the module's stated input contract, and a comment at the line says so. Three mutation rounds and 50+ mutations have otherwise pinned this file.

**These code blocks are copied verbatim from the shipped files.** Three defects were found while implementing: `plan.jokerUsedOn` did not compile, because `plan` is the narrow `ChecklistPlan` and the joker field lives on the raw `input.plan`; the nine original tests did not cover `calorieTotal` at all, so a hard-coded 0 passed every one of them; and the tombstone check was inline in the hook rather than in a testable pure helper. The shipped version fixes all three.

**Interfaces:**
- Consumes: repos, `useLiveQuery`, every relevant domain function.
- Produces:
  - `export interface TodayView { date; settings; plan; log; items; validated; streak; daysLeft; cycleComplete; jokerAvailable; weeklyRemaining; weeklyBudget }`
  - `useToday(userId: string): TodayView | undefined`
  - `buildTodayView(input: TodayInputs): TodayView` — the pure assembler, which is what the test exercises
  - `export interface TodayInputs { date; settings; plan; log; dayLogs; runsToday; calorieEntriesToday; calorieEntriesWeek }`

Splitting the pure `buildTodayView` out of the hook is deliberate: the assembly logic is where a wrong argument order would hide, and a pure function can be tested without rendering anything.

**This task also carries precondition 3, and my first instruction for it was wrong twice over.** I told the implementer to read today's log with `getOrCreateDayLog`, "deliberately". That function opens an `rw` transaction, which Dexie forbids inside a `useLiveQuery` querier, so the Today screen could not render at all — see the Global Constraint above. **Read with the read-only `getDayLog` and fall back to a pure in-memory placeholder** built by `blankDayLog(userId, date)`; `updateDayLog` creates the real row on the first tick.

That closes the **read** half of precondition 3: `getDayLog` returns `undefined` for a tombstoned row, so the hook never displays one. **It does not close the write half, and an earlier version of this paragraph wrongly said it did.** I claimed the residual hazard was the placeholder inheriting the dead row's `id`. That was never the hazard. Writes key off `date`, and both `updateDayLog` and `stampDayLog` look the row up with `where('[userId+date]')` and **no `deletedAt` filter** — so a write lands on the invisible row whatever id the placeholder carries. A reviewer proved it: a tick on a tombstoned day writes into the dead row with its `deletedAt` intact, `getDayLog` keeps returning `undefined`, so the checkbox appears to do nothing forever; and `stampDayLog` reads the dead row, returns `fireBonus: true` and stamps the invisible row. Declaring it solved here is worse than leaving it open, because it took the hazard off Plan 4's list. It is back on — see Plan 4's Global Constraints. The decision still belongs in a comment: **a tombstoned day log is not today's log, and the day reads as unlogged.** The placeholder carries `id: ''` because it is never persisted, so every write must key off `date`, never off `view.log.id`.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import {
  blankDayLog, buildTodayView, useToday, type TodayInputs,
} from '@/features/today/useToday';
import type {
  CalorieEntry, DayLog, Run, Settings, WeekPlan,
} from '@/domain/types';

const settings: Settings = {
  userId: 'u1', timezone: 'Europe/Paris',
  startDate: '2026-10-01', startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false, updatedAt: '',
};

/**
 * Deliberately NOT the defaults: DEFAULT_RUN_DAYS is [1, 2, 4, 6, 7] and
 * DEFAULT_NO_DINNER_DAYS is [3, 7]. The reference date 2026-10-06 is a Tuesday,
 * which this plan makes a no-dinner evening and not a run day - the mirror
 * image of the defaults - so a build that ignored the stored plan and fell back
 * to effectiveWeekPlan(undefined) would fail every test below.
 */
const plan: WeekPlan = {
  id: 'p1', userId: 'u1', isoWeek: '2026-W41',
  runDays: [1, 3, 5], noDinnerDays: [2],
  jokerUsedOn: null, updatedAt: '', deletedAt: null,
};

function log(partial: Partial<DayLog> = {}): DayLog {
  return {
    id: 'l1', userId: 'u1', updatedAt: '', deletedAt: null,
    date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null, ...partial,
  };
}

function run(id: string, date: string): Run {
  return {
    id, userId: 'u1', updatedAt: '', deletedAt: null,
    date, distanceKm: 5, durationS: 1500, note: null,
  };
}

function entry(id: string, date: string, kcal: number): CalorieEntry {
  return {
    id, userId: 'u1', updatedAt: '', deletedAt: null, date, kcal, label: null,
  };
}

// Coherent by construction: 2026-10-06 is in 2026-W41, and log.date matches.
// A case that moves `date` has to move the plan's week and the log's date too.
function inputs(partial: Partial<TodayInputs> = {}): TodayInputs {
  return {
    date: '2026-10-06', settings, plan, log: log(), dayLogs: [],
    runsToday: [], calorieEntriesToday: [], calorieEntriesWeek: [], ...partial,
  };
}

describe('buildTodayView', () => {
  it('counts down to the goal date', () => {
    expect(buildTodayView(inputs()).daysLeft).toBe(37);
    expect(buildTodayView(inputs()).cycleComplete).toBe(false);
  });

  it('reports the cycle complete the day after the goal', () => {
    const view = buildTodayView(inputs({
      date: '2026-11-13',
      plan: { ...plan, isoWeek: '2026-W46' },
      log: log({ date: '2026-11-13' }),
    }));
    expect(view.cycleComplete).toBe(true);
  });

  it('builds the Tuesday checklist from the stored plan', () => {
    expect(buildTodayView(inputs()).items.map((i) => i.id))
      .toEqual(['calories', 'no_dinner', 'steps', 'water']);
  });

  it('falls back to the default shape when no week plan is stored', () => {
    // The live branch: getWeekPlan is read-only, so a fresh install's first
    // Today render has no stored plan at all.
    const view = buildTodayView(inputs({ plan: undefined }));
    expect(view.items.map((i) => i.id)).toEqual(['course', 'calories', 'steps', 'water']);
    // Two default no-dinner evenings, five days at the daily target.
    expect(view.weeklyBudget).toBe(5 * 1500 + 2 * 900);
  });

  it('satisfies course from a run on a day the stored plan makes a run day', () => {
    // 2026-10-07 is a Wednesday, ISO weekday 3, which this plan's runDays make
    // a run day - so `course` is applicable, and runsToday is the only thing
    // that can satisfy it here: ticks.course is unset and there are no calorie
    // entries for a miscounted length to stand in for the run count.
    const view = buildTodayView(inputs({
      date: '2026-10-07',
      log: log({ date: '2026-10-07' }),
      runsToday: [{ date: '2026-10-07', distanceKm: 5, durationS: 1500 }],
    }));
    expect(view.items).toContainEqual({ id: 'course', satisfied: true });
  });

  it('leaves course unsatisfied on a run day with no run logged', () => {
    const view = buildTodayView(inputs({
      date: '2026-10-07',
      log: log({ date: '2026-10-07' }),
      runsToday: [],
    }));
    expect(view.items).toContainEqual({ id: 'course', satisfied: false });
  });

  it('validates the day when every applicable item is satisfied', () => {
    const view = buildTodayView(inputs({
      // No run on purpose: course is not applicable under this plan, so
      // omitting it keeps the case sensitive to the plan being ignored.
      calorieEntriesToday: [{ date: '2026-10-06', kcal: 850 }],
      log: log({ steps: 8200, waterGlasses: 6, ticks: { no_dinner: true } }),
    }));
    expect(view.validated).toBe(true);
  });

  it('does not validate a day whose calories exceed the allowance', () => {
    const view = buildTodayView(inputs({
      // 1000 kcal sits under dailyCalorieTarget but over the 900 no-dinner
      // allowance this plan puts on a Tuesday. The run satisfies the course
      // item that the default plan would add, so only calories can fail.
      runsToday: [{ date: '2026-10-06', distanceKm: 5, durationS: 1500 }],
      calorieEntriesToday: [{ date: '2026-10-06', kcal: 1000 }],
      log: log({ steps: 8200, waterGlasses: 6, ticks: { no_dinner: true } }),
    }));
    expect(view.validated).toBe(false);
  });

  it('computes the weekly remaining from the week entries, not the day entries', () => {
    const view = buildTodayView(inputs({
      calorieEntriesWeek: [
        { date: '2026-10-05', kcal: 1450 },
        { date: '2026-10-06', kcal: 1400 },
      ],
    }));
    // One marked evening in the seven: six days at the daily target plus one
    // no-dinner allowance.
    expect(view.weeklyBudget).toBe(6 * 1500 + 1 * 900);
    expect(view.weeklyRemaining).toBe(6 * 1500 + 1 * 900 - 2850);
  });

  it('counts the streak from the supplied day logs', () => {
    const view = buildTodayView(inputs({
      // startDate has to clip the walk, or a looser one would count the same.
      // 2026-10-03 is covered and consecutive, and sits a day before the start,
      // so only settings.startDate keeps it out of the count.
      settings: { ...settings, startDate: '2026-10-04' },
      dayLogs: [
        log({ date: '2026-10-03', validatedAt: '2026-10-03T21:00:00Z' }),
        // Jokered, not validated: a joker covers a day just as validation does.
        log({ date: '2026-10-04', jokered: true }),
        log({ date: '2026-10-05', validatedAt: '2026-10-05T21:00:00Z' }),
      ],
    }));
    expect(view.streak).toBe(2);
  });

  it("counts today's own log even when dayLogs does not carry it yet", () => {
    // listDayLogs lists them all, today's row included, so dayLogs usually
    // carries it and the push is a duplicate that currentStreak's Set absorbs.
    // The case that needs the push is this one: on a day with no stored row,
    // `log` is blankDayLog's placeholder, which no list can supply.
    const view = buildTodayView(inputs({
      dayLogs: [],
      log: log({ validatedAt: '2026-10-06T21:00:00Z' }),
    }));
    expect(view.streak).toBe(1);
  });

  it('offers the joker on an uncovered today when the week has one left', () => {
    expect(buildTodayView(inputs()).jokerAvailable).toBe(true);
  });

  it('withholds the joker once the week has spent it', () => {
    const view = buildTodayView(inputs({ plan: { ...plan, jokerUsedOn: '2026-10-05' } }));
    expect(view.jokerAvailable).toBe(false);
  });

  it('withholds the joker on a validated day', () => {
    const view = buildTodayView(inputs({
      log: log({ validatedAt: '2026-10-06T21:00:00Z' }),
    }));
    expect(view.jokerAvailable).toBe(false);
  });

  it('withholds the joker on an already jokered day', () => {
    // Section 4.4: a jokered day is covered, so it is not offered the joker
    // a second time.
    const view = buildTodayView(inputs({ log: log({ jokered: true }) }));
    expect(view.jokerAvailable).toBe(false);
  });

  it('withholds the joker before the start date', () => {
    // 2026-09-30 is the day before startDate, and it lives in 2026-W40.
    const view = buildTodayView(inputs({
      date: '2026-09-30',
      plan: { ...plan, isoWeek: '2026-W40' },
      log: log({ date: '2026-09-30' }),
    }));
    expect(view.jokerAvailable).toBe(false);
  });
});

describe('blankDayLog', () => {
  it('builds an unlogged day', () => {
    // The whole shape, not a sample of it: a surviving `jokered` would keep the
    // streak alive on a day nobody logged, and a stale bonusFiredAt would
    // suppress the reward a later task fires off it.
    expect(blankDayLog('u1', '2026-10-06')).toEqual({
      id: '', userId: 'u1', updatedAt: '', deletedAt: null,
      date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
    });
  });

  it('carries no id, because no such row exists', () => {
    // An id here would be either a tombstoned row's, which no caller could
    // tell from a live one, or a fresh one minted on every re-run of the
    // querier. The empty string can be mistaken for neither.
    expect(blankDayLog('u1', '2026-10-06').id).toBe('');
  });
});

describe('useToday', () => {
  beforeEach(async () => {
    // A fresh store per case: delete rather than clear, so no schema or row
    // from an earlier case can make a later one pass.
    await db.delete();
    await db.open();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves to a defined view against a seeded settings row', async () => {
    // Date only, so Testing Library's waitFor keeps its real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    // Midday in Paris on the Tuesday the pure cases above use.
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    const view = result.current;
    expect(view?.date).toBe('2026-10-06');
    // No stored week plan on a fresh install, so the default shape applies:
    // DEFAULT_RUN_DAYS includes Tuesday, so `course` is in.
    expect(view?.items.map((i) => i.id)).toEqual(['course', 'calories', 'steps', 'water']);
    expect(view?.validated).toBe(false);
    expect(view?.daysLeft).toBe(37);
    // Opening the app reads; it does not write. A getOrCreate here would both
    // reject inside the liveQuery context and leave a row behind.
    expect(await db.dayLogs.count()).toBe(0);
    expect(await db.weekPlans.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('shows an unlogged placeholder when no day log is stored', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.log).toEqual(blankDayLog('u1', '2026-10-06'));
  });

  it('reads the stored day log when there is one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);
    await db.dayLogs.put(log({ steps: 9100, waterGlasses: 6 }));

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.log.id).toBe('l1');
    expect(result.current?.log.steps).toBe(9100);
  });

  it('treats a tombstoned day log as unlogged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);
    await db.dayLogs.put(log({
      deletedAt: '2026-10-06T08:00:00Z', steps: 9100, jokered: true,
    }));

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    // The placeholder, id and all: the tombstoned row's ticks, steps, joker
    // and validation must not reach the view, and nor must its id.
    expect(result.current?.log).toEqual(blankDayLog('u1', '2026-10-06'));
  });

  it('reads the date in the stored zone rather than in UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 00:30 on the 7th in Paris, still the 6th in UTC. The mirror image of the
    // fallback case below: between them, only settings.timezone gives the date
    // these two cases expect.
    vi.setSystemTime(new Date('2026-10-06T22:30:00Z'));
    await db.settings.put(settings);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.date).toBe('2026-10-07');
  });

  it('falls back to UTC when the stored timezone is one this runtime rejects', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 01:30 on the 7th in Paris, still the 6th in UTC, so the fallback zone is
    // pinned and not just the fact that the querier survived.
    vi.setSystemTime(new Date('2026-10-06T23:30:00Z'));
    await db.settings.put({ ...settings, timezone: 'Not/AZone' });

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.date).toBe('2026-10-06');
  });

  it('feeds the stored plan, logs, runs and week entries into the view', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Midday in Paris on Wednesday 2026-10-07, which is in 2026-W41 - the week
    // the stored plan below is keyed to.
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    await db.settings.put(settings);
    await db.weekPlans.put(plan);
    await db.dayLogs.bulkPut([
      log({ id: 'l5', date: '2026-10-05', validatedAt: '2026-10-05T21:00:00Z' }),
      log({ id: 'l6', date: '2026-10-06', validatedAt: '2026-10-06T21:00:00Z' }),
    ]);
    // Nothing on 2026-10-07 itself, in either table: that is what makes the
    // two per-day filters observable, because an unfiltered list would hand
    // the build a run count and an entry count that today did not earn.
    await db.runs.bulkPut([run('r6', '2026-10-06'), run('r28', '2026-09-28')]);
    await db.calorieEntries.bulkPut([
      entry('c6', '2026-10-06', 1400),
      entry('c5', '2026-10-05', 1450),
      // 2026-09-28 is the Monday of 2026-W40, so weekDates must exclude it.
      entry('c28', '2026-09-28', 2000),
    ]);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    const view = result.current;
    expect(view?.date).toBe('2026-10-07');
    // The stored plan reached the build: it makes Wednesday a run day and not
    // a no-dinner evening, where the defaults do the exact opposite.
    expect(view?.items.map((i) => i.id)).toEqual(['course', 'calories', 'steps', 'water']);
    expect(view?.items).toContainEqual({ id: 'course', satisfied: false });
    expect(view?.items).toContainEqual({ id: 'calories', satisfied: false });
    // listDayLogs reached it too: the two covered days before an uncovered
    // today, with today's own row absent and a placeholder in its place.
    expect(view?.streak).toBe(2);
    // Six days at the daily target plus the Tuesday allowance this plan marks,
    // less the two in-week entries and not the 2026-W40 one.
    expect(view?.weeklyBudget).toBe(6 * 1500 + 900);
    expect(view?.weeklyRemaining).toBe(6 * 1500 + 900 - 2850);
  });

  it('resolves to undefined while no settings row exists', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    const { result } = renderHook(() => useToday('u1'));

    // Seeded first and waited on, so the querier has demonstrably run; then
    // the row is taken away. result.current is undefined on the first render
    // whatever the querier does, so asserting it straight away would prove
    // nothing. The re-run has to return undefined rather than throw on the
    // missing row, which is what the early return is for.
    await db.settings.put(settings);
    await waitFor(() => expect(result.current).toBeDefined());
    await db.settings.delete('u1');
    await waitFor(() => expect(result.current).toBeUndefined());
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- useToday`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import {
  getDayLog, getSettings, getWeekPlan, listCalorieEntries,
  listDayLogs, listRuns,
} from '@/db/repos';
import {
  dayCalorieTotal, weekCalorieTotal,
  weeklyBudget as computeWeeklyBudget, weeklyRemaining,
} from '@/domain/budget';
import { datesOfIsoWeek, isoWeekOf, isValidTimeZone, todayIn } from '@/domain/calendar';
import {
  effectiveWeekPlan, evaluateChecklist, isDayValidated,
  type ChecklistItem, type ChecklistPlan,
} from '@/domain/checklist';
import { canUseJoker, currentStreak } from '@/domain/streak';
import { daysUntil, isCycleComplete } from '@/domain/trajectory';
import type { DayLog, IsoDate, Settings, WeekPlan } from '@/domain/types';

interface RunRow { date: IsoDate; distanceKm: number; durationS: number }
interface CalorieRow { date: IsoDate; kcal: number }

/**
 * Coherence invariant, which the caller owes and this module does not re-check:
 * `log.date === date`, `plan` is the plan of `isoWeekOf(date)` (or undefined),
 * and `calorieEntriesWeek` covers that same week. useToday derives all four
 * from one `date`, so the only way to break it is a hand-built input.
 */
export interface TodayInputs {
  date: IsoDate;
  settings: Settings;
  /** Absent until the week is first edited; effectiveWeekPlan supplies defaults. */
  plan: WeekPlan | undefined;
  log: DayLog;
  dayLogs: DayLog[];
  runsToday: RunRow[];
  calorieEntriesToday: CalorieRow[];
  calorieEntriesWeek: CalorieRow[];
}

export interface TodayView {
  date: IsoDate;
  settings: Settings;
  /** Resolved through effectiveWeekPlan, so it is the narrow shape, not the
   *  stored row; the row may not exist until the week is first edited. */
  plan: ChecklistPlan;
  /** The stored row, or blankDayLog's placeholder on a day with none; the id is
   *  then empty, so a write keys off `date`, never off this. */
  log: DayLog;
  items: ChecklistItem[];
  validated: boolean;
  streak: number;
  daysLeft: number;
  cycleComplete: boolean;
  jokerAvailable: boolean;
  weeklyBudget: number;
  weeklyRemaining: number;
}

/** Pure assembler: plain values in, a view out. No IO, so it is directly testable. */
export function buildTodayView(input: TodayInputs): TodayView {
  const { date, settings, log } = input;
  const plan = effectiveWeekPlan(input.plan);
  const week = isoWeekOf(date);
  // Section 4.7's sums come from the domain, not from each screen re-deriving them.
  const calorieTotal = dayCalorieTotal(input.calorieEntriesToday, date);
  const consumedThisWeek = weekCalorieTotal(input.calorieEntriesWeek, week);

  const items = evaluateChecklist({
    date, plan, settings, log,
    runCount: input.runsToday.length,
    calorieTotal,
    calorieEntryCount: input.calorieEntriesToday.length,
  });

  const coverage = input.dayLogs.map((row) => ({
    date: row.date, validatedAt: row.validatedAt, jokered: row.jokered,
  }));
  // listDayLogs lists them all, today's row included, so this push is usually
  // a duplicate - and an idempotent one, because currentStreak reduces the
  // coverage to a Set of dates. It is here for the day that has no stored row
  // at all: `log` is then blankDayLog's placeholder, which no list can supply.
  coverage.push({ date, validatedAt: log.validatedAt, jokered: log.jokered });

  return {
    date, settings, plan, log, items,
    validated: isDayValidated(items),
    streak: currentStreak(coverage, date, settings.startDate),
    daysLeft: daysUntil(settings.goalDate, date),
    cycleComplete: isCycleComplete(settings.goalDate, date),
    jokerAvailable: canUseJoker({
      date, today: date, startDate: settings.startDate,
      coverage: { date, validatedAt: log.validatedAt, jokered: log.jokered },
      // ChecklistPlan is narrow; the joker lives on the stored row, if any.
      weekPlanJokerUsedOn: input.plan?.jokerUsedOn ?? null,
    }),
    weeklyBudget: computeWeeklyBudget(week, plan, settings),
    weeklyRemaining: weeklyRemaining(week, plan, settings, consumedThisWeek),
  };
}

/**
 * The unlogged day a date with no stored row is shown as. Pure, and never
 * persisted: opening the app must not create a row, so the querier reads with
 * the read-only getDayLog and falls back to this. getDayLog also returns
 * undefined for a tombstoned row, so a tombstoned day lands here too and its
 * stale ticks, steps, joker and validation never reach the view.
 *
 * The id is deliberately an empty string, because this row does not exist in
 * the database: every write must key off `date`, which is what
 * updateDayLog(userId, date, patch) takes, and never off `view.log.id`. What
 * the empty string buys is an id no caller can mistake for a real row's, where
 * a tombstoned row's id would be indistinguishable from a live one, and no
 * fresh id minted on every re-run of the querier.
 *
 * It buys no protection against a write reaching a tombstoned row. Writes look
 * rows up by `[userId+date]`, which does not filter `deletedAt`, so a tick on
 * a tombstoned day lands on the invisible row whatever id this carries. That
 * is unreachable until the sync phase can tombstone a day log, and the fix
 * belongs to the repo layer rather than here.
 */
export function blankDayLog(userId: string, date: IsoDate): DayLog {
  return {
    id: '', userId, date, ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null,
    updatedAt: '', deletedAt: null,
  };
}

export function useToday(userId: string): TodayView | undefined {
  return useLiveQuery(async () => {
    const settings = await getSettings(userId);
    if (!settings) return undefined;

    // A stored zone can be one this runtime rejects (synced from a device with
    // a different ICU, or a zone since dropped), and todayIn would then throw a
    // RangeError inside this querier. There is no ErrorBoundary above it, so
    // that is a white screen on the main view. Fall back the way onboarding
    // does for the detected zone.
    const timezone = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
    const date = todayIn(timezone);
    const week = isoWeekOf(date);
    const weekDates = new Set(datesOfIsoWeek(week));

    const [plan, log, dayLogs, runs, calorieEntries] = await Promise.all([
      // Read-only for the plan: opening the app must not invent a week plan.
      getWeekPlan(userId, week),
      // Read-only for the log too, for the same reason and one more: Dexie's
      // observability middleware rejects any readwrite transaction opened in a
      // liveQuery context, so a getOrCreate here would make this querier
      // reject forever and leave Today stuck on undefined. Nothing is lost -
      // updateDayLog creates the row on the first tick.
      getDayLog(userId, date),
      listDayLogs(userId),
      listRuns(userId),
      listCalorieEntries(userId),
    ]);

    return buildTodayView({
      date, settings, plan, log: log ?? blankDayLog(userId, date), dayLogs,
      runsToday: runs.filter((r) => r.date === date),
      calorieEntriesToday: calorieEntries.filter((e) => e.date === date),
      // This one keeps the input contract at the top of the file rather than
      // changing a result: weekCalorieTotal filters by the same week, so no
      // test can tell the filtered list from the unfiltered one.
      calorieEntriesWeek: calorieEntries.filter((e) => weekDates.has(e.date)),
    });
  }, [userId]);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- useToday`
Expected: PASS, 26 tests.

The brief originally asked for nine and they were not enough twice over: a reviewer showed that hard-coding the day's calorie total to 0 passed every one of them, and that a fixture whose week plan was byte-identical to the defaults meant the stored plan could be ignored entirely with no test noticing. The six `useToday` cases matter most — all nine original tests exercised only the pure `buildTodayView`, which is why a hook that could never resolve went unnoticed.

- [ ] **Step 5: Commit**

```bash
git add src/features/today/useToday.ts src/features/today/useToday.test.ts
git commit -m "feat: add the Today view model"
```

---

### Task 8: Validation stamping and the one-time bonus

**Files:**
- Create: `src/features/today/stamps.ts`
- Test: `src/features/today/stamps.test.ts`

**Interfaces:**
- Consumes: `updateDayLog` from `@/db/repos`, `nowIso` from `@/db/ids`.
- Produces:
  - `syncStamps(userId: string, view: TodayView): Promise<StampResult>`
  - `export interface StampResult { validatedNow: boolean; fireBonus: boolean }`

**Rules, from spec §4.3 and §4.5:** when the day becomes validated and `validatedAt` is null, stamp it — a *stamp*, not a derivation, so a later settings change cannot retroactively un-validate it. Therefore **never clear `validatedAt`** once set, even if the day stops evaluating as validated. The bonus fires once: if validated and `bonusFiredAt` is null, stamp that too and return `fireBonus: true`.

**The decision must be made from the stored row inside one transaction, not from `view.log`.** `view.log` is a snapshot from the last querier run, and the code block below gets this wrong: it reads `view.log.validatedAt ?? stamp` and then writes. Task 10 calls `syncStamps` from a `useEffect`; React StrictMode double-invokes effects in development, and a re-render can fire a second call before the live query has delivered the updated row. Both calls then see `validatedAt: null`, both write a stamp — so the timestamp is overwritten with a later one and **`fireBonus: true` is returned twice, firing the one-time bonus animation and fanfare twice**. This is the same lost-update shape already fixed once in Plan 1's `updateDayLog`, where a read in one transaction and a write in another let two rapid taps clobber a tick.

So `syncStamps` must not decide from the view. Add a repo function that does the check and the set atomically — something like `stampDayLog(userId, date): Promise<StampResult>` in `src/db/repos.ts`, which inside a single `db.transaction('rw', ...)` reads the row, stamps only the fields that are still null, writes the outbox entry, and reports which stamps it actually applied. `syncStamps` then uses `view` only to decide *whether the day is validated at all*, and takes the `validatedNow`/`fireBonus` answer from the stored row. Note this is the one case where a `getOrCreate`-shaped write is correct: `syncStamps` runs in an effect, never in a querier.

**Narrow the parameter type** to what the function actually reads, `Pick<TodayView, 'date' | 'validated'>`, which also removes the `as unknown as TodayView` double cast from the test fixture below. That cast silently defeats the type checker: a field added to `TodayView` would never be caught, and the fixture would keep compiling against a shape that no longer exists.

**Tests this task owes beyond the four below:** two concurrent `syncStamps` calls on a validated day must return `fireBonus: true` exactly once (drive it with `Promise.all`, and prove it fails against the `view.log`-based version), and a second sequential call must not move the `validatedAt` it already wrote.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDayLog, updateDayLog } from '@/db/repos';
import { db } from '@/db/schema';
import { syncStamps } from '@/features/today/stamps';
import type { TodayView } from '@/features/today/useToday';

const DATE = '2026-10-06';
/** An earlier instant than any nowIso() this run can return, so a re-stamp shows. */
const EARLIER = '2026-10-06T19:00:00.000Z';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.dayLogs.clear(), db.outbox.clear()]);
});

/**
 * Only the two fields syncStamps reads. The narrowed parameter type is what
 * lets this be a real value rather than a cast through unknown: a cast would
 * keep compiling after a field was added to or removed from TodayView.
 */
function view(validated: boolean): Pick<TodayView, 'date' | 'validated'> {
  return { date: DATE, validated };
}

describe('syncStamps', () => {
  it('does nothing while the day is incomplete', async () => {
    const result = await syncStamps('u1', view(false));
    expect(result).toEqual({ validatedNow: false, fireBonus: false });
    // Not even a row: an unfinished day the user only looked at is not an event.
    expect(await getDayLog('u1', DATE)).toBeUndefined();
    expect(await db.dayLogs.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('stamps validatedAt and fires the bonus on first completion', async () => {
    const result = await syncStamps('u1', view(true));
    expect(result).toEqual({ validatedNow: true, fireBonus: true });
    const log = await getDayLog('u1', DATE);
    // typeof, not not.toBeNull(): on a row that was never written log is
    // undefined, and expect(undefined).not.toBeNull() passes.
    expect(typeof log?.validatedAt).toBe('string');
    expect(typeof log?.bonusFiredAt).toBe('string');
    expect(await db.outbox.count()).toBe(1);
  });

  it('never fires the bonus twice', async () => {
    const first = await syncStamps('u1', view(true));
    const again = await syncStamps('u1', view(true));
    expect(first.fireBonus).toBe(true);
    expect(again).toEqual({ validatedNow: false, fireBonus: false });
  });

  it('never clears validatedAt once stamped', async () => {
    await syncStamps('u1', view(true));
    const stamped = (await getDayLog('u1', DATE))?.validatedAt;
    expect(typeof stamped).toBe('string');
    // A raised target can stop the day evaluating as validated; the stamp it
    // earned stays, because stamps record what happened (spec 4.3).
    await syncStamps('u1', view(false));
    expect((await getDayLog('u1', DATE))?.validatedAt).toBe(stamped);
  });

  it('fires the bonus exactly once when two calls race', async () => {
    // The realistic setup: the last tick created the row, and Task 10 then
    // calls syncStamps from an effect that StrictMode double-invokes, so two
    // calls are in flight before either has written. Deciding from a value
    // read before the transaction - view.log, or any read in its own
    // transaction - lets both see validatedAt: null and both fire.
    await updateDayLog('u1', DATE, { ticks: { course: true } });
    await db.outbox.clear();

    const results = await Promise.all([
      syncStamps('u1', view(true)),
      syncStamps('u1', view(true)),
    ]);

    expect(results.filter((r) => r.fireBonus)).toHaveLength(1);
    expect(results.filter((r) => r.validatedNow)).toHaveLength(1);
    expect(await db.dayLogs.count()).toBe(1);
    // One real write, so one sync push.
    expect(await db.outbox.count()).toBe(1);
  });

  it('does not move the validatedAt a previous call already wrote', async () => {
    await syncStamps('u1', view(true));
    const stamped = (await getDayLog('u1', DATE))?.validatedAt;
    expect(await db.outbox.count()).toBe(1);

    const again = await syncStamps('u1', view(true));

    expect(again).toEqual({ validatedNow: false, fireBonus: false });
    // nowIso() never repeats a value, so a re-stamp would read as a strictly
    // later string here.
    expect((await getDayLog('u1', DATE))?.validatedAt).toBe(stamped);
    // And a second outbox row would be a sync push for a day nothing changed on.
    expect(await db.outbox.count()).toBe(1);
  });

  it('records a missing bonus without moving an already stamped validatedAt', async () => {
    // A day validated earlier whose bonus never fired - a sync pull can
    // deliver exactly this. Only the null field may be filled.
    await updateDayLog('u1', DATE, { validatedAt: EARLIER });
    await db.outbox.clear();

    const result = await syncStamps('u1', view(true));

    expect(result).toEqual({ validatedNow: false, fireBonus: true });
    const log = await getDayLog('u1', DATE);
    expect(log?.validatedAt).toBe(EARLIER);
    expect(typeof log?.bonusFiredAt).toBe('string');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- stamps`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { stampDayLog } from '@/db/repos';
import type { TodayView } from '@/features/today/useToday';

export interface StampResult {
  validatedNow: boolean;
  fireBonus: boolean;
}

/**
 * Stamps are facts about what happened; targets are settings. So validatedAt
 * is written once and never cleared or moved - a step target raised in
 * November cannot retroactively un-validate October - and the celebration
 * fires exactly once (spec 4.3 and 4.5).
 *
 * The view decides only WHETHER the day is validated right now. Which stamps
 * this call applied comes from the stored row, inside stampDayLog's single
 * transaction, never from view.log: that is a snapshot from the last querier
 * run, so two calls in flight together would both read validatedAt: null from
 * it and both return fireBonus: true. Task 10 calls this from an effect that
 * StrictMode double-invokes, which makes that the ordinary case rather than a
 * rare race.
 *
 * This writes, so it is safe in an effect and never in a useLiveQuery querier,
 * where Dexie rejects any readwrite transaction.
 */
export async function syncStamps(
  userId: string,
  view: Pick<TodayView, 'date' | 'validated'>,
): Promise<StampResult> {
  // Nothing to stamp, and nothing to clear either: a day that stops evaluating
  // as validated keeps the stamp it earned. Returning before the write is also
  // what keeps merely opening the app on an unfinished day from creating a row.
  if (!view.validated) return { validatedNow: false, fireBonus: false };
  return stampDayLog(userId, view.date);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- stamps`
Expected: PASS, 7 tests, plus the `stampDayLog` cases in `repos.test.ts`.

**These blocks are the shipped files, which differ from what this task originally specified.** The original `syncStamps` decided from `view.log` and would have fired the bonus twice; the atomic `stampDayLog` in `src/db/repos.ts` replaced it. Verified by mutation: moving the read outside the transaction makes the race test report two fires.

- [ ] **Step 5: Commit**

```bash
git add src/features/today/stamps.ts src/features/today/stamps.test.ts
git commit -m "feat: stamp day validation and fire the bonus once"
```

---

### Task 9: Reward feedback

**Files:**
- Create: `src/ui/reward.ts`, `src/ui/Confetti.tsx`
- Test: `src/ui/reward.test.ts`, `src/ui/Confetti.test.tsx`, `src/ui/Confetti.reducedMotion.test.tsx`

**Interfaces:**
- Produces:
  - `playTick(enabled: boolean): void` — a soft two-note pluck
  - `playFanfare(enabled: boolean): void` — the completed-day chime
  - `<Confetti active />` — a one-shot shower of bows and hearts

Synthesised through the Web Audio API rather than shipped as a file: nothing to download, nothing to cache, and no CSP question. Both functions return immediately when `enabled` is false, so the default-off sound setting costs nothing.

**My `Confetti` code was untestable as written, and the implementer had to change it.** Both branches rendered an anonymous `motion.div`, so no assertion could tell the shower from the reduced-motion pulse — the dedicated test file would have been built and still could not have discriminated. Each branch now carries a `data-testid` (`confetti-shower`, `confetti-pulse`), the pattern `Bow` already uses. The block below is the shipped file. Writing a brief that demands a discriminating test while specifying markup that cannot be distinguished is a defect in the brief, not a detail for the implementer to solve quietly.

**`Confetti`'s reduced-motion branch needs its own test file, and I originally listed no `Confetti` test at all.** This is Task 3's defect repeating: framer-motion reads `prefers-reduced-motion` once and caches it behind a module-level guard, so `matchMedia` must be stubbed *before the module is first imported*. Vitest gives each test file its own module registry, which makes a dedicated file the only way to exercise the branch — in Task 3 the first attempt at an in-file test passed against a deliberately broken branch, and the implementer deleted it rather than ship it. So:

- `src/ui/Confetti.reducedMotion.test.tsx` stubs `matchMedia` to report `prefers-reduced-motion: reduce` at the very top, before any import of `Confetti`, and asserts the single soft pulse renders and the shower does not.
- `src/ui/Confetti.test.tsx` covers the ordinary path: `active` false renders nothing, `active` true renders the shower.
- **Prove each file discriminates by breaking the branch it covers**, exactly as Task 3 did. A reduced-motion test that passes whichever branch runs is worse than no test, because it reads as coverage.

**`reward.ts` owes the negative case too:** `playTick(false)` and `playFanfare(false)` must construct no `AudioContext` at all. Assert that by spying on the constructor and expecting zero calls — not by checking the functions returned `undefined`, which they do either way. The sound setting defaults to off, so the disabled path is the one that runs for every user until she turns it on.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playFanfare, playTick } from '@/ui/reward';

const started: number[] = [];

beforeEach(() => {
  started.length = 0;
  class FakeOscillator {
    frequency = { value: 0, setValueAtTime: vi.fn() };
    type = '';
    connect = vi.fn();
    start = vi.fn((when: number) => { started.push(when); });
    stop = vi.fn();
  }
  class FakeGain {
    gain = { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    connect = vi.fn();
  }
  vi.stubGlobal('AudioContext', class {
    currentTime = 0;
    destination = {};
    createOscillator = () => new FakeOscillator();
    createGain = () => new FakeGain();
    close = vi.fn();
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('playTick', () => {
  it('stays silent when sound is disabled', () => {
    playTick(false);
    expect(started).toHaveLength(0);
  });

  it('plays two notes when enabled', () => {
    playTick(true);
    expect(started).toHaveLength(2);
  });
});

describe('playFanfare', () => {
  it('plays more notes than a tick', () => {
    playFanfare(true);
    expect(started.length).toBeGreaterThan(2);
  });

  it('stays silent when disabled', () => {
    playFanfare(false);
    expect(started).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- reward`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/ui/reward.ts`:

```ts
/** Notes as semitone offsets from A4, played as a soft sine pluck. */
const TICK_NOTES = [7, 12];
const FANFARE_NOTES = [0, 4, 7, 12, 16];

function frequency(semitonesFromA4: number): number {
  return 440 * 2 ** (semitonesFromA4 / 12);
}

function pluck(notes: number[]): void {
  const Ctor = globalThis.AudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();
  notes.forEach((note, index) => {
    const at = ctx.currentTime + index * 0.075;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency(note), at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.14, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.36);
  });
}

export function playTick(enabled: boolean): void {
  if (!enabled) return;
  pluck(TICK_NOTES);
}

export function playFanfare(enabled: boolean): void {
  if (!enabled) return;
  pluck(FANFARE_NOTES);
}
```

`src/ui/Confetti.tsx`:

```tsx
import { motion, useReducedMotion } from 'framer-motion';
import { Bow } from '@/ui/Bow';

const PIECES = 18;

/** A one-shot shower of bows. Reduced motion gets a single soft pulse instead. */
export function Confetti({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  if (!active) return null;

  if (reduced) {
    return (
      <motion.div
        data-testid="confetti-pulse"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'var(--rose)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.22, 0] }}
        transition={{ duration: 0.9 }}
      />
    );
  }

  return (
    <div
      data-testid="confetti-shower"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {Array.from({ length: PIECES }, (_, i) => (
        <motion.div
          key={i}
          style={{ position: 'absolute', top: -30, left: `${(i / PIECES) * 100}%`, width: 20, height: 20 }}
          initial={{ y: -40, opacity: 0, rotate: 0 }}
          animate={{ y: '100vh', opacity: [0, 1, 1, 0], rotate: 320 }}
          transition={{ duration: 2.1 + (i % 5) * 0.22, delay: (i % 7) * 0.08, ease: 'easeIn' }}
        >
          <Bow className="bowbox__bow" />
        </motion.div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- reward`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/reward.ts src/ui/reward.test.ts src/ui/Confetti.tsx \
  src/ui/Confetti.test.tsx src/ui/Confetti.reducedMotion.test.tsx
git commit -m "feat: add synthesised reward sounds and the bow shower"
```

---

### Task 10: The Today screen

**This task owns the joker's rule 6 test, a debt carried from Plan 1.** Rule 6 says the week consulted must be that of the date being *excused*, not today's week. It is untestable inside `canUseJoker`, and it is untestable in Task 7's `buildTodayView` too, which passes `date, today: date` — the same value by construction, so the two weeks are trivially identical and no test could tell a correct implementation from a wrong one. Here the joker is actually spent, via `updateWeekPlan(userId, isoWeekOf(view.date), ...)`, so a test must pin that the week written is the excused date's week. A Sunday/Monday boundary is the case that discriminates: ISO weeks start on Monday, so excusing a Sunday from a Monday writes to the previous week.

**Files:**
- Create: `src/features/today/Today.tsx`, `src/features/today/Checklist.tsx`, `src/features/today/StreakCard.tsx`, `src/features/today/today.css`
- Test: `src/features/today/Today.test.tsx`

**Interfaces:**
- Consumes: `useToday`, `syncStamps`, `updateDayLog`, `updateWeekPlan`, primitives, `playTick`, `playFanfare`, `Confetti`.
- Produces: `<Today userId />`.

French labels, exactly: `course` → "Course", `calories` → "Calories respectées", `no_dinner` → "Pas de dîner", `steps` → "Pas", `water` → "Eau".


**Five defects in this task's brief were found while implementing it, and the blocks below are the shipped files.** Two I had already flagged (the `NaN`-writing input, the empty placeholder id). Three I had not: `Checklist.tsx` would not compile, because it imported `ChecklistItemId` from `@/domain/checklist`, which imports that type from `./types` without re-exporting it; the validated mark was rendered on `view.validated`, the *live* evaluation, which directly contradicts this task's own owed test that unticking an item must not remove the mark (spec 4.3 makes `validatedAt` the fact, so the condition reads from the stamp); and the brief's own test #2 could not pass against the brief's own markup, because `getByText('Pas')` is an exact match while the row's only text was `Pas · objectif 8000` — the name and the hint are now separate elements.

I also had two claims probed and found false. My note that StrictMode's doubled mount makes a second `syncStamps` call the ordinary case is **wrong**: on the doubled mount `view` is still `undefined`, so the effect returns before calling it. Task 8's atomic stamping is still right, and its own concurrency test proves the race independently, but the reason I gave here was not the reason. The `cancelled` flag was dropped on a better argument than mine: where it could actually bite it would discard the single `fireBonus` the day will ever report, losing the celebration permanently. The real leak — the 2600 ms celebration timeout, never cleared — is now cleared on unmount.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSettings } from '@/db/repos';
import { db } from '@/db/schema';
import type { DayLog } from '@/domain/types';
import { Today } from '@/features/today/Today';

/**
 * The fanfare leaves no trace in the DOM - reward.ts is silent in jsdom, which
 * has no AudioContext, and silent again because sound defaults off - so
 * counting it needs the module replaced. reward.ts has its own tests.
 */
const reward = vi.hoisted(() => ({ playTick: vi.fn(), playFanfare: vi.fn() }));
vi.mock('@/ui/reward', () => reward);

/** A Tuesday. Under the default week plan it is a run day and not a no-dinner evening. */
const TUESDAY = '2026-10-06';
/** Midday in Paris on that Tuesday. */
const TUESDAY_NOON = new Date('2026-10-06T10:00:00Z');

function log(partial: Partial<DayLog> = {}): DayLog {
  return {
    id: 'l1', userId: 'u1', date: TUESDAY, ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null,
    updatedAt: '2026-10-06T09:00:00.000Z', deletedAt: null, ...partial,
  };
}

beforeEach(async () => {
  reward.playTick.mockClear();
  reward.playFanfare.mockClear();
  // Date only, so Testing Library's waitFor and userEvent keep real timers -
  // and so the celebration's own setTimeout stays real and cannot fire inside
  // a test.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TUESDAY_NOON);
  await db.open();
  await Promise.all([
    db.settings.clear(), db.dayLogs.clear(), db.weekPlans.clear(),
    db.runs.clear(), db.calorieEntries.clear(), db.outbox.clear(),
  ]);
  await saveSettings({
    userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-01',
    startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
    weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
    calorieFloor: 1200, stepTarget: 8000, waterTarget: 6,
    runSessionsTarget: 5, soundEnabled: false,
  });
  // saveSettings queues its own push; cleared so every outbox count below is
  // about what the screen wrote.
  await db.outbox.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Today', () => {
  it('shows the countdown and the streak', async () => {
    render(<Today userId="u1" />);
    expect(await screen.findByTestId('countdown')).toBeInTheDocument();
    expect(await screen.findByTestId('streak')).toBeInTheDocument();
  });

  it('renders only the items that apply today', async () => {
    render(<Today userId="u1" />);
    // Calories, Pas and Eau apply every day.
    expect(await screen.findByRole('checkbox', { name: 'Calories respectées' })).toBeInTheDocument();
    expect(screen.getByText('Pas')).toBeInTheDocument();
    expect(screen.getByText('Eau')).toBeInTheDocument();
    // Tuesday is a run day under the default plan and not a no-dinner evening,
    // so one of the two optional items is here and the other is not.
    expect(screen.getByRole('checkbox', { name: 'Course' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Pas de dîner' })).not.toBeInTheDocument();
  });

  it('persists a manual tick', async () => {
    render(<Today userId="u1" />);
    const box = await screen.findByRole('checkbox', { name: 'Calories respectées' });
    await userEvent.click(box);
    await waitFor(async () => {
      const row = await db.dayLogs.toCollection().first();
      expect(row?.ticks.calories).toBe(true);
    });
    // The per-tick feedback is wired, and it is handed the stored setting
    // rather than a hardcoded one; reward.ts decides whether that makes a
    // sound, and sound defaults off.
    expect(reward.playTick).toHaveBeenCalledWith(false);
  });

  it('counts the streak and agrees with it in French', async () => {
    // Yesterday covered and today not, so the streak ends at yesterday.
    await db.dayLogs.put(log({
      id: 'l5', date: '2026-10-05', validatedAt: '2026-10-05T21:00:00.000Z',
    }));

    render(<Today userId="u1" />);
    const streak = await screen.findByTestId('streak');
    expect(await within(streak).findByText('1')).toBeInTheDocument();
    // French puts one in the singular.
    expect(within(streak).getByText("jour d'affilée")).toBeInTheDocument();

    // A second covered day, delivered by the live query into the same card.
    await db.dayLogs.put(log({
      id: 'l4', date: '2026-10-04', validatedAt: '2026-10-04T21:00:00.000Z',
    }));
    expect(await within(streak).findByText('2')).toBeInTheDocument();
    expect(within(streak).getByText("jours d'affilée")).toBeInTheDocument();
  });

  it('shows the weekly calorie remainder', async () => {
    render(<Today userId="u1" />);
    const panel = await screen.findByTestId('week-remaining');
    // Nothing logged this week, so the remainder is the whole budget: five days
    // at the daily target plus the two default no-dinner evenings (Wed, Sun).
    // Read off textContent rather than toHaveTextContent, which would collapse
    // the narrow no-break space in "9 300" to a plain space.
    expect(panel.textContent).toContain('9\u202f300 kcal');
  });

  it('writes the joker to the ISO week of the day it excuses', async () => {
    // Sunday 2026-10-11 is the LAST day of 2026-W41; the next day opens W42.
    // ISO weeks start on Monday, so a Sunday is the one case that tells the
    // excused date's week apart from any week read off the following day.
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));

    render(<Today userId="u1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Utiliser mon joker' }));

    await waitFor(async () => { expect(await db.weekPlans.count()).toBe(1); });
    const plan = (await db.weekPlans.toArray())[0];
    expect(plan?.isoWeek).toBe('2026-W41');
    expect(plan?.jokerUsedOn).toBe('2026-10-11');

    const row = await db.dayLogs.toCollection().first();
    expect(row?.date).toBe('2026-10-11');
    expect(row?.jokered).toBe(true);
    // The offer goes away: a jokered day is covered, and the week has one joker.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Utiliser mon joker' })).not.toBeInTheDocument();
    });
  });

  it('fires the one-time bonus when the last item is ticked, and never twice', async () => {
    // Everything satisfied but `course`, so one tap completes the day.
    await db.dayLogs.put(log({ steps: 8200, waterGlasses: 6, ticks: { calories: true } }));

    render(<StrictMode><Today userId="u1" /></StrictMode>);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Course' }));

    expect(await screen.findByTestId('confetti-shower')).toBeInTheDocument();
    await waitFor(() => { expect(reward.playFanfare).toHaveBeenCalledTimes(1); });
    const stamped = (await db.dayLogs.get('l1'))?.bonusFiredAt;
    expect(typeof stamped).toBe('string');

    // Another write, so another render of the whole screen. Waited on through
    // the rendered value rather than through the row, because a wait that ends
    // when the write lands can end before the re-render it causes - and then
    // "nothing fired again" would be true only because nothing had happened
    // yet.
    await userEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect((await db.dayLogs.get('l1'))?.waterGlasses).toBe(7);

    expect(reward.playFanfare).toHaveBeenCalledTimes(1);
    // nowIso() never repeats a value, so a second stamp would read as a
    // strictly later string here.
    expect((await db.dayLogs.get('l1'))?.bonusFiredAt).toBe(stamped);
  });

  it('fires the bonus once on a day that is already complete when the screen opens', async () => {
    // The other way a day completes: not under the user's finger but before
    // the screen was ever opened - the last item logged from another screen,
    // or a day pulled in already finished. The stamping effect is then the
    // only thing that can fire the celebration, and it must fire it once.
    await db.dayLogs.put(log({
      steps: 8200, waterGlasses: 6, ticks: { calories: true, course: true },
    }));

    render(<StrictMode><Today userId="u1" /></StrictMode>);

    expect(await screen.findByTestId('confetti-shower')).toBeInTheDocument();
    await waitFor(() => { expect(reward.playFanfare).toHaveBeenCalledTimes(1); });
    // Both calls have settled by the time the stamp is readable, so the count
    // above is final rather than merely early.
    await waitFor(async () => {
      expect(typeof (await db.dayLogs.get('l1'))?.bonusFiredAt).toBe('string');
    });
    expect(reward.playFanfare).toHaveBeenCalledTimes(1);
    expect(await db.dayLogs.count()).toBe(1);
    // One stamp, so one sync push: the second call must write nothing.
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps the validated mark after a tick is taken back', async () => {
    await db.dayLogs.put(log({
      steps: 8200, waterGlasses: 6, ticks: { calories: true, course: true },
    }));

    render(<Today userId="u1" />);
    expect(await screen.findByText('Journée validée.')).toBeInTheDocument();
    await waitFor(async () => {
      expect(typeof (await db.dayLogs.get('l1'))?.validatedAt).toBe('string');
    });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Course' }));
    // Waited on the rendered box, not on the row: the write lands a tick
    // before the live query re-renders, and what this case is about is what
    // the screen shows afterwards.
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Course' })).not.toBeChecked();
    });
    expect((await db.dayLogs.get('l1'))?.ticks.course).toBe(false);

    // The day no longer evaluates as complete, and the mark it earned stays,
    // because validatedAt is never cleared.
    expect(screen.getByText('Journée validée.')).toBeInTheDocument();
    expect(typeof (await db.dayLogs.get('l1'))?.validatedAt).toBe('string');
  });

  it('names the day at the top of the screen', async () => {
    render(<Today userId="u1" />);
    // In the stored zone and without the year, and formatted back in UTC:
    // dates are parsed at UTC noon, so a westward browser zone would read
    // this back as the 5th.
    expect(await screen.findByRole('heading', { name: 'mardi 6 octobre' })).toBeInTheDocument();
  });

  it('shows the step and water targets in French figures', async () => {
    render(<Today userId="u1" />);
    const hints = (await screen.findAllByText(/objectif/)).map((el) => el.textContent);
    // Thin-space thousands, and the middle dot that separates name from hint.
    expect(hints).toContain('\u00b7 objectif 8\u202f000');
    expect(hints).toContain('\u00b7 objectif 6');
  });

  it('says it is loading rather than rendering an empty screen', async () => {
    // No settings row for this user, so the view never resolves, and the
    // screen has to say so rather than render blank.
    //
    // The copy is written as an expression rather than as JSX text because
    // whether a \u escape in JSX TEXT is resolved is up to the transform -
    // this project's resolves it, Babel does not and would ship the six
    // characters of source to the user. An expression is a plain string
    // literal and cannot differ. This case pins the copy, not that choice:
    // under this toolchain both forms render the same ellipsis.
    render(<Today userId="u-nobody" />);
    expect(await screen.findByText('Un instant\u2026')).toBeInTheDocument();
    expect(screen.queryByTestId('streak')).not.toBeInTheDocument();
  });

  it('ignores a steps entry that is not a count, rather than storing NaN', async () => {
    render(<Today userId="u1" />);
    const field = await screen.findByRole('textbox', { name: 'Pas' });

    await userEvent.type(field, 'abc');
    // Nothing written at all - not a row, not a push. A NaN here would make
    // `NaN >= stepTarget` false for this day forever and render as "NaN".
    expect(await db.dayLogs.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(field).toHaveValue('');

    // A pasted negative is a count no pedometer can report.
    fireEvent.change(field, { target: { value: '-5' } });

    // The control: the same field still takes a real count, so the guard is
    // not simply a block. It also settles the rejected pastes above, because
    // updateDayLog opens its transaction when it is called and IndexedDB runs
    // overlapping readwrite transactions in the order they were opened - so
    // anything they had queued has landed by the time this is readable.
    fireEvent.change(field, { target: { value: '8200' } });
    await waitFor(async () => {
      expect((await db.dayLogs.toCollection().first())?.steps).toBe(8200);
    });
    // One accepted entry, so exactly one row and exactly one push. A stored
    // -5 or NaN would show up here as a second outbox entry; asserting the
    // count straight after the paste would not, because the write it rejects
    // would not have landed yet either way.
    expect(await db.dayLogs.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);

    // And clearing it stores null, not 0, which would read as a logged zero.
    fireEvent.change(field, { target: { value: '' } });
    await waitFor(async () => {
      expect((await db.dayLogs.toCollection().first())?.steps).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- Today`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/features/today/today.css`:

```css
.today { display: flex; flex-direction: column; gap: 16px; }
.today__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.today__date { font-family: var(--font-display); font-size: var(--step-2); margin: 0; }
.today__streak { display: flex; align-items: baseline; gap: 10px; }
.today__streaknum { font-family: var(--font-display); font-size: var(--step-3); font-weight: 600; line-height: 1; }
.today__items { display: flex; flex-direction: column; }
.today__items > * + * { border-top: 1px solid var(--line); }
.today__amount { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 2px; }
.today__amount + .today__amount { border-top: 1px solid var(--line); }
.today__amountrow { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.today__amountname { font-weight: 500; }
.today__amounthint { color: var(--ink-soft); font-size: var(--step--1); }
.today__steps {
  width: 6ch;
  text-align: right;
  color: var(--ink);
  background: var(--inset);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 6px 8px;
  /* font-size AFTER font, which resets it: a text input under 16px makes iOS
     Safari zoom the page on focus, and the layout jumps on every tap. */
  font: inherit;
  font-size: 16px;
}
.today__week { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.today__weeknum { font-family: var(--font-display); font-size: var(--step-2); }
.today__joker { margin: 0; color: var(--ink-soft); }
.today__done { font-family: var(--font-hand); font-size: var(--step-2); color: var(--cerise); margin: 0; }
```

`src/features/today/Checklist.tsx`:

```tsx
import type { ChecklistItem } from '@/domain/checklist';
import type { ChecklistItemId, TickableItemId } from '@/domain/types';
import { BowCheckbox } from '@/ui/BowCheckbox';

/**
 * Spec 4.2's five items, named for the screen. Not exported: a non-primitive
 * export beside a component trips oxlint's only-export-components rule, which
 * allowConstantExport only waives for primitives, and nothing outside this
 * file needs the map.
 */
const LABELS: Record<ChecklistItemId, string> = {
  course: 'Course',
  calories: 'Calories respectées',
  no_dinner: 'Pas de dîner',
  steps: 'Pas',
  water: 'Eau',
};

/**
 * The three items a tap can satisfy. `steps` and `water` are derived from the
 * amounts logged under the list, so a box for either would be a second,
 * disagreeing source of truth.
 */
const TICKABLE: TickableItemId[] = ['course', 'calories', 'no_dinner'];

function isTickable(id: ChecklistItemId): id is TickableItemId {
  return (TICKABLE as ChecklistItemId[]).includes(id);
}

export function Checklist({
  items, onToggle,
}: {
  items: ChecklistItem[];
  onToggle: (id: TickableItemId, next: boolean) => void;
}) {
  return (
    <div className="today__items">
      {items.map((item) => {
        // Narrowed through a const, so the closure below keeps the narrowing
        // and no cast is needed to call onToggle.
        const id = item.id;
        if (!isTickable(id)) return null;
        return (
          <BowCheckbox
            key={id}
            label={LABELS[id]}
            checked={item.satisfied}
            onChange={(next) => onToggle(id, next)}
          />
        );
      })}
    </div>
  );
}
```

`src/features/today/StreakCard.tsx`:

```tsx
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { Pill } from '@/ui/Pill';

export function StreakCard({
  streak, daysLeft, jokerAvailable, onUseJoker,
}: {
  streak: number;
  daysLeft: number;
  jokerAvailable: boolean;
  onUseJoker: () => void;
}) {
  return (
    <>
      <div className="today__head">
        <div className="today__streak" data-testid="streak">
          <span className="today__streaknum">{streak}</span>
          <span className="label">{plural(streak, 'jour', 'jours')} d'affilée</span>
        </div>
        <span data-testid="countdown">
          <Pill>{`J\u2212${daysLeft}`}</Pill>
        </span>
      </div>
      {jokerAvailable && (
        <div>
          <p className="today__joker">
            {/* No-break space before the question mark, French typography. */}
            Un imprévu{'\u00a0'}? Il te reste ton joker de la semaine.
          </p>
          <Button variant="quiet" onClick={onUseJoker}>Utiliser mon joker</Button>
        </div>
      )}
    </>
  );
}
```

`src/features/today/Today.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { updateDayLog, updateWeekPlan } from '@/db/repos';
import { isoWeekOf } from '@/domain/calendar';
import type { TickableItemId } from '@/domain/types';
import { Checklist } from '@/features/today/Checklist';
import { StreakCard } from '@/features/today/StreakCard';
import { syncStamps } from '@/features/today/stamps';
import { useToday } from '@/features/today/useToday';
import { Card } from '@/ui/Card';
import { Confetti } from '@/ui/Confetti';
import { kcal, longDate } from '@/ui/format';
import { playFanfare, playTick } from '@/ui/reward';
import { Stepper } from '@/ui/Stepper';
import '@/features/today/today.css';

/** How long the shower runs before the screen goes quiet again. */
const CELEBRATION_MS = 2600;

/**
 * kcal() is this project's thousands grouper (8000 becomes "8 000" with a
 * narrow no-break space), and the French number rules apply to a step target
 * as much as to a calorie count. Aliased rather than reimplemented, because a
 * second grouper would be a second set of rules to keep in step.
 */
const grouped = kcal;

type CountEntry =
  | { kind: 'clear' }
  | { kind: 'count'; value: number }
  | { kind: 'reject' };

/**
 * What a keystroke in a count field means. inputMode is a keyboard hint, not a
 * constraint: it does nothing on a desktop keyboard and nothing against a
 * paste. Number('abc') is NaN, and a NaN in dayLogs.steps makes
 * `NaN >= stepTarget` false for that day forever while rendering as "NaN", so
 * anything that is not a count of zero or more is ignored rather than stored -
 * the same guard Onboarding puts on its own number fields.
 */
function readCount(raw: string): CountEntry {
  const text = raw.trim();
  if (text === '') return { kind: 'clear' };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return { kind: 'reject' };
  return { kind: 'count', value };
}

export function Today({ userId }: { userId: string }) {
  const view = useToday(userId);
  const [celebrating, setCelebrating] = useState(false);
  const celebrationTimer = useRef(0);

  // Cleared on unmount only: clearing it on every effect run would cut the
  // shower short on the very re-render the stamp itself causes.
  useEffect(() => () => { window.clearTimeout(celebrationTimer.current); }, []);

  // Read out of the view so the effect below can depend on the values it
  // actually uses rather than on the identity of a freshly built object.
  const date = view?.date;
  const validated = view?.validated;
  const bonusFiredAt = view?.log.bonusFiredAt;
  const sound = view?.settings.soundEnabled ?? false;

  // Stamps validation and fires the one-time bonus whenever the view says the
  // day is complete. The write belongs here and never in useToday's querier,
  // where Dexie rejects any readwrite transaction.
  useEffect(() => {
    if (date === undefined || validated === undefined) return;
    // No cancellation flag on the result, deliberately. Firing twice is
    // already impossible: stampDayLog decides inside one transaction from the
    // stored row, so of any number of calls in flight exactly one reports
    // fireBonus (Task 8). What a flag would add is a way to LOSE it. The
    // report arrives after the write, bonusFiredAt is then stamped forever,
    // and dropping the report because this effect was cleaned up mid-flight -
    // an item unticked in the moment between the call and its answer - would
    // mean the celebration never shows for that day again. The leak actually
    // worth guarding is the timeout, which the unmount effect above clears.
    void syncStamps(userId, { date, validated }).then((result) => {
      if (!result.fireBonus) return;
      playFanfare(sound);
      setCelebrating(true);
      window.clearTimeout(celebrationTimer.current);
      celebrationTimer.current = window.setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    });
  }, [userId, date, validated, bonusFiredAt, sound]);

  if (!view) return <p>{'Un instant\u2026'}</p>;

  const toggle = async (id: TickableItemId, next: boolean) => {
    playTick(sound);
    // Keyed off the date, never off view.log.id, which is the empty string on a
    // day with no stored row yet.
    await updateDayLog(userId, view.date, { ticks: { [id]: next } });
  };

  const spendJoker = async () => {
    await updateDayLog(userId, view.date, { jokered: true });
    // Rule 6: the week that holds the joker is the EXCUSED date's week, not
    // whatever week today falls in. ISO weeks start on Monday, so on a Sunday
    // the two differ - the Sunday belongs to the week that is closing.
    await updateWeekPlan(userId, isoWeekOf(view.date), { jokerUsedOn: view.date });
  };

  const setSteps = (raw: string) => {
    const entry = readCount(raw);
    if (entry.kind === 'reject') return;
    void updateDayLog(userId, view.date, {
      steps: entry.kind === 'clear' ? null : entry.value,
    });
  };

  return (
    <div className="today">
      <Confetti active={celebrating} />

      <StreakCard
        streak={view.streak}
        daysLeft={view.daysLeft}
        jokerAvailable={view.jokerAvailable}
        onUseJoker={spendJoker}
      />

      <Card laced>
        <h1 className="today__date">{longDate(view.date)}</h1>
        <Checklist items={view.items} onToggle={toggle} />

        <div className="today__amount">
          <span className="today__amountrow">
            <label className="today__amountname" htmlFor="today-steps">Pas</label>
            <span className="today__amounthint">
              {`\u00b7 objectif ${grouped(view.settings.stepTarget)}`}
            </span>
          </span>
          <input
            id="today-steps"
            className="today__steps"
            aria-label="Pas"
            inputMode="numeric"
            value={view.log.steps ?? ''}
            onChange={(event) => setSteps(event.target.value)}
          />
        </div>

        <div className="today__amount">
          <span className="today__amountrow">
            <span className="today__amountname">Eau</span>
            <span className="today__amounthint">
              {`\u00b7 objectif ${grouped(view.settings.waterTarget)}`}
            </span>
          </span>
          <Stepper
            label="Eau"
            value={view.log.waterGlasses ?? 0}
            min={0}
            max={20}
            step={1}
            onChange={(next) => {
              playTick(sound);
              void updateDayLog(userId, view.date, { waterGlasses: next });
            }}
          />
        </div>

        {/* The stamp, not the live evaluation: spec 4.3 makes validatedAt a
            fact about what happened, so a target raised later - or a tick
            taken back - cannot un-validate a day that earned it. The live
            `validated` is here too, for the instant before the stamp lands. */}
        {(view.log.validatedAt !== null || view.validated) && (
          <p className="today__done">Journée validée.</p>
        )}
      </Card>

      <Card>
        <div className="today__week" data-testid="week-remaining">
          <span className="label">Reste cette semaine</span>
          <span className="today__weeknum">{kcal(view.weeklyRemaining)} kcal</span>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- Today`
Expected: PASS, 13 tests.

**Four tests is not enough for the screen the whole app exists to show, and one of the gaps is a requirement this task's own prose claims to own.**

1. **The joker's rule 6** — the debt carried from Plan 1. The prose at the top of this task says this task owns it, and then the test list above does not contain a joker test at all: the same "requirement with no owning step" defect as `openDatabase`, which sat unwired through two whole tasks. Pin that spending the joker writes to **the excused date's** ISO week, not to today's. Drive it on a Sunday/Monday boundary, which is the only case that discriminates: ISO weeks start on Monday, so a Sunday belongs to the week that is already closing. Mock the clock to a Sunday, spend the joker, and assert the `weekPlans` row written is that Sunday's week.
2. **The bonus fires exactly once.** Task 8 made the stamping atomic and Task 9 built the shower and the fanfare; this task wires them, and nothing yet tests the wire. Complete the last item of a day and assert `Confetti` becomes active and the fanfare plays once — then assert a re-render does not fire either again. StrictMode double-invokes the effect, which is the ordinary case rather than a rare race.
3. **A validated day renders as validated** — the `today__done` message — and stays that way after a tick is removed, because `validatedAt` is a stamp and is never cleared.
4. **The steps input rejects what is not a number** (see the defect below).

**Defect in the code block above: `Number(raw)` is unvalidated, and writes `NaN` to the database.** `inputMode="numeric"` is a keyboard hint, not a constraint — it does nothing on a desktop keyboard and nothing against a paste. `Number('abc')` is `NaN`, which goes straight into `dayLogs.steps`, and from there `NaN >= stepTarget` is false forever, so the steps item can never be satisfied again on that day and the field renders as `NaN`. This is exactly the onboarding defect from Task 6, where `Number('')` and `Number('abc')` were written into the one settings row every screen reads. Guard it the way `Onboarding` does: parse, and ignore the keystroke unless the result is a finite number greater than or equal to zero. Reject a negative step count too.

**`view.log.id` is an empty string on a day with no stored row.** It is falsy, so an `if (log.id)` guard behaves sensibly, but `db.dayLogs.get(view.log.id)` would return `undefined` rather than throw — a silent wrong answer. Key every write off `view.date`, which is what `updateDayLog(userId, date, patch)` and `stampDayLog(userId, date)` already take.

**Recorded for Plan 4, not to be fixed here:** this input writes on every keystroke, so typing `8200` enqueues four outbox rows for one number. Correct under last-write-wins, but four pushes where one would do, on a free-tier budget. Plan 4's push should coalesce the outbox by `table + rowId`, keeping only the newest entry per row.

- [ ] **Step 5: Commit**

```bash
git add src/features/today
git commit -m "feat: add the Today screen with bow ticks, streak and joker"
```

---

### Task 11: App shell and routing

**Files:**
- Create: `src/app/App.tsx`, `src/app/TabBar.tsx`, `src/app/app.css`
- Modify: `src/main.tsx`
- Delete: `src/App.tsx` (the Vite template's)
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `<App />`, routing `/` → Today, `/poids`, `/calories`, `/course`, `/moi`. Plans 3 fills the last four; this task gives each a placeholder heading so the tab bar is navigable.

**This task also carries precondition 1, which Task 5 built but left unwired.** Task 5 added `openDatabase()` so a failed `db.open()` becomes a value instead of a rejection, and nothing in the project calls it — `grep -rn openDatabase src/` matches only its own definition. The stated purpose was that *the first screen to open the database must be able to say something to the user instead of rendering blank*, and that purpose is still unmet: the repos open Dexie implicitly, so on a device with storage blocked (iOS private browsing, Firefox private windows) the app renders nothing at all. This is the "prose with no owning task" failure this plan warns about in its own preamble; building a value-returning wrapper satisfied Task 5's tests without satisfying the requirement.

The shell must `await openDatabase()` before it gates on `getCurrentUserId`/`getSettings`, and on `{ ok: false }` render a French explanation rather than a blank page or a spinner that never resolves — distinguish `reason: 'blocked'` (tell her the browser is blocking storage, and that private browsing is the usual cause) from `'unknown'`. Test both branches by making `openDatabase` resolve to each.

**Call it from a `useEffect` with `useState`, never from inside the `useLiveQuery` querier.** `db.open()` runs any pending schema upgrade, and an upgrade writes — which is the `ReadOnlyError` trap in the Global Constraints all over again, except it would only fire on the devices that happen to need the migration, i.e. existing users and never a fresh test database. The gate must resolve before the querier's result is trusted, so the shell has three states and not two: still opening, failed to open, and open.

**The code block below does not do any of this, and the test list does not cover it. Both need extending — do not simply transcribe them.** I added the requirement above as prose and left the block and the tests untouched, which is precisely the defect the requirement is about. Said plainly so the next reader does not transcribe a block that is knowingly incomplete.

The shell therefore holds two independent pieces of state:

```tsx
// 'opening' until openDatabase resolves; then the result. Separate from the
// useLiveQuery state below, which must not be trusted until this is ok.
const [open, setOpen] = useState<OpenResult | 'opening'>('opening');
useEffect(() => {
  let cancelled = false;
  void openDatabase().then((result) => { if (!cancelled) setOpen(result); });
  return () => { cancelled = true; };
}, []);

if (open === 'opening') return <div className="app"><p>Un instant\u2026</p></div>;
if (!open.ok) return <StorageBlocked reason={open.reason} />;
// Only now is the querier's result meaningful.
```

`StorageBlocked` is French copy, not a stack trace: on `'blocked'` say the browser is preventing Ruban from saving anything and that private browsing is the usual reason; on `'unknown'` say something went wrong opening her data and suggest reloading. Neither message should read as though her data is lost, because it is not — it is unreachable from this browsing context.

**Two tests this task owes beyond the three in the block**, both by stubbing `openDatabase` with `vi.mock` so it resolves to each failure shape:

**These five do not cover the plan's own stated requirement that "the gate must resolve before the querier's result is trusted", and a sixth test is needed.** Moving the open gate *below* `if (!state)` leaves all five green, because a test database always opens, so the querier always resolves and the ordering is invisible. The case that sees it reproduces a real blocked device, where the querier never resolves at all: mock `getCurrentUserId` to return a never-resolving promise and assert the blocked panel still appears. Without it, the shell could render a spinner forever on exactly the devices this precondition exists for.

5. `{ ok: false, reason: 'blocked' }` renders the storage-blocked copy, and renders neither onboarding nor the Today screen. Prove it discriminates by also asserting the blocked copy is **absent** on the success path — otherwise a component that always renders it would pass.
6. `{ ok: false, reason: 'unknown' }` renders the generic copy rather than the blocked copy. The two branches must be distinguishable in the DOM; if they render identical text, no test can tell them apart and the `reason` field is decorative — the same defect as Task 9's two `Confetti` branches, which both rendered an anonymous `motion.div`.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { saveSettings } from '@/db/repos';
import { App } from '@/app/App';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.settings.clear(), db.meta.clear(), db.dayLogs.clear(), db.weekPlans.clear()]);
});

describe('App', () => {
  it('shows onboarding when no settings exist', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Commencer' })).toBeInTheDocument();
  });

  it('shows Today once settings exist', async () => {
    await db.meta.put({ key: 'currentUserId', value: 'u1' });
    await saveSettings({
      userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-01',
      startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
      weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
      calorieFloor: 1200, stepTarget: 8000, waterTarget: 6,
      runSessionsTarget: 5, soundEnabled: false,
    });
    render(<App />);
    expect(await screen.findByTestId('countdown')).toBeInTheDocument();
  });

  it('offers all five tabs', async () => {
    await db.meta.put({ key: 'currentUserId', value: 'u1' });
    await saveSettings({
      userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-01',
      startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
      weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
      calorieFloor: 1200, stepTarget: 8000, waterTarget: 6,
      runSessionsTarget: 5, soundEnabled: false,
    });
    render(<App />);
    for (const name of ['Aujourd\u2019hui', 'Poids', 'Calories', 'Course', 'Moi']) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- App`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/app/app.css`:

```css
.tabbar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  display: flex;
  justify-content: space-around;
  gap: 4px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  padding-top: 8px;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
}
.tabbar a {
  flex: 1;
  text-align: center;
  text-decoration: none;
  color: var(--ink-soft);
  font-size: var(--step--1);
  font-weight: 500;
  padding: 4px 2px;
}
.tabbar a[aria-current="page"] { color: var(--cerise); }
```

`src/app/TabBar.tsx`:

```tsx
import { NavLink } from 'react-router';
import '@/app/app.css';

const TABS = [
  { to: '/', label: 'Aujourd\u2019hui' },
  { to: '/poids', label: 'Poids' },
  { to: '/calories', label: 'Calories' },
  { to: '/course', label: 'Course' },
  { to: '/moi', label: 'Moi' },
];

export function TabBar() {
  return (
    <nav className="tabbar">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.to === '/'}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

`src/app/App.tsx`:

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { BrowserRouter, Route, Routes } from 'react-router';
import { getCurrentUserId } from '@/app/session';
import { TabBar } from '@/app/TabBar';
import { getSettings } from '@/db/repos';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { Today } from '@/features/today/Today';

/** Placeholder screens; Plan 3 replaces each one. */
function Soon({ title }: { title: string }) {
  return <h1 className="today__date">{title}</h1>;
}

export function App() {
  const state = useLiveQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return { userId: null, hasSettings: false };
    return { userId, hasSettings: (await getSettings(userId)) !== undefined };
  }, []);

  if (!state) return <div className="app"><p>Un instant\u2026</p></div>;

  if (!state.userId || !state.hasSettings) {
    // useLiveQuery re-runs on the settings write, so no explicit callback is needed.
    return <div className="app"><Onboarding onDone={() => {}} /></div>;
  }

  const userId = state.userId;

  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Today userId={userId} />} />
          <Route path="/poids" element={<Soon title="Poids" />} />
          <Route path="/calories" element={<Soon title="Calories" />} />
          <Route path="/course" element={<Soon title="Course" />} />
          <Route path="/moi" element={<Soon title="Moi" />} />
        </Routes>
      </div>
      <TabBar />
    </BrowserRouter>
  );
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/ui/tokens.css';
import '@/ui/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Run the tests and the whole suite**

Run: `npm test -- App`
Expected: PASS, 5 tests — the three in the block plus the two open-failure branches.

Run: `npm test && npx tsc -b`
Expected: everything PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git rm -f src/App.tsx
git add src/app src/main.tsx
git commit -m "feat: add app shell, routing and the bottom tab bar"
```

---

### Task 12: Use it for real


**Sweep the Vite template's leftovers first.** `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg` and `public/icons.svg` were referenced only by the template `src/App.tsx` that Task 11 deleted, and nothing references them now. `vite build` tree-shakes what is not imported, so they cost nothing shipped — but they are dead files in a public repository. Confirm with `grep -rln` over `src` and `index.html` before deleting, and leave `public/favicon.svg`, which `index.html` still uses.
Not a code task. The point of Plan 2 is that the app becomes usable, and that claim needs checking against a real device before Plan 3 starts.

- [ ] **Step 1: Deploy**

```bash
npx vercel --prod
```

Accept the defaults; the framework preset is Vite. Note the URL.

- [ ] **Step 2: Add it to your phone's home screen and complete onboarding**

Enter your real starting weight and target. Confirm the implied weekly rate reads sensibly.

- [ ] **Step 3: Tick a full day and confirm three things**

- Each tick ties a bow with a spring.
- Completing every applicable item fires the bow shower exactly once, and reloading does not re-fire it.
- The streak reads 1, and the countdown matches the days left to 12 November.

- [ ] **Step 4: Record what is wrong**

Write anything that felt off into `docs/superpowers/notes/plan-2-feedback.md` — wording, tap targets, the palette in daylight versus at night. Plan 3 is written against real use, not against the spec alone.

```bash
git add docs/superpowers/notes/plan-2-feedback.md
git commit -m "docs: record first-use feedback on the Today screen"
```

---

## Plan 2 Done When

- `npm test` and `npx tsc -b` are clean.
- No component touches a **table** from `src/db/schema` — table access goes through `src/db/repos` or a hook, so nothing bypasses the repos' `updatedAt` stamping and outbox push. `src/app/App.tsx` importing `openDatabase` is the one allowed exception and is not really one: `openDatabase` touches no table, it is the open gate itself, and the shell is by definition the only place that can run it. I first wrote this line as "no component imports from `src/db/schema` directly", which Task 11 then had to violate to satisfy its own brief — the rule's purpose was always about table access, so it now says that.
- Verify no rule logic leaked into components: `grep -rE "(noDinnerDays|runDays)\.includes" src/features/` returns nothing.
- Both themes render legibly, and `prefers-reduced-motion` replaces the bow shower with a pulse.
- The app is installed on your phone and you have validated at least one real day.
