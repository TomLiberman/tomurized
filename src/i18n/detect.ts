import type { TheoryData } from '../lib/types';
import type { Lang } from './index';

/**
 * The browser's preferred UI language — the fallback when content gives no
 * signal. The FIRST supported language in the user's preference order wins
 * (['en-US', 'he'] → English); none supported → English.
 */
export function browserLang(
  prefs: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
): Lang {
  for (const l of prefs) {
    if (/^(he|iw)\b/i.test(l ?? '')) return 'he';
    if (/^en\b/i.test(l ?? '')) return 'en';
  }
  return 'en';
}

// Hebrew-letter share among *letters*. Hebrew academic text quotes many English
// names/terms, so the threshold is biased toward Hebrew. With too little text to
// judge, fall back to `fallback` (the browser language in the app).
export function detectLang(sample: string, fallback: Lang = 'he'): Lang {
  const hebrew = (sample.match(/[֐-׿]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (hebrew + latin < 40) return fallback;
  return hebrew / (hebrew + latin) >= 0.25 ? 'he' : 'en';
}

// Deck is the primary signal (sync, always loaded); cap the sample for perf.
export function buildDetectionSample(db: TheoryData, materials = ''): string {
  const deckText = Object.entries(db)
    .flatMap(([part, cards]) => [part, ...cards.map((c) => `${c.term} ${c.definition}`)])
    .join('\n')
    .slice(0, 20_000);
  return deckText + '\n' + materials.slice(0, 4_000);
}

const cacheKey = (subjectId: string) => `tomurized_lang_auto_${subjectId}`;

// Detect once, cache per course. Sync — safe to call from useMemo.
export function resolveAutoLang(subjectId: string, db: TheoryData, materials?: string): Lang {
  const cached = localStorage.getItem(cacheKey(subjectId)) as Lang | null;
  if (cached === 'he' || cached === 'en') return cached;
  const result = detectLang(buildDetectionSample(db, materials), browserLang());
  if (Object.keys(db).length > 0) localStorage.setItem(cacheKey(subjectId), result); // never cache an empty-deck guess
  return result;
}

export function cacheAutoLang(subjectId: string, lang: Lang) {
  localStorage.setItem(cacheKey(subjectId), lang);
}

export function invalidateAutoLang(subjectId: string) {
  localStorage.removeItem(cacheKey(subjectId));
}
