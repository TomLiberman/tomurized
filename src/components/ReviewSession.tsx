import { useEffect, useMemo, useState } from 'react';
import { Eye, Layers, Keyboard, Check, X, RefreshCw, PartyPopper, CalendarCheck, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useReviewEngine } from '../hooks/useReviewEngine';
import { previewGrades, type FSRSCard, type GradeName } from '../data/fsrs';
import { matchAnswer, type RecallMatch } from '../data/hebrew';
import { t } from '../i18n';
import './ReviewSession.css';

type Mode = 'recognition' | 'recall';

const POINTS: Record<GradeName, number> = { again: 0, hard: 1, good: 2, easy: 3 };

export default function ReviewSession({
  subjectId,
  topicFilter,
  onReviewed,
}: {
  subjectId: string | null; // null = cross-course Mixed Review
  topicFilter: string;
  onReviewed?: (points: number) => void;
}) {
  const engine = useReviewEngine(subjectId, topicFilter);
  const { current } = engine;

  const [mode, setMode] = useState<Mode>('recognition');
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [match, setMatch] = useState<RecallMatch | null>(null);
  // Brainscape-style checkpoint: hide progress during a 10-card round, reveal at the end.
  const [, setRound] = useState({ count: 0, known: 0 });
  const [checkpoint, setCheckpoint] = useState<number | null>(null);

  // Reset per-card interaction state whenever the current card (or mode) changes.
  useEffect(() => {
    setRevealed(false);
    setConfidence(null);
    setTyped('');
    setMatch(null);
  }, [current?.id, mode]);

  const grades = useMemo(
    () => (current ? previewGrades(current.fsrs as FSRSCard) : []),
    [current]
  );

  const suggested: GradeName | null = match ? (match.exact ? 'easy' : match.close ? 'good' : 'again') : null;

  const doGrade = async (name: GradeName) => {
    const g = grades.find((x) => x.name === name);
    if (!g) return;
    const saved = await engine.grade(g.rating, {
      predictedConfidence: confidence ?? undefined,
      typedAnswer: mode === 'recall' ? typed : undefined,
      correct: match ? match.exact || match.close : undefined,
    });
    if (!saved) return; // double-click or save failure (error banner shows below)
    onReviewed?.(POINTS[name]);
    const known = name === 'good' || name === 'easy';
    setRound((r) => {
      const count = r.count + 1;
      const knownCount = r.known + (known ? 1 : 0);
      if (count >= 10) {
        setCheckpoint(Math.round((knownCount / count) * 100));
        return { count: 0, known: 0 };
      }
      return { count, known: knownCount };
    });
  };

  const checkRecall = () => {
    if (!current) return;
    setMatch(matchAnswer(typed, current.term));
    setRevealed(true);
  };

  if (checkpoint !== null) {
    return (
      <div className="rv-wrap">
        <div className="rv-done">
          <PartyPopper size={30} style={{ color: 'var(--success)' }} />
          <div className="rv-done-num">{checkpoint}%</div>
          <h3>{t('review_checkpoint_title')}</h3>
          <p>{t('review_checkpoint_text', { pct: checkpoint })}</p>
          <button className="btn btn-primary" onClick={() => setCheckpoint(null)}>{t('review_next_round')}</button>
        </div>
      </div>
    );
  }

  if (engine.loading) {
    return (
      <div className="rv-wrap">
        <div className="rv-empty">
          <RefreshCw size={22} className="spin" />
          <p>{t('review_loading')}</p>
        </div>
      </div>
    );
  }

  if (engine.error && !current) {
    return (
      <div className="rv-wrap">
        <div className="rv-empty">
          <AlertTriangle size={30} style={{ color: 'var(--danger)' }} />
          <p>{t('err_server_unreachable')}</p>
          <button className="btn btn-outline" onClick={() => void engine.reload()}>
            <RefreshCw size={15} /> {t('boot_retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="rv-wrap">
        {engine.reviewedCount > 0 ? (
          <div className="rv-done">
            <PartyPopper size={30} style={{ color: 'var(--success)' }} />
            <div className="rv-done-num">{engine.reviewedCount}</div>
            <h3>{t('review_done_title')}</h3>
            <p>{t('review_done_text', { n: engine.reviewedCount })}</p>
            <button className="btn btn-outline" onClick={() => void engine.reload()}>
              <RefreshCw size={15} /> {t('review_check_again')}
            </button>
          </div>
        ) : (
          <div className="rv-empty">
            <CalendarCheck size={30} style={{ color: 'var(--secondary-accent)' }} />
            <h3 style={{ color: 'var(--text-main)', margin: '0.5rem 0' }}>{t('review_none_title')}</h3>
            <p>{t('review_none_text')}</p>
            <button className="btn btn-outline" onClick={() => void engine.reload()}>
              <RefreshCw size={15} /> {t('review_refresh')}
            </button>
          </div>
        )}
      </div>
    );
  }

  const showGrades = revealed;

  return (
    <div className="rv-wrap">
      <div className="rv-toolbar">
        <div className="rv-modes">
          <button className={`rv-mode-btn ${mode === 'recognition' ? 'active' : ''}`} onClick={() => setMode('recognition')}>
            <Layers size={14} /> {t('review_mode_recognition')}
          </button>
          <button className={`rv-mode-btn ${mode === 'recall' ? 'active' : ''}`} onClick={() => setMode('recall')}>
            <Keyboard size={14} /> {t('review_mode_recall')}
          </button>
        </div>
        <div className="rv-progress">
          {t('review_progress_done', { n: engine.reviewedCount })} <span className="rv-due">{engine.remaining}</span>
        </div>
      </div>

      <div className="rv-card">
        <span className="rv-cat">{current.topicId?.split(' - ')[0]}</span>

        {mode === 'recognition' ? (
          <>
            <div className="rv-term">{current.term}</div>
            {revealed ? (
              <>
                <div className="rv-divider" />
                <div className="rv-def">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.definition}</ReactMarkdown>
                </div>
              </>
            ) : (
              <div className="rv-confidence">
                <span className="rv-c-label">{t('review_confidence_label')}</span>
                <div className="rv-c-row">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} className="rv-c-btn" onClick={() => { setConfidence(n); setRevealed(true); }}>
                      {n}
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary rv-reveal-btn" onClick={() => setRevealed(true)}>
                  <Eye size={15} /> {t('review_reveal')}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="rv-prompt-label">{t('review_recall_prompt')}</span>
            <div className="rv-def">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.definition}</ReactMarkdown>
            </div>
            {!revealed ? (
              <div className="rv-confidence">
                <input
                  className="rv-recall-input"
                  placeholder={t('review_recall_placeholder')}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') checkRecall(); }}
                  autoFocus
                />
                <button className="btn btn-primary rv-reveal-btn" onClick={checkRecall} disabled={!typed.trim()}>
                  <Check size={15} /> {t('review_check')}
                </button>
              </div>
            ) : (
              <>
                <div className="rv-divider" />
                {match && (
                  <div className={`rv-match ${match.exact ? 'exact' : match.close ? 'close' : 'miss'}`}>
                    {match.exact || match.close ? <Check size={16} /> : <X size={16} />}
                    {match.exact ? t('review_match_exact') : match.close ? t('review_match_close') : t('review_match_miss')}
                  </div>
                )}
                <div>
                  <span className="rv-prompt-label">{t('review_correct_term')}</span>
                  <div className="rv-answer">{current.term}</div>
                </div>
              </>
            )}
          </>
        )}

        {engine.error && (
          <p className="rv-save-error" role="alert">
            <AlertTriangle size={15} /> {t('review_save_failed')}
          </p>
        )}

        {showGrades && (
          <div className="rv-grades">
            {grades.map((g) => (
              <button
                key={g.name}
                className={`rv-grade ${g.name} ${suggested === g.name ? 'suggested' : ''}`}
                disabled={engine.grading}
                onClick={() => void doGrade(g.name)}
              >
                <span className="rv-iv" dir="ltr">{g.interval}</span>
                <span className="rv-lb">{g.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
