// FSRS cards + review logs. All FSRS math happens on the CLIENT (ts-fsrs);
// the server stores card rows and the append-only review log verbatim.

import { Hono } from 'hono';
import { db, nowIso, tx } from '../db.ts';

export const cardsRouter = new Hono();

// Client-facing shapes match src/data/db.ts (CardRecord / ReviewLogRecord).
interface CardIn {
  id: string;
  subjectId: string;
  topicId?: string;
  term: string;
  definition?: string;
  cloze?: string | null;
  fsrs?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

interface ReviewIn {
  cardId: string;
  subjectId: string;
  topicId?: string;
  grade: number;
  predictedConfidence?: number;
  typedAnswer?: string;
  aiScore?: number;
  correct?: boolean;
  reviewedAt?: string;
  elapsedDays?: number;
  fsrs?: unknown; // updated ts-fsrs state for the card, applied atomically with the log
}

interface CardRow {
  id: string;
  subject_id: string;
  topic_id: string;
  term: string;
  definition: string;
  cloze: string | null;
  fsrs: string | null;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: number;
  card_id: string;
  subject_id: string;
  topic_id: string | null;
  grade: number;
  predicted_confidence: number | null;
  typed_answer: string | null;
  ai_score: number | null;
  correct: number | null;
  reviewed_at: string;
  elapsed_days: number | null;
}

function cardOut(row: CardRow) {
  let fsrs: unknown = undefined;
  if (row.fsrs) {
    try {
      fsrs = JSON.parse(row.fsrs);
    } catch {
      fsrs = undefined;
    }
  }
  return {
    id: row.id,
    subjectId: row.subject_id,
    topicId: row.topic_id,
    term: row.term,
    definition: row.definition,
    cloze: row.cloze,
    fsrs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function logOut(row: LogRow) {
  return {
    id: row.id,
    cardId: row.card_id,
    subjectId: row.subject_id,
    topicId: row.topic_id ?? undefined,
    grade: row.grade,
    predictedConfidence: row.predicted_confidence ?? undefined,
    typedAnswer: row.typed_answer ?? undefined,
    aiScore: row.ai_score ?? undefined,
    correct: row.correct === null ? undefined : !!row.correct,
    reviewedAt: row.reviewed_at,
    elapsedDays: row.elapsed_days ?? undefined,
  };
}

const CARD_COLS =
  'id, subject_id, topic_id, term, definition, cloze, fsrs, created_at, updated_at';
const LOG_COLS =
  'id, card_id, subject_id, topic_id, grade, predicted_confidence, typed_answer, ai_score, correct, reviewed_at, elapsed_days';

cardsRouter.get('/cards', (c) => {
  const rows = db.prepare(`SELECT ${CARD_COLS} FROM cards`).all() as unknown as CardRow[];
  return c.json(rows.map(cardOut));
});

cardsRouter.get('/subjects/:id/cards', (c) => {
  const rows = db
    .prepare(`SELECT ${CARD_COLS} FROM cards WHERE subject_id = ?`)
    .all(c.req.param('id')) as unknown as CardRow[];
  return c.json(rows.map(cardOut));
});

export function upsertCard(card: CardIn): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO cards (id, subject_id, topic_id, term, definition, cloze, fsrs, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       topic_id = excluded.topic_id,
       term = excluded.term,
       definition = excluded.definition,
       cloze = excluded.cloze,
       fsrs = excluded.fsrs,
       updated_at = excluded.updated_at`
  ).run(
    card.id,
    card.subjectId,
    card.topicId ?? '',
    card.term,
    card.definition ?? '',
    card.cloze ?? null,
    card.fsrs === undefined || card.fsrs === null ? null : JSON.stringify(card.fsrs),
    card.createdAt ?? now,
    card.updatedAt ?? now
  );
}

// Reconcile after deck regeneration: client computes the ensure/orphan diff.
cardsRouter.post('/subjects/:id/cards/sync', async (c) => {
  const subjectId = c.req.param('id');
  if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subjectId)) {
    return c.json({ error: 'subject not found' }, 404);
  }
  const body = (await c.req.json()) as { upserts?: CardIn[]; deleteIds?: string[] };
  const upserts = Array.isArray(body.upserts) ? body.upserts : [];
  const deleteIds = Array.isArray(body.deleteIds) ? body.deleteIds : [];
  tx(() => {
    for (const card of upserts) {
      if (!card || typeof card.id !== 'string' || typeof card.term !== 'string') continue;
      upsertCard({ ...card, subjectId });
    }
    const del = db.prepare('DELETE FROM cards WHERE id = ? AND subject_id = ?');
    for (const id of deleteIds) {
      if (typeof id === 'string') del.run(id, subjectId);
    }
  });
  return c.json({ ok: true, upserted: upserts.length, deleted: deleteIds.length });
});

// ---- Reviews ---------------------------------------------------------------

export function insertReview(review: ReviewIn): void {
  const reviewedAt = review.reviewedAt ?? nowIso();
  db.prepare(
    `INSERT INTO review_logs
       (card_id, subject_id, topic_id, grade, predicted_confidence, typed_answer, ai_score, correct, reviewed_at, elapsed_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    review.cardId,
    review.subjectId,
    review.topicId ?? null,
    review.grade,
    review.predictedConfidence ?? null,
    review.typedAnswer ?? null,
    review.aiScore ?? null,
    review.correct === undefined || review.correct === null ? null : review.correct ? 1 : 0,
    reviewedAt,
    review.elapsedDays ?? null
  );
  if (review.fsrs !== undefined && review.fsrs !== null) {
    db.prepare('UPDATE cards SET fsrs = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(review.fsrs),
      nowIso(),
      review.cardId
    );
  }
}

const isValidReview = (r: ReviewIn | undefined): r is ReviewIn =>
  !!r && typeof r.cardId === 'string' && typeof r.subjectId === 'string' && typeof r.grade === 'number';

cardsRouter.post('/reviews', async (c) => {
  const review = (await c.req.json()) as ReviewIn;
  if (!isValidReview(review)) return c.json({ error: 'cardId, subjectId, grade required' }, 400);
  tx(() => insertReview(review));
  return c.json({ ok: true }, 201);
});

cardsRouter.post('/reviews/batch', async (c) => {
  const body = (await c.req.json()) as { reviews?: ReviewIn[] };
  const reviews = (Array.isArray(body.reviews) ? body.reviews : []).filter(isValidReview);
  tx(() => {
    for (const r of reviews) insertReview(r);
  });
  return c.json({ ok: true, count: reviews.length }, 201);
});

cardsRouter.get('/reviews', (c) => {
  const rows = db.prepare(`SELECT ${LOG_COLS} FROM review_logs ORDER BY id`).all() as unknown as LogRow[];
  return c.json(rows.map(logOut));
});

cardsRouter.get('/subjects/:id/reviews', (c) => {
  const rows = db
    .prepare(`SELECT ${LOG_COLS} FROM review_logs WHERE subject_id = ? ORDER BY id`)
    .all(c.req.param('id')) as unknown as LogRow[];
  return c.json(rows.map(logOut));
});
