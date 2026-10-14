// Study-streak bookkeeping (pure — unit-tested in __tests__/streak.test.ts).
//
// Dates are LOCAL calendar days as 'YYYY-MM-DD'. (toISOString() is UTC, which
// put late-night study on the wrong day for anyone east/west of Greenwich.)

export interface StreakState {
  streakDays?: number;
  streakShields?: number;
  lastStudyDate?: string;
}

/** Local calendar date of `d` as YYYY-MM-DD. */
export function localDateStr(d: Date = new Date()): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar day before `iso`. */
export function previousDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localDateStr(new Date(y, m - 1, d - 1));
}

export interface StreakCheck {
  next: StreakState;
  /** Shields spent to bridge missed days (0 when none were needed or available). */
  shieldsUsed: number;
  /** The streak was broken and reset to 0. */
  reset: boolean;
}

/**
 * Run once per app start: did the student miss days since they last studied?
 * Each missed day costs one shield. With enough shields the gap is bridged —
 * lastStudyDate moves to yesterday, so studying today continues the streak (and
 * the next app start doesn't charge for the same gap again). Without enough
 * shields the streak resets and the shields are kept for next time.
 */
export function checkStreak(state: StreakState, today: string): StreakCheck {
  const { lastStudyDate, streakShields = 0, streakDays = 0 } = state;
  if (!lastStudyDate) return { next: state, shieldsUsed: 0, reset: false };
  const missed = daysBetween(lastStudyDate, today) - 1;
  if (missed <= 0) return { next: state, shieldsUsed: 0, reset: false };
  if (streakDays > 0 && streakShields >= missed) {
    return {
      next: { ...state, streakShields: streakShields - missed, lastStudyDate: previousDay(today) },
      shieldsUsed: missed,
      reset: false,
    };
  }
  return { next: { ...state, streakDays: 0 }, shieldsUsed: 0, reset: streakDays > 0 };
}

/** Record a study session today: extends, starts, or keeps the streak. */
export function recordStudyDay(state: StreakState, today: string): { next: StreakState; newDay: boolean } {
  const { lastStudyDate, streakDays = 0 } = state;
  if (lastStudyDate === today) return { next: state, newDay: false };
  const streak = lastStudyDate === previousDay(today) ? streakDays + 1 : 1;
  return { next: { ...state, streakDays: streak, lastStudyDate: today }, newDay: true };
}
