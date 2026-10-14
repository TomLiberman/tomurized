import { useState } from 'react';
import { RefreshCw, Send, CheckCircle, AlertTriangle, Lightbulb } from 'lucide-react';
import { usePortal } from '../portal/context';
import { explainConceptFeedback, type ExplanationFeedback } from '../services/gemini';
import { t } from '../i18n';

// Feynman "explain it in your own words" mode — the generation effect + self-explanation.
export default function FeynmanMode() {
  const { db, apiKey, recordStudyActivity, lang } = usePortal();
  const concepts = Object.entries(db).flatMap(([topic, terms]) => terms.map((t) => ({ topic, ...t })));

  const [idx, setIdx] = useState(0);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [fb, setFb] = useState<ExplanationFeedback | null>(null);
  const current = concepts[idx];

  const submit = async () => {
    if (!apiKey) { alert(t('alert_need_gemini_key')); return; }
    if (!text.trim() || !current) return;
    setLoading(true);
    setFb(null);
    try {
      const res = await explainConceptFeedback(apiKey, current.term, current.definition, text, lang);
      setFb(res);
      if (res.score >= 70) recordStudyActivity(5);
    } catch (e) {
      alert(t('feynman_check_error', { msg: (e as Error)?.message || String(e) }));
    } finally {
      setLoading(false);
    }
  };

  const next = () => {
    setIdx((i) => (i + 1) % Math.max(1, concepts.length));
    setText('');
    setFb(null);
  };

  if (!concepts.length) return <div className="empty-state">{t('feynman_no_concepts')}</div>;

  return (
    <div className="ai-workspace">
      <div className="ai-question-card">
        <h3><Lightbulb size={18} style={{ verticalAlign: '-3px', marginLeft: 6 }} />{t('feynman_title')}</h3>
        <div className="question-text">
          {t('feynman_prompt_prefix')}<strong>{current.term}</strong>{t('feynman_prompt_suffix')}
        </div>
      </div>

      <div className="ai-answer-card">
        <label>{t('feynman_your_explanation', { term: current.term })}</label>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('feynman_placeholder')}
          disabled={loading}
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={submit} disabled={loading || !text.trim()}>
            {loading ? (<><RefreshCw size={16} className="spin" /> <span>{t('feynman_checking')}</span></>) : (<><Send size={16} /> <span>{t('feynman_check_btn')}</span></>)}
          </button>
          <button className="btn btn-outline" onClick={next} disabled={loading}>{t('feynman_another')}</button>
        </div>
      </div>

      {fb && (
        <div className={`ai-evaluation-results ${fb.score >= 70 ? 'success' : 'partial'}`}>
          <div className="eval-header">
            <div className="score-circle"><span className="val">{fb.score}%</span></div>
            <div>
              <h4>{t('feynman_feedback_title')}</h4>
              <p className="status">{t('feynman_completeness')}</p>
            </div>
          </div>
          {fb.strengths?.length > 0 && (
            <div className="eval-feedback">
              <h5><CheckCircle size={15} style={{ verticalAlign: '-2px', marginLeft: 4, color: 'var(--success)' }} />{t('feynman_strengths')}</h5>
              <ul>{fb.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {fb.gaps?.length > 0 && (
            <div className="eval-feedback">
              <h5><AlertTriangle size={15} style={{ verticalAlign: '-2px', marginLeft: 4, color: 'var(--warning)' }} />{t('feynman_gaps')}</h5>
              <ul>{fb.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
