import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { subjectStats, type SubjectReviewStats } from '../data/cards';
import { usePortal } from '../portal/context';
import { t } from '../i18n';

// Dashboard tile — replaces the legacy Leitner-box tile with live FSRS state.
export default function MemoryTile({ subjectId }: { subjectId: string }) {
  const { cardsVersion } = usePortal();
  const [stats, setStats] = useState<SubjectReviewStats | null>(null);

  useEffect(() => {
    let alive = true;
    subjectStats(subjectId)
      .then((s) => alive && setStats(s))
      .catch((e) => console.error('[tomurized] loading memory stats failed', e));
    return () => {
      alive = false;
    };
  }, [subjectId, cardsVersion]);

  const total = stats?.total ?? 0;
  const retention = total > 0 ? Math.round(((stats?.mastered ?? 0) / total) * 100) : 0;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const bars: { label: string; count: number; color: string }[] = [
    { label: t('dash_memory_new'), count: stats?.newCount ?? 0, color: 'var(--secondary-accent)' },
    { label: t('dash_memory_learning'), count: stats?.learning ?? 0, color: 'var(--warning)' },
    { label: t('dash_memory_review'), count: stats?.review ?? 0, color: 'var(--primary-accent)' },
    { label: t('dash_memory_mastered'), count: stats?.mastered ?? 0, color: 'var(--success)' },
  ];

  return (
    <>
      <h3>{t('dash_memory_title')}</h3>
      <div className="retention-score-block">
        <span className="retention-val">{retention}%</span>
        <span className="retention-lbl">{t('dash_memory_retention', { due: stats?.due ?? 0 })}</span>
      </div>

      <div className="leitner-bar-group">
        {bars.map((b) => (
          <div className="box-indicator" key={b.label}>
            <span className="box-lbl">{b.label}:</span>
            <div className="bar-bg">
              <div className="bar-fg" style={{ width: `${pct(b.count)}%`, backgroundColor: b.color }} />
            </div>
            <span className="box-count">{t('dash_memory_terms_count', { n: b.count })}</span>
          </div>
        ))}
      </div>

      {(stats?.due ?? 0) > 20 && (
        <div className="alert-box-warning">
          <AlertCircle size={16} />
          <span>{t('dash_memory_due_warning', { n: stats?.due ?? 0 })}</span>
        </div>
      )}
    </>
  );
}
