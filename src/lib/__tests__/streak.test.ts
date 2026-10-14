import { describe, it, expect } from 'vitest';
import { checkStreak, recordStudyDay, daysBetween, previousDay, localDateStr } from '../streak';

describe('date helpers', () => {
  it('localDateStr uses the local calendar day, zero-padded', () => {
    expect(localDateStr(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateStr(new Date(2026, 9, 14, 0, 30))).toBe('2026-10-14');
  });

  it('daysBetween / previousDay cross month, year and DST boundaries', () => {
    expect(daysBetween('2026-10-14', '2026-10-14')).toBe(0);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-02')).toBe(2);
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1); // DST change week
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('checkStreak (app start)', () => {
  it('does nothing without history or when the student studied today/yesterday', () => {
    expect(checkStreak({}, '2026-10-14').shieldsUsed).toBe(0);
    for (const last of ['2026-10-14', '2026-10-13']) {
      const r = checkStreak({ streakDays: 5, streakShields: 2, lastStudyDate: last }, '2026-10-14');
      expect(r).toEqual({ next: { streakDays: 5, streakShields: 2, lastStudyDate: last }, shieldsUsed: 0, reset: false });
    }
  });

  it('spends one shield per missed day and bridges the gap to yesterday', () => {
    const r = checkStreak({ streakDays: 7, streakShields: 3, lastStudyDate: '2026-10-11' }, '2026-10-14');
    expect(r.shieldsUsed).toBe(2); // missed the 12th and 13th
    expect(r.reset).toBe(false);
    expect(r.next).toEqual({ streakDays: 7, streakShields: 1, lastStudyDate: '2026-10-13' });
  });

  it('is idempotent: a second app start the same day charges nothing more', () => {
    const first = checkStreak({ streakDays: 7, streakShields: 3, lastStudyDate: '2026-10-11' }, '2026-10-14');
    const second = checkStreak(first.next, '2026-10-14');
    expect(second.shieldsUsed).toBe(0);
    expect(second.next).toEqual(first.next);
  });

  it('a bridged streak continues when the student studies today', () => {
    const bridged = checkStreak({ streakDays: 7, streakShields: 1, lastStudyDate: '2026-10-12' }, '2026-10-14').next;
    expect(recordStudyDay(bridged, '2026-10-14').next.streakDays).toBe(8);
  });

  it('resets the streak (and keeps the shields) when there are not enough shields', () => {
    const r = checkStreak({ streakDays: 9, streakShields: 1, lastStudyDate: '2026-10-10' }, '2026-10-14');
    expect(r.reset).toBe(true);
    expect(r.shieldsUsed).toBe(0);
    expect(r.next).toEqual({ streakDays: 0, streakShields: 1, lastStudyDate: '2026-10-10' });
  });

  it('never spends shields on a streak that is already 0, or on a clock that went backwards', () => {
    expect(checkStreak({ streakDays: 0, streakShields: 4, lastStudyDate: '2026-10-01' }, '2026-10-14').shieldsUsed).toBe(0);
    expect(checkStreak({ streakDays: 3, streakShields: 4, lastStudyDate: '2026-10-20' }, '2026-10-14').shieldsUsed).toBe(0);
  });
});

describe('recordStudyDay', () => {
  it('starts, extends, or keeps the streak', () => {
    expect(recordStudyDay({}, '2026-10-14')).toEqual({ next: { streakDays: 1, lastStudyDate: '2026-10-14' }, newDay: true });
    expect(recordStudyDay({ streakDays: 4, lastStudyDate: '2026-10-13' }, '2026-10-14').next.streakDays).toBe(5);
    expect(recordStudyDay({ streakDays: 4, lastStudyDate: '2026-10-10' }, '2026-10-14').next.streakDays).toBe(1);
    expect(recordStudyDay({ streakDays: 4, lastStudyDate: '2026-10-14' }, '2026-10-14')).toEqual({
      next: { streakDays: 4, lastStudyDate: '2026-10-14' },
      newDay: false,
    });
  });
});
