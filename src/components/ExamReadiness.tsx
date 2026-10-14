import { useEffect, useState } from 'react';
import { Target, AlertTriangle, CalendarClock } from 'lucide-react';
import { examReadiness, type ExamReadiness as Readiness } from '../data/cards';
import { usePortal } from '../portal/context';
import { t } from '../i18n';

// "Am I ready for the exam?" — average predicted recall on the exam date (FSRS),
// days remaining, coverage, and the cards predicted to be shaky on the day.
export default function ExamReadiness({ subjectId, examDate }: { subjectId: string; examDate: string }) {
  const { cardsVersion } = usePortal();
  const [data, setData] = useState<Readiness | null>(null);

  useEffect(() => {
    if (!examDate) return;
    let alive = true;
    examReadiness(subjectId, examDate)
      .then((d) => alive && setData(d))
      .catch((e) => console.error('[tomurized] loading exam readiness failed', e));
    return () => {
      alive = false;
    };
  }, [subjectId, examDate, cardsVersion]);

  if (!examDate || !data || data.total === 0) return null;

  const color = data.readiness >= 75 ? 'var(--success)' : data.readiness >= 50 ? 'var(--warning)' : 'var(--danger)';
  const advice =
    data.reviewedShare < 0.5
      ? t('plan_ready_advice_low_coverage')
      : data.readiness >= 80
      ? t('plan_ready_advice_great')
      : data.readiness >= 50
      ? t('plan_ready_advice_ok')
      : t('plan_ready_advice_low');

  return (
    <div className="plan-setup-card" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 120 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Target size={15} /> {t('plan_ready_title')}
          </div>
          <span style={{ fontSize: '3rem', fontWeight: 800, color, lineHeight: 1.1 }}>{data.readiness}%</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <CalendarClock size={13} /> {t('plan_ready_days', { n: data.daysToExam })}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ color: 'var(--text-main)', fontWeight: 600, margin: '0 0 0.5rem' }}>{advice}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            {t('plan_ready_coverage', { pct: Math.round(data.reviewedShare * 100) })}
          </p>
        </div>
      </div>

      {data.weakCards.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <div className="alert-box-warning" style={{ marginBottom: '0.5rem' }}>
            <AlertTriangle size={16} />
            <span>{t('plan_ready_weak', { n: data.weakCards.length })}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {data.weakCards.map((w) => (
              <span key={w.term} className="badge-count" style={{ borderColor: 'color-mix(in oklch, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
                {w.term}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
