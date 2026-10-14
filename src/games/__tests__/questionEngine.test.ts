import { describe, it, expect } from 'vitest';
import {
  shuffleArray,
  pickDistractors,
  uniqueByTerm,
  buildLocalQuestions,
  mcqToGameQuestion,
  buildPairRound,
  buildMemoryBoard,
  truncateText,
  dedupeResults,
  minPoolFor,
} from '../questionEngine';
import type { DeckTerm } from '../types';
import type { GeneratedMCQ } from '../../services/gemini';

// Deterministic rng (mulberry32) so shuffles/choices are reproducible.
const seeded = (seed: number) => {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const mkTerm = (i: number, subject = 'נושא 1'): DeckTerm => ({
  term: `מושג ${i}`,
  definition: `הגדרה ארוכה ומפורטת של מושג ${i}`,
  subject,
});

const pool = (n: number, subject?: string) => Array.from({ length: n }, (_, i) => mkTerm(i, subject));

describe('shuffleArray', () => {
  it('permutes without mutating the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...input];
    const out = shuffleArray(input, seeded(1));
    expect(input).toEqual(copy);
    expect([...out].sort((a, b) => a - b)).toEqual(copy);
  });
});

describe('pickDistractors', () => {
  it('prefers same-subject candidates before falling back to the global pool', () => {
    const sameSubject = [mkTerm(1, 'A'), mkTerm(2, 'A'), mkTerm(3, 'A'), mkTerm(4, 'A')];
    const other = [mkTerm(10, 'B'), mkTerm(11, 'B')];
    const out = pickDistractors([...sameSubject, ...other], sameSubject[0], 'term', seeded(2));
    expect(out).toHaveLength(3);
    // Enough same-subject candidates exist, so no cross-subject term appears.
    expect(out.every(t => ['מושג 1', 'מושג 2', 'מושג 3', 'מושג 4'].includes(t))).toBe(true);
    expect(out).not.toContain('מושג 1'); // never the correct answer itself
  });

  it('never offers a second correct answer (a distractor sharing the shown text)', () => {
    const twin = { term: 'Twin term', definition: mkTerm(1, 'A').definition, subject: 'B' };
    const candidates = [mkTerm(1, 'A'), twin, mkTerm(2, 'A'), mkTerm(3, 'A'), mkTerm(4, 'A')];
    for (let seed = 1; seed <= 20; seed++) {
      // definition shown → options are terms: the twin (same definition) must not appear
      expect(pickDistractors(candidates, candidates[0], 'term', seeded(seed))).not.toContain('Twin term');
    }
  });

  it('falls back to the global pool when the subject is thin', () => {
    const thin = [mkTerm(1, 'A'), mkTerm(2, 'A')];
    const global = [mkTerm(10, 'B'), mkTerm(11, 'B'), mkTerm(12, 'B')];
    const out = pickDistractors([...thin, ...global], thin[0], 'term', seeded(3));
    expect(out).toHaveLength(3);
  });

  it('never duplicates option texts', () => {
    const dup = [
      { term: 'א', definition: 'זהה', subject: 'A' },
      { term: 'ב', definition: 'זהה', subject: 'A' },
      { term: 'ג', definition: 'אחרת', subject: 'A' },
      { term: 'ד', definition: 'רביעית', subject: 'A' },
    ];
    const out = pickDistractors(dup, dup[0], 'definition', seeded(4));
    expect(new Set(out).size).toBe(out.length);
    expect(out).not.toContain('זהה');
  });
});

describe('buildLocalQuestions', () => {
  it('prompt text matches the option type (the historical inversion bug)', () => {
    const qs = buildLocalQuestions(pool(10), 10, {}, seeded(5));
    for (const q of qs) {
      if (q.kind === 'definition-to-term') {
        // Shows the definition, options are TERMS.
        expect(q.prompt).toContain(q.definition);
        expect(q.options).toContain(q.term);
        expect(q.correctAnswer).toBe(q.term);
      } else {
        // Shows the term, options are DEFINITIONS.
        expect(q.prompt).toContain(q.term);
        expect(q.options).toContain(q.definition);
        expect(q.correctAnswer).toBe(q.definition);
      }
    }
  });

  it('includes the correct answer exactly once among 4 unique options', () => {
    const qs = buildLocalQuestions(pool(10), 5, {}, seeded(6));
    for (const q of qs) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options.filter(o => o === q.correctAnswer)).toHaveLength(1);
    }
  });

  it('never targets the same term twice, even when the pool has duplicates', () => {
    const withDup = [...pool(6), { ...mkTerm(0), subject: 'נושא 2' }];
    const qs = buildLocalQuestions(withDup, 7, {}, seeded(7));
    const targets = qs.map(q => q.term);
    expect(new Set(targets).size).toBe(targets.length);
    expect(qs.length).toBe(6); // only 6 unique terms available
  });

  it('works with a pool of exactly 4', () => {
    const qs = buildLocalQuestions(pool(4), 4, {}, seeded(8));
    expect(qs).toHaveLength(4);
    for (const q of qs) expect(q.options).toHaveLength(4);
  });

  it('uses distractorPool for options when the target pool is narrow', () => {
    const topicPool = pool(2, 'צר');
    const wide = pool(10, 'רחב');
    const qs = buildLocalQuestions(topicPool, 2, { distractorPool: [...topicPool, ...wide] }, seeded(9));
    for (const q of qs) expect(q.options).toHaveLength(4);
  });
});

describe('mcqToGameQuestion', () => {
  const mcq: GeneratedMCQ = {
    question: 'מי טבע את המושג הביטוס?',
    options: ['בורדייה', 'פוקו', 'וובר', 'מרקס'],
    correctIndex: 0,
    explanation: 'בורדייה פיתח את מושג ההביטוס.',
    testedTerm: 'הביטוס',
  };

  it('keeps testedTerm only when it matches the deck', () => {
    const deck = [{ term: 'הביטוס', definition: 'מערך נטיות', subject: 'א' }];
    const matched = mcqToGameQuestion(mcq, deck, seeded(10));
    expect(matched.term).toBe('הביטוס');
    expect(matched.definition).toBe('מערך נטיות');

    const unmatched = mcqToGameQuestion({ ...mcq, testedTerm: 'לא קיים' }, deck, seeded(10));
    expect(unmatched.term).toBe('');
  });

  it('re-shuffles options but keeps the correct answer', () => {
    const q = mcqToGameQuestion(mcq, [], seeded(11));
    expect(q.options).toHaveLength(4);
    expect(q.options).toContain('בורדייה');
    expect(q.correctAnswer).toBe('בורדייה');
    expect(q.kind).toBe('ai');
    expect(q.source).toBe('ai');
  });
});

describe('buildPairRound', () => {
  it('splits roughly 50/50 true/mismatch and marks sourceTerm correctly', () => {
    const round = buildPairRound(pool(20), 20, seeded(12));
    expect(round).toHaveLength(20);
    const trues = round.filter(p => p.isTruePair);
    expect(trues).toHaveLength(10);
    for (const p of round) {
      if (p.isTruePair) {
        expect(p.sourceTerm).toBe(p.term);
      } else {
        expect(p.sourceTerm).not.toBe(p.term);
        // The mismatched definition is never text-identical to the real one.
        const real = pool(20).find(t => t.term === p.term)!;
        expect(p.definition.trim()).not.toBe(real.definition.trim());
      }
    }
  });

  it('clamps to pool size and dedupes terms', () => {
    const withDup = [...pool(8), { ...mkTerm(3), subject: 'אחר' }];
    const round = buildPairRound(withDup, 20, seeded(13));
    expect(round).toHaveLength(8);
    expect(new Set(round.map(p => p.term)).size).toBe(8);
  });

  it('falls back to true pairs when every other definition is identical', () => {
    const degenerate: DeckTerm[] = Array.from({ length: 4 }, (_, i) => ({
      term: `מושג ${i}`,
      definition: 'אותה הגדרה בדיוק',
      subject: 'A',
    }));
    const round = buildPairRound(degenerate, 4, seeded(14));
    expect(round.every(p => p.isTruePair)).toBe(true);
  });
});

describe('buildMemoryBoard', () => {
  it('builds pairs*2 cards linked by pairId with matching faces', () => {
    const board = buildMemoryBoard(pool(10), 6, 90, seeded(15));
    expect(board).toHaveLength(12);
    const byPair = new Map<string, typeof board>();
    for (const c of board) {
      byPair.set(c.pairId, [...(byPair.get(c.pairId) ?? []), c]);
    }
    expect(byPair.size).toBe(6);
    for (const cards of byPair.values()) {
      expect(cards.map(c => c.face).sort()).toEqual(['definition', 'term']);
    }
  });

  it('truncates definition text but keeps fullText intact', () => {
    const long: DeckTerm[] = Array.from({ length: 6 }, (_, i) => ({
      term: `מושג ${i}`,
      definition: `הגדרה ${i} `.repeat(30),
      subject: 'A',
    }));
    const board = buildMemoryBoard(long, 6, 40, seeded(16));
    for (const c of board.filter(c => c.face === 'definition')) {
      expect(c.text.length).toBeLessThanOrEqual(41); // 40 + ellipsis
      expect(c.fullText.length).toBeGreaterThan(c.text.length);
    }
  });

  it('resolves identical definitions by pairId, not text', () => {
    const twins: DeckTerm[] = Array.from({ length: 6 }, (_, i) => ({
      term: `מושג ${i}`,
      definition: 'הגדרה זהה לחלוטין',
      subject: 'A',
    }));
    const board = buildMemoryBoard(twins, 6, 90, seeded(17));
    const pairIds = new Set(board.map(c => c.pairId));
    expect(pairIds.size).toBe(6);
  });

  it('clamps pairs to the number of unique terms', () => {
    const board = buildMemoryBoard(pool(4), 6, 90, seeded(18));
    expect(board).toHaveLength(8);
  });
});

describe('truncateText', () => {
  it('keeps short text untouched and cuts long text at a word boundary', () => {
    expect(truncateText('קצר', 10)).toBe('קצר');
    const out = truncateText('אחת שתיים שלוש ארבע חמש שש שבע', 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });
});

describe('dedupeResults', () => {
  it('is worst-wins and order-independent', () => {
    const a = dedupeResults([{ term: 'א', correct: true }, { term: 'א', correct: false }]);
    const b = dedupeResults([{ term: 'א', correct: false }, { term: 'א', correct: true }]);
    expect(a).toEqual([{ term: 'א', correct: false }]);
    expect(b).toEqual([{ term: 'א', correct: false }]);
  });

  it('drops empty terms (unmatched AI questions)', () => {
    expect(dedupeResults([{ term: '', correct: true }])).toEqual([]);
  });
});

describe('uniqueByTerm / minPoolFor', () => {
  it('dedupes by trimmed term', () => {
    const out = uniqueByTerm([mkTerm(1), { ...mkTerm(1), subject: 'ב' }, mkTerm(2)]);
    expect(out).toHaveLength(2);
  });

  it('returns the documented minimums', () => {
    expect(minPoolFor('boss')).toBe(4);
    expect(minPoolFor('millionaire')).toBe(4);
    expect(minPoolFor('memory')).toBe(6);
    expect(minPoolFor('swipe')).toBe(8);
  });
});
