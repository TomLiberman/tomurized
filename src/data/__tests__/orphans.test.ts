import { describe, it, expect } from 'vitest';
import { computeOrphanIds, cardId } from '../cards';

const SUBJECT = 'subject_test';

describe('computeOrphanIds (deck regeneration FSRS reconcile)', () => {
  const dict = {
    'נושא א': [
      { term: 'מושג 1', definition: 'הגדרה 1' },
      { term: 'מושג 2', definition: 'הגדרה 2' },
    ],
    'נושא ב': [{ term: 'מושג 3', definition: 'הגדרה 3' }],
  };

  it('returns ids of stored cards whose terms left the dictionary', () => {
    const existing = [
      cardId(SUBJECT, 'מושג 1'),
      cardId(SUBJECT, 'מושג ישן'), // removed by regeneration
      cardId(SUBJECT, 'מושג 3'),
    ];
    expect(computeOrphanIds(dict, SUBJECT, existing)).toEqual([cardId(SUBJECT, 'מושג ישן')]);
  });

  it('keeps survivors regardless of which topic they now live in', () => {
    // Term moved from one topic to another during regeneration — still valid.
    const moved = { 'נושא חדש': [{ term: 'מושג 1', definition: 'הגדרה' }] };
    expect(computeOrphanIds(moved, SUBJECT, [cardId(SUBJECT, 'מושג 1')])).toEqual([]);
  });

  it('empty dictionary orphans everything; empty store orphans nothing', () => {
    const ids = [cardId(SUBJECT, 'א'), cardId(SUBJECT, 'ב')];
    expect(computeOrphanIds({}, SUBJECT, ids)).toEqual(ids);
    expect(computeOrphanIds(dict, SUBJECT, [])).toEqual([]);
  });

  it('ignores blank/malformed dictionary terms', () => {
    const messy = { t: [{ term: '  ', definition: 'x' }, { term: 'תקין', definition: 'y' }] };
    expect(computeOrphanIds(messy, SUBJECT, [cardId(SUBJECT, 'תקין')])).toEqual([]);
  });
});
