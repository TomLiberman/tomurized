import {
  fsrs,
  createEmptyCard,
  generatorParameters,
  Rating,
  State,
  type Card as FSRSCard,
  type Grade,
} from 'ts-fsrs';

import { t, type StringKey } from '../i18n';

export { Rating, State };
export type { FSRSCard, Grade };

export type GradeName = 'again' | 'hard' | 'good' | 'easy';

export interface GradeDef {
  name: GradeName;
  rating: Grade;
}

// The four review buttons, in display order. Button labels are resolved via
// t() at preview time (not here) so they follow the current course language.
export const GRADES: GradeDef[] = [
  { name: 'again', rating: Rating.Again },
  { name: 'hard', rating: Rating.Hard },
  { name: 'good', rating: Rating.Good },
  { name: 'easy', rating: Rating.Easy },
];

const GRADE_LABEL_KEYS: Record<GradeName, StringKey> = {
  again: 'review_grade_again',
  hard: 'review_grade_hard',
  good: 'review_grade_good',
  easy: 'review_grade_easy',
};

// A single FSRS instance, rebuilt only when the target retention changes.
let _instance: ReturnType<typeof fsrs> | null = null;
let _retention = 0.9;

export function getScheduler(requestRetention = _retention): ReturnType<typeof fsrs> {
  if (!_instance || requestRetention !== _retention) {
    _retention = requestRetention;
    _instance = fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: true }));
  }
  return _instance;
}

export function newCard(now: Date = new Date()): FSRSCard {
  return createEmptyCard(now);
}

// Compact, LTR-rendered interval label for a grade button, e.g. "<1m", "3d", "2mo".
export function formatInterval(due: Date, now: Date = new Date()): string {
  const ms = due.getTime() - now.getTime();
  if (ms < 60_000) return '<1m';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export interface GradePreview extends GradeDef {
  label: string;
  interval: string;
  resultCard: FSRSCard;
}

// For each of the four grades, the resulting card + human interval label.
// Uses next() per grade (does not mutate the input card), so applying a grade
// is just picking the matching preview's resultCard.
export function previewGrades(card: FSRSCard, now: Date = new Date()): GradePreview[] {
  const sched = getScheduler();
  return GRADES.map((g) => {
    const { card: resultCard } = sched.next(card, now, g.rating);
    return { ...g, label: t(GRADE_LABEL_KEYS[g.name]), interval: formatInterval(resultCard.due, now), resultCard };
  });
}

export function applyGrade(card: FSRSCard, rating: Grade, now: Date = new Date()): FSRSCard {
  return getScheduler().next(card, now, rating).card;
}

export function retrievability(card: FSRSCard, now: Date = new Date()): number {
  try {
    return getScheduler().get_retrievability(card, now, false) as number;
  } catch {
    return 0;
  }
}
