import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { saveSettings } from '@/db/repos';
import { db, type OpenResult } from '@/db/schema';

/**
 * The shell's open gate is the thing under test here, so openDatabase has to
 * be drivable to each of its three outcomes. Partially mocked: `db` and the
 * repos' own import of it must stay the one real instance, or beforeEach would
 * seed a different database from the one the screen reads.
 */
const open = vi.hoisted(() => ({ result: { ok: true } as OpenResult }));
vi.mock('@/db/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/schema')>();
  return { ...actual, openDatabase: () => Promise.resolve(open.result) };
});

/**
 * On a device that blocks storage, every repo read fails too - and it fails in
 * one of two ways, both of which the shell has to survive. `stall` makes the
 * querier hang forever, so the shell may only render if its open gate decides
 * BEFORE the querier's result is consulted. `reject` makes it fail outright,
 * which is strictly worse: dexie-react-hooks rethrows a rejected querier
 * during render, so a shell that merely consults the gate first still goes
 * blank the moment the rejection arrives.
 */
const session = vi.hoisted(() => ({ stall: false, reject: false, reads: 0 }));
vi.mock('@/app/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/session')>();
  return {
    ...actual,
    getCurrentUserId: () => {
      // Counted, not just driven: `reads` is how a test can tell "the gate
      // rendered first" from "the querier was never subscribed at all", which
      // is the difference between surviving the race and not running it.
      session.reads += 1;
      if (session.reject) {
        return Promise.reject(new DOMException('denied', 'SecurityError'));
      }
      return session.stall ? new Promise<string | null>(() => {}) : actual.getCurrentUserId();
    },
  };
});

/**
 * A screen below the open gate that throws while rendering, standing in for a
 * corrupt stored date reaching a parser. Nothing the gate inspects can predict
 * it, so only a boundary can keep it off a blank page.
 */
const today = vi.hoisted(() => ({ throws: false }));
vi.mock('@/features/today/Today', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/today/Today')>();
  return {
    ...actual,
    Today: (props: { userId: string }) => {
      if (today.throws) throw new TypeError('invalid stored date');
      return <actual.Today {...props} />;
    },
  };
});

/** Lets any already-scheduled Dexie query timer fire before we assert on it. */
function flushTimers() {
  return new Promise((resolve) => { setTimeout(resolve, 20); });
}

/** Midday in Paris on a Tuesday, well before the goal date. */
const TUESDAY_NOON = new Date('2026-10-06T10:00:00Z');

async function seedUser() {
  await db.meta.put({ key: 'currentUserId', value: 'u1' });
  await saveSettings({
    userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-01',
    startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
    weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
    calorieFloor: 1200, stepTarget: 8000, waterTarget: 6,
    runSessionsTarget: 5, soundEnabled: false,
  });
}

beforeEach(async () => {
  open.result = { ok: true };
  session.stall = false;
  session.reject = false;
  session.reads = 0;
  today.throws = false;
  // Date only, so findBy* and waitFor keep real timers. Pinned because the
  // countdown is relative to the goal date and the suite must not change
  // meaning as the real date moves.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TUESDAY_NOON);
  await db.open();
  await Promise.all([
    db.settings.clear(), db.meta.clear(), db.dayLogs.clear(), db.weekPlans.clear(),
    db.runs.clear(), db.calorieEntries.clear(), db.outbox.clear(),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('shows onboarding when no settings exist', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Commencer' })).toBeInTheDocument();
  });

  it('shows Today once settings exist', async () => {
    await seedUser();
    render(<App />);
    expect(await screen.findByTestId('countdown')).toBeInTheDocument();
  });

  it('offers all five tabs', async () => {
    await seedUser();
    render(<App />);
    for (const name of ['Aujourd\u2019hui', 'Poids', 'Calories', 'Course', 'Moi']) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('explains blocked storage instead of rendering onboarding or Today', async () => {
    await seedUser();

    // The success path first. Without this half, a shell that ALWAYS rendered
    // the blocked panel would pass the second half.
    const opened = render(<App />);
    expect(await screen.findByTestId('countdown')).toBeInTheDocument();
    expect(screen.queryByTestId('storage-blocked')).toBeNull();
    opened.unmount();

    open.result = { ok: false, reason: 'blocked', error: new DOMException('denied', 'SecurityError') };
    render(<App />);
    const panel = await screen.findByTestId('storage-blocked');
    expect(panel).toHaveTextContent(/navigation priv/);
    expect(screen.queryByTestId('countdown')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Commencer' })).toBeNull();
  });

  it('explains an unknown open failure in different words from a blocked one', async () => {
    await seedUser();
    open.result = { ok: false, reason: 'unknown', error: new Error('boom') };
    render(<App />);
    const panel = await screen.findByTestId('storage-unknown');
    expect(panel).toHaveTextContent(/[Rr]echarge/);
    // The two failure branches must be tellable apart in the DOM, or `reason`
    // is decorative and no test could discriminate them.
    expect(screen.queryByTestId('storage-blocked')).toBeNull();
    expect(screen.queryByTestId('countdown')).toBeNull();
  });

  it('explains blocked storage when the live query REJECTS rather than hangs', async () => {
    // The sibling test above stalls the querier. A blocked store is just as
    // likely to make every read reject, and dexie-react-hooks rethrows a
    // rejected querier during render - so the gate must not merely be
    // consulted first, the querier must not be subscribed to at all until the
    // gate has passed.
    await seedUser();
    session.reject = true;
    open.result = { ok: false, reason: 'blocked', error: new DOMException('denied', 'SecurityError') };
    render(<App />);
    const panel = await screen.findByTestId('storage-blocked');
    expect(panel).toHaveTextContent(/navigation priv/);
    // Not the boundary's panel, and not a blank page: the gate's own branch.
    expect(screen.queryByTestId('storage-unknown')).toBeNull();
    expect(screen.queryByTestId('countdown')).toBeNull();

    // The querier must never have been subscribed, not merely have lost a
    // race with the gate: a subscription that rejects later still rethrows on
    // the next render and takes the panel down with it. Checked after a flush
    // so a subscription made at mount would have fired by now, and alongside
    // the assertions above so that zero reads cannot mean nothing rendered.
    await flushTimers();
    expect(session.reads).toBe(0);
    expect(screen.getByTestId('storage-blocked')).toBeInTheDocument();
  });

  it('explains the failure even when the live query never resolves', async () => {
    // The gate has to be consulted before the querier's result, not after: on
    // a blocked device the querier stays pending forever, and a shell that
    // waits for it shows a spinner that never resolves instead of the reason.
    await seedUser();
    session.stall = true;
    open.result = { ok: false, reason: 'blocked', error: new DOMException('denied', 'SecurityError') };
    render(<App />);
    expect(await screen.findByTestId('storage-blocked')).toBeInTheDocument();
  });

  it('shows the unknown panel, not a blank page, when a screen throws mid-render', async () => {
    await seedUser();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    today.throws = true;

    render(<App />);
    const panel = await screen.findByTestId('storage-unknown');
    expect(panel).toHaveTextContent(/[Rr]echarge/);
    // The gate succeeded, so this is the boundary's branch and not the gate's.
    expect(screen.queryByTestId('storage-blocked')).toBeNull();
    expect(screen.queryByTestId('countdown')).toBeNull();

    // And it must not swallow: a defect that lands here stays diagnosable.
    expect(logged.mock.calls.some(
      (call) => String(call[0]).includes('ErrorBoundary'),
    )).toBe(true);
  });
});
