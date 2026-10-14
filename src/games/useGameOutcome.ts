// The single place every game reports a finished run: FSRS grading, study
// points (awarded exactly once — recordStudyActivity self-fires 'success'
// confetti when points > 0), high-score bookkeeping, and 'perfect' confetti.

import { usePortal } from '../portal/context';
import { gradeExamResults } from '../data/cards';
import { dedupeResults } from './questionEngine';
import { recordScore } from './highScores';
import type { GameResult, GameSummary } from './types';

export function useGameOutcome() {
  const { activeSubjectId, recordStudyActivity, triggerConfetti } = usePortal();

  const finishRun = (summary: GameSummary, results: GameResult[]): { isNewBest: boolean } => {
    const deduped = dedupeResults(results);
    if (deduped.length) void gradeExamResults(activeSubjectId, deduped);
    if (summary.pointsAwarded > 0) recordStudyActivity(summary.pointsAwarded);
    const { isNewBest } = recordScore(activeSubjectId, summary.gameId, summary.score);
    if (summary.perfect) triggerConfetti('perfect');
    return { isNewBest };
  };

  return { finishRun };
}
