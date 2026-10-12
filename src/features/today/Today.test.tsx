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
