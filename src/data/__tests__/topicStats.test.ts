import { describe, it, expect } from 'vitest';
import { computeTopicStats } from '../cards';
import { newCard, applyGrade, Rating } from '../fsrs';

const now = new Date('2026-07-14T12:00:00Z');

// A card reviewed as Good several times ago has high retrievability; a fresh
// new card has none of that history.
const strongFsrs = (() => {
  let c = newCard(new Date('2026-06-01T00:00:00Z'));
  c = applyGrade(c, Rating.Good, new Date('2026-06-01T00:00:00Z'));
  c = applyGrade(c, Rating.Good, new Date('2026-06-10T00:00:00Z'));
  return c;
})();

describe('computeTopicStats', () => {
  const cards = [
    { id: 's::a1', topicId: 'נושא חזק', fsrs: strongFsrs },
    { id: 's::a2', topicId: 'נושא חזק', fsrs: strongFsrs },
    { id: 's::b1', topicId: 'נושא חלש', fsrs: newCard(now) },
    { id: 's::b2', topicId: 'נושא חלש', fsrs: newCard(now) },
  ];

  it('weak topic (wrong answers) sorts before strong topic (right answers)', () => {
    const logs = [
      { cardId: 's::a1', topicId: 'נושא חזק', grade: 3 },
      { cardId: 's::a2', topicId: 'נושא חזק', grade: 4 },
      { cardId: 's::b1', topicId: 'נושא חלש', grade: 1 },
      { cardId: 's::b2', topicId: 'נושא חלש', grade: 1, correct: false },
    ];
    const stats = computeTopicStats(cards, logs, now);
    expect(stats[0].topicId).toBe('נושא חלש');
    expect(stats[0].accuracy).toBe(0);
    expect(stats[1].topicId).toBe('נושא חזק');
    expect(stats[1].accuracy).toBe(1);
    expect(stats[1].strength).toBeGreaterThan(stats[0].strength);
  });

  it('explicit correct flag overrides the grade heuristic', () => {
    // grade Good but marked incorrect (e.g. typed answer judged wrong)
    const stats = computeTopicStats(cards, [{ cardId: 's::a1', topicId: 'נושא חזק', grade: 3, correct: false }], now);
    const strong = stats.find(s => s.topicId === 'נושא חזק')!;
    expect(strong.accuracy).toBe(0);
  });

  it('topics without attempts score by retrievability alone (accuracy null)', () => {
    const stats = computeTopicStats(cards, [], now);
    for (const s of stats) expect(s.accuracy).toBeNull();
    const weak = stats.find(s => s.topicId === 'נושא חלש')!;
    const strong = stats.find(s => s.topicId === 'נושא חזק')!;
    expect(strong.avgRetrievability).toBeGreaterThan(weak.avgRetrievability);
  });

  it('logs without topicId fall back to the card current topic; unknown cards skipped', () => {
    const stats = computeTopicStats(cards, [
      { cardId: 's::b1', grade: 4 },              // no topicId → resolved via card
      { cardId: 's::gone', grade: 1 },            // deleted card → ignored
    ], now);
    const weak = stats.find(s => s.topicId === 'נושא חלש')!;
    expect(weak.attempts).toBe(1);
    expect(weak.accuracy).toBe(1);
  });

  it('counts due cards per topic', () => {
    const stats = computeTopicStats(cards, [], now);
    const weak = stats.find(s => s.topicId === 'נושא חלש')!;
    expect(weak.due).toBe(2); // new cards are due immediately
  });
});
