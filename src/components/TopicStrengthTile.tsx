import { useEffect, useState } from 'react';
import { Play, TrendingDown } from 'lucide-react';
import { usePortal } from '../portal/context';
import { topicStats, type TopicStat } from '../data/cards';
import { t as tr } from '../i18n';

const strengthColor = (s: number) =>
  s < 50 ? '#e5484d' : s < 75 ? 'var(--warning)' : 'var(--success)';

// Dashboard tile: which topics are weak vs strong right now. Fed by every
// review/exam answer (reviewLogs carry topicId) blended with FSRS
// retrievability — updates as the user studies.
export default function TopicStrengthTile() {
  const { activeSubjectId, db, cardsVersion, setFlashcardSubject, navigate } = usePortal();
  const [stats, setStats] = useState<TopicStat[] | null>(null);

  useEffect(() => {
    let alive = true;
    topicStats(activeSubjectId)
      .then((s) => alive && setStats(s))
      .catch((e) => console.error('[tomurized] loading topic stats failed', e));
    return () => {
      alive = false;
    };
  }, [activeSubjectId, db, cardsVersion]);

  const practice = (topicId: string) => {
    setFlashcardSubject(topicId);
    navigate('/flashcards');
  };

  if (!stats || stats.length === 0) {
    return (
      <>
        <h3><TrendingDown size={16} /> {tr('topic_title')}</h3>
        <p className="hint-text">{tr('topic_empty')}</p>
      </>
    );
  }

  return (
    <>
      <h3><TrendingDown size={16} /> {tr('topic_title')}</h3>
      <p className="hint-text" style={{ margin: '0 0 0.6rem' }}>{tr('topic_sort_hint')}</p>
      <div className="topic-strength-list">
        {stats.map((t) => (
          <div className="topic-strength-row" key={t.topicId}>
            <button className="btn-icon" title={tr('topic_practice_title', { topic: t.topicId })} onClick={() => practice(t.topicId)}>
              <Play size={13} />
            </button>
            <span className="topic-strength-name" title={t.topicId}>{t.topicId.split(' - ')[0]}</span>
            <div className="bar-bg">
              <div className="bar-fg" style={{ width: `${t.strength}%`, backgroundColor: strengthColor(t.strength) }} />
            </div>
            <span className="topic-strength-val" style={{ color: strengthColor(t.strength) }}>
              {t.strength}%{t.due > 0 ? tr('topic_due', { n: t.due }) : ''}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
