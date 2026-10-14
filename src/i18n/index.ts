import { he, en, type StringKey } from './strings';

export type Lang = 'he' | 'en'; // resolved — what UI/AI actually use
export type LangSetting = Lang | 'auto'; // what the user picks per course

export const langDir = (l: Lang): 'rtl' | 'ltr' => (l === 'he' ? 'rtl' : 'ltr');
export const langName = (l: Lang) => (l === 'he' ? 'Hebrew' : 'English'); // for AI prompts

// Module-level current language, set synchronously by usePortalState BEFORE the
// tree renders. This lets plain .ts modules (gemini errors, game logic, the
// alert() strings in usePortalState) call t() without threading a translator
// through every signature. Re-render correctness holds because the state that
// drives this lives in usePortalState and the whole tree re-renders through
// usePortal().
let current: Lang = 'he';
export function setCurrentLang(l: Lang) {
  current = l;
}
export function getCurrentLang(): Lang {
  return current;
}

const tables: Record<Lang, Record<StringKey, string>> = { he, en };

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = tables[current][key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export type { StringKey };
