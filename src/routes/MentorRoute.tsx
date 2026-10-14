import { useState } from 'react';
import { usePortal } from '../portal/context';
import { RefreshCw, Send } from 'lucide-react';
import MarkdownText from '../components/MarkdownText';
import FeynmanMode from '../components/FeynmanMode';
import SocraticMode from '../components/SocraticMode';
import Dropdown from '../components/Dropdown';
import { t } from '../i18n';

export default function MentorRoute() {
  const { db, aiSubject, setAiSubject, aiLoading, aiQuestion, setAiQuestion, userAiAnswer, setUserAiAnswer, aiEvaluation, setAiEvaluation, evaluating, handleGenerateAIQuestion, handleEvaluateAIAnswer } = usePortal();
  const [mode, setMode] = useState<'qa' | 'feynman' | 'socratic'>('qa');
  const tabStyle = (on: boolean): React.CSSProperties => ({
    background: on ? 'var(--primary-accent)' : 'transparent', color: on ? 'var(--primary-fg)' : 'var(--text-muted)',
    border: 'none', padding: '0.5rem 1rem', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
  });
  return (
              <div className="ai-view">
                <div className="view-intro">
                  <h2>{t('mentor_title')}</h2>
                  <p>{t('mentor_intro')}</p>
                </div>

                <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  <button style={tabStyle(mode === 'qa')} onClick={() => setMode('qa')}>{t('mentor_tab_qa')}</button>
                  <button style={tabStyle(mode === 'feynman')} onClick={() => setMode('feynman')}>{t('mentor_tab_feynman')}</button>
                  <button style={tabStyle(mode === 'socratic')} onClick={() => setMode('socratic')}>{t('mentor_tab_socratic')}</button>
                </div>

                {mode === 'feynman' ? <FeynmanMode /> : mode === 'socratic' ? <SocraticMode /> : (<>
                <div className="ai-setup-card">
                  <div className="setup-group">
                    <label>{t('mentor_pick_topic')}</label>
                    <Dropdown
                      value={aiSubject}
                      onChange={setAiSubject}
                      minWidth={220}
                      ariaLabel={t('mentor_topic_aria')}
                      disabled={aiLoading || evaluating}
                      options={Object.keys(db).map((subject) => ({ value: subject, label: subject.split(' - ')[0] }))}
                    />
                  </div>

                  <button
                    className="btn btn-primary"
                    onClick={handleGenerateAIQuestion}
                    disabled={aiLoading || evaluating}
                  >
                    {aiLoading ? (
                      <>
                        <RefreshCw size={16} className="spin" />
                        <span>{t('mentor_generating')}</span>
                      </>
                    ) : (
                      t('mentor_generate_btn')
                    )}
                  </button>
                </div>

                {aiQuestion && (
                  <div className="ai-workspace">
                    <div className="ai-question-card">
                      <h3>{t('mentor_open_question')}</h3>
                      <div className="question-text"><MarkdownText>{aiQuestion.question}</MarkdownText></div>
                    </div>

                    <div className="ai-answer-card">
                      <label>{t('mentor_your_answer')}</label>
                      <textarea
                        placeholder={t('mentor_answer_placeholder')}
                        value={userAiAnswer}
                        onChange={(e) => setUserAiAnswer(e.target.value)}
                        disabled={evaluating}
                        rows={6}
                      ></textarea>

                      <button
                        className="btn btn-primary evaluate-btn"
                        onClick={handleEvaluateAIAnswer}
                        disabled={evaluating || !userAiAnswer.trim()}
                      >
                        {evaluating ? (
                          <>
                            <RefreshCw size={16} className="spin" />
                            <span>{t('mentor_evaluating')}</span>
                          </>
                        ) : (
                          <>
                            <Send size={16} />
                            <span>{t('mentor_send_answer')}</span>
                          </>
                        )}
                      </button>
                    </div>

                    {aiEvaluation && (
                      <div className={`ai-evaluation-results ${aiEvaluation.isCorrect ? 'success' : 'partial'}`}>
                        <div className="eval-header">
                          <div className="score-circle">
                            <span className="val">{aiEvaluation.score}%</span>
                          </div>
                          <div>
                            <h4>{t('mentor_eval_title')}</h4>
                            <p className="status">
                              {t('mentor_eval_class', { verdict: aiEvaluation.evaluation === 'correct' ? t('mentor_verdict_correct') : aiEvaluation.evaluation === 'partial' ? t('mentor_verdict_partial') : t('mentor_verdict_wrong') })}
                            </p>
                          </div>
                        </div>

                        <div className="eval-feedback">
                          <h5>{t('mentor_feedback_title')}</h5>
                          <MarkdownText>{aiEvaluation.feedback}</MarkdownText>
                        </div>

                        <div style={{ marginTop: '1rem' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => {
                            setAiQuestion(null);
                            setAiEvaluation(null);
                          }}>
                            {t('mentor_next_question')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                </>)}
              </div>
  );
}
