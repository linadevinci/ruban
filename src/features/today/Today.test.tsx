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

/**
 * A switch that makes every write this screen can make reject, the way
 * IndexedDB refuses one on a near-full phone. Pass-through while it is off, so
 * every other case in this file runs against the real repos - and so the
 * happy-path case can prove the notice is not simply always on screen.
 *
 * Only the three writes Today reaches are wrapped: the reads useToday's
 * querier makes have to keep working, or the screen never renders at all and
 * the message would be unreachable for the wrong reason.
 */
const writes = vi.hoisted(() => ({ fail: false }));
vi.mock('@/db/repos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/repos')>();
  const refuse = <F extends (...args: never[]) => Promise<unknown>>(real: F): F => {
    const pass = real as unknown as (...args: unknown[]) => Promise<unknown>;
    return ((...args: unknown[]) => (writes.fail
      ? Promise.reject(new DOMException('quota exceeded', 'QuotaExceededError'))
      : pass(...args))) as unknown as F;
  };
  return {
    ...actual,
    updateDayLog: refuse(actual.updateDayLog),
    spendJoker: refuse(actual.spendJoker),
    stampDayLog: refuse(actual.stampDayLog),
  };
});

/** The first line of the refused-write notice, as Today renders it. */
const OOPS = /pas réussi à enregistrer/;

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
  writes.fail = false;
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

  it('keeps every digit of a step count typed key by key', async () => {
    render(<Today userId="u1" />);
    const field = await screen.findByRole('textbox', { name: 'Pas' });

    // Key by key and with no delay, which is how a number is actually typed
    // and the one thing the suite never did: every case above hands the field
    // a whole value in one change event. A field whose value comes from the
    // live query is reset to the PRE-write value on the re-render each
    // keystroke causes, so any two keys inside one IndexedDB round-trip
    // collapse - this typed 0 into the field and stored 0.
    await userEvent.type(field, '8200', { delay: 0 });

    await waitFor(async () => {
      expect((await db.dayLogs.toCollection().first())?.steps).toBe(8200);
    });
    expect(field).toHaveValue('8200');
    // 8200 clears the 8000 target, so the day can go on to validate. A
    // collapsed 0 or 82 never would, and nothing on the screen would say why.
    expect(screen.getByRole('checkbox', { name: 'Calories respectées' })).toBeInTheDocument();
  });

  it('shows the step count already stored for the day', async () => {
    // The draft the field is driven by has to be seeded from the stored row,
    // or a count logged yesterday evening - or on her laptop - would read as
    // an empty field this morning, and the first keystroke would replace it.
    await db.dayLogs.put(log({ steps: 8200 }));
    render(<Today userId="u1" />);
    expect(await screen.findByRole('textbox', { name: 'Pas' })).toHaveValue('8200');
  });

  it('honours the first tap on a box that something else is satisfying', async () => {
    // A logged run satisfies `course` on its own, with no tick stored, so the
    // box shows checked while the stored tick is unset. The first tap means
    // what the browser says it means - take it back - and only a LATER tap
    // has an earlier tap's result to flip instead.
    await db.runs.put({
      id: 'r1', userId: 'u1', date: TUESDAY, distanceKm: 5, durationS: 1500,
      note: null, updatedAt: '2026-10-06T09:00:00.000Z', deletedAt: null,
    });

    render(<Today userId="u1" />);
    const box = await screen.findByRole('checkbox', { name: 'Course' });
    expect(box).toBeChecked();

    await userEvent.click(box);
    await waitFor(async () => {
      expect((await db.dayLogs.toCollection().first())?.ticks.course).toBe(false);
    });
  });

  it('counts every tap on the water stepper, however fast they come', async () => {
    render(<Today userId="u1" />);
    const plus = await screen.findByRole('button', { name: 'Augmenter Eau' });

    // Three taps with no await between them: all three read the same rendered
    // count, because the live query cannot deliver a new one until the first
    // write has landed. Writing the absolute value the stepper computed from
    // that count stored 1 and lost two glasses.
    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);

    await waitFor(async () => {
      expect((await db.dayLogs.toCollection().first())?.waterGlasses).toBe(3);
    });
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('lets a mistaken tick be taken straight back', async () => {
    render(<Today userId="u1" />);
    const box = await screen.findByRole('checkbox', { name: 'Calories respectées' });

    // Tick, then untick before the first write has been delivered back - a
    // tap on the wrong line and an immediate correction. Both taps read the
    // same rendered box, so both wrote `true` and the untick was lost: the
    // day then validated on an item she had explicitly taken back.
    fireEvent.click(box);
    fireEvent.click(box);

    await waitFor(async () => {
      expect((await db.dayLogs.toCollection().first())?.ticks.calories).toBe(false);
    });
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Calories respectées' })).not.toBeChecked();
    });
  });

  it('does not carry a half-typed step count over into the new day', async () => {
    vi.setSystemTime(new Date('2026-10-06T21:50:00Z'));
    render(<Today userId="u1" />);
    const field = await screen.findByRole('textbox', { name: 'Pas' });
    await userEvent.type(field, '82', { delay: 0 });
    expect(field).toHaveValue('82');

    // Midnight, with the field never blurred. The draft belongs to the day it
    // was typed on: the 7th has no count yet, and showing yesterday's "82"
    // over an empty row would invite her to add two digits to a number that
    // is not there.
    vi.setSystemTime(new Date('2026-10-06T22:10:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByRole('heading', { name: 'mercredi 7 octobre' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Pas' })).toHaveValue('');
  });

  it('follows the clock across midnight while it stays open', async () => {
    // 23:50 in Paris on the Tuesday, the screen left open - spec 10's "the
    // checklist gets ticked at 23h in bed", and a home-screen PWA is resumed
    // from the background rather than reloaded, so nothing else corrects it.
    vi.setSystemTime(new Date('2026-10-06T21:50:00Z'));
    render(<Today userId="u1" />);
    expect(await screen.findByRole('heading', { name: 'mardi 6 octobre' })).toBeInTheDocument();

    vi.setSystemTime(new Date('2026-10-06T22:10:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByRole('heading', { name: 'mercredi 7 octobre' })).toBeInTheDocument();

    // And the ticks go to the new day. Landing on the 6th would silently
    // re-validate a day already stamped, leave the 7th with nothing, and
    // break the streak.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Calories respectées' }));
    await waitFor(async () => { expect(await db.dayLogs.count()).toBe(1); });
    const row = await db.dayLogs.toCollection().first();
    expect(row?.date).toBe('2026-10-07');
    expect(row?.ticks.calories).toBe(true);
  });
  it('says so, and keeps saying so, when a tick cannot be saved', async () => {
    render(<Today userId="u1" />);
    const box = await screen.findByRole('checkbox', { name: 'Calories respectées' });
    // Nothing on screen yet: the notice has to be caused by the failure, not
    // rendered unconditionally.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    writes.fail = true;
    await userEvent.click(box);

    // In the UI, in French, and announced - until this landed a refused write
    // left no trace at all outside a console she cannot open: the tick simply
    // sprang back.
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(OOPS);
    // And it does not read as "your day is gone", the way the shell's
    // open-failure panel does not either.
    expect(notice).toHaveTextContent(/le reste de ta journée est intact/);

    // The tick really did not take, which is what the notice is there to
    // explain.
    expect(await db.dayLogs.count()).toBe(0);
    expect(box).not.toBeChecked();

    // Dismissible, and dismissed by her rather than by the next render: three
    // more renders happen under it here.
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when the steps field, the water stepper or the joker cannot be saved', async () => {
    // The other three write paths. Each one used to drop its rejection: two as
    // unhandled promises, one under a bare `void`.
    render(<Today userId="u1" />);
    const field = await screen.findByRole('textbox', { name: 'Pas' });
    writes.fail = true;

    fireEvent.change(field, { target: { value: '8200' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(OOPS);
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));

    fireEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OOPS);
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));

    fireEvent.click(screen.getByRole('button', { name: 'Utiliser mon joker' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OOPS);

    // None of the three landed.
    expect(await db.dayLogs.count()).toBe(0);
    expect(await db.weekPlans.count()).toBe(0);
  });

  it('says so when the day cannot be stamped as validated', async () => {
    // The fifth write, and the one with the most to lose: the stamping effect
    // is what records a finished day AS finished. A day that is already
    // complete when the screen opens, so the effect is the only write in
    // play - refusing the tick first would stop the day completing and never
    // reach the stamp at all.
    await db.dayLogs.put(log({
      steps: 8200, waterGlasses: 6, ticks: { calories: true, course: true },
    }));
    writes.fail = true;
    render(<Today userId="u1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(OOPS);
    expect((await db.dayLogs.get('l1'))?.validatedAt).toBeNull();
    // The screen still shows the day as done - the live evaluation says so
    // even though the stamp was refused - which is exactly why the refusal
    // needs saying out loud.
    expect(screen.getByText('Journée validée.')).toBeInTheDocument();
  });

  it('says nothing at all when the writes land', async () => {
    // The control. A notice rendered unconditionally would pass every case
    // above and shout at her all day.
    await db.dayLogs.put(log({ steps: 8200, waterGlasses: 5, ticks: { calories: true } }));
    render(<Today userId="u1" />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Course' }));
    await waitFor(async () => {
      expect((await db.dayLogs.get('l1'))?.ticks.course).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    await waitFor(async () => {
      expect((await db.dayLogs.get('l1'))?.waterGlasses).toBe(6);
    });
    // Including after the stamping effect has run, which is a write of its own.
    await waitFor(async () => {
      expect(typeof (await db.dayLogs.get('l1'))?.validatedAt).toBe('string');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(OOPS)).not.toBeInTheDocument();
  });

  it('counts down to the goal date, and stops counting past it', async () => {
    // The goal date itself: the last day there is anything to count down to.
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    render(<Today userId="u1" />);
    expect((await screen.findByTestId('countdown')).textContent).toBe('J\u22120');
  });

  it('does not render a negative countdown the day after the goal', async () => {
    // One day past the goal, daysUntil is -1, and a minus sign in front of it
    // rendered "J--1". Spec 4.9's cycle summary belongs to Plan 3; what this
    // pins is that the pill stops counting rather than counting backwards.
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    render(<Today userId="u1" />);
    const pill = await screen.findByTestId('countdown');
    expect(pill.textContent).toBe('Cycle terminé');
    expect(pill.textContent).not.toContain('\u2212');
    expect(pill.textContent).not.toContain('-');
  });

  it('names the water count, and not just its two buttons', async () => {
    // "Eau" was a plain <span> beside an unlabelled <span> holding the count,
    // so a screen reader read out a bare number with no name on it.
    await db.dayLogs.put(log({ waterGlasses: 4 }));
    render(<Today userId="u1" />);

    const count = await screen.findByRole('spinbutton', { name: 'Eau' });
    expect(count).toHaveAttribute('aria-valuenow', '4');
    // And "Eau" is a real <label> pointing at it, which is the standard the
    // steps row above already set with its <label htmlFor> plus aria-label.
    // Asserted through the `for`/`id` pair rather than through
    // getByLabelText('Eau'), which resolves through the value's own aria-label
    // and would pass against the <span> this used to be.
    const name = screen.getByText('Eau');
    expect(name.tagName).toBe('LABEL');
    expect(count.id).not.toBe('');
    expect(name).toHaveAttribute('for', count.id);
    // The button names tests rely on still work.
    expect(screen.getByRole('button', { name: 'Augmenter Eau' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diminuer Eau' })).toBeInTheDocument();
  });
});
