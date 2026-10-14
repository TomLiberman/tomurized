import { useEffect, useState } from 'react';
import { Gauge, AlertTriangle, CheckCircle } from 'lucide-react';
import { getCalibration, type Calibration } from '../data/cards';
import { t } from '../i18n';

// "Do you actually know what you think you know?" — compares pre-reveal
// confidence against real outcomes and surfaces overconfident cards.
export default function CalibrationPanel({ subjectId }: { subjectId: string }) {
  const [cal, setCal] = useState<Calibration | null>(null);

  useEffect(() => {
    let alive = true;
    getCalibration(subjectId)
      .then((c) => alive && setCal(c))
      .catch((e) => console.error('[tomurized] loading calibration failed', e));
    return () => {
      alive = false;
    };
  }, [subjectId]);

  if (!cal || cal.totalRated === 0) {
    return (
      <div className="progress-card-detail">
        <h3><Gauge size={18} style={{ verticalAlign: '-3px', marginLeft: 6 }} />{t('progress_cal_title')}</h3>
        <div className="empty-scores">
          <CheckCircle size={22} />
          <p>{t('progress_cal_empty')}</p>
        </div>
      </div>
    );
  }

  const gapPct = Math.round(cal.gap * 100);
  const gapLabel = gapPct > 8 ? t('progress_cal_overconfident') : gapPct < -8 ? t('progress_cal_underconfident') : t('progress_cal_good');

  return (
    <div className="progress-card-detail">
      <h3><Gauge size={18} style={{ verticalAlign: '-3px', marginLeft: 6 }} />{t('progress_cal_title')}</h3>

      <div className="retention-score-block" style={{ marginBottom: '1rem' }}>
        <span className="retention-val" style={{ color: Math.abs(gapPct) > 8 ? 'var(--warning)' : 'var(--success)' }}>
          {gapPct > 0 ? '+' : ''}{gapPct}%
        </span>
        <span className="retention-lbl">{t('progress_cal_by_ratings', { label: gapLabel, n: cal.totalRated })}</span>
      </div>

      <div className="leitner-bar-group">
        {cal.buckets.map((b) => (
          <div className="box-indicator" key={b.confidence}>
            <span className="box-lbl">{t('progress_cal_confidence', { n: b.confidence })}</span>
            <div className="bar-bg">
              <div className="bar-fg" style={{ width: `${Math.round(b.accuracy * 100)}%`, backgroundColor: 'var(--success)' }} />
            </div>
            <span className="box-count">{b.total ? t('progress_cal_knew', { pct: Math.round(b.accuracy * 100) }) : '—'}</span>
          </div>
        ))}
      </div>

      {cal.overconfident.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <div className="alert-box-warning" style={{ marginBottom: '0.5rem' }}>
            <AlertTriangle size={16} />
            <span>{t('progress_cal_wrong_high_conf', { n: cal.overconfident.length })}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {cal.overconfident.slice(0, 24).map((o) => (
              <span key={o.cardId} className="badge-count" style={{ borderColor: 'color-mix(in oklch, var(--warning) 35%, transparent)', color: 'var(--warning)' }}>
                {o.term}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
