import { describe, it, expect } from 'vitest';
import {
  buildBosses,
  attackDamage,
  bossScore,
  PLAYER_MAX_HP,
  LADDER,
  SAFE_HAVENS,
  prizeOnWrong,
  audiencePoll,
  fiftyFifty,
  millionairePoints,
  memoryScore,
  memoryPoints,
  swipeMultiplier,
  swipePoints,
} from '../gameLogic';
import type { TheoryData } from '../../lib/types';

const seeded = (seed: number) => {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('buildBosses', () => {
  const db: TheoryData = {
    'נושא 1 - צירים אנליטיים': [{ term: 'א', definition: 'ב' }],
    'נושא 5ב - כוח, ידע וסובייקט - מישל פוקו': [{ term: 'ג', definition: 'ד' }],
    'ללא מפריד': [{ term: 'ה', definition: 'ו' }],
    'נושא ריק - בלי מושגים': [],
  };

  it('derives name from the part after the first " - " and keeps the unit prefix', () => {
    const bosses = buildBosses(db);
    expect(bosses).toHaveLength(3); // empty topic dropped
    expect(bosses[0]).toMatchObject({ name: 'צירים אנליטיים', unit: 'נושא 1' });
    expect(bosses[1]).toMatchObject({ name: 'כוח, ידע וסובייקט - מישל פוקו', unit: 'נושא 5ב' });
    expect(bosses[2]).toMatchObject({ name: 'ללא מפריד', unit: '' });
  });

  it('escalates HP 4,5,6,… capped at 8', () => {
    const many: TheoryData = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`נושא ${i} - חלק`, [{ term: 'א', definition: 'ב' }]])
    );
    const hps = buildBosses(many).map(b => b.hp);
    expect(hps).toEqual([4, 5, 6, 7, 8, 8, 8]);
  });
});

describe('attackDamage / bossScore', () => {
  it('crits from a streak of 3', () => {
    expect(attackDamage(0)).toEqual({ dmg: 1, crit: false });
    expect(attackDamage(2)).toEqual({ dmg: 1, crit: false });
    expect(attackDamage(3)).toEqual({ dmg: 2, crit: true });
    expect(attackDamage(10)).toEqual({ dmg: 2, crit: true });
  });

  it('scores 10/correct +5/crit +20/boss, capped at 200', () => {
    expect(bossScore({ correct: 3, crits: 1, bossesDefeated: 0 })).toBe(35);
    expect(bossScore({ correct: 8, crits: 2, bossesDefeated: 2 })).toBe(130);
    expect(bossScore({ correct: 50, crits: 20, bossesDefeated: 5 })).toBe(200);
  });

  it('player has 3 hearts', () => {
    expect(PLAYER_MAX_HP).toBe(3);
  });
});

describe('millionaire ladder', () => {
  it('has 10 rungs and havens at Q3/Q6', () => {
    expect(LADDER).toHaveLength(10);
    expect(SAFE_HAVENS).toEqual([2, 5]);
  });

  it('prizeOnWrong drops to the last passed haven', () => {
    // Wrong on Q1–Q3 (indices 0–2): no haven passed yet → 0.
    expect(prizeOnWrong(0)).toBe(0);
    expect(prizeOnWrong(2)).toBe(0);
    // Wrong on Q4–Q6 (indices 3–5): passed Q3 → 300.
    expect(prizeOnWrong(3)).toBe(LADDER[2]);
    expect(prizeOnWrong(5)).toBe(LADDER[2]);
    // Wrong on Q7+ (indices 6–9): passed Q6 → 2000.
    expect(prizeOnWrong(6)).toBe(LADDER[5]);
    expect(prizeOnWrong(9)).toBe(LADDER[5]);
  });

  it('audiencePoll sums to 100 with the correct answer leading early on', () => {
    const options = ['א', 'ב', 'ג', 'ד'];
    for (let seed = 1; seed <= 20; seed++) {
      const poll = audiencePoll(options, 'ב', 0, seeded(seed));
      const total = Object.values(poll).reduce((s, v) => s + v, 0);
      expect(total).toBe(100);
      expect(Object.keys(poll).sort()).toEqual([...options].sort());
      for (const other of ['א', 'ג', 'ד']) {
        expect(poll['ב']).toBeGreaterThan(poll[other]);
      }
      expect(poll['ב']).toBeGreaterThanOrEqual(35);
      expect(poll['ב']).toBeLessThanOrEqual(85);
    }
  });

  it('fiftyFifty keeps the correct answer plus exactly one distractor', () => {
    const options = ['א', 'ב', 'ג', 'ד'];
    for (let seed = 1; seed <= 10; seed++) {
      const kept = fiftyFifty(options, 'ג', seeded(seed));
      expect(kept).toHaveLength(2);
      expect(kept).toContain('ג');
    }
  });

  it('millionairePoints: 10/correct +30 finish bonus', () => {
    expect(millionairePoints(0, false)).toBe(0);
    expect(millionairePoints(7, false)).toBe(70);
    expect(millionairePoints(10, true)).toBe(130);
  });
});

describe('memory scoring', () => {
  it('perfect run scores 100 and floors at 0', () => {
    expect(memoryScore(6, 0, 6)).toBe(100);
    expect(memoryScore(6, 9, 6)).toBe(100); // under 10s costs nothing
    expect(memoryScore(100, 1000, 6)).toBe(0);
  });

  it('penalizes extra moves and time', () => {
    expect(memoryScore(10, 0, 6)).toBe(80);   // 4 extra moves × 5
    expect(memoryScore(6, 30, 6)).toBe(94);   // 3 decades × 2
  });

  it('memoryPoints maxes at 20', () => {
    expect(memoryPoints(100)).toBe(20);
    expect(memoryPoints(47)).toBe(9);
    expect(memoryPoints(0)).toBe(0);
  });
});

describe('swipe scoring', () => {
  it('multiplier steps at streaks 5 and 10, capped ×3', () => {
    expect(swipeMultiplier(0)).toBe(1);
    expect(swipeMultiplier(4)).toBe(1);
    expect(swipeMultiplier(5)).toBe(2);
    expect(swipeMultiplier(9)).toBe(2);
    expect(swipeMultiplier(10)).toBe(3);
    expect(swipeMultiplier(50)).toBe(3);
  });

  it('swipePoints caps at 100', () => {
    expect(swipePoints([1, 1, 2])).toBe(20);
    expect(swipePoints(Array.from({ length: 20 }, () => 3))).toBe(100);
    expect(swipePoints([])).toBe(0);
  });
});
