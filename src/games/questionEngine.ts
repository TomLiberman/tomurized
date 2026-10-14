// Pure question/pair/board builders for the study games (no React, no storage).
// The MCQ algorithm mirrors the quick exam in usePortalState — same Fisher-Yates
// shuffle and same-subject-first distractor picking — parameterized by pool so
// games (and the exam, via thin delegates) share one implementation.

import type { DeckTerm, GameQuestion, GameResult, GameId, SwipePair, MemoryCard } from './types';
import type { GeneratedMCQ } from '../services/gemini';
import { t } from '../i18n';

export type Rng = () => number;

// Unbiased Fisher-Yates shuffle (the `sort(() => 0.5 - Math.random())` idiom is
// biased and was also mutating state arrays in place).
export function shuffleArray<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick 3 distractors for a question: prefer cards from the SAME subject (cross-
// subject options are usually giveaway-wrong), fall back to the global pool,
// and never duplicate each other or the correct answer's text.
export function pickDistractors(
  pool: DeckTerm[],
  correct: DeckTerm,
  field: 'term' | 'definition',
  rng: Rng = Math.random
): string[] {
  const seen = new Set<string>([correct[field].trim()]);
  const out: string[] = [];
  // The prompt shows the OTHER field: a distractor that shares it (two terms with
  // the same definition, or vice versa) would be a second correct answer.
  const shown = field === 'term' ? 'definition' : 'term';
  const prompt = correct[shown].trim();
  const take = (cands: DeckTerm[]) => {
    for (const c of shuffleArray(cands, rng)) {
      const text = c[field].trim();
      if (out.length >= 3) break;
      if (!text || seen.has(text) || c[shown].trim() === prompt) continue;
      seen.add(text);
      out.push(text);
    }
  };
  take(pool.filter(t => t.subject === correct.subject));
  if (out.length < 3) take(pool);
  return out;
}

/** Dedupe a pool by term name (same term under two topics = one FSRS card). */
export function uniqueByTerm(pool: DeckTerm[]): DeckTerm[] {
  const seen = new Set<string>();
  return pool.filter(t => {
    const key = t.term.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let questionCounter = 0;
const nextQuestionId = () => `gq-${++questionCounter}`;

// Build `count` local MCQs from the pool. Direction is random per question, and
// the prompt text always matches the option type (definition-to-term prompts ask
// for the term over TERM options; term-to-definition over DEFINITION options —
// this pairing was once inverted in the exam, keep it pinned by tests).
export function buildLocalQuestions(
  pool: DeckTerm[],
  count: number,
  opts: { distractorPool?: DeckTerm[] } = {},
  rng: Rng = Math.random
): GameQuestion[] {
  const distractorPool = opts.distractorPool?.length ? opts.distractorPool : pool;
  const targets = shuffleArray(uniqueByTerm(pool), rng).slice(0, count);

  return targets.map(q => {
    const isDefToTerm = rng() > 0.5;
    const field = isDefToTerm ? 'term' : 'definition';
    const correctText = q[field].trim();
    const options = shuffleArray([correctText, ...pickDistractors(distractorPool, q, field, rng)], rng);
    return {
      id: nextQuestionId(),
      term: q.term,
      definition: q.definition,
      prompt: isDefToTerm
        ? t('game_q_def_to_term', { def: q.definition.trim() })
        : t('game_q_term_to_def', { term: q.term.trim() }),
      options,
      correctAnswer: correctText,
      kind: isDefToTerm ? 'definition-to-term' : 'term-to-definition',
      source: 'local',
    } as GameQuestion;
  });
}

// Map a Gemini exam-style MCQ to a game question (same guard as startAiExam:
// testedTerm counts for FSRS only when it matches a deck term exactly).
export function mcqToGameQuestion(
  mcq: GeneratedMCQ,
  pool: DeckTerm[],
  rng: Rng = Math.random
): GameQuestion {
  const correctText = mcq.options[mcq.correctIndex].trim();
  const matched = pool.find(t => t.term === mcq.testedTerm);
  return {
    id: nextQuestionId(),
    term: matched ? mcq.testedTerm : '',
    definition: matched?.definition || '',
    prompt: mcq.question.trim(),
    options: shuffleArray(mcq.options.map(o => o.trim()), rng),
    correctAnswer: correctText,
    kind: 'ai',
    explanation: mcq.explanation?.trim() || '',
    source: 'ai',
  };
}

// Build a swipe round: ~half true pairs, ~half mismatches whose definition is
// borrowed from another term (same subject preferred) and never text-identical
// to the real definition.
export function buildPairRound(
  pool: DeckTerm[],
  count: number,
  rng: Rng = Math.random
): SwipePair[] {
  const unique = uniqueByTerm(pool);
  const targets = shuffleArray(unique, rng).slice(0, Math.min(count, unique.length));
  const trueCount = Math.ceil(targets.length / 2);

  const pairs = targets.map((t, i): SwipePair => {
    const wantTrue = i < trueCount;
    if (wantTrue) {
      return { id: `sp-${i}`, term: t.term, definition: t.definition, isTruePair: true, sourceTerm: t.term };
    }
    const differs = (c: DeckTerm) =>
      c.term !== t.term && c.definition.trim() !== t.definition.trim() && !!c.definition.trim();
    const sameSubject = unique.filter(c => c.subject === t.subject && differs(c));
    const candidates = sameSubject.length ? sameSubject : unique.filter(differs);
    if (!candidates.length) {
      // Degenerate pool (all definitions identical) — fall back to a true pair.
      return { id: `sp-${i}`, term: t.term, definition: t.definition, isTruePair: true, sourceTerm: t.term };
    }
    const source = candidates[Math.floor(rng() * candidates.length)];
    return { id: `sp-${i}`, term: t.term, definition: source.definition, isTruePair: false, sourceTerm: source.term };
  });

  return shuffleArray(pairs, rng);
}

/** Truncate display text at a word boundary, keeping an ellipsis. */
export function truncateText(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

// Build a memory board of `pairs` term↔definition pairs (2 cards each), shuffled.
// Prefers terms with SHORT definitions so cards stay readable; keeps fullText.
export function buildMemoryBoard(
  pool: DeckTerm[],
  pairs: number,
  truncateAt: number,
  rng: Rng = Math.random
): MemoryCard[] {
  // Shuffle first so equal-length ties don't always pick the same terms, then
  // keep the shortest-definition half as candidates and draw the pairs from it.
  const unique = shuffleArray(uniqueByTerm(pool), rng)
    .sort((a, b) => a.definition.length - b.definition.length);
  const candidates = unique.slice(0, pairs * 2);
  const chosen = shuffleArray(candidates, rng).slice(0, Math.min(pairs, unique.length));

  const cards = chosen.flatMap((t, i): MemoryCard[] => [
    { id: `mc-${i}-t`, pairId: `mp-${i}`, face: 'term', text: t.term.trim(), fullText: t.term.trim() },
    {
      id: `mc-${i}-d`,
      pairId: `mp-${i}`,
      face: 'definition',
      text: truncateText(t.definition, truncateAt),
      fullText: t.definition.trim(),
    },
  ]);
  return shuffleArray(cards, rng);
}

/** Worst-wins dedupe per term: one wrong occurrence marks the term wrong. */
export function dedupeResults(results: GameResult[]): GameResult[] {
  const byTerm = new Map<string, boolean>();
  for (const r of results) {
    if (!r.term) continue;
    byTerm.set(r.term, (byTerm.get(r.term) ?? true) && r.correct);
  }
  return [...byTerm.entries()].map(([term, correct]) => ({ term, correct }));
}

/** Minimum unique terms a course needs before a game is playable. */
export function minPoolFor(game: GameId): number {
  switch (game) {
    case 'boss': return 4;
    case 'millionaire': return 4;
    case 'memory': return 6;
    case 'swipe': return 8;
  }
}
