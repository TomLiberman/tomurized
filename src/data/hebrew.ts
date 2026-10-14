// Lenient Hebrew (and mixed Hebrew/Latin) text comparison for the type-the-answer
// Recall mode. Grades locally by default so a review session never depends on an
// AI call. Strips niqqud/cantillation, folds final letters (ך→כ etc.), drops
// gershayim/punctuation, and allows a small edit-distance fuzz.

const NIQQUD = /[֑-ׇ]/g; // Hebrew points + cantillation marks
const BIDI = /[‎‏‪-‮]/g;
const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

export function normalizeHebrew(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFKC').replace(NIQQUD, '').replace(BIDI, '');
  s = s.replace(/["'׳״`’‘“”]/g, ''); // gershayim, quotes, apostrophes
  s = s.replace(/[.,;:!?()[\]{}\-–—/\\|]/g, ' '); // punctuation → space
  s = s.replace(/[־]/g, ' '); // maqaf (Hebrew hyphen)
  s = Array.from(s).map((ch) => FINALS[ch] ?? ch).join('');
  s = s.toLowerCase().replace(/\s+/g, ' ').trim();
  return s;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Result of grading a typed answer against the reference definition/term.
export interface RecallMatch {
  exact: boolean;
  close: boolean; // within edit-distance tolerance
  distance: number;
  similarity: number; // 0..1
}

export function matchAnswer(userAnswer: string, reference: string): RecallMatch {
  const a = normalizeHebrew(userAnswer);
  const b = normalizeHebrew(reference);
  if (!a || !b) return { exact: false, close: false, distance: Math.max(a.length, b.length), similarity: 0 };
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen;
  const tolerance = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.15));
  return { exact: a === b, close: distance <= tolerance, distance, similarity };
}
