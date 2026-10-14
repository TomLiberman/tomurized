import { useState } from 'react';
import { FileQuestion, Loader2, Sparkles, Zap } from 'lucide-react';
import { usePortal } from '../portal/context';
import { gradeExamResults } from '../data/cards';
import Dropdown from '../components/Dropdown';
import { t } from '../i18n';

export default function ExamRoute() {
  const { db, examSubject, setExamSubject, examQuestions, selectedAnswers, setSelectedAnswers, examSubmitted, examActive, setExamActive, startExam, submitExam, activeSubjectId, pastExams, startAiExam, aiExamLoading, apiKey, navigate } = usePortal();

  // 'quick' = local term/definition MCQs; 'ai' = Gemini writes exam-style questions,
  // imitating the past exams stored in the course's materials library.
  // AI is the default whenever a key exists ("focus on AI questions only");
  // quick stays available as the instant/no-key fallback.
  const [examMode, setExamMode] = useState<'quick' | 'ai'>(apiKey ? 'ai' : 'quick');

  // Submit + feed each answer back into the FSRS schedule (testing effect):
  // wrong answers make that card due again soon. AI questions count only when
  // they were matched to a deck concept.
  const handleSubmit = () => {
    if (examSubmitted) return;
    submitExam();
    const results = examQuestions
      .filter((q) => q.term)
      .map((q) => {
        const idx = examQuestions.indexOf(q);
        return { term: q.term, correct: selectedAnswers[idx] === q.correctAnswer };
      });
    void gradeExamResults(activeSubjectId, results);
  };

  const startSelectedExam = () => {
    if (examMode === 'ai') void startAiExam();
    else startExam();
  };

  return (
              <div className="exam-view">
                <div className="view-intro">
                  <h2>{t('exam_title')}</h2>
                  <p>{t('exam_intro')}</p>
                </div>

                {!examActive ? (
                  <div className="exam-setup-card">
                    <div className="setup-group">
                      <label>{t('exam_pick_topic')}</label>
                      <Dropdown
                        value={examSubject}
                        onChange={setExamSubject}
                        minWidth={220}
                        ariaLabel={t('exam_topic_aria')}
                        options={[{ value: 'all', label: t('exam_all_topics_summary') }, ...Object.keys(db).map((subject) => ({ value: subject, label: subject.split(' - ')[0] }))]}
                      />
                    </div>

                    <div className="setup-group">
                      <label>{t('exam_type_label')}</label>
                      <div className="exam-mode-toggle" role="radiogroup" aria-label={t('exam_type_label')}>
                        <button
                          className={`exam-mode-btn ${examMode === 'quick' ? 'active' : ''}`}
                          role="radio"
                          aria-checked={examMode === 'quick'}
                          onClick={() => setExamMode('quick')}
                        >
                          <Zap size={15} /> {t('exam_type_quick')}
                        </button>
                        <button
                          className={`exam-mode-btn ${examMode === 'ai' ? 'active' : ''}`}
                          role="radio"
                          aria-checked={examMode === 'ai'}
                          onClick={() => setExamMode('ai')}
                          title={!apiKey ? t('api_key_required') : undefined}
                        >
                          <Sparkles size={15} /> {t('exam_type_ai')}
                        </button>
                      </div>
                    </div>

                    {examMode === 'ai' && (
                      <div className="setup-group past-exams-box">
                        <p className="hint-text" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                          <FileQuestion size={15} />
                          {pastExams.length > 0
                            ? t('exam_ai_imitate', { n: pastExams.length })
                            : t('exam_no_past_exams')}
                          <button className="btn btn-outline btn-sm" onClick={() => navigate('/loader')}>
                            {t('exam_to_library')}
                          </button>
                        </p>
                      </div>
                    )}

                    <button className="btn btn-primary" onClick={startSelectedExam} disabled={aiExamLoading}>
                      {aiExamLoading ? (<><Loader2 size={16} className="spin" /> {t('exam_ai_composing')}</>) : t('exam_start_now')}
                    </button>
                  </div>
                ) : (
                  <div className="exam-active-card">
                    <div className="exam-status-header">
                      <h3>{t('exam_practice_title', { topic: examSubject === 'all' ? t('exam_all_topics') : examSubject.split(' - ')[0] })}</h3>
                      <button className="btn btn-sm btn-outline" onClick={() => setExamActive(false)}>
                        {t('exam_cancel')}
                      </button>
                    </div>

                    <div className="questions-list">
                      {examQuestions.map((q, idx) => {
                        // Match the prompt to the option type the generator built:
                        //  ai                 -> options are whatever the model wrote: show its full question.
                        //  term-to-definition -> options are DEFINITIONS: show the term, ask for its definition.
                        //  definition-to-term -> options are TERMS: show the definition, ask for the concept.
                        const isTermToDef = q.questionType === 'term-to-definition';
                        return (
                          <div className="exam-question-card" key={idx}>
                            <h4>{t('exam_question_n', { n: idx + 1 })}</h4>
                            <p className="question-prompt">
                              {q.questionType === 'ai' ? (
                                q.prompt
                              ) : isTermToDef ? (
                                <>{t('exam_q_def_prefix')}<strong>{q.term}</strong>?</>
                              ) : (
                                <>{t('exam_q_term_prefix')}<br /><span className="quote">"{q.definition}"</span>?</>
                              )}
                            </p>

                            <div className="options-grid">
                              {q.options.map((opt, optIdx) => {
                                const isSelected = selectedAnswers[idx] === opt;
                                const isCorrect = opt === q.correctAnswer;
                                let btnClass = '';

                                if (examSubmitted) {
                                  if (isCorrect) btnClass = 'correct';
                                  else if (isSelected) btnClass = 'incorrect';
                                  else btnClass = 'disabled';
                                } else {
                                  if (isSelected) btnClass = 'selected';
                                }

                                return (
                                  <button
                                    key={optIdx}
                                    className={`option-btn ${btnClass}`}
                                    disabled={examSubmitted}
                                    onClick={() => {
                                      setSelectedAnswers(prev => ({ ...prev, [idx]: opt }));
                                    }}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>

                            {examSubmitted && (q.questionType === 'ai' ? (q.explanation || q.term) : true) && (
                              <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: 'var(--r-md)', background: 'var(--surface-bg)', border: '1px solid var(--border)', fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                                {q.questionType === 'ai' ? (
                                  <>{q.term && <strong style={{ color: 'var(--text-main)' }}>{q.term} — </strong>}{q.explanation}</>
                                ) : (
                                  <><strong style={{ color: 'var(--text-main)' }}>{q.term}</strong> — {q.definition}</>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {!examSubmitted ? (
                      <button
                        className="btn btn-primary submit-btn"
                        onClick={handleSubmit}
                        disabled={Object.keys(selectedAnswers).length < examQuestions.length}
                      >
                        {t('exam_submit')}
                      </button>
                    ) : (
                      <div className="exam-results-pane">
                        <div className="result-score-block">
                          <h3>{t('exam_results_title')}</h3>
                          <span className="score-badge">
                            {Math.round(
                              (examQuestions.filter((q, idx) => selectedAnswers[idx] === q.correctAnswer).length /
                                examQuestions.length) *
                                100
                            )}%
                          </span>
                          <p>
                            {t('exam_correct_count', { correct: examQuestions.filter((q, idx) => selectedAnswers[idx] === q.correctAnswer).length, total: examQuestions.length })}
                          </p>
                        </div>
                        <button className="btn btn-primary" disabled={aiExamLoading} onClick={startSelectedExam}>
                          {aiExamLoading ? (<><Loader2 size={16} className="spin" /> {t('exam_ai_composing')}</>) : t('exam_retry')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
  );
}
