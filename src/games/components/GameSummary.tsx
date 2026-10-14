import type { ReactNode } from 'react';
import { RotateCcw, Trophy } from 'lucide-react';
import { usePortal } from '../../portal/context';
import { t } from '../../i18n';
import type { GameSummary as Summary } from '../types';

// End-of-run screen: score, points earned, missed terms (reinforcement), and
// replay / back-to-hub actions.
export default function GameSummary(props: {
  summary: Summary;
  isNewBest: boolean;
  /** Missed items shown for reinforcement: label = what was asked, detail = the right answer. */
  missed: { label: string; detail: string }[];
  onReplay: () => void;
  /** Optional game-specific flavor (e.g. the Millionaire prize banner). */
  extra?: ReactNode;
}) {
  const { navigate } = usePortal();
  const { summary } = props;

  return (
    <div className="game-summary">
      {props.extra}
      <div className="game-summary-score">
        <span className="num">{summary.score}</span>
        <span className="lbl">{t('game_score_lbl')}</span>
      </div>
      {props.isNewBest && (
        <span className="game-summary-newbest">
          <Trophy size={16} />
          {t('game_new_best')}
        </span>
      )}
      <div className="game-summary-stats">
        <span><b>{summary.correct}</b> / {summary.total} {t('game_correct_answers')}</span>
        {summary.bestStreak > 0 && <span>{t('game_best_streak')} <b>{summary.bestStreak}</b></span>}
        <span>{t('game_points')} <b>+{summary.pointsAwarded}</b></span>
      </div>

      {props.missed.length > 0 && (
        <div className="game-missed">
          <h4>{t('game_missed_title')}</h4>
          {props.missed.map((m, i) => (
            <div className="game-missed-item" key={i}>
              <b>{m.label}</b>
              {' — '}
              <span>{m.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className="game-summary-actions">
        <button className="btn btn-primary" onClick={props.onReplay}>
          <RotateCcw size={16} />
          <span>{t('game_play_again')}</span>
        </button>
        <button className="btn btn-outline" onClick={() => navigate('/games')}>
          {t('game_back_to_hub')}
        </button>
      </div>
    </div>
  );
}
