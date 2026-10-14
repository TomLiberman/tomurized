import type { TheoryData } from './types';

/**
 * Merge `incoming` cards into `base` card-by-card (pure; unit-tested).
 *
 * The old `{ ...base, ...incoming }` replaced a whole topic whenever the names
 * matched, silently deleting the cards that were already there. Now:
 * - a term that already exists ANYWHERE in the deck is updated in place (terms
 *   are unique per course — the FSRS card id is `subjectId::term`);
 * - a new term is appended to its incoming topic (created if needed);
 * - topic order is kept; new topics go at the end.
 */
export function mergeDecks(base: TheoryData, incoming: TheoryData): TheoryData {
  const out: TheoryData = {};
  const topicOfTerm = new Map<string, string>();
  for (const [topic, cards] of Object.entries(base)) {
    out[topic] = [...cards];
    for (const c of cards) topicOfTerm.set(c.term.trim(), topic);
  }
  for (const [topic, cards] of Object.entries(incoming)) {
    for (const card of cards) {
      const term = card.term.trim();
      if (!term) continue;
      const clean = { term, definition: card.definition };
      const home = topicOfTerm.get(term);
      if (home !== undefined) {
        out[home] = out[home].map((c) => (c.term.trim() === term ? clean : c));
      } else {
        (out[topic] ??= []).push(clean);
        topicOfTerm.set(term, topic);
      }
    }
  }
  return out;
}
