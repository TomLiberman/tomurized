import { describe, it, expect } from 'vitest';
import { splitHighlight } from '../highlight';

describe('splitHighlight', () => {
  it('marks case-insensitive matches', () => {
    expect(splitHighlight('C. Wright Mills and mills', 'mills')).toEqual([
      { text: 'C. Wright ', match: false },
      { text: 'Mills', match: true },
      { text: ' and ', match: false },
      { text: 'mills', match: true },
    ]);
  });

  it('treats regex metacharacters as plain text instead of throwing', () => {
    for (const q of ['(', '[', '*', '+?', '\\', 'a|b', '(C.']) {
      expect(() => splitHighlight('מושג (C. Wright Mills) [1] a|b *', q)).not.toThrow();
    }
    expect(splitHighlight('מושג (C. Wright Mills)', '(C.').filter((p) => p.match).map((p) => p.text)).toEqual(['(C.']);
  });

  it('returns the whole text unmarked for an empty query or no match', () => {
    expect(splitHighlight('abc', '')).toEqual([{ text: 'abc', match: false }]);
    expect(splitHighlight('abc', 'z')).toEqual([{ text: 'abc', match: false }]);
  });
});
