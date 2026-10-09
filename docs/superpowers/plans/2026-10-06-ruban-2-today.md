# Ruban Plan 2 — The App You Can Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The design system, onboarding, and the Today screen — checklist with bow ticks, streak, joker, countdown, rewards — running local-only on Plan 1's domain and Dexie layers. At the end of this plan the app is in daily use.

**Architecture:** React reads Dexie through `dexie-react-hooks`' `useLiveQuery`, so a write anywhere re-renders every dependent screen with no state manager. Screens assemble plain values and hand them to Plan 1's pure functions; no rule is re-implemented in a component. The design system is CSS custom properties on `:root` plus a handful of primitives — no CSS framework.

**Tech Stack:** React 19, React Router 7, `dexie-react-hooks`, `framer-motion`, Vitest + `@testing-library/react` + jsdom. Web Audio API for the reward sound (no audio asset, so nothing to load or cache).

**Spec:** `docs/superpowers/specs/2026-10-06-coquette-tracker-design.md`

**Depends on:** Plan 1 complete (`docs/superpowers/plans/2026-10-06-ruban-1-foundation.md`).

## Required before the first screen reads the database

Three items carried out of Plan 1's final review. All are latent there — Plan 1 has no
runtime database consumer — and all become reachable the moment a screen opens Dexie.

**Each is allocated to the task that first needs it: (1) → Task 5, (2) → Task 6, (3) → Task 7.** They were prose with no task until the pre-flight scan caught it — the same defect as a spec section with no owner.

1. **A `version(2)` upgrade that de-duplicates, plus an open-failure path.** Plan 1 made
   `dayLogs`, `weights` and `weekPlans` unique on their natural key *in place* under
   `version(1)`. This was probed against real Dexie + fake-indexeddb: an existing database
   holding two rows with the same `(userId, date)` **cannot be opened at all** — `db.open()`
   rejects with `AbortError`/`ConstraintError`, and **bumping the version alone does not
   help**, because IndexedDB cannot build a unique index over data that already violates it.
   So add a `version(2)` whose `upgrade` merges duplicate `(userId, date)` and
   `(userId, isoWeek)` rows by `updatedAt` *before* the unique index is declared, and give
   `db.open()` a rejection handler that tells the user something recoverable rather than
   rendering a blank screen. Nothing in `src/` handles an open rejection today.

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

Identical to Plan 1's Global Constraints section — read it there; every item applies here. The ones this plan exercises directly:

- **Palette:** ground `#F7E3E6`, surface `#FFFBF7`, inset `#FDF2F4`, rose `#E89BB0`, cerise `#C2567A`, ink `#6E2B45`, ink-soft `#9A6579`, line `#EDCCD6`. Dark: ground `#1B0F15`, surface `#2A1821`, inset `#231420`, ink `#F7E5EA`, ink-soft `#C098AA`, rose `#EFA6BA`, cerise `#F57FA6`, line `#412833`.
- **Type:** Cormorant Garamond (display — weight, streak, countdown), Jost (UI, body, labels), Caveat (sparingly). Never Nunito.
- **A ticked box ties a bow** — the checked state is an SVG ribbon, not a checkmark.
- **All copy French, tutoiement.** Decimal comma (`62,4`), thin-space thousands (`8 000`).
- **Every animation respects `prefers-reduced-motion`,** degrading to a crossfade.
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
  --ink-soft: #9A6579;
  --rose: #E89BB0;
  --cerise: #C2567A;
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
    expect(kcal(2400)).toBe('2 400');
    expect(kcal(900)).toBe('900');
    expect(kcal(-300)).toBe('−300');
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

const NARROW_NBSP = ' ';
const MINUS = '−';

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
npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

In `vite.config.ts`, **replace only the `environment: 'node'` line** with the two lines below. Leave `include` and `env` exactly as they are — in particular **keep `env: { TZ: 'Europe/Paris' }`**, which Plan 1's fix wave added so the DST cases can actually fail; dropping it silently returns them to proving nothing. Do not replace the whole `test` block, and do not add a second `environment` key (two would silently keep the first).

```ts
environment: 'jsdom',
setupFiles: ['./src/test-setup.ts'],
```

After editing, confirm the block still contains `include`, `env.TZ` and exactly one `environment` key.

Create `src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
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

  it('shows the current value', () => {
    render(<Stepper label="Eau" value={3} min={0} max={10} step={1} onChange={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
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
        −
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
  - `openDatabase(): Promise<{ ok: true } | { ok: false; reason: 'corrupt' | 'unknown'; error: unknown }>` in `src/db/schema.ts`

**This task also carries precondition 1, because it is the first code that opens the database.**

Plan 1 declared `dayLogs`, `weights` and `weekPlans` unique on their natural key *in place* under `version(1)`. That was probed against real Dexie: a database that already holds two rows sharing a `(userId, date)` **cannot be opened at all** — `db.open()` rejects with `AbortError`/`ConstraintError` — and **bumping the version alone does not fix it**, because IndexedDB cannot build a unique index over data that already violates it. So:

1. Add a `version(2)` to `RubanDb` declaring the same stores, whose `.upgrade(tx)` walks `dayLogs`, `weights` and `weekPlans`, groups rows by their natural key, keeps the one with the newest `updatedAt` and deletes the rest. The de-duplication must happen in the upgrade, before the unique index is rebuilt.
2. Add `openDatabase()` wrapping `db.open()` in a try/catch that returns a discriminated result rather than throwing, so the app can render something recoverable instead of a blank screen. Nothing in `src/` handles an open rejection today.

Tests: a fresh database opens with `{ ok: true }`; and — the one that matters — seed a `version(1)` database containing two `dayLogs` rows with the same `(userId, date)` and different ids, then open at `version(2)` and assert it succeeds with exactly one row surviving, the newer `updatedAt` one. Write that second test first and watch it fail against a `version(2)` with no `upgrade` body, so you know it is the de-duplication being tested and not the version bump.

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

  it('is idempotent — the id never changes once created', async () => {
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
  const existing = await getCurrentUserId();
  if (existing) return existing;
  const id = newId();
  await db.meta.put({ key: CURRENT_USER_KEY, value: id });
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

**This task also carries precondition 2, because it is the first code to write and read a timezone.**

Onboarding stores `Intl.DateTimeFormat().resolvedOptions().timeZone`, and every later screen reads it back and hands it to `todayIn`. Two gaps close here:

1. Add `isValidTimeZone(tz: string): boolean` to `src/domain/calendar.ts` — a `try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true } catch { return false }`. Onboarding falls back to `'UTC'` when the detected zone fails it, rather than storing a value that makes `todayIn` throw `RangeError` on every later render.
2. Make `todayIn` **throw** when `formatToParts` omits a part, instead of its current `?? ''`, which would return a malformed date such as `2026--06`. A wrong day is a bug; a malformed string that flows into every date comparison is worse.

Tests: `isValidTimeZone` accepts `'Europe/Paris'` and rejects `'Not/AZone'`; onboarding stores a non-empty, valid zone. Both are one-liners.

Fields, with defaults: poids de départ (empty), objectif (empty), date objectif (`2026-11-12`), cible calories (`1500`), allocation sans dîner (`900`), seuil minimum (`1200`), objectif de pas (`8000`), verres d'eau (`6`), sorties par semaine (`5`). Timezone is detected via `Intl.DateTimeFormat().resolvedOptions().timeZone` and not asked. `startDate` is today. The implied weekly rate is displayed live once both weights are entered — shown, never enforced, never editorialised.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
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
    expect(await screen.findByText(/par semaine/)).toBeInTheDocument();
  });

  it('refuses to submit without both weights', async () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    expect(onDone).not.toHaveBeenCalled();
    expect(await db.settings.count()).toBe(0);
  });

  it('writes a settings row and calls onDone', async () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66');
    await userEvent.type(screen.getByLabelText('Objectif'), '62.3');
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));

    expect(onDone).toHaveBeenCalled();
    const settings = (await db.settings.toArray())[0];
    expect(settings?.startWeight).toBe(66);
    expect(settings?.targetWeight).toBe(62.3);
    expect(settings?.goalDate).toBe('2026-11-12');
    expect(settings?.dailyCalorieTarget).toBe(1500);
    expect(settings?.noDinnerAllowance).toBe(900);
    expect(settings?.runSessionsTarget).toBe(5);
    expect(settings?.soundEnabled).toBe(false);
    expect(settings?.timezone.length).toBeGreaterThan(0);
  });

  it('accepts a decimal comma as well as a point', async () => {
    render(<Onboarding onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Poids de départ'), '66,5');
    await userEvent.type(screen.getByLabelText('Objectif'), '62,3');
    await userEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    expect((await db.settings.toArray())[0]?.startWeight).toBe(66.5);
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
  font: inherit; color: var(--ink);
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
import { todayIn } from '@/domain/calendar';
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
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

  const start = parseDecimal(startWeight);
  const target = parseDecimal(targetWeight);
  const startDate = todayIn(timezone);

  const rate = start !== null && target !== null
    ? impliedWeeklyRate({ startDate, startWeight: start, targetWeight: target, goalDate })
    : null;

  async function submit() {
    if (start === null || target === null) {
      setError('Il me faut ton poids de départ et ton objectif.');
      return;
    }
    const userId = await ensureLocalUser();
    await saveSettings({
      userId,
      timezone,
      startDate,
      startWeight: start,
      targetWeight: target,
      goalDate,
      weighInCadence: 'daily',
      dailyCalorieTarget: Number(dailyCalorieTarget),
      noDinnerAllowance: Number(noDinnerAllowance),
      calorieFloor: Number(calorieFloor),
      stepTarget: Number(stepTarget),
      waterTarget: Number(waterTarget),
      runSessionsTarget: Number(runSessionsTarget),
      soundEnabled: false,
    });
    onDone();
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

      {error && <p className="onb__err">{error}</p>}

      <Button onClick={submit}>Commencer</Button>
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

**Interfaces:**
- Consumes: repos, `useLiveQuery`, every relevant domain function.
- Produces:
  - `export interface TodayView { date; settings; plan; log; items; validated; streak; daysLeft; cycleComplete; jokerAvailable; weeklyRemaining; weeklyBudget }`
  - `useToday(userId: string): TodayView | undefined`
  - `buildTodayView(input: TodayInputs): TodayView` — the pure assembler, which is what the test exercises
  - `export interface TodayInputs { date; settings; plan; log; dayLogs; runsToday; calorieEntriesToday; calorieEntriesWeek }`

Splitting the pure `buildTodayView` out of the hook is deliberate: the assembly logic is where a wrong argument order would hide, and a pure function can be tested without rendering anything.

**This task also carries precondition 3.** It calls both `getWeekPlan` (read-only, returns `undefined` for a tombstoned row) and `getOrCreateDayLog` (returns a tombstoned row as if it were live). Decide deliberately and write the decision into a comment: **a tombstoned day log must not be treated as today's log.** Only Plan 4's pull can tombstone one, so this is not reachable yet — but the hook is where it would surface, and discovering it later means a user's ticks vanishing into an invisible row. If `getOrCreateDayLog` returns a row whose `deletedAt` is non-null, treat the day as unlogged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildTodayView, type TodayInputs } from '@/features/today/useToday';
import { DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS, type DayLog, type Settings, type WeekPlan } from '@/domain/types';

const settings: Settings = {
  userId: 'u1', timezone: 'Europe/Paris',
  startDate: '2026-10-01', startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false, updatedAt: '',
};

const plan: WeekPlan = {
  id: 'p1', userId: 'u1', isoWeek: '2026-W41',
  runDays: [...DEFAULT_RUN_DAYS], noDinnerDays: [...DEFAULT_NO_DINNER_DAYS],
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
    const view = buildTodayView(inputs({ date: '2026-11-13' }));
    expect(view.cycleComplete).toBe(true);
  });

  it('builds a Tuesday checklist without no_dinner', () => {
    expect(buildTodayView(inputs()).items.map((i) => i.id))
      .toEqual(['course', 'calories', 'steps', 'water']);
  });

  it('validates the day when every applicable item is satisfied', () => {
    const view = buildTodayView(inputs({
      runsToday: [{ date: '2026-10-06', distanceKm: 5, durationS: 1500 }],
      calorieEntriesToday: [{ date: '2026-10-06', kcal: 1400 }],
      log: log({ steps: 8200, waterGlasses: 6 }),
    }));
    expect(view.validated).toBe(true);
  });

  it('computes the weekly remaining from the week entries, not the day entries', () => {
    const view = buildTodayView(inputs({
      calorieEntriesWeek: [
        { date: '2026-10-05', kcal: 1450 },
        { date: '2026-10-06', kcal: 1400 },
      ],
    }));
    expect(view.weeklyBudget).toBe(5 * 1500 + 2 * 900);
    expect(view.weeklyRemaining).toBe(5 * 1500 + 2 * 900 - 2850);
  });

  it('counts the streak from the supplied day logs', () => {
    const view = buildTodayView(inputs({
      dayLogs: [
        log({ date: '2026-10-04', validatedAt: '2026-10-04T21:00:00Z' }),
        log({ date: '2026-10-05', validatedAt: '2026-10-05T21:00:00Z' }),
      ],
    }));
    expect(view.streak).toBe(2);
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
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- useToday`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import {
  getOrCreateDayLog, getSettings, getWeekPlan, listCalorieEntries,
  listDayLogs, listRuns,
} from '@/db/repos';
import {
  dayCalorieTotal, weekCalorieTotal,
  weeklyBudget as computeWeeklyBudget, weeklyRemaining,
} from '@/domain/budget';
import { datesOfIsoWeek, isoWeekOf, todayIn } from '@/domain/calendar';
import {
  effectiveWeekPlan, evaluateChecklist, isDayValidated,
  type ChecklistItem, type ChecklistPlan,
} from '@/domain/checklist';
import { canUseJoker, currentStreak } from '@/domain/streak';
import { daysUntil, isCycleComplete } from '@/domain/trajectory';
import type { DayLog, IsoDate, Settings, WeekPlan } from '@/domain/types';

interface RunRow { date: IsoDate; distanceKm: number; durationS: number }
interface CalorieRow { date: IsoDate; kcal: number }

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
   *  stored row — the row may not exist until the week is first edited. */
  plan: ChecklistPlan;
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
  // §4.7's sums come from the domain, not from each screen re-deriving them.
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
  // The current day's own row may not be in dayLogs yet.
  coverage.push({ date: log.date, validatedAt: log.validatedAt, jokered: log.jokered });

  return {
    date, settings, plan, log, items,
    validated: isDayValidated(items),
    streak: currentStreak(coverage, date, settings.startDate),
    daysLeft: daysUntil(settings.goalDate, date),
    cycleComplete: isCycleComplete(settings.goalDate, date),
    jokerAvailable: canUseJoker({
      date, today: date, startDate: settings.startDate,
      coverage: { date, validatedAt: log.validatedAt, jokered: log.jokered },
      weekPlanJokerUsedOn: plan.jokerUsedOn,
    }),
    weeklyBudget: computeWeeklyBudget(week, plan, settings),
    weeklyRemaining: weeklyRemaining(week, plan, settings, consumedThisWeek),
  };
}

export function useToday(userId: string): TodayView | undefined {
  return useLiveQuery(async () => {
    const settings = await getSettings(userId);
    if (!settings) return undefined;

    const date = todayIn(settings.timezone);
    const week = isoWeekOf(date);
    const weekDates = new Set(datesOfIsoWeek(week));

    const [plan, log, dayLogs, runs, calorieEntries] = await Promise.all([
      // Read-only for the plan: opening the app must not invent a week plan.
      getWeekPlan(userId, week),
      // getOrCreate for today's log, deliberately: the user is here to tick it,
      // syncStamps writes to it anyway, and a row for today is a real fact.
      getOrCreateDayLog(userId, date),
      listDayLogs(userId),
      listRuns(userId),
      listCalorieEntries(userId),
    ]);

    return buildTodayView({
      date, settings, plan, log, dayLogs,
      runsToday: runs.filter((r) => r.date === date),
      calorieEntriesToday: calorieEntries.filter((e) => e.date === date),
      calorieEntriesWeek: calorieEntries.filter((e) => weekDates.has(e.date)),
    });
  }, [userId]);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- useToday`
Expected: PASS, 9 tests.

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

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { getOrCreateDayLog } from '@/db/repos';
import { syncStamps } from '@/features/today/stamps';
import type { TodayView } from '@/features/today/useToday';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.dayLogs.clear(), db.outbox.clear()]);
});

async function view(validated: boolean): Promise<TodayView> {
  const log = await getOrCreateDayLog('u1', '2026-10-06');
  return { date: '2026-10-06', log, validated } as unknown as TodayView;
}

describe('syncStamps', () => {
  it('does nothing while the day is incomplete', async () => {
    const result = await syncStamps('u1', await view(false));
    expect(result).toEqual({ validatedNow: false, fireBonus: false });
    const log = await getOrCreateDayLog('u1', '2026-10-06');
    expect(log.validatedAt).toBeNull();
  });

  it('stamps validatedAt and fires the bonus on first completion', async () => {
    const result = await syncStamps('u1', await view(true));
    expect(result).toEqual({ validatedNow: true, fireBonus: true });
    const log = await getOrCreateDayLog('u1', '2026-10-06');
    expect(log.validatedAt).not.toBeNull();
    expect(log.bonusFiredAt).not.toBeNull();
  });

  it('never fires the bonus twice', async () => {
    await syncStamps('u1', await view(true));
    const again = await syncStamps('u1', await view(true));
    expect(again.fireBonus).toBe(false);
  });

  it('never clears validatedAt once stamped', async () => {
    await syncStamps('u1', await view(true));
    await syncStamps('u1', await view(false));
    const log = await getOrCreateDayLog('u1', '2026-10-06');
    expect(log.validatedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- stamps`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { nowIso } from '@/db/ids';
import { updateDayLog } from '@/db/repos';
import type { TodayView } from '@/features/today/useToday';

export interface StampResult {
  validatedNow: boolean;
  fireBonus: boolean;
}

/**
 * Stamps are facts about what happened; targets are settings. So validatedAt
 * is written once and never cleared, and the bonus fires exactly once.
 */
export async function syncStamps(userId: string, view: TodayView): Promise<StampResult> {
  if (!view.validated) return { validatedNow: false, fireBonus: false };

  const alreadyValidated = view.log.validatedAt !== null;
  const alreadyFired = view.log.bonusFiredAt !== null;
  if (alreadyValidated && alreadyFired) {
    return { validatedNow: false, fireBonus: false };
  }

  const stamp = nowIso();
  await updateDayLog(userId, view.date, {
    validatedAt: view.log.validatedAt ?? stamp,
    bonusFiredAt: view.log.bonusFiredAt ?? stamp,
  });

  return { validatedNow: !alreadyValidated, fireBonus: !alreadyFired };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- stamps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/today/stamps.ts src/features/today/stamps.test.ts
git commit -m "feat: stamp day validation and fire the bonus once"
```

---

### Task 9: Reward feedback

**Files:**
- Create: `src/ui/reward.ts`, `src/ui/Confetti.tsx`
- Test: `src/ui/reward.test.ts`

**Interfaces:**
- Produces:
  - `playTick(enabled: boolean): void` — a soft two-note pluck
  - `playFanfare(enabled: boolean): void` — the completed-day chime
  - `<Confetti active />` — a one-shot shower of bows and hearts

Synthesised through the Web Audio API rather than shipped as a file: nothing to download, nothing to cache, and no CSP question. Both functions return immediately when `enabled` is false, so the default-off sound setting costs nothing.

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
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'var(--rose)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.22, 0] }}
        transition={{ duration: 0.9 }}
      />
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
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
git add src/ui/reward.ts src/ui/reward.test.ts src/ui/Confetti.tsx
git commit -m "feat: add synthesised reward sounds and the bow shower"
```

---

### Task 10: The Today screen

**Files:**
- Create: `src/features/today/Today.tsx`, `src/features/today/Checklist.tsx`, `src/features/today/StreakCard.tsx`, `src/features/today/today.css`
- Test: `src/features/today/Today.test.tsx`

**Interfaces:**
- Consumes: `useToday`, `syncStamps`, `updateDayLog`, `updateWeekPlan`, primitives, `playTick`, `playFanfare`, `Confetti`.
- Produces: `<Today userId />`.

French labels, exactly: `course` → "Course", `calories` → "Calories respectées", `no_dinner` → "Pas de dîner", `steps` → "Pas", `water` → "Eau".

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { saveSettings } from '@/db/repos';
import { Today } from '@/features/today/Today';

beforeEach(async () => {
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
  });

  it('persists a manual tick', async () => {
    render(<Today userId="u1" />);
    const box = await screen.findByRole('checkbox', { name: 'Calories respectées' });
    await userEvent.click(box);
    await waitFor(async () => {
      const log = await db.dayLogs.toCollection().first();
      expect(log?.ticks.calories).toBe(true);
    });
  });

  it('shows the weekly calorie remainder', async () => {
    render(<Today userId="u1" />);
    expect(await screen.findByTestId('week-remaining')).toBeInTheDocument();
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
.today__week { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.today__weeknum { font-family: var(--font-display); font-size: var(--step-2); }
.today__joker { margin: 0; color: var(--ink-soft); }
.today__done { font-family: var(--font-hand); font-size: var(--step-2); color: var(--cerise); margin: 0; }
```

`src/features/today/Checklist.tsx`:

```tsx
import type { ChecklistItem, ChecklistItemId } from '@/domain/checklist';
import type { TickableItemId } from '@/domain/types';
import { BowCheckbox } from '@/ui/BowCheckbox';

const LABELS: Record<ChecklistItemId, string> = {
  course: 'Course',
  calories: 'Calories respectées',
  no_dinner: 'Pas de dîner',
  steps: 'Pas',
  water: 'Eau',
};

const TICKABLE: ChecklistItemId[] = ['course', 'calories', 'no_dinner'];

export function Checklist({
  items, onToggle,
}: {
  items: ChecklistItem[];
  onToggle: (id: TickableItemId, next: boolean) => void;
}) {
  return (
    <div className="today__items">
      {items
        .filter((item) => TICKABLE.includes(item.id))
        .map((item) => (
          <BowCheckbox
            key={item.id}
            label={LABELS[item.id]}
            checked={item.satisfied}
            onChange={(next) => onToggle(item.id as TickableItemId, next)}
          />
        ))}
    </div>
  );
}

export { LABELS as CHECKLIST_LABELS };
```

`src/features/today/StreakCard.tsx`:

```tsx
import { plural } from '@/ui/format';
import { Button } from '@/ui/Button';
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
          <Pill>J−{daysLeft}</Pill>
        </span>
      </div>
      {jokerAvailable && (
        <div>
          <p className="today__joker">Un imprévu&nbsp;? Il te reste ton joker de la semaine.</p>
          <Button variant="quiet" onClick={onUseJoker}>Utiliser mon joker</Button>
        </div>
      )}
    </>
  );
}
```

`src/features/today/Today.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { updateDayLog, updateWeekPlan } from '@/db/repos';
import { isoWeekOf } from '@/domain/calendar';
import type { TickableItemId } from '@/domain/types';
import { Card } from '@/ui/Card';
import { Confetti } from '@/ui/Confetti';
import { kcal, longDate } from '@/ui/format';
import { playFanfare, playTick } from '@/ui/reward';
import { Stepper } from '@/ui/Stepper';
import { Checklist } from '@/features/today/Checklist';
import { StreakCard } from '@/features/today/StreakCard';
import { syncStamps } from '@/features/today/stamps';
import { useToday } from '@/features/today/useToday';
import '@/features/today/today.css';

export function Today({ userId }: { userId: string }) {
  const view = useToday(userId);
  const [celebrating, setCelebrating] = useState(false);

  // Stamp validation and fire the bonus whenever the view says the day is done.
  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    void syncStamps(userId, view).then((result) => {
      if (cancelled || !result.fireBonus) return;
      playFanfare(view.settings.soundEnabled);
      setCelebrating(true);
      window.setTimeout(() => setCelebrating(false), 2600);
    });
    return () => { cancelled = true; };
  }, [userId, view?.validated, view?.log.bonusFiredAt]);

  if (!view) return <p>Un instant…</p>;

  const sound = view.settings.soundEnabled;

  async function toggle(id: TickableItemId, next: boolean) {
    playTick(sound);
    await updateDayLog(userId, view!.date, { ticks: { [id]: next } });
  }

  return (
    <div className="today">
      <Confetti active={celebrating} />

      <StreakCard
        streak={view.streak}
        daysLeft={view.daysLeft}
        jokerAvailable={view.jokerAvailable}
        onUseJoker={async () => {
          await updateDayLog(userId, view.date, { jokered: true });
          await updateWeekPlan(userId, isoWeekOf(view.date), { jokerUsedOn: view.date });
        }}
      />

      <Card laced>
        <h1 className="today__date">{longDate(view.date)}</h1>
        <Checklist items={view.items} onToggle={toggle} />

        <div className="today__amount">
          <span>Pas · objectif {view.settings.stepTarget}</span>
          <input
            aria-label="Pas"
            inputMode="numeric"
            value={view.log.steps ?? ''}
            onChange={(event) => {
              const raw = event.target.value.trim();
              void updateDayLog(userId, view.date, { steps: raw === '' ? null : Number(raw) });
            }}
            style={{
              width: '6ch', font: 'inherit', textAlign: 'right', color: 'var(--ink)',
              background: 'var(--inset)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '6px 8px',
            }}
          />
        </div>

        <div className="today__amount">
          <span>Eau · objectif {view.settings.waterTarget}</span>
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

        {view.validated && <p className="today__done">Journée validée.</p>}
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
Expected: PASS, 4 tests.

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
    for (const name of ['Aujourd’hui', 'Poids', 'Calories', 'Course', 'Moi']) {
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
  { to: '/', label: 'Aujourd’hui' },
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

  if (!state) return <div className="app"><p>Un instant…</p></div>;

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
Expected: PASS.

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
- No component imports from `src/db/schema` directly — only through `src/db/repos` or a hook.
- Verify no rule logic leaked into components: `grep -rE "(noDinnerDays|runDays)\.includes" src/features/` returns nothing.
- Both themes render legibly, and `prefers-reduced-motion` replaces the bow shower with a pulse.
- The app is installed on your phone and you have validated at least one real day.
