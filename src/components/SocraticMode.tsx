import { useState } from 'react';
import { RefreshCw, HelpCircle, Eye, Lightbulb } from 'lucide-react';
import { usePortal } from '../portal/context';
import { socraticQuestions, type SocraticSet } from '../services/gemini';
import { t } from '../i18n';

// Socratic tutor — leads you to the answer with guiding questions instead of giving it away.
export default function SocraticMode() {
  const { db, apiKey, lang } = usePortal();
  const concepts = Object.entries(db).flatMap(([topic, terms]) => terms.map((t) => ({ topic, ...t })));

  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [set, setSet] = useState<SocraticSet | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const current = concepts[idx];

  const ask = async () => {
    if (!apiKey) { alert(t('alert_need_gemini_key')); return; }
    if (!current) return;
    setLoading(true);
    setSet(null);
    setShowHint(false);
    setShowAnswer(false);
    try {
      setSet(await socraticQuestions(apiKey, current.term, current.definition, lang));
    } catch (e) {
      alert(t('socratic_error', { msg: (e as Error)?.message || String(e) }));
    } finally {
      setLoading(false);
    }
  };

  const next = () => {
    setIdx((i) => (i + 1) % Math.max(1, concepts.length));
    setSet(null);
    setShowHint(false);
    setShowAnswer(false);
  };

  if (!concepts.length) return <div className="empty-state">{t('socratic_no_concepts')}</div>;

  return (
    <div className="ai-workspace">
      <div className="ai-question-card">
        <h3><HelpCircle size={18} style={{ verticalAlign: '-3px', marginLeft: 6 }} />{t('socratic_title')}</h3>
        <div className="question-text">
          {t('socratic_prompt_prefix')}<strong>{current.term}</strong>{t('socratic_prompt_suffix')}
        </div>
      </div>

      <div className="ai-answer-card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={ask} disabled={loading}>
            {loading ? (<><RefreshCw size={16} className="spin" /> <span>{t('socratic_thinking')}</span></>) : (<><HelpCircle size={16} /> <span>{t('socratic_ask_btn')}</span></>)}
          </button>
          <button className="btn btn-outline" onClick={next} disabled={loading}>{t('socratic_another')}</button>
        </div>

        {set && (
          <div style={{ marginTop: '1rem' }}>
            <ol style={{ paddingInlineStart: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: 0 }}>
              {set.questions.map((q, i) => <li key={i} style={{ color: 'var(--text-main)', lineHeight: 1.6 }}>{q}</li>)}
            </ol>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              {!showHint && <button className="btn btn-outline btn-sm" onClick={() => setShowHint(true)}><Lightbulb size={14} /> {t('socratic_hint')}</button>}
              {!showAnswer && <button className="btn btn-outline btn-sm" onClick={() => setShowAnswer(true)}><Eye size={14} /> {t('socratic_reveal')}</button>}
            </div>

            {showHint && (
              <p style={{ marginTop: '0.75rem', color: 'var(--warning)', fontSize: '0.9rem' }}><Lightbulb size={14} style={{ verticalAlign: '-2px', marginLeft: 4 }} />{set.hint}</p>
            )}
            {showAnswer && (
              <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: 'var(--r-md)', background: 'var(--surface-bg)', border: '1px solid var(--border)' }}>
                <strong style={{ color: 'var(--text-main)' }}>{current.term}</strong>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', lineHeight: 1.6 }}>{current.definition}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
