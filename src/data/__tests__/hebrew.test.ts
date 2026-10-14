import { describe, it, expect } from 'vitest';
import { normalizeHebrew, matchAnswer } from '../hebrew';

describe('normalizeHebrew', () => {
  it('strips niqqud/cantillation', () => {
    expect(normalizeHebrew('שָׁלוֹם')).toBe(normalizeHebrew('שלום'));
  });
  it('folds final letters (ם ≡ מ)', () => {
    expect(normalizeHebrew('אדם')).toBe(normalizeHebrew('אדמ'));
    expect(normalizeHebrew('דין')).toBe(normalizeHebrew('דינ'));
  });
  it('drops gershayim / quotes', () => {
    expect(normalizeHebrew('ר״ה')).toBe(normalizeHebrew('רה'));
    expect(normalizeHebrew("צ׳ק")).toBe(normalizeHebrew('צק'));
  });
  it('collapses whitespace and lowercases Latin', () => {
    expect(normalizeHebrew('  HABITUS   ')).toBe('habitus');
  });
});

describe('matchAnswer', () => {
  it('exact after normalization', () => {
    expect(matchAnswer('הביטוס', 'הביטוס').exact).toBe(true);
    expect(matchAnswer('שָׁלוֹם', 'שלום').exact).toBe(true);
  });
  it('close within tolerance (single typo)', () => {
    expect(matchAnswer('הביטוסי', 'הביטוס').close).toBe(true);
  });
  it('miss on an unrelated term', () => {
    const m = matchAnswer('סטרוקטורליזם', 'הביטוס');
    expect(m.exact).toBe(false);
    expect(m.close).toBe(false);
  });
  it('empty answer is never a match', () => {
    expect(matchAnswer('', 'הביטוס').close).toBe(false);
  });
});
