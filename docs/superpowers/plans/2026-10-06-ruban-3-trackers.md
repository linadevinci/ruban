# Ruban Plan 3 — The Trackers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four remaining screens — Poids, Calories, Course, Moi — completing the local-only app against the full feature set of spec §4.6, §4.7, §4.8 and the settings in §5.

**Architecture:** Each screen follows Plan 2's shape: a pure `build*View` assembler tested without rendering, wrapped in a `useLiveQuery` hook. Charts are hand-built SVG over one shared scale module; identity is carried by mark type, never by hue, for the reason recorded in spec §10.

**Tech Stack:** As Plan 2. No charting library — the scale is 40 lines and a library would import its own visual language.

**Spec:** `docs/superpowers/specs/2026-10-06-coquette-tracker-design.md`

**Depends on:** Plans 1 and 2 complete.

## Global Constraints

Plan 1's Global Constraints apply in full. The ones this plan turns on:

**Pre-flight finding: this plan has thirteen `useLiveQuery` uses and no test that renders any of
them against a database.** Two `fake-indexeddb` imports in the whole file, against five screens
that each read Dexie reactively, and the screen tests here are pure view-model cases of the
`reports no average below three weigh-ins` kind. Those are worth having and they cannot catch the
one failure that matters: in Plan 2 a hook that **could never resolve** shipped past 209 passing
tests, because every test exercised the pure view model and none rendered the hook. The cause was a
`getOrCreate*` inside a querier, which Dexie rejects outright, and the screen sat on `undefined`
forever.

So before any screen task here is dispatched, each one owes a test that renders the component
against `fake-indexeddb`, seeds **every table its querier reads**, and asserts real content rather
than the loading state. A defined result is necessary, not sufficient: Plan 2's hook tests seeded
only two tables and left seven wiring lines free to be wrong, including one that re-ran an earlier
Critical finding a level up. `src/features/today/Today.test.tsx` and
`src/features/today/useToday.test.ts` are the shape to copy.

Also verify per screen, since Plan 2 shipped each of these as a defect once:

- **No `getOrCreate*` anywhere a querier can reach it.** Task 4's prose already gets this right for
  the week planner and states both reasons; the rule is global and the repo functions carry warning
  docblocks. `getOrCreateWeekPlan` appearing in a *test* fixture is fine, it is the querier path
  that must stay read-only.
- **Numeric inputs must reject what is not a number.** `inputMode="numeric"` is a keyboard hint and
  does nothing against a desktop keyboard or a paste; `Number('abc')` is `NaN`, and a `NaN` written
  to a target or a weigh-in poisons every comparison that reads it. Good news from the scan: this
  plan's fields already hold a `draft` and commit on save, so the collapsing-digits bug that hit
  Plan 2's steps field is **not** copied forward here, and no raw `Number(raw)` appears.
- **`font-size: 16px` or larger on every text input, placed *after* any `font: inherit`**, which
  resets it. Fourteen inline input styles in this plan need the check; below 16px iOS zooms the page
  on focus.
- **Writes keyed off the date, never off a row id.** A day with no stored row yields a placeholder
  whose `id` is the empty string.
- **The escape rule, as sharpened during Plan 2:** escape the characters that look like an ASCII neighbour (U+202F, U+00A0, U+2212, U+2014, U+2019, U+2026, U+00B7); write accented letters literally (`départ`, not an escape), because they are visibly distinct and cannot be silently substituted. Code comments stay ASCII. Plan 2's Global Constraints carry the full statement.


**Pre-flight, before any task here is dispatched: this plan's code blocks contain literal
confusable characters and they must become `\u` escapes.** A scan counted 17 such lines,
listed at the end of this paragraph. Most are the French right single quote U+2019 in UI strings
(`l’écran`, `c’est`), which renders identically to an ASCII apostrophe and is one careless edit
away from becoming one. **This cannot be done with a bulk search and replace**, because the right
fix depends on context: inside a string or template literal the escape works on its own, but in
JSX *text* it does not — there it must be wrapped in braces as an expression, and a blind
rewrite would emit a literal backslash-u into the rendered page. Em dashes and ellipses inside
code *comments* take plain ASCII rather than an escape, since comments stay ASCII and an escape
in a comment just reads as noise. Work through these by hand at pre-flight.

Lines: 427, 467, 674, 805, 823, 838, 1264, 1631, 1678, 1680, 1738, 1739, 1944, 2253, 2466, 2477, 2497


- **Colour carries no meaning in any chart** (spec §10). Raw weigh-ins = hollow cerise circles; rolling average = 2px solid cerise line (same entity, same colour, deliberately); trajectory = 2px dashed muted-ink reference line, direct-labelled. No legend box.
- **Never a dual-axis chart.** Pace and weekly distance are two separate charts.
- **Every chart ships a "voir les chiffres" table view** and a pointer/touch crosshair.
- **No gridlines** except a hairline at each weekly target.
- **Weekly total falls on no-dinner days** — never redistribute a surplus (spec §4.7).
- **Each `week_plan` is its own snapshot.** Editing next week must not alter a past week.
- All copy French, tutoiement; decimal comma; narrow no-break space in thousands.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/chartScale.ts` | Domain→pixel mapping, tick selection, and the `ChartPoint` type. Pure, tested. |
| `src/ui/Chart.tsx` | SVG frame, axes, crosshair, table view. Takes marks as children. |
| `src/ui/marks.tsx` | `<LineMark>`, `<DotsMark>`, `<DashedMark>`, `<BarsMark>`. |
| `src/features/weight/useWeight.ts` | `buildWeightView` + hook. |
| `src/features/weight/Weight.tsx` | Screen: entry, chart, gap readout. |
| `src/features/calories/useCalories.ts` | `buildCaloriesView` + hook. |
| `src/features/calories/Calories.tsx` | Screen: remaining, day list, quick-add. |
| `src/features/calories/WeekPlanner.tsx` | Per-week no-dinner and run-day toggles. |
| `src/features/running/useRunning.ts` | `buildRunningView` + hook. |
| `src/features/running/Running.tsx` | Screen: log, weekly gauge, two charts. |
| `src/features/settings/Settings.tsx` | Screen "Moi": every adjustable target, floor warnings, sound, theme. |

---

### Task 1: Chart scale

**Files:**
- Create: `src/ui/chartScale.ts`
- Test: `src/ui/chartScale.test.ts`

**Interfaces:**
- Produces:
  - `export interface Box { width: number; height: number; padLeft: number; padRight: number; padTop: number; padBottom: number }`
  - `export interface Domain { x0: number; x1: number; y0: number; y1: number }`
  - `makeScale(domain: Domain, box: Box): { x(v: number): number; y(v: number): number }`
  - `export interface ChartPoint { x: number; y: number; label: string; value: string }` — declared here, not in `Chart.tsx`, so a view model never has to import a React component file to get a data type
  - `niceTicks(min: number, max: number, count: number): number[]`
  - `padDomain(min: number, max: number, fraction: number): { lo: number; hi: number }`

The box carries explicit padding on all four sides because the outermost tick labels must fit *inside* the viewBox — a chart whose labels are clipped is the most common SVG mistake.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { makeScale, niceTicks, padDomain, type Box } from '@/ui/chartScale';

const box: Box = {
  width: 320, height: 200,
  padLeft: 40, padRight: 20, padTop: 16, padBottom: 28,
};

describe('makeScale', () => {
  const scale = makeScale({ x0: 0, x1: 10, y0: 60, y1: 70 }, box);

  it('maps the x domain into the padded width', () => {
    expect(scale.x(0)).toBe(40);
    expect(scale.x(10)).toBe(300);
    expect(scale.x(5)).toBe(170);
  });

  it('inverts y so larger values sit higher', () => {
    expect(scale.y(70)).toBe(16);
    expect(scale.y(60)).toBe(172);
    expect(scale.y(65)).toBe(94);
  });

  it('does not divide by zero on a flat domain', () => {
    const flat = makeScale({ x0: 5, x1: 5, y0: 62, y1: 62 }, box);
    expect(Number.isFinite(flat.x(5))).toBe(true);
    expect(Number.isFinite(flat.y(62))).toBe(true);
  });
});

describe('niceTicks', () => {
  it('returns round values spanning the range', () => {
    const ticks = niceTicks(61.2, 66.4, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0]).toBeLessThanOrEqual(61.2);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(66.4);
    for (const t of ticks) expect(Number.isFinite(t)).toBe(true);
  });

  it('every tick is a value the chart actually reaches', () => {
    const ticks = niceTicks(0, 10, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(10);
  });

  it('survives a flat range', () => {
    expect(niceTicks(62, 62, 4)).toEqual([62]);
  });
});

describe('padDomain', () => {
  it('pads both ends by a fraction of the span', () => {
    expect(padDomain(60, 70, 0.1)).toEqual({ lo: 59, hi: 71 });
  });

  it('pads a flat range by an absolute amount so the line is visible', () => {
    const { lo, hi } = padDomain(62, 62, 0.1);
    expect(lo).toBeLessThan(62);
    expect(hi).toBeGreaterThan(62);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- chartScale`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface Box {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface Domain {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** One plotted observation. `label` and `value` are what the table view renders. */
export interface ChartPoint {
  x: number;
  y: number;
  label: string;
  value: string;
}

export function makeScale(domain: Domain, box: Box) {
  const innerW = box.width - box.padLeft - box.padRight;
  const innerH = box.height - box.padTop - box.padBottom;
  const spanX = domain.x1 - domain.x0 || 1;
  const spanY = domain.y1 - domain.y0 || 1;
  return {
    x(value: number): number {
      return box.padLeft + ((value - domain.x0) / spanX) * innerW;
    },
    y(value: number): number {
      // Inverted: SVG y grows downward.
      return box.padTop + (1 - (value - domain.y0) / spanY) * innerH;
    },
  };
}

/** Round tick values that bracket the range, so every label names a value reached. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / Math.max(count, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = candidates.find((c) => c >= raw) ?? candidates[candidates.length - 1]!;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step / 2; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

export function padDomain(min: number, max: number, fraction: number): { lo: number; hi: number } {
  const span = max - min;
  const pad = span === 0 ? Math.max(Math.abs(min) * 0.01, 0.5) : span * fraction;
  return { lo: min - pad, hi: max + pad };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- chartScale`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/chartScale.ts src/ui/chartScale.test.ts
git commit -m "feat: add chart scale and tick selection"
```

---

### Task 2: Chart frame and marks

**Files:**
- Create: `src/ui/Chart.tsx`, `src/ui/marks.tsx`, `src/ui/chart.css`
- Test: `src/ui/Chart.test.tsx`

**Interfaces:**
- Consumes: `makeScale`, `niceTicks`, `padDomain`, `ChartPoint`.
- Produces:
  - `<Chart title points yFormat referenceLines? targetLineY? children />` where `children` receives the scale via `ChartScaleContext`
  - re-exports `ChartPoint` for convenience
  - `useChartScale()` — the scale inside a `<Chart>`
  - `<LineMark points />`, `<DotsMark points />`, `<DashedMark points label />`, `<BarsMark points />`

`points` is the single series. The crosshair reads from it, and the table view renders `label`/`value` pairs — so values are legible without interpreting any mark, which is the accessibility relief the monochrome palette requires.

- [ ] **Step 1: Write the failing test**

```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Chart, type ChartPoint } from '@/ui/Chart';
import { DotsMark, LineMark } from '@/ui/marks';

const points: ChartPoint[] = [
  { x: 0, y: 66, label: '1 oct', value: '66,0 kg' },
  { x: 1, y: 65.4, label: '2 oct', value: '65,4 kg' },
  { x: 2, y: 65.1, label: '3 oct', value: '65,1 kg' },
];

describe('Chart', () => {
  it('names the series in its own title, so no legend box is needed', () => {
    render(
      <Chart title="Poids" points={points} yFormat={(v) => `${v}`}>
        <LineMark points={points} />
      </Chart>,
    );
    expect(screen.getByText('Poids')).toBeInTheDocument();
    expect(screen.queryByTestId('legend')).not.toBeInTheDocument();
  });

  it('leaves room in the viewBox for the outermost labels', () => {
    render(<Chart title="Poids" points={points} yFormat={(v) => `${v}`}><LineMark points={points} /></Chart>);
    const svg = screen.getByRole('img', { name: /Poids/ });
    // viewBox must start at 0 0 and the drawing is inset by the padding.
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
  });

  it('offers a table view and reveals every value in it', async () => {
    render(<Chart title="Poids" points={points} yFormat={(v) => `${v}`}><LineMark points={points} /></Chart>);
    await userEvent.click(screen.getByRole('button', { name: 'Voir les chiffres' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('66,0 kg')).toBeInTheDocument();
    expect(screen.getByText('65,1 kg')).toBeInTheDocument();
  });

  it('renders an empty state rather than an empty axis', () => {
    render(<Chart title="Poids" points={[]} yFormat={(v) => `${v}`}><LineMark points={[]} /></Chart>);
    expect(screen.getByText('Pas encore assez de données.')).toBeInTheDocument();
  });

  it('gives every drawn shape an explicit fill or stroke', () => {
    render(<Chart title="Poids" points={points} yFormat={(v) => `${v}`}><DotsMark points={points} /></Chart>);
    const circles = document.querySelectorAll('circle');
    expect(circles.length).toBe(3);
    circles.forEach((c) => {
      expect(c.getAttribute('fill')).toBeTruthy();
      expect(c.getAttribute('stroke')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- Chart`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/ui/chart.css`:

```css
.chart { display: flex; flex-direction: column; gap: 8px; }
.chart__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.chart__title { margin: 0; font-family: var(--font-display); font-size: var(--step-1); }
.chart__toggle {
  font: inherit; font-size: var(--step--1);
  background: none; border: 0; color: var(--cerise);
  text-decoration: underline; cursor: pointer; padding: 2px;
}
.chart__svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
.chart__axis { fill: var(--ink-soft); font-size: 10px; font-family: var(--font-ui); }
.chart__grid { stroke: var(--line); stroke-width: 1; }
.chart__empty { color: var(--ink-soft); margin: 0; }
.chart__tip {
  font-size: var(--step--1); color: var(--ink);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 10px; padding: 4px 9px; display: inline-block;
}
.chart__table { width: 100%; border-collapse: collapse; font-size: var(--step--1); }
.chart__table th, .chart__table td {
  text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.chart__wrap { overflow-x: auto; }
```

`src/ui/Chart.tsx`:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { makeScale, niceTicks, padDomain, type Box, type ChartPoint } from '@/ui/chartScale';
import '@/ui/chart.css';

export type { ChartPoint };

export interface ReferenceLine {
  points: { x: number; y: number }[];
  label: string;
}

const BOX: Box = {
  width: 340, height: 200,
  padLeft: 38, padRight: 46, padTop: 14, padBottom: 26,
};

type Scale = ReturnType<typeof makeScale>;
const ChartScaleContext = createContext<Scale | null>(null);

export function useChartScale(): Scale {
  const scale = useContext(ChartScaleContext);
  if (!scale) throw new Error('A mark must be rendered inside <Chart>');
  return scale;
}

export function Chart({
  title, points, yFormat, referenceLines = [], targetLineY, children,
}: {
  title: string;
  points: ChartPoint[];
  yFormat: (value: number) => string;
  referenceLines?: ReferenceLine[];
  /** Hairline at this week's target; the only gridline permitted. */
  targetLineY?: number;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<ChartPoint | null>(null);

  const allY = [
    ...points.map((p) => p.y),
    ...referenceLines.flatMap((r) => r.points.map((p) => p.y)),
    ...(targetLineY === undefined ? [] : [targetLineY]),
  ];

  const scale = useMemo(() => {
    const xs = points.map((p) => p.x);
    const { lo, hi } = padDomain(Math.min(...allY), Math.max(...allY), 0.08);
    return makeScale(
      { x0: Math.min(...xs, 0), x1: Math.max(...xs, 1), y0: lo, y1: hi },
      BOX,
    );
  }, [points, referenceLines, targetLineY]);

  if (points.length === 0) {
    return (
      <div className="chart">
        <div className="chart__head"><h2 className="chart__title">{title}</h2></div>
        <p className="chart__empty">Pas encore assez de données.</p>
      </div>
    );
  }

  const yTicks = niceTicks(Math.min(...allY), Math.max(...allY), 4);

  function onPointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * BOX.width;
    let closest = points[0]!;
    for (const p of points) {
      if (Math.abs(scale.x(p.x) - px) < Math.abs(scale.x(closest.x) - px)) closest = p;
    }
    setHover(closest);
  }

  return (
    <div className="chart">
      <div className="chart__head">
        <h2 className="chart__title">{title}</h2>
        <button type="button" className="chart__toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Voir la courbe' : 'Voir les chiffres'}
        </button>
      </div>

      {showTable ? (
        <div className="chart__wrap">
          <table className="chart__table">
            <thead><tr><th>Date</th><th>{title}</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.x}><td>{p.label}</td><td>{p.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            className="chart__svg"
            viewBox={`0 0 ${BOX.width} ${BOX.height}`}
            role="img"
            aria-label={`${title} — courbe. Utilise « Voir les chiffres » pour le détail.`}
            onPointerMove={onPointer}
            onPointerLeave={() => setHover(null)}
          >
            {yTicks.map((tick) => (
              <text
                key={tick}
                className="chart__axis"
                x={BOX.padLeft - 6}
                y={scale.y(tick) + 3}
                textAnchor="end"
                fill="currentColor"
              >
                {yFormat(tick)}
              </text>
            ))}

            {targetLineY !== undefined && (
              <line
                className="chart__grid"
                x1={BOX.padLeft}
                x2={BOX.width - BOX.padRight}
                y1={scale.y(targetLineY)}
                y2={scale.y(targetLineY)}
                stroke="currentColor"
                strokeOpacity="0.5"
              />
            )}

            <ChartScaleContext.Provider value={scale}>{children}</ChartScaleContext.Provider>

            {hover && (
              <line
                x1={scale.x(hover.x)} x2={scale.x(hover.x)}
                y1={BOX.padTop} y2={BOX.height - BOX.padBottom}
                stroke="var(--ink-soft)" strokeWidth="1" strokeDasharray="2 3"
              />
            )}
          </svg>
          <span className="chart__tip">
            {hover ? `${hover.label} · ${hover.value}` : 'Touche la courbe pour un détail'}
          </span>
        </>
      )}
    </div>
  );
}

export { BOX as CHART_BOX };
```

`src/ui/marks.tsx`:

```tsx
import { CHART_BOX, useChartScale } from '@/ui/Chart';
import type { ChartPoint } from '@/ui/chartScale';

function path(points: { x: number; y: number }[], scale: ReturnType<typeof useChartScale>): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${scale.x(p.x).toFixed(2)} ${scale.y(p.y).toFixed(2)}`)
    .join(' ');
}

/** The hero series: 2px solid cerise. */
export function LineMark({ points }: { points: { x: number; y: number }[] }) {
  const scale = useChartScale();
  if (points.length < 2) return null;
  return (
    <path
      d={path(points, scale)}
      fill="none"
      stroke="var(--cerise)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Raw observations: hollow circles, same hue as the line because it is the same entity. */
export function DotsMark({ points }: { points: { x: number; y: number }[] }) {
  const scale = useChartScale();
  return (
    <>
      {points.map((p) => (
        <circle
          key={`${p.x}-${p.y}`}
          cx={scale.x(p.x)}
          cy={scale.y(p.y)}
          r="3.4"
          fill="var(--surface)"
          stroke="var(--cerise)"
          strokeWidth="1.4"
        />
      ))}
    </>
  );
}

/** A reference line, not a series: recessive, dashed, direct-labelled at its right end. */
export function DashedMark({
  points, label,
}: {
  points: { x: number; y: number }[];
  label: string;
}) {
  const scale = useChartScale();
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  return (
    <>
      <path
        d={path(points, scale)}
        fill="none"
        stroke="var(--ink-soft)"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      <text
        className="chart__axis"
        x={Math.min(scale.x(last.x) + 5, CHART_BOX.width - 2)}
        y={scale.y(last.y) + 3}
        fill="currentColor"
      >
        {label}
      </text>
    </>
  );
}

/** Weekly totals. 4px rounded top, 2px gap between bars, anchored to the baseline. */
export function BarsMark({ points }: { points: ChartPoint[] }) {
  const scale = useChartScale();
  const baseline = CHART_BOX.height - CHART_BOX.padBottom;
  const inner = CHART_BOX.width - CHART_BOX.padLeft - CHART_BOX.padRight;
  const width = Math.max(inner / Math.max(points.length, 1) - 2, 3);
  return (
    <>
      {points.map((p) => {
        const top = scale.y(p.y);
        return (
          <rect
            key={p.x}
            x={scale.x(p.x) - width / 2}
            y={top}
            width={width}
            height={Math.max(baseline - top, 0)}
            rx="4"
            fill="var(--cerise)"
            stroke="none"
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- Chart`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Chart.tsx src/ui/marks.tsx src/ui/chart.css src/ui/Chart.test.tsx
git commit -m "feat: add hand-built chart frame, marks and table view"
```

---

### Task 3: Weight screen

**Files:**
- Create: `src/features/weight/useWeight.ts`, `src/features/weight/Weight.tsx`
- Test: `src/features/weight/useWeight.test.ts`

**Interfaces:**
- Consumes: `listWeights`, `saveWeight`, `getSettings`; `rollingAverage`, `trajectoryAt`, `weeklyIntermediateGoal`, `gapToTrajectory`; `diffDays`, `isoWeekOf`, `todayIn`.
- Produces:
  - `export interface WeightView { today; latestKg; rollingAvg; gap; weekGoal; rawPoints; avgPoints; trajectoryPoints; enoughForAverage }`
  - `buildWeightView(input: WeightInputs): WeightView`
  - `useWeight(userId: string): WeightView | undefined`
  - `<Weight userId />`

`x` on every chart point is `diffDays(settings.startDate, date)`, so all three mark sets share one x scale.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildWeightView, type WeightInputs } from '@/features/weight/useWeight';
import type { Settings } from '@/domain/types';

const settings: Settings = {
  userId: 'u1', timezone: 'Europe/Paris',
  startDate: '2026-10-01', startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false, updatedAt: '',
};

function inputs(weighIns: { date: string; kg: number }[], date = '2026-10-06'): WeightInputs {
  return { date, settings, weighIns };
}

describe('buildWeightView', () => {
  it('reports no average below three weigh-ins', () => {
    const view = buildWeightView(inputs([{ date: '2026-10-06', kg: 65.6 }]));
    expect(view.enoughForAverage).toBe(false);
    expect(view.rollingAvg).toBeNull();
    expect(view.avgPoints).toEqual([]);
  });

  it('reports the latest weigh-in even without an average', () => {
    const view = buildWeightView(inputs([
      { date: '2026-10-04', kg: 65.9 },
      { date: '2026-10-06', kg: 65.6 },
    ]));
    expect(view.latestKg).toBe(65.6);
  });

  it('computes the average and the gap once there are three', () => {
    const view = buildWeightView(inputs([
      { date: '2026-10-04', kg: 65.9 },
      { date: '2026-10-05', kg: 65.7 },
      { date: '2026-10-06', kg: 65.5 },
    ]));
    expect(view.enoughForAverage).toBe(true);
    expect(view.rollingAvg).toBeCloseTo(65.7, 6);
    expect(view.gap).toBeCloseTo(65.7 - view.trajectoryPoints[5]!.y, 6);
  });

  it('shares one x scale across all three mark sets', () => {
    const view = buildWeightView(inputs([
      { date: '2026-10-04', kg: 65.9 },
      { date: '2026-10-05', kg: 65.7 },
      { date: '2026-10-06', kg: 65.5 },
    ]));
    // x = days since startDate.
    expect(view.rawPoints.map((p) => p.x)).toEqual([3, 4, 5]);
    expect(view.trajectoryPoints[0]?.x).toBe(0);
  });

  it('draws the trajectory from start date to today, not to the goal', () => {
    const view = buildWeightView(inputs([{ date: '2026-10-06', kg: 65.5 }]));
    expect(view.trajectoryPoints).toHaveLength(6); // 1 Oct … 6 Oct
    expect(view.trajectoryPoints[0]?.y).toBeCloseTo(66, 6);
  });

  it('exposes this week intermediate goal', () => {
    const view = buildWeightView(inputs([{ date: '2026-10-06', kg: 65.5 }]));
    // 2026-W41 ends Sunday 11 October, 10 days into a 42-day span of 3.7 kg.
    expect(view.weekGoal).toBeCloseTo(66 - (3.7 / 42) * 10, 6);
  });

  it('sorts unsorted weigh-ins before plotting', () => {
    const view = buildWeightView(inputs([
      { date: '2026-10-06', kg: 65.5 },
      { date: '2026-10-04', kg: 65.9 },
    ]));
    expect(view.rawPoints.map((p) => p.x)).toEqual([3, 5]);
  });

  it('gives every point a formatted value for the table view', () => {
    const view = buildWeightView(inputs([{ date: '2026-10-06', kg: 65.5 }]));
    expect(view.rawPoints[0]?.value).toBe('65,5 kg');
    expect(view.rawPoints[0]?.label.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- useWeight`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/features/weight/useWeight.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, listWeights } from '@/db/repos';
import { addDays, diffDays, isoWeekOf, todayIn } from '@/domain/calendar';
import { rollingAverage, type WeighIn } from '@/domain/rollingAverage';
import { gapToTrajectory, trajectoryAt, weeklyIntermediateGoal } from '@/domain/trajectory';
import type { IsoDate, Settings } from '@/domain/types';
import type { ChartPoint } from '@/ui/chartScale';
import { kg, longDate } from '@/ui/format';

export interface WeightInputs {
  date: IsoDate;
  settings: Settings;
  weighIns: WeighIn[];
}

export interface WeightView {
  today: IsoDate;
  latestKg: number | null;
  rollingAvg: number | null;
  enoughForAverage: boolean;
  gap: number | null;
  weekGoal: number;
  rawPoints: ChartPoint[];
  avgPoints: ChartPoint[];
  trajectoryPoints: ChartPoint[];
}

function point(x: number, y: number, date: IsoDate): ChartPoint {
  return { x, y, label: longDate(date), value: `${kg(y)} kg` };
}

export function buildWeightView(input: WeightInputs): WeightView {
  const { date, settings } = input;
  const sorted = [...input.weighIns].sort((a, b) => a.date.localeCompare(b.date));
  const x = (d: IsoDate) => diffDays(settings.startDate, d);

  const rawPoints = sorted.map((w) => point(x(w.date), w.kg, w.date));

  // One average point per weigh-in date, so the line follows the dots.
  const avgPoints: ChartPoint[] = [];
  for (const w of sorted) {
    const avg = rollingAverage(sorted, w.date);
    if (avg !== null) avgPoints.push(point(x(w.date), avg, w.date));
  }

  const trajectoryPoints: ChartPoint[] = [];
  for (let d = settings.startDate; diffDays(d, date) >= 0; d = addDays(d, 1)) {
    trajectoryPoints.push(point(x(d), trajectoryAt(d, settings), d));
  }

  const rollingAvg = rollingAverage(sorted, date);

  return {
    today: date,
    latestKg: sorted[sorted.length - 1]?.kg ?? null,
    rollingAvg,
    enoughForAverage: rollingAvg !== null,
    gap: rollingAvg === null ? null : gapToTrajectory(rollingAvg, date, settings),
    weekGoal: weeklyIntermediateGoal(isoWeekOf(date), settings),
    rawPoints,
    avgPoints,
    trajectoryPoints,
  };
}

export function useWeight(userId: string): WeightView | undefined {
  return useLiveQuery(async () => {
    const settings = await getSettings(userId);
    if (!settings) return undefined;
    const weights = await listWeights(userId);
    return buildWeightView({
      date: todayIn(settings.timezone),
      settings,
      weighIns: weights.map((w) => ({ date: w.date, kg: w.kg })),
    });
  }, [userId]);
}
```

`src/features/weight/Weight.tsx`:

```tsx
import { useState } from 'react';
import { saveWeight } from '@/db/repos';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chart } from '@/ui/Chart';
import { kg, signedKg } from '@/ui/format';
import { DashedMark, DotsMark, LineMark } from '@/ui/marks';
import { useWeight } from '@/features/weight/useWeight';

export function Weight({ userId }: { userId: string }) {
  const view = useWeight(userId);
  const [draft, setDraft] = useState('');

  if (!view) return <p>Un instant…</p>;

  async function record() {
    const value = Number(draft.trim().replace(',', '.'));
    if (!Number.isFinite(value) || draft.trim() === '') return;
    await saveWeight(userId, view!.today, value);
    setDraft('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <span className="label">Pesée du jour</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
          <input
            aria-label="Poids du jour"
            inputMode="decimal"
            value={draft}
            placeholder={view.latestKg === null ? '—' : kg(view.latestKg)}
            onChange={(event) => setDraft(event.target.value)}
            style={{
              flex: 1, font: 'inherit', color: 'var(--ink)',
              background: 'var(--inset)', border: '1px solid var(--line)',
              borderRadius: 12, padding: '10px 12px',
            }}
          />
          <Button onClick={record}>Enregistrer</Button>
        </div>
      </Card>

      <Card>
        <span className="label">Moyenne 7 jours</span>
        <p className="display" style={{ fontSize: 'var(--step-4)', margin: '4px 0 0', lineHeight: 1 }}>
          {view.rollingAvg === null ? '—' : kg(view.rollingAvg)}
        </p>
        <p style={{ margin: '6px 0 0', color: 'var(--cerise)' }}>
          {view.enoughForAverage && view.gap !== null
            ? signedKg(view.gap)
            : 'Pas encore assez de pesées.'}
        </p>
        <p style={{ margin: '10px 0 0', color: 'var(--ink-soft)' }}>
          Objectif de dimanche&nbsp;: {kg(view.weekGoal)} kg
        </p>
      </Card>

      <Card>
        <Chart
          title="Poids"
          points={view.rawPoints}
          yFormat={(value) => kg(value)}
          targetLineY={view.weekGoal}
        >
          <DashedMark points={view.trajectoryPoints} label="trajectoire" />
          <LineMark points={view.avgPoints} />
          <DotsMark points={view.rawPoints} />
        </Chart>
      </Card>
    </div>
  );
}
```

Mark order matters: the dashed reference line is drawn first so the solid average line and the hollow dots sit on top of it.

- [ ] **Step 4: Run the tests**

Run: `npm test -- useWeight`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/weight
git commit -m "feat: add the weight screen with rolling average and trajectory"
```

---

### Task 4: Week planner

**Files:**
- Create: `src/features/calories/WeekPlanner.tsx`
- Test: `src/features/calories/WeekPlanner.test.tsx`

**Interfaces:**
- Consumes: `getWeekPlan`, `updateWeekPlan`; `effectiveWeekPlan`; `datesOfIsoWeek`, `weekdayShort`.

**Read with `getWeekPlan`, never `getOrCreateWeekPlan`.** The get-or-create form *writes*, and this component reads inside `useLiveQuery` — a reactive read that writes to the table it observes. Worse, it is semantically wrong: §4.7 makes each `week_plan` the snapshot of what that week asked, so seeding an unvisited week with today's `DEFAULT_*` invents a snapshot nobody set, and then shows it back as fact. Browsing weeks would also queue sync pushes for rows the user never touched. Read with `getWeekPlan`, pass the result through the pure `effectiveWeekPlan` for display defaults, and let `updateWeekPlan` create the row on the first real edit.
- Produces: `<WeekPlanner userId isoWeek />`

Seven columns, each with two toggles: *sans dîner* and *course*. Writes only to that week's snapshot, so a past week is never rewritten.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { getOrCreateWeekPlan } from '@/db/repos';
import { WeekPlanner } from '@/features/calories/WeekPlanner';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.weekPlans.clear(), db.outbox.clear()]);
});

describe('WeekPlanner', () => {
  it('seeds Wednesday and Sunday as the no-dinner evenings', async () => {
    render(<WeekPlanner userId="u1" isoWeek="2026-W41" />);
    const wednesday = await screen.findByRole('checkbox', { name: 'Sans dîner mercredi' });
    const friday = screen.getByRole('checkbox', { name: 'Sans dîner vendredi' });
    expect(wednesday).toBeChecked();
    expect(friday).not.toBeChecked();
  });

  it('seeds the default run days', async () => {
    render(<WeekPlanner userId="u1" isoWeek="2026-W41" />);
    expect(await screen.findByRole('checkbox', { name: 'Course lundi' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Course mercredi' })).not.toBeChecked();
  });

  it('persists a toggled evening to that week only', async () => {
    render(<WeekPlanner userId="u1" isoWeek="2026-W41" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sans dîner jeudi' }));
    await waitFor(async () => {
      const plan = await getOrCreateWeekPlan('u1', '2026-W41');
      expect(plan.noDinnerDays).toContain(4);
    });
    const other = await getOrCreateWeekPlan('u1', '2026-W42');
    expect(other.noDinnerDays).toEqual([3, 7]);
  });

  it('removes an evening when untoggled', async () => {
    render(<WeekPlanner userId="u1" isoWeek="2026-W41" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sans dîner mercredi' }));
    await waitFor(async () => {
      const plan = await getOrCreateWeekPlan('u1', '2026-W41');
      expect(plan.noDinnerDays).not.toContain(3);
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- WeekPlanner`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { getWeekPlan, updateWeekPlan } from '@/db/repos';
import { effectiveWeekPlan } from '@/domain/checklist';
import { datesOfIsoWeek } from '@/domain/calendar';
import type { IsoWeek, Weekday } from '@/domain/types';
import { BowCheckbox } from '@/ui/BowCheckbox';

const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: 'lundi', 2: 'mardi', 3: 'mercredi', 4: 'jeudi',
  5: 'vendredi', 6: 'samedi', 7: 'dimanche',
};

function toggled(list: Weekday[], day: Weekday, next: boolean): Weekday[] {
  const without = list.filter((d) => d !== day);
  return next ? [...without, day].sort((a, b) => a - b) : without;
}

export function WeekPlanner({ userId, isoWeek }: { userId: string; isoWeek: IsoWeek }) {
  // Read-only: a reactive read must not write to the table it observes.
  const stored = useLiveQuery(() => getWeekPlan(userId, isoWeek), [userId, isoWeek]);
  // `undefined` means "not loaded yet" on the first pass and "no row" after;
  // both render the defaults, and the first toggle creates the row.
  const plan = effectiveWeekPlan(stored);

  const days = datesOfIsoWeek(isoWeek).map((_, index) => (index + 1) as Weekday);

  return (
    <div>
      <span className="label">Semaine {isoWeek.split('-W')[1]}</span>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
        {days.map((day) => (
          <div
            key={day}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(68px, 1fr) auto auto',
              alignItems: 'center',
              gap: 8,
              borderTop: day === 1 ? 'none' : '1px solid var(--line)',
            }}
          >
            <span style={{ textTransform: 'capitalize' }}>{WEEKDAY_NAMES[day]}</span>
            <BowCheckbox
              label={`Sans dîner ${WEEKDAY_NAMES[day]}`}
              checked={plan.noDinnerDays.includes(day)}
              onChange={(next) => {
                void updateWeekPlan(userId, isoWeek, {
                  noDinnerDays: toggled(plan.noDinnerDays, day, next),
                });
              }}
            />
            <BowCheckbox
              label={`Course ${WEEKDAY_NAMES[day]}`}
              checked={plan.runDays.includes(day)}
              onChange={(next) => {
                void updateWeekPlan(userId, isoWeek, {
                  runDays: toggled(plan.runDays, day, next),
                });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export { WEEKDAY_NAMES };
```

The visible label text is long because it doubles as the accessible name; style it down with CSS rather than shortening it, so screen-reader users still hear which day a toggle belongs to.

- [ ] **Step 4: Run the tests**

Run: `npm test -- WeekPlanner`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/calories/WeekPlanner.tsx src/features/calories/WeekPlanner.test.tsx
git commit -m "feat: add the per-week no-dinner and run-day planner"
```

---

### Task 5: Calories screen

**Files:**
- Create: `src/features/calories/useCalories.ts`, `src/features/calories/Calories.tsx`
- Test: `src/features/calories/useCalories.test.ts`

**Interfaces:**
- Consumes: `listCalorieEntries`, `saveCalorieEntry`, `softDelete`, `getWeekPlan`, `getSettings`; `dayAllowance`, `weeklyBudget`, `weeklyRemaining`, `floorWarnings`, `dayCalorieTotal`, `weekCalorieTotal`; `effectiveWeekPlan`; `datesOfIsoWeek`, `isoWeekOf`, `todayIn`.
- Produces:
  - `export interface CaloriesView { today; isoWeek; budget; consumed; remaining; overshoot; warnings; days }`
  - `export interface CaloriesDay { date; weekdayLabel; allowance; consumed; noDinner; entries }`
  - `buildCaloriesView(input: CaloriesInputs): CaloriesView`
  - `useCalories(userId: string): CaloriesView | undefined`
  - `<Calories userId />`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildCaloriesView, type CaloriesInputs } from '@/features/calories/useCalories';
import type { CalorieEntry, Settings, WeekPlan } from '@/domain/types';

const settings: Settings = {
  userId: 'u1', timezone: 'Europe/Paris',
  startDate: '2026-10-01', startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false, updatedAt: '',
};

const plan: WeekPlan = {
  id: 'p', userId: 'u1', isoWeek: '2026-W41',
  runDays: [1, 2, 4, 6, 7], noDinnerDays: [3, 7], jokerUsedOn: null,
  updatedAt: '', deletedAt: null,
};

function entry(date: string, kcal: number, label: string | null = null): CalorieEntry {
  return { id: `${date}-${kcal}`, userId: 'u1', date, kcal, label, updatedAt: '', deletedAt: null };
}

function inputs(entries: CalorieEntry[]): CaloriesInputs {
  return { date: '2026-10-06', settings, plan, entries };
}

describe('buildCaloriesView', () => {
  it('computes the budget from the per-day allowances', () => {
    expect(buildCaloriesView(inputs([])).budget).toBe(5 * 1500 + 2 * 900);
  });

  it('reports the remainder in real time', () => {
    const view = buildCaloriesView(inputs([entry('2026-10-05', 1450), entry('2026-10-06', 1200)]));
    expect(view.consumed).toBe(2650);
    expect(view.remaining).toBe(5 * 1500 + 2 * 900 - 2650);
    expect(view.overshoot).toBe(false);
  });

  it('flags an overshoot rather than clamping to zero', () => {
    const view = buildCaloriesView(inputs([entry('2026-10-05', 12000)]));
    expect(view.remaining).toBeLessThan(0);
    expect(view.overshoot).toBe(true);
  });

  it('gives every day its own allowance and consumption', () => {
    const view = buildCaloriesView(inputs([entry('2026-10-07', 700)]));
    const wednesday = view.days.find((d) => d.date === '2026-10-07');
    expect(wednesday?.allowance).toBe(900);
    expect(wednesday?.noDinner).toBe(true);
    expect(wednesday?.consumed).toBe(700);

    const friday = view.days.find((d) => d.date === '2026-10-09');
    expect(friday?.allowance).toBe(1500);
    expect(friday?.noDinner).toBe(false);
  });

  it('returns seven days, Monday first', () => {
    const view = buildCaloriesView(inputs([]));
    expect(view.days).toHaveLength(7);
    expect(view.days[0]?.date).toBe('2026-10-05');
    expect(view.days[6]?.date).toBe('2026-10-11');
  });

  it('ignores entries from other weeks', () => {
    const view = buildCaloriesView(inputs([entry('2026-10-12', 2000)]));
    expect(view.consumed).toBe(0);
  });

  it('surfaces floor warnings from settings', () => {
    const view = buildCaloriesView(inputs([]));
    // noDinnerAllowance 900 is below the 1200 floor.
    expect(view.warnings).toEqual([{ kind: 'noDinner', value: 900, floor: 1200 }]);
  });

  it('groups entries under their day so each can be deleted', () => {
    const view = buildCaloriesView(inputs([
      entry('2026-10-06', 600, 'déjeuner'),
      entry('2026-10-06', 400, 'goûter'),
    ]));
    const today = view.days.find((d) => d.date === '2026-10-06');
    expect(today?.entries.map((e) => e.label)).toEqual(['déjeuner', 'goûter']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- useCalories`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/features/calories/useCalories.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, getWeekPlan, listCalorieEntries } from '@/db/repos';
import { effectiveWeekPlan } from '@/domain/checklist';
import {
  dayAllowance, dayCalorieTotal, floorWarnings, weekCalorieTotal,
  weeklyBudget, weeklyRemaining, type FloorWarning,
} from '@/domain/budget';
import { datesOfIsoWeek, isoWeekOf, todayIn, weekdayOf } from '@/domain/calendar';
import type { CalorieEntry, IsoDate, IsoWeek, Settings, WeekPlan } from '@/domain/types';
import { weekdayShort } from '@/ui/format';

export interface CaloriesInputs {
  date: IsoDate;
  settings: Settings;
  plan: WeekPlan;
  entries: CalorieEntry[];
}

export interface CaloriesDay {
  date: IsoDate;
  weekdayLabel: string;
  allowance: number;
  consumed: number;
  noDinner: boolean;
  entries: CalorieEntry[];
}

export interface CaloriesView {
  today: IsoDate;
  isoWeek: IsoWeek;
  budget: number;
  consumed: number;
  remaining: number;
  overshoot: boolean;
  warnings: FloorWarning[];
  days: CaloriesDay[];
}

export function buildCaloriesView(input: CaloriesInputs): CaloriesView {
  const { date, settings, plan } = input;
  const isoWeek = isoWeekOf(date);
  const weekDates = datesOfIsoWeek(isoWeek);
  const inWeek = new Set(weekDates);

  const entriesThisWeek = input.entries.filter((e) => inWeek.has(e.date));
  // §4.7's weekly sum lives in the domain; re-deriving it here is how it ended
  // up implemented twice and tested nowhere.
  const consumed = weekCalorieTotal(input.entries, isoWeek);
  const remaining = weeklyRemaining(isoWeek, plan, settings, consumed);

  const days: CaloriesDay[] = weekDates.map((d) => {
    const dayEntries = entriesThisWeek.filter((e) => e.date === d);
    return {
      date: d,
      weekdayLabel: weekdayShort(d),
      allowance: dayAllowance(d, plan, settings),
      consumed: dayCalorieTotal(dayEntries, d),
      // Read the plan directly. Comparing allowances would misreport every
      // day the moment dailyCalorieTarget and noDinnerAllowance coincide.
      noDinner: plan.noDinnerDays.includes(weekdayOf(d)),
      entries: dayEntries,
    };
  });

  return {
    today: date,
    isoWeek,
    budget: weeklyBudget(isoWeek, plan, settings),
    consumed,
    remaining,
    overshoot: remaining < 0,
    warnings: floorWarnings(settings),
    days,
  };
}

export function useCalories(userId: string): CaloriesView | undefined {
  return useLiveQuery(async () => {
    const settings = await getSettings(userId);
    if (!settings) return undefined;
    const date = todayIn(settings.timezone);
    const [plan, entries] = await Promise.all([
      getWeekPlan(userId, isoWeekOf(date)),
      listCalorieEntries(userId),
    ]);
    return buildCaloriesView({ date, settings, plan, entries });
  }, [userId]);
}
```

`src/features/calories/Calories.tsx`:

```tsx
import { useState } from 'react';
import { saveCalorieEntry, softDelete } from '@/db/repos';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { kcal } from '@/ui/format';
import { Pill } from '@/ui/Pill';
import { useCalories } from '@/features/calories/useCalories';
import { WeekPlanner } from '@/features/calories/WeekPlanner';

export function Calories({ userId }: { userId: string }) {
  const view = useCalories(userId);
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');

  if (!view) return <p>Un instant…</p>;

  async function add() {
    const value = Number(amount.trim());
    if (!Number.isFinite(value) || amount.trim() === '') return;
    await saveCalorieEntry(userId, view!.today, value, label.trim() === '' ? null : label.trim());
    setAmount('');
    setLabel('');
  }

  const inputStyle = {
    font: 'inherit', color: 'var(--ink)', background: 'var(--inset)',
    border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px',
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <span className="label">Reste cette semaine</span>
        <p
          className="display"
          style={{
            fontSize: 'var(--step-4)', margin: '4px 0 0', lineHeight: 1,
            color: view.overshoot ? 'var(--cerise)' : 'var(--ink)',
          }}
        >
          {kcal(view.remaining)}
        </p>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)' }}>
          {kcal(view.consumed)} / {kcal(view.budget)} kcal
        </p>
        {view.warnings.map((warning) => (
          <p key={warning.kind} style={{ margin: '10px 0 0', color: 'var(--cerise)' }}>
            {warning.kind === 'noDinner'
              ? `Ton allocation sans dîner (${kcal(warning.value)}) est sous ton seuil de ${kcal(warning.floor)}.`
              : `Ta cible (${kcal(warning.value)}) est sous ton seuil de ${kcal(warning.floor)}.`}
          </p>
        ))}
      </Card>

      <Card>
        <span className="label">Ajouter</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            aria-label="Calories"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            style={{ ...inputStyle, width: '7ch' }}
          />
          <input
            aria-label="Libellé"
            placeholder="déjeuner"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <Button onClick={add}>Ajouter</Button>
        </div>
      </Card>

      <Card>
        <span className="label">La semaine</span>
        <div style={{ marginTop: 8 }}>
          {view.days.map((day) => (
            <div
              key={day.date}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 10,
                padding: '9px 0',
                borderTop: day.date === view.days[0]?.date ? 'none' : '1px solid var(--line)',
              }}
            >
              <span style={{ width: '4ch', color: 'var(--ink-soft)' }}>{day.weekdayLabel}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {kcal(day.consumed)} / {kcal(day.allowance)}
              </span>
              {day.noDinner && <Pill tone="quiet">sans dîner</Pill>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {day.entries.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Supprimer ${item.label ?? kcal(item.kcal)}`}
                    onClick={() => void softDelete('calorieEntries', item.id)}
                    style={{
                      font: 'inherit', fontSize: 'var(--step--1)', cursor: 'pointer',
                      background: 'var(--inset)', color: 'var(--ink-soft)',
                      border: '1px solid var(--line)', borderRadius: 999, padding: '2px 9px',
                    }}
                  >
                    {item.label ?? kcal(item.kcal)} ×
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <WeekPlanner userId={userId} isoWeek={view.isoWeek} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- useCalories`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/calories
git commit -m "feat: add the calories screen with weekly budget and quick-add"
```

---

### Task 6: Running screen

**Files:**
- Create: `src/features/running/useRunning.ts`, `src/features/running/Running.tsx`
- Test: `src/features/running/useRunning.test.ts`

**Interfaces:**
- Consumes: `listRuns`, `saveRun`, `softDelete`, `getSettings`; `weeklyRunSummary`, `paceSecondsPerKm`, `formatPace`, `formatDuration`; `isoWeekOf`, `diffDays`, `todayIn`.
- Produces:
  - `export interface RunningView { today; isoWeek; summary; pacePoints; weekKmPoints; recent }`
  - `buildRunningView(input: RunningInputs): RunningView`
  - `useRunning(userId: string): RunningView | undefined`
  - `<Running userId />`
  - `parseDuration(raw: string): number | null` — accepts `"28:40"` and `"28"` (minutes)

**Two separate charts, never one with two y-axes:** pace over time, and distance per week.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildRunningView, parseDuration, type RunningInputs } from '@/features/running/useRunning';
import type { Run, Settings } from '@/domain/types';

const settings: Settings = {
  userId: 'u1', timezone: 'Europe/Paris',
  startDate: '2026-10-01', startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false, updatedAt: '',
};

function run(date: string, distanceKm: number, durationS: number): Run {
  return {
    id: `${date}-${distanceKm}`, userId: 'u1', date, distanceKm, durationS,
    note: null, updatedAt: '', deletedAt: null,
  };
}

function inputs(runs: Run[], date = '2026-10-06'): RunningInputs {
  return { date, settings, runs };
}

describe('parseDuration', () => {
  it('accepts mm:ss', () => {
    expect(parseDuration('28:40')).toBe(1720);
    expect(parseDuration('5:00')).toBe(300);
  });

  it('accepts bare minutes', () => {
    expect(parseDuration('28')).toBe(1680);
  });

  it('accepts h:mm:ss', () => {
    expect(parseDuration('1:01:01')).toBe(3661);
  });

  it('rejects nonsense', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('28:99')).toBeNull();
  });
});

describe('buildRunningView', () => {
  it('fills the weekly gauge against the session target', () => {
    const view = buildRunningView(inputs([
      run('2026-10-05', 5, 1500),
      run('2026-10-06', 5.2, 1600),
    ]));
    expect(view.summary.sessions).toBe(2);
    expect(view.summary.target).toBe(5);
    expect(view.summary.totalKm).toBeCloseTo(10.2, 6);
  });

  it('plots one pace point per run, oldest first', () => {
    const view = buildRunningView(inputs([
      run('2026-10-06', 5, 1600),
      run('2026-10-05', 5, 1500),
    ]));
    expect(view.pacePoints.map((p) => p.x)).toEqual([4, 5]);
    expect(view.pacePoints[0]?.y).toBeCloseTo(300, 6);
  });

  it('formats pace points for the table view', () => {
    const view = buildRunningView(inputs([run('2026-10-05', 5, 1500)]));
    expect(view.pacePoints[0]?.value).toBe('5:00 /km');
  });

  it('aggregates distance per ISO week', () => {
    const view = buildRunningView(inputs([
      run('2026-10-05', 5, 1500),
      run('2026-10-06', 5, 1500),
      run('2026-10-12', 7, 2400),
    ], '2026-10-12'));
    expect(view.weekKmPoints).toHaveLength(2);
    expect(view.weekKmPoints[0]?.y).toBeCloseTo(10, 6);
    expect(view.weekKmPoints[1]?.y).toBeCloseTo(7, 6);
  });

  it('lists recent runs newest first', () => {
    const view = buildRunningView(inputs([
      run('2026-10-05', 5, 1500),
      run('2026-10-06', 5.2, 1600),
    ]));
    expect(view.recent[0]?.date).toBe('2026-10-06');
  });

  it('handles no runs without dividing by zero', () => {
    const view = buildRunningView(inputs([]));
    expect(view.summary.sessions).toBe(0);
    expect(view.summary.averagePaceSecondsPerKm).toBeNull();
    expect(view.pacePoints).toEqual([]);
    expect(view.weekKmPoints).toEqual([]);
  });

  it('skips a zero-distance run in the pace chart rather than plotting Infinity', () => {
    const view = buildRunningView(inputs([run('2026-10-05', 0, 1500)]));
    expect(view.pacePoints).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- useRunning`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/features/running/useRunning.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, listRuns } from '@/db/repos';
import { diffDays, isoWeekOf, todayIn } from '@/domain/calendar';
import {
  formatPace, paceSecondsPerKm, weeklyRunSummary, type WeeklyRunSummary,
} from '@/domain/running';
import type { IsoDate, IsoWeek, Run, Settings } from '@/domain/types';
import type { ChartPoint } from '@/ui/chartScale';
import { longDate } from '@/ui/format';

export interface RunningInputs {
  date: IsoDate;
  settings: Settings;
  runs: Run[];
}

export interface RunningView {
  today: IsoDate;
  isoWeek: IsoWeek;
  summary: WeeklyRunSummary;
  pacePoints: ChartPoint[];
  weekKmPoints: ChartPoint[];
  recent: Run[];
}

/** Accepts "28:40", "1:01:01" and a bare "28" meaning minutes. */
export function parseDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(':');
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) return null;
  const numbers = parts.map(Number);
  if (parts.length === 1) return numbers[0]! * 60;
  if (numbers.slice(1).some((n) => n > 59)) return null;
  if (parts.length === 2) return numbers[0]! * 60 + numbers[1]!;
  if (parts.length === 3) return numbers[0]! * 3600 + numbers[1]! * 60 + numbers[2]!;
  return null;
}

export function buildRunningView(input: RunningInputs): RunningView {
  const { date, settings } = input;
  const sorted = [...input.runs].sort((a, b) => a.date.localeCompare(b.date));
  const isoWeek = isoWeekOf(date);

  const pacePoints: ChartPoint[] = [];
  for (const r of sorted) {
    const pace = paceSecondsPerKm(r.distanceKm, r.durationS);
    if (pace === null) continue;
    pacePoints.push({
      x: diffDays(settings.startDate, r.date),
      y: pace,
      label: longDate(r.date),
      value: `${formatPace(pace)} /km`,
    });
  }

  const kmByWeek = new Map<IsoWeek, number>();
  for (const r of sorted) {
    const week = isoWeekOf(r.date);
    kmByWeek.set(week, (kmByWeek.get(week) ?? 0) + r.distanceKm);
  }
  const weekKmPoints: ChartPoint[] = [...kmByWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, km], index) => ({
      x: index,
      y: km,
      label: `S${week.split('-W')[1]}`,
      value: `${km.toFixed(1).replace('.', ',')} km`,
    }));

  return {
    today: date,
    isoWeek,
    summary: weeklyRunSummary(sorted, isoWeek, settings.runSessionsTarget),
    pacePoints,
    weekKmPoints,
    recent: [...sorted].reverse(),
  };
}

export function useRunning(userId: string): RunningView | undefined {
  return useLiveQuery(async () => {
    const settings = await getSettings(userId);
    if (!settings) return undefined;
    return buildRunningView({
      date: todayIn(settings.timezone),
      settings,
      runs: await listRuns(userId),
    });
  }, [userId]);
}
```

`src/features/running/Running.tsx`:

```tsx
import { useState } from 'react';
import { saveRun, softDelete } from '@/db/repos';
import { formatDuration, formatPace, paceSecondsPerKm } from '@/domain/running';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chart } from '@/ui/Chart';
import { longDate } from '@/ui/format';
import { BarsMark, DotsMark, LineMark } from '@/ui/marks';
import { parseDuration, useRunning } from '@/features/running/useRunning';

export function Running({ userId }: { userId: string }) {
  const view = useRunning(userId);
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!view) return <p>Un instant…</p>;

  async function log() {
    const km = Number(distance.trim().replace(',', '.'));
    const seconds = parseDuration(duration);
    if (!Number.isFinite(km) || km <= 0 || seconds === null) {
      setError('Il me faut une distance et une durée, par exemple 5,2 et 28:40.');
      return;
    }
    setError(null);
    await saveRun(userId, { date: view!.today, distanceKm: km, durationS: seconds, note: null });
    setDistance('');
    setDuration('');
  }

  const inputStyle = {
    font: 'inherit', color: 'var(--ink)', background: 'var(--inset)',
    border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', flex: 1,
  } as const;

  const gaugePercent = Math.min(
    (view.summary.sessions / Math.max(view.summary.target, 1)) * 100,
    100,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <span className="label">Cette semaine</span>
        <p className="display" style={{ fontSize: 'var(--step-3)', margin: '4px 0 0', lineHeight: 1 }}>
          {view.summary.sessions} / {view.summary.target}
        </p>
        <div
          role="progressbar"
          aria-valuenow={view.summary.sessions}
          aria-valuemin={0}
          aria-valuemax={view.summary.target}
          aria-label="Sorties de la semaine"
          style={{
            height: 8, borderRadius: 999, background: 'var(--inset)',
            border: '1px solid var(--line)', overflow: 'hidden', marginTop: 10,
          }}
        >
          <div style={{ width: `${gaugePercent}%`, height: '100%', background: 'var(--cerise)' }} />
        </div>
        <p style={{ margin: '8px 0 0', color: 'var(--ink-soft)' }}>
          {view.summary.totalKm.toFixed(1).replace('.', ',')} km
          {view.summary.totalDurationS > 0 && ` · ${formatDuration(view.summary.totalDurationS)}`}
          {view.summary.averagePaceSecondsPerKm !== null
            && ` · ${formatPace(view.summary.averagePaceSecondsPerKm)} /km`}
        </p>
      </Card>

      <Card>
        <span className="label">Ajouter une sortie</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            aria-label="Distance en km" inputMode="decimal" placeholder="5,2"
            value={distance} onChange={(event) => setDistance(event.target.value)}
            style={inputStyle}
          />
          <input
            aria-label="Durée" inputMode="numeric" placeholder="28:40"
            value={duration} onChange={(event) => setDuration(event.target.value)}
            style={inputStyle}
          />
          <Button onClick={log}>Ajouter</Button>
        </div>
        {error && <p style={{ color: 'var(--cerise)', margin: '8px 0 0' }}>{error}</p>}
      </Card>

      <Card>
        <Chart
          title="Allure"
          points={view.pacePoints}
          yFormat={(value) => formatPace(value)}
        >
          <LineMark points={view.pacePoints} />
          <DotsMark points={view.pacePoints} />
        </Chart>
      </Card>

      <Card>
        <Chart
          title="Distance par semaine"
          points={view.weekKmPoints}
          yFormat={(value) => `${Math.round(value)}`}
        >
          <BarsMark points={view.weekKmPoints} />
        </Chart>
      </Card>

      <Card>
        <span className="label">Historique</span>
        <div style={{ marginTop: 8 }}>
          {view.recent.map((item, index) => {
            const pace = paceSecondsPerKm(item.distanceKm, item.durationS);
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 0',
                  borderTop: index === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <span style={{ color: 'var(--ink-soft)', flex: 1 }}>{longDate(item.date)}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {item.distanceKm.toFixed(1).replace('.', ',')} km · {formatDuration(item.durationS)}
                  {pace !== null && ` · ${formatPace(pace)}`}
                </span>
                <button
                  type="button"
                  aria-label={`Supprimer la sortie du ${longDate(item.date)}`}
                  onClick={() => void softDelete('runs', item.id)}
                  style={{
                    font: 'inherit', cursor: 'pointer', background: 'none',
                    border: 0, color: 'var(--ink-soft)',
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- useRunning`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/running
git commit -m "feat: add the running screen with gauge and two single-series charts"
```

---

### Task 7: Settings screen

**Files:**
- Create: `src/features/settings/Settings.tsx`
- Test: `src/features/settings/Settings.test.tsx`

**Interfaces:**
- Consumes: `getSettings`, `saveSettings`; `floorWarnings`, `impliedWeeklyRate`.
- Produces: `<SettingsScreen userId />`

Editable: objectif de poids, date objectif, cible calories, allocation sans dîner, seuil minimum, objectif de pas, verres d'eau, sorties par semaine, cadence de pesée, son, thème. The implied weekly rate is shown live. Floor warnings appear as soon as a value crosses the floor, before saving.

Theme is written to `document.documentElement.dataset.theme` and remembered in `localStorage` inside a `try/catch` — a per-viewer convenience, not synced state.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { getSettings, saveSettings } from '@/db/repos';
import { SettingsScreen } from '@/features/settings/Settings';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.settings.clear(), db.outbox.clear()]);
  await saveSettings({
    userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-01',
    startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
    weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
    calorieFloor: 1200, stepTarget: 8000, waterTarget: 6,
    runSessionsTarget: 5, soundEnabled: false,
  });
});

describe('SettingsScreen', () => {
  it('loads the stored values', async () => {
    render(<SettingsScreen userId="u1" />);
    expect(await screen.findByLabelText('Cible calories')).toHaveValue('1500');
    expect(screen.getByLabelText('Objectif de pas')).toHaveValue('8000');
  });

  it('saves an edited target', async () => {
    render(<SettingsScreen userId="u1" />);
    const field = await screen.findByLabelText('Objectif de pas');
    await userEvent.clear(field);
    await userEvent.type(field, '9000');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => {
      expect((await getSettings('u1'))?.stepTarget).toBe(9000);
    });
  });

  it('warns as soon as a value crosses the floor, before saving', async () => {
    render(<SettingsScreen userId="u1" />);
    const field = await screen.findByLabelText('Cible calories');
    await userEvent.clear(field);
    await userEvent.type(field, '1100');
    expect(await screen.findByText(/sous ton seuil/)).toBeInTheDocument();
  });

  it('shows the implied weekly rate', async () => {
    render(<SettingsScreen userId="u1" />);
    expect(await screen.findByText(/par semaine/)).toBeInTheDocument();
  });

  it('toggles sound', async () => {
    render(<SettingsScreen userId="u1" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sons de récompense' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => {
      expect((await getSettings('u1'))?.soundEnabled).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- features/settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '@/db/repos';
import { floorWarnings } from '@/domain/budget';
import { impliedWeeklyRate } from '@/domain/trajectory';
import { BowCheckbox } from '@/ui/BowCheckbox';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { kcal, kg } from '@/ui/format';

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'ruban.theme';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A private window can refuse storage; the theme still applies for this visit.
  }
}

function Field({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = `set-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="label">{label}</span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          font: 'inherit', color: 'var(--ink)', background: 'var(--inset)',
          border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px',
        }}
      />
    </label>
  );
}

export function SettingsScreen({ userId }: { userId: string }) {
  const stored = useLiveQuery(() => getSettings(userId), [userId]);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [sound, setSound] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    if (!stored || draft) return;
    setDraft({
      targetWeight: String(stored.targetWeight),
      goalDate: stored.goalDate,
      dailyCalorieTarget: String(stored.dailyCalorieTarget),
      noDinnerAllowance: String(stored.noDinnerAllowance),
      calorieFloor: String(stored.calorieFloor),
      stepTarget: String(stored.stepTarget),
      waterTarget: String(stored.waterTarget),
      runSessionsTarget: String(stored.runSessionsTarget),
    });
    setSound(stored.soundEnabled);
  }, [stored, draft]);

  useEffect(() => { applyTheme(theme); }, [theme]);

  if (!stored || !draft) return <p>Un instant…</p>;

  const num = (key: string) => Number(draft[key]?.replace(',', '.') ?? '0');

  const warnings = floorWarnings({
    dailyCalorieTarget: num('dailyCalorieTarget'),
    noDinnerAllowance: num('noDinnerAllowance'),
    calorieFloor: num('calorieFloor'),
  });

  const rate = impliedWeeklyRate({
    startDate: stored.startDate,
    startWeight: stored.startWeight,
    targetWeight: num('targetWeight'),
    goalDate: draft.goalDate ?? stored.goalDate,
  });

  const set = (key: string) => (next: string) =>
    setDraft((current) => ({ ...(current ?? {}), [key]: next }));

  async function save() {
    await saveSettings({
      ...stored,
      targetWeight: num('targetWeight'),
      goalDate: draft.goalDate ?? stored.goalDate,
      dailyCalorieTarget: num('dailyCalorieTarget'),
      noDinnerAllowance: num('noDinnerAllowance'),
      calorieFloor: num('calorieFloor'),
      stepTarget: num('stepTarget'),
      waterTarget: num('waterTarget'),
      runSessionsTarget: num('runSessionsTarget'),
      soundEnabled: sound,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <span className="label">Objectif</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 8 }}>
          <Field label="Objectif" value={draft.targetWeight ?? ''} onChange={set('targetWeight')} />
          <label htmlFor="set-goal-date" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="label">Date objectif</span>
            <input
              id="set-goal-date"
              type="date"
              value={draft.goalDate ?? ''}
              onChange={(event) => set('goalDate')(event.target.value)}
              style={{
                font: 'inherit', color: 'var(--ink)', background: 'var(--inset)',
                border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px',
              }}
            />
          </label>
        </div>
        <p style={{ fontFamily: 'var(--font-hand)', fontSize: 'var(--step-1)', color: 'var(--cerise)', margin: '10px 0 0' }}>
          Ça fait {kg(Math.abs(rate))} kg par semaine.
        </p>
      </Card>

      <Card>
        <span className="label">Calories</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 8 }}>
          <Field label="Cible calories" value={draft.dailyCalorieTarget ?? ''} onChange={set('dailyCalorieTarget')} />
          <Field label="Sans dîner" value={draft.noDinnerAllowance ?? ''} onChange={set('noDinnerAllowance')} />
          <Field label="Seuil minimum" value={draft.calorieFloor ?? ''} onChange={set('calorieFloor')} />
        </div>
        {warnings.map((warning) => (
          <p key={warning.kind} style={{ color: 'var(--cerise)', margin: '10px 0 0' }}>
            {warning.kind === 'noDinner' ? 'Ton allocation sans dîner' : 'Ta cible'}
            {` (${kcal(warning.value)}) est sous ton seuil de ${kcal(warning.floor)}.`}
          </p>
        ))}
      </Card>

      <Card>
        <span className="label">Objectifs quotidiens</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 8 }}>
          <Field label="Objectif de pas" value={draft.stepTarget ?? ''} onChange={set('stepTarget')} />
          <Field label="Verres d'eau" value={draft.waterTarget ?? ''} onChange={set('waterTarget')} />
          <Field label="Sorties par semaine" value={draft.runSessionsTarget ?? ''} onChange={set('runSessionsTarget')} />
        </div>
      </Card>

      <Card>
        <span className="label">Confort</span>
        <BowCheckbox label="Sons de récompense" checked={sound} onChange={setSound} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {(['system', 'light', 'dark'] as Theme[]).map((option) => (
            <Button
              key={option}
              variant={theme === option ? 'solid' : 'quiet'}
              onClick={() => setTheme(option)}
            >
              {option === 'system' ? 'Système' : option === 'light' ? 'Clair' : 'Sombre'}
            </Button>
          ))}
        </div>
      </Card>

      <Button onClick={save}>Enregistrer</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- features/settings`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings
git commit -m "feat: add the settings screen with live floor warnings"
```

---

### Task 8: Wire the routes

**Files:**
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx` (extend)

- [ ] **Step 1: Add the failing test**

Append to `src/app/App.test.tsx`:

```ts
it('routes each tab to its real screen, with no placeholders left', async () => {
  await db.meta.put({ key: 'currentUserId', value: 'u1' });
  await saveSettings({
    userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-01',
    startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
    weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
    calorieFloor: 1200, stepTarget: 8000, waterTarget: 6,
    runSessionsTarget: 5, soundEnabled: false,
  });
  render(<App />);
  await screen.findByTestId('countdown');

  await userEvent.click(screen.getByRole('link', { name: 'Poids' }));
  expect(await screen.findByLabelText('Poids du jour')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Course' }));
  expect(await screen.findByLabelText('Distance en km')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Moi' }));
  expect(await screen.findByLabelText('Objectif de pas')).toBeInTheDocument();
});
```

Add `import userEvent from '@testing-library/user-event';` at the top of the file.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- App`
Expected: FAIL — the placeholder renders instead of the real screen.

- [ ] **Step 3: Replace the placeholders**

In `src/app/App.tsx`, delete the `Soon` component and swap the imports and routes:

```tsx
import { Calories } from '@/features/calories/Calories';
import { Running } from '@/features/running/Running';
import { SettingsScreen } from '@/features/settings/Settings';
import { Weight } from '@/features/weight/Weight';
```

```tsx
<Routes>
  <Route path="/" element={<Today userId={userId} />} />
  <Route path="/poids" element={<Weight userId={userId} />} />
  <Route path="/calories" element={<Calories userId={userId} />} />
  <Route path="/course" element={<Running userId={userId} />} />
  <Route path="/moi" element={<SettingsScreen userId={userId} />} />
</Routes>
```

- [ ] **Step 4: Run the full suite**

Run: `npm test && npx tsc -b`
Expected: everything PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat: route every tab to its real screen"
```

---

### Task 9: Look at the charts

Not a code task. The dataviz procedure ends with "render it and look at it" — the validator checks colour, not layout, and label collisions only show up on screen.

- [ ] **Step 1: Seed a realistic week**

In the running app, log six weigh-ins across eight days, two weeks of runs, and a week of calorie entries. Real-shaped data, not round numbers.

- [ ] **Step 2: Check each chart against the anti-patterns**

For the weight chart, the pace chart and the weekly-distance chart, confirm:

- No axis label is clipped by the viewBox edge, including the `trajectoire` label at the right.
- The dashed reference line sits *behind* the solid line and the dots.
- The hairline weekly target does not collide with a y-axis label.
- Every y-tick names a value the chart actually reaches.
- The crosshair tooltip is readable, and the touch target finds the nearest point.
- Both themes: the hollow dots stay visible against the surface in dark mode.

- [ ] **Step 3: Fix what you find, then confirm the table view**

Open "Voir les chiffres" on each chart. Every plotted value must appear there — that table is the accessibility relief the monochrome palette obliges.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: chart layout corrections from visual review"
```

---

### Task 10: End of cycle

**Files:**
- Modify: `src/domain/streak.ts` (add `longestStreak`), `src/app/App.tsx`
- Create: `src/features/cycle/summary.ts`, `src/features/cycle/CycleComplete.tsx`
- Test: `src/features/cycle/summary.test.ts`

**Interfaces:**
- Consumes: `listCycles`, `saveCycle`, `saveSettings`, `listDayLogs`, `listRuns`, `listWeights`; `diffDays`, `isCovered`.
- Produces:
  - `longestStreak(days: DayCoverage[], from: IsoDate, to: IsoDate): number` in `@/domain/streak`
  - `buildCycleSummary(input: CycleSummaryInputs): CycleSummary`
  - `<CycleComplete userId settings summary />`

This implements spec §4.9, the only §4 rule not yet covered by a task. It matters on a date: the countdown reaches zero on **12 November 2026**, and from the 13th the app must have somewhere to go.

**The summary is derived, not stored.** Every figure recomputes from the day logs, runs and weigh-ins already present, which keeps the spec's "derived, never stored" rule intact. Only the cycle's *boundaries* are written, in the `cycles` row — because starting a new goal overwrites `settings.startDate` and would otherwise erase what the old cycle even was.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildCycleSummary, type CycleSummaryInputs } from '@/features/cycle/summary';
import { longestStreak, type DayCoverage } from '@/domain/streak';

const validated = (date: string): DayCoverage =>
  ({ date, validatedAt: `${date}T21:00:00Z`, jokered: false });
const jokered = (date: string): DayCoverage => ({ date, validatedAt: null, jokered: true });
const failed = (date: string): DayCoverage => ({ date, validatedAt: null, jokered: false });

describe('longestStreak', () => {
  it('is zero with nothing covered', () => {
    expect(longestStreak([failed('2026-10-01')], '2026-10-01', '2026-10-05')).toBe(0);
  });

  it('finds the longest run, not the most recent one', () => {
    const days = [
      validated('2026-10-01'), validated('2026-10-02'), validated('2026-10-03'),
      failed('2026-10-04'),
      validated('2026-10-05'),
    ];
    expect(longestStreak(days, '2026-10-01', '2026-10-05')).toBe(3);
  });

  it('counts a jokered day as part of the run', () => {
    const days = [validated('2026-10-01'), jokered('2026-10-02'), validated('2026-10-03')];
    expect(longestStreak(days, '2026-10-01', '2026-10-03')).toBe(3);
  });

  it('ignores days outside the range', () => {
    const days = [
      validated('2026-09-28'), validated('2026-09-29'), validated('2026-09-30'),
      validated('2026-10-01'),
    ];
    expect(longestStreak(days, '2026-10-01', '2026-10-05')).toBe(1);
  });
});

function inputs(partial: Partial<CycleSummaryInputs> = {}): CycleSummaryInputs {
  return {
    startDate: '2026-10-06',
    goalDate: '2026-11-12',
    startWeight: 66,
    targetWeight: 62.3,
    dayLogs: [],
    runs: [],
    weighIns: [],
    ...partial,
  };
}

describe('buildCycleSummary', () => {
  it('reports the span in days', () => {
    expect(buildCycleSummary(inputs()).days).toBe(38); // 6 Oct to 12 Nov inclusive
  });

  it('takes the end weight from the last weigh-in inside the cycle', () => {
    const summary = buildCycleSummary(inputs({
      weighIns: [
        { date: '2026-11-10', kg: 62.8 },
        { date: '2026-11-12', kg: 62.5 },
        { date: '2026-11-20', kg: 61.0 }, // after the goal date — must not count
      ],
    }));
    expect(summary.endWeight).toBe(62.5);
    expect(summary.deltaKg).toBeCloseTo(-3.5, 6);
  });

  it('reports a null end weight and delta when nothing was weighed', () => {
    const summary = buildCycleSummary(inputs());
    expect(summary.endWeight).toBeNull();
    expect(summary.deltaKg).toBeNull();
  });

  it('says whether the target was reached', () => {
    expect(buildCycleSummary(inputs({
      weighIns: [{ date: '2026-11-12', kg: 62.2 }],
    })).targetReached).toBe(true);

    expect(buildCycleSummary(inputs({
      weighIns: [{ date: '2026-11-12', kg: 62.9 }],
    })).targetReached).toBe(false);
  });

  it('counts runs and kilometres inside the cycle only', () => {
    const summary = buildCycleSummary(inputs({
      runs: [
        { date: '2026-10-05', distanceKm: 9, durationS: 3000 },  // before
        { date: '2026-10-06', distanceKm: 5, durationS: 1500 },
        { date: '2026-11-12', distanceKm: 7, durationS: 2400 },
        { date: '2026-11-13', distanceKm: 9, durationS: 3000 },  // after
      ],
    }));
    expect(summary.runs).toBe(2);
    expect(summary.totalKm).toBeCloseTo(12, 6);
  });

  it('counts validated days and the longest streak', () => {
    const summary = buildCycleSummary(inputs({
      dayLogs: [
        validated('2026-10-06'), validated('2026-10-07'),
        failed('2026-10-08'), validated('2026-10-09'),
      ],
    }));
    expect(summary.daysValidated).toBe(3);
    expect(summary.longestStreak).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- cycle/summary`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `longestStreak` to the domain**

Append to `src/domain/streak.ts`:

```ts
/** The longest run of consecutive covered days within [from, to] inclusive. */
export function longestStreak(
  days: DayCoverage[],
  from: IsoDate,
  to: IsoDate,
): number {
  const covered = new Set<IsoDate>();
  for (const day of days) {
    if (isCovered(day) && diffDays(from, day.date) >= 0 && diffDays(day.date, to) >= 0) {
      covered.add(day.date);
    }
  }

  let best = 0;
  let run = 0;
  for (let d = from; diffDays(d, to) >= 0; d = addDays(d, 1)) {
    run = covered.has(d) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
```

- [ ] **Step 4: Write the summary and the screen**

`src/features/cycle/summary.ts`:

```ts
import { diffDays } from '@/domain/calendar';
import { longestStreak, type DayCoverage } from '@/domain/streak';
import type { IsoDate } from '@/domain/types';

export interface CycleSummaryInputs {
  startDate: IsoDate;
  goalDate: IsoDate;
  startWeight: number;
  targetWeight: number;
  dayLogs: DayCoverage[];
  runs: { date: IsoDate; distanceKm: number; durationS: number }[];
  weighIns: { date: IsoDate; kg: number }[];
}

export interface CycleSummary {
  startDate: IsoDate;
  goalDate: IsoDate;
  days: number;
  startWeight: number;
  targetWeight: number;
  endWeight: number | null;
  deltaKg: number | null;
  targetReached: boolean;
  daysValidated: number;
  longestStreak: number;
  runs: number;
  totalKm: number;
}

function inCycle(date: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return diffDays(from, date) >= 0 && diffDays(date, to) >= 0;
}

/** Every figure recomputed from the logs. Nothing here is read from storage. */
export function buildCycleSummary(input: CycleSummaryInputs): CycleSummary {
  const { startDate, goalDate } = input;

  const weighIns = input.weighIns
    .filter((w) => inCycle(w.date, startDate, goalDate))
    .sort((a, b) => a.date.localeCompare(b.date));
  const endWeight = weighIns[weighIns.length - 1]?.kg ?? null;

  const runs = input.runs.filter((r) => inCycle(r.date, startDate, goalDate));
  const logs = input.dayLogs.filter((d) => inCycle(d.date, startDate, goalDate));

  return {
    startDate,
    goalDate,
    days: diffDays(startDate, goalDate) + 1,
    startWeight: input.startWeight,
    targetWeight: input.targetWeight,
    endWeight,
    deltaKg: endWeight === null ? null : endWeight - input.startWeight,
    targetReached: endWeight !== null && endWeight <= input.targetWeight,
    daysValidated: logs.filter((d) => d.validatedAt !== null).length,
    longestStreak: longestStreak(logs, startDate, goalDate),
    runs: runs.length,
    totalKm: runs.reduce((sum, r) => sum + r.distanceKm, 0),
  };
}
```

`src/features/cycle/CycleComplete.tsx`:

```tsx
import { useState } from 'react';
import { saveCycle, saveSettings } from '@/db/repos';
import { todayIn } from '@/domain/calendar';
import { impliedWeeklyRate } from '@/domain/trajectory';
import type { Settings } from '@/domain/types';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { kg, longDate, plural } from '@/ui/format';
import type { CycleSummary } from '@/features/cycle/summary';

export function CycleComplete({
  userId, settings, summary,
}: {
  userId: string;
  settings: Settings;
  summary: CycleSummary;
}) {
  const today = todayIn(settings.timezone);
  const [targetWeight, setTargetWeight] = useState('');
  const [goalDate, setGoalDate] = useState('');

  const target = Number(targetWeight.trim().replace(',', '.'));
  const ready = Number.isFinite(target) && targetWeight.trim() !== '' && goalDate !== '';

  const rate = ready
    ? impliedWeeklyRate({
        startDate: today,
        startWeight: summary.endWeight ?? settings.startWeight,
        targetWeight: target,
        goalDate,
      })
    : null;

  async function startNewCycle() {
    if (!ready) return;
    // Record the boundaries before overwriting them.
    await saveCycle(userId, {
      startDate: summary.startDate,
      goalDate: summary.goalDate,
      startWeight: summary.startWeight,
      targetWeight: summary.targetWeight,
      endWeight: summary.endWeight,
    });
    await saveSettings({
      ...settings,
      startDate: today,
      startWeight: summary.endWeight ?? settings.startWeight,
      targetWeight: target,
      goalDate,
    });
  }

  const inputStyle = {
    font: 'inherit', color: 'var(--ink)', background: 'var(--inset)',
    border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', width: '100%',
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card laced>
        <span className="label">
          {longDate(summary.startDate)} — {longDate(summary.goalDate)}
        </span>
        <h1 className="display" style={{ fontSize: 'var(--step-3)', margin: '6px 0 0', fontWeight: 300 }}>
          {summary.targetReached ? 'Objectif atteint.' : "C'est fini."}
        </h1>

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="label">Poids</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {kg(summary.startWeight)} →{' '}
              {summary.endWeight === null ? '—' : kg(summary.endWeight)} kg
              {summary.deltaKg !== null
                && ` (${summary.deltaKg < 0 ? '\u2212' : '+'}${kg(Math.abs(summary.deltaKg))})`}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="label">Journées validées</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {summary.daysValidated} / {summary.days}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="label">Plus longue série</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {summary.longestStreak} {plural(summary.longestStreak, 'jour', 'jours')}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="label">Sorties</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {summary.runs} · {summary.totalKm.toFixed(1).replace('.', ',')} km
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <span className="label">La suite</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <label htmlFor="cyc-target" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="label">Nouvel objectif</span>
            <input
              id="cyc-target" inputMode="decimal" value={targetWeight}
              onChange={(event) => setTargetWeight(event.target.value)} style={inputStyle}
            />
          </label>
          <label htmlFor="cyc-date" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="label">Nouvelle date</span>
            <input
              id="cyc-date" type="date" value={goalDate}
              onChange={(event) => setGoalDate(event.target.value)} style={inputStyle}
            />
          </label>
          {rate !== null && (
            <p style={{ fontFamily: 'var(--font-hand)', fontSize: 'var(--step-1)', color: 'var(--cerise)', margin: 0 }}>
              Ça fait {kg(Math.abs(rate))} kg par semaine.
            </p>
          )}
          <Button onClick={startNewCycle} disabled={!ready}>Repartir</Button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Gate it in the app shell**

In `src/app/App.tsx`, inside the authenticated branch, before the router: if the goal date has passed *and* no `cycles` row has been written for that goal date, render `<CycleComplete />` instead of the tabs. Add to the `useLiveQuery` body:

```ts
const date = todayIn(settings.timezone);
const cycles = await listCycles(userId);
const alreadyArchived = cycles.some((c) => c.goalDate === settings.goalDate);
const cycleComplete = isCycleComplete(settings.goalDate, date) && !alreadyArchived;
const summary = cycleComplete
  ? buildCycleSummary({
      startDate: settings.startDate,
      goalDate: settings.goalDate,
      startWeight: settings.startWeight,
      targetWeight: settings.targetWeight,
      dayLogs: (await listDayLogs(userId)).map((d) => ({
        date: d.date, validatedAt: d.validatedAt, jokered: d.jokered,
      })),
      runs: await listRuns(userId),
      weighIns: (await listWeights(userId)).map((w) => ({ date: w.date, kg: w.kg })),
    })
  : null;
```

and return `<div className="app"><CycleComplete userId={userId} settings={settings} summary={summary} /></div>` when `summary` is non-null. The `alreadyArchived` check is what makes "Repartir" actually leave the screen: it writes the cycle row, so the gate stops matching.

- [ ] **Step 6: Run the tests and commit**

Run: `npm test && npx tsc -b`
Expected: all PASS.

```bash
git add src/features/cycle src/domain/streak.ts src/app/App.tsx
git commit -m "feat: archive a finished cycle and prompt for the next goal"
```

---

## Plan 3 Done When

- `npm test` and `npx tsc -b` are clean.
- No chart uses two y-scales. Verify by inspection: each `<Chart>` has exactly one `yFormat`.
- No chart distinguishes series by colour alone. Verify: `grep -rE "var\(--rose\)" src/ui/marks.tsx` returns nothing — marks use `--cerise` for data and `--ink-soft` for the reference line only.
- Every chart has a working "Voir les chiffres" table.
- Editing week W+1's planner leaves week W's stored plan untouched.
- The app is feature-complete for local use: you can log a weight, a meal, a run, and adjust every target without touching the code.
- Spec §4.9 is covered: setting `goalDate` to yesterday in settings shows the cycle summary, and "Repartir" writes a `cycles` row and returns you to the tabs.
