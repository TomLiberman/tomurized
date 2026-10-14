// Pure balance math for the study games — all tunable numbers live here so
// they're unit-testable and adjustable in one place.

import type { TheoryData } from '../lib/types';
import type { Rng } from './questionEngine';

// ---------------------------------------------------------------------------
// Boss battle — קרב בוסים
// ---------------------------------------------------------------------------

export interface BossDef {
  /** Display name: the descriptive part of the topic key (after "נושא X - "). */
  name: string;
  /** Short unit label ("נושא 5ב") or '' when the key has no such prefix. */
  unit: string;
  /** Full topic key — the question pool for this boss. */
  topic: string;
  hp: number;
  emoji: string;
  /** OKLCH hue for the boss's accent color. */
  hue: number;
}

const BOSS_EMOJI = ['🎓', '🧠', '📚', '⚖️', '🏛️', '🔬', '🗣️', '👥'];
const BOSS_HUES = [265, 210, 155, 25, 330, 95, 0, 45];

export const PLAYER_MAX_HP = 3;

// One boss per deck topic (in deck order), HP escalating 4,5,…,8 capped.
// Topic keys look like "נושא 5ב - כוח, ידע וסובייקט - מישל פוקו" — the part
// after the first " - " is the interesting name; the prefix becomes the unit.
export function buildBosses(db: TheoryData): BossDef[] {
  return Object.keys(db)
    .filter(topic => (db[topic] || []).length > 0)
    .map((topic, i) => {
      const sep = topic.indexOf(' - ');
      return {
        name: sep === -1 ? topic.trim() : topic.slice(sep + 3).trim(),
        unit: sep === -1 ? '' : topic.slice(0, sep).trim(),
        topic,
        hp: Math.min(4 + i, 8),
        emoji: BOSS_EMOJI[i % BOSS_EMOJI.length],
        hue: BOSS_HUES[i % BOSS_HUES.length],
      };
    });
}

/** Streak of 3+ correct answers lands a critical hit (2 damage). */
export function attackDamage(streak: number): { dmg: number; crit: boolean } {
  return streak >= 3 ? { dmg: 2, crit: true } : { dmg: 1, crit: false };
}

export function bossScore(events: { correct: number; crits: number; bossesDefeated: number }): number {
  return Math.min(200, events.correct * 10 + events.crits * 5 + events.bossesDefeated * 20);
}

// ---------------------------------------------------------------------------
// Millionaire — מיליונר
// ---------------------------------------------------------------------------

/** Display "prizes" — flavor only; study points come from millionairePoints. */
export const LADDER = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000];

/** Ladder indices that are safe havens (Q3 and Q6). */
export const SAFE_HAVENS = [2, 5];

/** Prize kept when answering question `qIndex` (0-based) wrong. */
export function prizeOnWrong(qIndex: number): number {
  const passed = SAFE_HAVENS.filter(h => h < qIndex);
  return passed.length ? LADDER[passed[passed.length - 1]] : 0;
}

// Simulated audience poll: the correct answer usually leads, less confidently
// on later (harder) rungs. Integer percentages summing to 100.
export function audiencePoll(
  options: string[],
  correctAnswer: string,
  qIndex: number,
  rng: Rng = Math.random
): Record<string, number> {
  const jitter = Math.floor(rng() * 17) - 8; // −8..8
  const correctShare = Math.min(85, Math.max(35, 70 - qIndex * 3 + jitter));
  const others = options.filter(o => o !== correctAnswer);

  // Split the remainder with random weights.
  const weights = others.map(() => rng() + 0.1);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  let remaining = 100 - correctShare;
  const poll: Record<string, number> = { [correctAnswer]: correctShare };
  others.forEach((o, i) => {
    const share = i === others.length - 1
      ? remaining
      : Math.min(remaining, Math.round((weights[i] / weightSum) * (100 - correctShare)));
    poll[o] = share;
    remaining -= share;
  });
  return poll;
}

/** 50:50 — returns the two options to KEEP (the correct one + one distractor). */
export function fiftyFifty(options: string[], correctAnswer: string, rng: Rng = Math.random): string[] {
  const distractors = options.filter(o => o !== correctAnswer);
  const kept = distractors[Math.floor(rng() * distractors.length)];
  return options.filter(o => o === correctAnswer || o === kept);
}

export function millionairePoints(correctCount: number, finished: boolean): number {
  return correctCount * 10 + (finished ? 30 : 0);
}

// ---------------------------------------------------------------------------
// Memory match — משחק זיכרון
// ---------------------------------------------------------------------------

/** 100 minus penalties for extra moves and elapsed time; floors at 0. */
export function memoryScore(moves: number, seconds: number, pairs: number): number {
  return Math.max(0, 100 - Math.max(0, moves - pairs) * 5 - Math.floor(seconds / 10) * 2);
}

export function memoryPoints(score: number): number {
  return Math.min(20, Math.floor(score / 5));
}

// ---------------------------------------------------------------------------
// Swipe — החלקה
// ---------------------------------------------------------------------------

/** ×1 at streak 0–4, ×2 at 5–9, ×3 from 10 up. */
export function swipeMultiplier(streak: number): number {
  return Math.min(3, 1 + Math.floor(streak / 5));
}

/** 5 × multiplier per correct judgment, capped at 100. */
export function swipePoints(correctMultipliers: number[]): number {
  return Math.min(100, correctMultipliers.reduce((s, m) => s + 5 * m, 0));
}
