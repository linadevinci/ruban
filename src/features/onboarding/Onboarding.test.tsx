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
