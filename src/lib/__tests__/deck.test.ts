import { describe, it, expect } from 'vitest';
import { mergeDecks } from '../deck';

const base = {
  Cells: [{ term: 'Ribosome', definition: 'makes proteins' }],
  Ecology: [{ term: 'Ecosystem', definition: 'community + environment' }],
};

describe('mergeDecks', () => {
  it('appends to an existing topic instead of replacing it', () => {
    const merged = mergeDecks(base, { Ecology: [{ term: 'Biome', definition: 'large region' }] });
    expect(merged.Ecology.map((c) => c.term)).toEqual(['Ecosystem', 'Biome']);
    expect(merged.Cells).toEqual(base.Cells);
  });

  it('updates an existing term in place — even when it arrives under another topic', () => {
    const merged = mergeDecks(base, { Misc: [{ term: 'Ribosome ', definition: 'assembles proteins' }] });
    expect(merged.Cells).toEqual([{ term: 'Ribosome', definition: 'assembles proteins' }]);
    expect(merged.Misc).toBeUndefined(); // no duplicate term, no empty topic
  });

  it('adds new topics at the end, keeps topic order, skips blank terms and dedupes within the import', () => {
    const merged = mergeDecks(base, {
      Genetics: [
        { term: 'Allele', definition: 'gene version' },
        { term: '  ', definition: 'blank' },
        { term: 'Allele', definition: 'gene version (v2)' },
      ],
    });
    expect(Object.keys(merged)).toEqual(['Cells', 'Ecology', 'Genetics']);
    expect(merged.Genetics).toEqual([{ term: 'Allele', definition: 'gene version (v2)' }]);
  });

  it('does not mutate its inputs', () => {
    const snapshot = JSON.stringify(base);
    mergeDecks(base, { Cells: [{ term: 'Nucleus', definition: 'holds DNA' }] });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
