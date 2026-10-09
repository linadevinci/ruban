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
    expect(kcal(2400)).toBe('2\u202F400');
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
