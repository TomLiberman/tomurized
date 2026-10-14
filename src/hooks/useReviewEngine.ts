import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardRecord } from '../data/records';
import { ensureCardsForSubject, ensureAllCards, getDueCards, gradeCard, type GradeContext } from '../data/cards';
import type { Grade } from '../data/fsrs';

// Interleave cards (across courses) so consecutive cards vary — a desirable difficulty.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ReviewEngine {
  loading: boolean;
  /** Set when loading the queue or saving a grade failed (network/server down). */
  error: boolean;
  /** True while a grade is being saved — further grades are ignored until it lands. */
  grading: boolean;
  current: CardRecord | null;
  reviewedCount: number;
  remaining: number;
  totalDue: number;
  grade: (rating: Grade, ctx?: GradeContext) => Promise<boolean>;
  reload: () => Promise<void>;
}

// Loads the due-today queue for a subject (optionally a single topic/section),
// tracks position, and persists each grade via the card service.
// subjectId === null → cross-course Mixed Review across ALL subjects.
export function useReviewEngine(subjectId: string | null, topicFilter: string): ReviewEngine {
  const [queue, setQueue] = useState<CardRecord[]>([]);
  const [pos, setPos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [grading, setGrading] = useState(false);
  const [totalDue, setTotalDue] = useState(0);
  // Synchronous guard: a double-click fires twice before React re-renders, so
  // state alone can't stop the same card being graded (and the next skipped).
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (subjectId === null) {
        await ensureAllCards();
      } else {
        await ensureCardsForSubject(subjectId);
      }
      const due =
        subjectId === null
          ? shuffle(await getDueCards({}))
          : await getDueCards({ subjectId, topicId: topicFilter === 'all' ? undefined : topicFilter });
      setQueue(due);
      setTotalDue(due.length);
      setPos(0);
    } catch (e) {
      console.error('[tomurized] loading the review queue failed', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [subjectId, topicFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grade = useCallback(
    async (rating: Grade, ctx: GradeContext = {}) => {
      const card = queue[pos];
      if (!card || inFlight.current) return false;
      inFlight.current = true;
      setGrading(true);
      try {
        await gradeCard(card, rating, ctx);
        setError(false);
        setPos((p) => p + 1);
        return true;
      } catch (e) {
        console.error('[tomurized] saving the grade failed', e);
        setError(true);
        return false;
      } finally {
        inFlight.current = false;
        setGrading(false);
      }
    },
    [queue, pos]
  );

  return {
    loading,
    error,
    grading,
    current: queue[pos] ?? null,
    reviewedCount: pos,
    remaining: Math.max(0, queue.length - pos),
    totalDue,
    grade,
    reload,
  };
}
