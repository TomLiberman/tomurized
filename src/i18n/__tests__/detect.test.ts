import { describe, it, expect } from 'vitest';
import { detectLang, buildDetectionSample, browserLang } from '../detect';

describe('detectLang', () => {
  it('detects a Hebrew academic text (with quoted English terms) as he', () => {
    expect(detectLang('ההביטוס (Habitus) של פייר בורדייה הוא מערך נטיות מופנם המכוון את הפעולה החברתית של הפרט בשדות שונים')).toBe('he');
  });

  it('detects an English text as en', () => {
    expect(detectLang('Natural selection is the process in which heritable traits that improve survival become more common over generations')).toBe('en');
  });

  it('mixed text leans Hebrew at >=25% Hebrew letters', () => {
    // ~40% Hebrew letters: Hebrew sentence quoting an English term
    const mixed = 'הון סימבולי הוא הצורה שההון מקבל כאשר הוא נתפס כלגיטימי (symbolic capital, per Bourdieu)';
    expect(detectLang(mixed)).toBe('he');
    // mostly-English text stays en even with a few Hebrew words
    const mostlyEn = 'מושג: symbolic capital is the form that capital takes when it is perceived as legitimate by social agents';
    expect(detectLang(mostlyEn)).toBe('en');
  });

  it('too little signal falls back to the given language (he by default)', () => {
    expect(detectLang('abc')).toBe('he');
    expect(detectLang('')).toBe('he');
    expect(detectLang('', 'en')).toBe('en');
  });
});

describe('browserLang', () => {
  it('takes the first supported language in preference order', () => {
    expect(browserLang(['en-US', 'he'])).toBe('en');
    expect(browserLang(['he-IL', 'en-US'])).toBe('he');
    expect(browserLang(['fr-FR', 'he', 'en'])).toBe('he');
    expect(browserLang(['iw'])).toBe('he'); // legacy Hebrew code
  });

  it('defaults to English when no supported language is listed', () => {
    expect(browserLang(['fr-FR', 'de'])).toBe('en');
    expect(browserLang([])).toBe('en');
  });
});

describe('buildDetectionSample', () => {
  it('flattens topics + cards and appends materials', () => {
    const db = { 'Topic A': [{ term: 'Term', definition: 'Definition text' }] };
    const s = buildDetectionSample(db, 'extra materials');
    expect(s).toContain('Topic A');
    expect(s).toContain('Term Definition text');
    expect(s).toContain('extra materials');
  });

  it('caps the deck sample size', () => {
    const big = { T: [{ term: 'x'.repeat(50_000), definition: 'y' }] };
    expect(buildDetectionSample(big).length).toBeLessThan(25_000);
  });
});
