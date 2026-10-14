import { describe, it, expect } from 'vitest';
import { newCard, previewGrades, applyGrade, retrievability, formatInterval, Rating, State, type FSRSCard } from '../fsrs';

const now = new Date('2026-07-11T09:00:00Z');

describe('fsrs wrapper', () => {
  it('a new card is in New state and due immediately', () => {
    const c = newCard(now);
    expect(c.state as unknown as number).toBe(State.New);
    expect(new Date(c.due).getTime()).toBeLessThanOrEqual(now.getTime() + 1000);
  });

  it('previewGrades returns the four grades in order, with Easy scheduled no sooner than Good', () => {
    const g = previewGrades(newCard(now), now);
    expect(g.map((x) => x.name)).toEqual(['again', 'hard', 'good', 'easy']);
    const due = g.map((x) => new Date(x.resultCard.due).getTime());
    expect(due[3]).toBeGreaterThanOrEqual(due[2]); // easy >= good
    expect(due[2]).toBeGreaterThanOrEqual(due[0]); // good >= again
  });

  it('grading Easy schedules further out than Again', () => {
    const c = newCard(now);
    const again = applyGrade(c, Rating.Again, now);
    const easy = applyGrade(c, Rating.Easy, now);
    expect(new Date(easy.due).getTime()).toBeGreaterThan(new Date(again.due).getTime());
  });

  it('grades a card that went through a JSON round-trip (server storage turns dates into strings)', () => {
    const stored = JSON.parse(JSON.stringify(applyGrade(newCard(now), Rating.Good, now))) as FSRSCard;
    expect(typeof stored.due).toBe('string');
    const later = new Date(now.getTime() + 3 * 86400_000);
    const next = applyGrade(stored, Rating.Good, later);
    expect(new Date(next.due).getTime()).toBeGreaterThan(later.getTime());
    const r = retrievability(stored, later);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe('formatInterval', () => {
  const at = (ms: number) => formatInterval(new Date(now.getTime() + ms), now);
  it('renders compact units', () => {
    expect(at(30 * 1000)).toBe('<1m');
    expect(at(5 * 60 * 1000)).toBe('5m');
    expect(at(3 * 3600 * 1000)).toBe('3h');
    expect(at(10 * 86400 * 1000)).toBe('10d');
    expect(at(90 * 86400 * 1000)).toBe('3mo');
  });
});
