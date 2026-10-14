import type { CardRecord, ReviewLogRecord } from './records';
import { newCard, applyGrade, retrievability, Rating, type FSRSCard, type Grade } from './fsrs';
import { apiGet, apiPost } from '../api/client';

// ---------------------------------------------------------------------------
// Card service — server-backed.
//
// All FSRS math (ts-fsrs) runs on the client; the server stores card rows and
// the append-only review log verbatim:
//   GET  /api/subjects/:id/cards | /api/cards          card rows
//   POST /api/subjects/:id/cards/sync                  ensure/orphan reconcile
//   POST /api/reviews | /api/reviews/batch             grade: fsrs + log, atomic
//   GET  /api/subjects/:id/reviews | /api/reviews      review history
//
// The pure aggregation cores (computeTopicStats, computeOrphanIds) are
// unit-tested and storage-agnostic.
// ---------------------------------------------------------------------------

type Dictionary = Record<string, { term: string; definition: string }[]>;
interface SubjectEntry { id: string; name: string }

// --- Server fetch helpers ----------------------------------------------------

async function fetchCards(subjectId?: string): Promise<CardRecord[]> {
  return subjectId
    ? apiGet<CardRecord[]>(`/subjects/${subjectId}/cards`)
    : apiGet<CardRecord[]>('/cards');
}

async function fetchLogs(subjectId?: string): Promise<ReviewLogRecord[]> {
  return subjectId
    ? apiGet<ReviewLogRecord[]>(`/subjects/${subjectId}/reviews`)
    : apiGet<ReviewLogRecord[]>('/reviews');
}

async function fetchDeck(subjectId: string): Promise<Dictionary> {
  const deck = await apiGet<Dictionary | null>(`/subjects/${subjectId}/deck`);
  return deck && typeof deck === 'object' ? deck : {};
}

async function fetchSubjects(): Promise<SubjectEntry[]> {
  return apiGet<SubjectEntry[]>('/subjects');
}

// Stable card id — term-scoped within a subject, mirroring the legacy per-term
// Leitner mastery map.
export function cardId(subjectId: string, term: string): string {
  return `${subjectId}::${term}`;
}

function fsrsOf(card: CardRecord): FSRSCard {
  return card.fsrs as FSRSCard;
}

// Add cards for any dictionary term in this subject that isn't in the store yet
// (e.g. newly built decks). New terms start as brand-new FSRS cards (due now).
// Pass `dict` when the caller just changed the deck — its debounced server save
// may not have landed yet, so a server fetch here would see the OLD deck.
export async function ensureCardsForSubject(subjectId: string, dict?: Dictionary): Promise<number> {
  const [deck, cards] = await Promise.all([
    dict ? Promise.resolve(dict) : fetchDeck(subjectId),
    fetchCards(subjectId),
  ]);
  const existing = new Set(cards.map((c) => c.id));
  const now = new Date();
  const toAdd: CardRecord[] = [];
  for (const [topicId, terms] of Object.entries(deck)) {
    for (const t of terms) {
      if (!t || typeof t.term !== 'string' || !t.term.trim()) continue;
      const id = cardId(subjectId, t.term);
      if (existing.has(id)) continue;
      toAdd.push({
        id,
        subjectId,
        topicId,
        term: t.term,
        definition: t.definition ?? '',
        fsrs: newCard(now),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
  }
  if (toAdd.length) {
    await apiPost(`/subjects/${subjectId}/cards/sync`, { upserts: toAdd, deleteIds: [] });
  }
  return toAdd.length;
}

// Pure diff used by removeOrphanCards (kept separate so it's unit-testable
// without storage): which stored card ids are no longer in the dictionary?
export function computeOrphanIds(dict: Dictionary, subjectId: string, existingIds: string[]): string[] {
  const valid = new Set<string>();
  for (const terms of Object.values(dict)) {
    for (const t of terms) {
      if (t && typeof t.term === 'string' && t.term.trim()) valid.add(cardId(subjectId, t.term));
    }
  }
  return existingIds.filter(id => !valid.has(id));
}

// Delete FSRS cards whose term no longer exists in the subject's dictionary
// (e.g. after a deck/topic regeneration). Review-log history rows are kept;
// cards for surviving terms keep their FSRS state untouched. Pass `dict` when
// the deck was just changed (see ensureCardsForSubject).
export async function removeOrphanCards(subjectId: string, dict?: Dictionary): Promise<number> {
  const [deck, cards] = await Promise.all([
    dict ? Promise.resolve(dict) : fetchDeck(subjectId),
    fetchCards(subjectId),
  ]);
  const orphans = computeOrphanIds(deck, subjectId, cards.map((c) => c.id));
  if (orphans.length) {
    await apiPost(`/subjects/${subjectId}/cards/sync`, { upserts: [], deleteIds: orphans });
  }
  return orphans.length;
}

// Full deck⇄cards reconcile after a MANUAL deck edit: add cards for new terms,
// carry definition/topic changes onto existing cards WITHOUT touching their
// FSRS scheduling, and drop cards whose terms are gone (review logs kept).
// One /cards/sync POST. `dict` is passed by the caller (its debounced deck
// save may not have reached the server yet).
export async function reconcileDeckCards(
  subjectId: string,
  dict: Dictionary
): Promise<{ added: number; updated: number; removed: number }> {
  const cards = await fetchCards(subjectId);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const now = new Date();
  const upserts: CardRecord[] = [];
  const valid = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const [topicId, terms] of Object.entries(dict)) {
    for (const t of terms) {
      if (!t || typeof t.term !== 'string' || !t.term.trim()) continue;
      const id = cardId(subjectId, t.term);
      valid.add(id);
      const definition = t.definition ?? '';
      const existing = byId.get(id);
      if (!existing) {
        upserts.push({
          id, subjectId, topicId, term: t.term, definition,
          fsrs: newCard(now), createdAt: now.toISOString(), updatedAt: now.toISOString(),
        });
        added++;
      } else if (existing.definition !== definition || existing.topicId !== topicId) {
        upserts.push({ ...existing, definition, topicId, updatedAt: now.toISOString() });
        updated++;
      }
    }
  }
  const deleteIds = cards.filter((c) => !valid.has(c.id)).map((c) => c.id);
  if (upserts.length || deleteIds.length) {
    await apiPost(`/subjects/${subjectId}/cards/sync`, { upserts, deleteIds });
  }
  return { added, updated, removed: deleteIds.length };
}

// Ensure cards exist for EVERY subject (used by cross-course Mixed Review).
export async function ensureAllCards(): Promise<void> {
  for (const sub of await fetchSubjects()) {
    await ensureCardsForSubject(sub.id);
  }
}

export interface DueFilter {
  subjectId?: string;
  topicId?: string;
}

// The due-today queue: cards whose FSRS due time has passed, soonest first.
export async function getDueCards(filter: DueFilter = {}): Promise<CardRecord[]> {
  let rows = await fetchCards(filter.subjectId);
  if (filter.topicId) rows = rows.filter((c) => c.topicId === filter.topicId);
  const now = Date.now();
  return rows
    .filter((c) => new Date(fsrsOf(c).due).getTime() <= now)
    .sort((a, b) => new Date(fsrsOf(a).due).getTime() - new Date(fsrsOf(b).due).getTime());
}

export async function countDue(filter: DueFilter = {}): Promise<number> {
  return (await getDueCards(filter)).length;
}

export interface GradeContext {
  predictedConfidence?: number; // 1..5, captured before reveal
  typedAnswer?: string;
  aiScore?: number;
  correct?: boolean;
}

// Apply a grade: advance FSRS state locally, then persist card + review log
// atomically on the server (one POST, one transaction).
export async function gradeCard(card: CardRecord, rating: Grade, ctx: GradeContext = {}): Promise<CardRecord> {
  const now = new Date();
  const prev = fsrsOf(card);
  const nextFsrs = applyGrade(prev, rating, now);
  const updated: CardRecord = { ...card, fsrs: nextFsrs, updatedAt: now.toISOString() };
  await apiPost('/reviews', {
    cardId: card.id,
    subjectId: card.subjectId,
    topicId: card.topicId,
    grade: rating,
    predictedConfidence: ctx.predictedConfidence,
    typedAnswer: ctx.typedAnswer,
    aiScore: ctx.aiScore,
    correct: ctx.correct,
    reviewedAt: now.toISOString(),
    elapsedDays: prev.elapsed_days,
    fsrs: nextFsrs,
  });
  return updated;
}

// Feed exam results back into the FSRS schedule (the testing effect): a correct
// answer grades the card Good, a wrong answer grades it Again so it resurfaces
// soon. One batch POST for the whole exam/game run.
export async function gradeExamResults(
  subjectId: string,
  results: { term: string; correct: boolean }[]
): Promise<number> {
  if (!results.length) return 0;
  const cards = await fetchCards(subjectId);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const now = new Date();
  const reviews = [];
  for (const r of results) {
    const card = byId.get(cardId(subjectId, r.term));
    if (!card) continue; // term not in the deck (e.g. unmatched AI question)
    const prev = fsrsOf(card);
    const rating = (r.correct ? Rating.Good : Rating.Again) as Grade;
    reviews.push({
      cardId: card.id,
      subjectId: card.subjectId,
      topicId: card.topicId,
      grade: rating,
      correct: r.correct,
      reviewedAt: now.toISOString(),
      elapsedDays: prev.elapsed_days,
      fsrs: applyGrade(prev, rating, now),
    });
  }
  if (reviews.length) await apiPost('/reviews/batch', { reviews });
  return reviews.length;
}

export interface SubjectReviewStats {
  total: number;
  due: number;
  newCount: number;
  learning: number;
  review: number;
  mastered: number; // state Review with stability >= 30d, a rough "long-term" proxy
}

// Lightweight stats for the dashboard tile (repoints the old Leitner tile).
// --- Per-topic strength/weakness -------------------------------------------

export interface TopicStat {
  topicId: string;
  total: number;             // cards in the topic
  due: number;               // cards due now
  attempts: number;          // graded answers seen (reviews + exam answers)
  accuracy: number | null;   // share answered correctly; null before any attempt
  avgRetrievability: number; // 0..1 — mean FSRS recall probability right now
  strength: number;          // 0..100 blended score (higher = stronger)
}

// Pure aggregation (exported for unit tests): group cards + review logs by
// topic and blend answer accuracy with current FSRS retrievability. Logs
// prefer their own topicId; older rows without one fall back to the card's
// current topic.
export function computeTopicStats(
  cards: Pick<CardRecord, 'id' | 'topicId' | 'fsrs'>[],
  logs: { cardId: string; topicId?: string; grade: number; correct?: boolean }[],
  now: Date = new Date()
): TopicStat[] {
  const topicOfCard = new Map(cards.map(c => [c.id, c.topicId]));
  const acc = new Map<string, { total: number; due: number; rSum: number; attempts: number; correct: number }>();
  const bucket = (t: string) => {
    let b = acc.get(t);
    if (!b) { b = { total: 0, due: 0, rSum: 0, attempts: 0, correct: 0 }; acc.set(t, b); }
    return b;
  };
  for (const c of cards) {
    const b = bucket(c.topicId);
    b.total++;
    const f = c.fsrs as FSRSCard;
    if (new Date(f.due).getTime() <= now.getTime()) b.due++;
    b.rSum += retrievability(f, now);
  }
  for (const l of logs) {
    const topic = l.topicId || topicOfCard.get(l.cardId);
    if (!topic || !acc.has(topic)) continue; // topic no longer exists
    const b = bucket(topic);
    b.attempts++;
    // `correct` is set by typed-answer/exam grading; otherwise Good/Easy counts.
    if (l.correct !== undefined ? l.correct : l.grade >= 3) b.correct++;
  }
  const stats: TopicStat[] = [];
  for (const [topicId, b] of acc) {
    const avgR = b.total ? b.rSum / b.total : 0;
    const accuracy = b.attempts ? b.correct / b.attempts : null;
    // Untouched topics score by retrievability alone (new cards ≈ weak);
    // once answers exist, accuracy dominates.
    const strength = Math.round(100 * (accuracy === null ? avgR : 0.55 * accuracy + 0.45 * avgR));
    stats.push({ topicId, total: b.total, due: b.due, attempts: b.attempts, accuracy, avgRetrievability: avgR, strength });
  }
  return stats.sort((a, b) => a.strength - b.strength); // weakest first
}

export async function topicStats(subjectId: string): Promise<TopicStat[]> {
  const [cards, logs] = await Promise.all([fetchCards(subjectId), fetchLogs(subjectId)]);
  return computeTopicStats(cards, logs);
}

export async function subjectStats(subjectId?: string): Promise<SubjectReviewStats> {
  const rows = await fetchCards(subjectId);
  const now = Date.now();
  let due = 0, newCount = 0, learning = 0, review = 0, mastered = 0;
  for (const c of rows) {
    const f = fsrsOf(c);
    if (new Date(f.due).getTime() <= now) due++;
    const state = f.state as unknown as number;
    if (state === 0) newCount++;
    else if (state === 1 || state === 3) learning++;
    else {
      review++;
      if (f.stability >= 30) mastered++;
    }
  }
  return { total: rows.length, due, newCount, learning, review, mastered };
}

// --- Calibration: did the student's pre-reveal confidence match reality? ---
export interface CalibrationBucket { confidence: number; total: number; known: number; accuracy: number }
export interface OverconfidentCard { cardId: string; term: string; confidence: number }
export interface Calibration {
  buckets: CalibrationBucket[];
  overconfident: OverconfidentCard[];
  totalRated: number;
  gap: number; // avg(confidence/5) − avg(accuracy); positive = overconfident overall
}

// A review counts as "known" if it was graded Good/Easy (>=3) or a Recall match.
function wasKnown(grade: number, correct?: boolean): boolean {
  return correct !== undefined ? correct : grade >= 3;
}

export async function getCalibration(subjectId?: string): Promise<Calibration> {
  const [allLogs, cards] = await Promise.all([fetchLogs(subjectId), fetchCards(subjectId)]);
  const rows = allLogs.filter((l) => typeof l.predictedConfidence === 'number');

  const buckets: CalibrationBucket[] = [1, 2, 3, 4, 5].map((c) => ({ confidence: c, total: 0, known: 0, accuracy: 0 }));
  const overMap = new Map<string, number>(); // cardId -> latest overconfident confidence
  let sumConf = 0;
  let sumKnown = 0;

  for (const l of rows) {
    const c = l.predictedConfidence!;
    const known = wasKnown(l.grade, l.correct);
    const b = buckets[c - 1];
    if (!b) continue;
    b.total++;
    if (known) b.known++;
    sumConf += c / 5;
    sumKnown += known ? 1 : 0;
    // High confidence but failed → flag; a later "known" attempt clears it.
    if (c >= 4 && !known) overMap.set(l.cardId, c);
    else if (known) overMap.delete(l.cardId);
  }
  buckets.forEach((b) => (b.accuracy = b.total ? b.known / b.total : 0));

  const termOfCard = new Map(cards.map((c) => [c.id, c.term]));
  const overconfident: OverconfidentCard[] = [...overMap.keys()].map((id) => ({
    cardId: id,
    term: termOfCard.get(id) ?? id.split('::')[1] ?? id,
    confidence: overMap.get(id)!,
  }));

  const total = rows.length;
  return { buckets, overconfident, totalRated: total, gap: total ? (sumConf - sumKnown) / total : 0 };
}

// --- Exam readiness: predicted recall probability AT the exam date (FSRS) ---
export interface ExamReadiness {
  readiness: number; // 0..100, average predicted retrievability on exam day
  daysToExam: number;
  total: number;
  reviewedShare: number; // fraction of cards seen at least once
  weakCards: { term: string; topicId: string; r: number }[]; // predicted to be shaky on the day
}

export async function examReadiness(subjectId: string, examDateISO: string): Promise<ExamReadiness> {
  const rows = await fetchCards(subjectId);
  const examDate = new Date(`${examDateISO}T09:00:00`);
  const daysToExam = Math.max(0, Math.ceil((examDate.getTime() - Date.now()) / 86400000));
  if (!rows.length) return { readiness: 0, daysToExam, total: 0, reviewedShare: 0, weakCards: [] };

  let sum = 0;
  let reviewed = 0;
  const weak: { term: string; topicId: string; r: number }[] = [];
  for (const c of rows) {
    const f = c.fsrs as FSRSCard;
    if (f.reps > 0) reviewed++;
    const r = f.reps > 0 ? retrievability(f, examDate) : 0; // unseen cards read as 0 (not yet learned)
    sum += r;
    if (r < 0.7) weak.push({ term: c.term, topicId: c.topicId, r });
  }
  weak.sort((a, b) => a.r - b.r);
  return {
    readiness: Math.round((sum / rows.length) * 100),
    daysToExam,
    total: rows.length,
    reviewedShare: reviewed / rows.length,
    weakCards: weak.slice(0, 24),
  };
}
