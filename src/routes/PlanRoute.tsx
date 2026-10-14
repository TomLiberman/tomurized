import { usePortal } from '../portal/context';
import { Award, CalendarDays, CalendarPlus, Download, RefreshCw } from 'lucide-react';
import { googleCalLink } from '../lib/calendar';
import ExamReadiness from '../components/ExamReadiness';
import { t } from '../i18n';

export default function PlanRoute() {
  const { examDate, setExamDate, studyPlan, planGenerating, handleGeneratePlan, downloadPlanICS, activeSubjectId, lang } = usePortal();
  const locale = lang === 'he' ? 'he-IL' : 'en-GB';
  return (
              <div className="plan-view">
                <div className="view-intro">
                  <h2>{t('plan_title')}</h2>
                  <p>{t('plan_intro')}</p>
                </div>

                <div className="plan-setup-card">
                  <div className="plan-date-group">
                    <label>{t('plan_exam_date')}</label>
                    <input
                      type="date"
                      value={examDate}
                      onChange={(e) => setExamDate(e.target.value)}
                      className="theory-select"
                    />
                  </div>
                  <button className="btn btn-primary" onClick={handleGeneratePlan} disabled={planGenerating || !examDate}>
                    {planGenerating ? (
                      <><RefreshCw size={16} className="spin" /> <span>{t('plan_building')}</span></>
                    ) : (
                      <><CalendarDays size={16} /> <span>{studyPlan.length ? t('plan_rebuild') : t('plan_build')}</span></>
                    )}
                  </button>
                </div>

                <ExamReadiness subjectId={activeSubjectId} examDate={examDate} />

                {studyPlan.length > 0 && (
                  <>
                    <div className="plan-toolbar">
                      <span className="plan-count">{t('plan_days_count', { n: studyPlan.length })}</span>
                      <button className="btn btn-outline btn-sm" onClick={downloadPlanICS}>
                        <Download size={15} /> <span>{t('plan_download_ics')}</span>
                      </button>
                    </div>

                    <div className="plan-timeline">
                      {studyPlan.map((d, i) => {
                        const details = `${d.focus || ''}${d.tasks && d.tasks.length ? '\n\n' + d.tasks.map(t => '• ' + t).join('\n') : ''}`.trim();
                        let dateLabel = d.date;
                        try {
                          dateLabel = new Date(d.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
                        } catch { /* keep raw */ }
                        return (
                          <div className="plan-day-card" key={i}>
                            <div className="plan-day-date">
                              <span className="pd-num">{i + 1}</span>
                              <span className="pd-date">{dateLabel}</span>
                            </div>
                            <div className="plan-day-body">
                              <h4>{d.title}</h4>
                              {d.focus && <p className="pd-focus">{d.focus}</p>}
                              {d.tasks && d.tasks.length > 0 && (
                                <ul className="pd-tasks">
                                  {d.tasks.map((t, ti) => <li key={ti}>{t}</li>)}
                                </ul>
                              )}
                              <a
                                className="gcal-link"
                                href={googleCalLink(`📚 ${d.title}`, d.date, details)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <CalendarPlus size={14} /> {t('plan_add_gcal')}
                              </a>
                            </div>
                          </div>
                        );
                      })}

                      {examDate && (
                        <div className="plan-day-card exam-day-card">
                          <div className="plan-day-date">
                            <Award size={20} />
                          </div>
                          <div className="plan-day-body">
                            <h4>{t('plan_exam_day')}</h4>
                            <p className="pd-focus">{(() => { try { return new Date(examDate + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return examDate; } })()}</p>
                            <a
                              className="gcal-link"
                              href={googleCalLink(t('plan_exam_event_title'), examDate, t('plan_exam_event_details'))}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <CalendarPlus size={14} /> {t('plan_add_exam_gcal')}
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {studyPlan.length === 0 && (
                  <div className="empty-state" style={{ textAlign: 'center', padding: '2.5rem', background: 'var(--surface-glass)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                    <CalendarDays size={40} style={{ color: 'var(--primary-accent)', marginBottom: '1rem' }} />
                    <p style={{ color: 'var(--text-muted)' }}>{t('plan_empty')}</p>
                  </div>
                )}
              </div>
  );
}
