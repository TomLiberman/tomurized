import { usePortal } from '../portal/context';
import { AlertCircle, CheckCircle } from 'lucide-react';
import CalibrationPanel from '../components/CalibrationPanel';
import { t } from '../i18n';

export default function ProgressRoute() {
  const { activeSubjectId, db, completedSubjects, scoreHistory, toggleSubjectCompleted } = usePortal();
  return (
              <div className="progress-view">
                <div className="view-intro">
                  <h2>{t('progress_title')}</h2>
                  <p>{t('progress_intro')}</p>
                </div>

                <div className="progress-grid">
                  <CalibrationPanel subjectId={activeSubjectId} />
                  <div className="progress-card-detail">
                    <h3>{t('progress_completed_topics')}</h3>
                    <div className="subject-checkboxes-grid">
                      {Object.keys(db).map((subject, idx) => {
                        const isCompleted = !!completedSubjects[subject];
                        return (
                          <div
                            key={idx}
                            className={`subject-checkbox-item ${isCompleted ? 'checked' : ''}`}
                            onClick={() => toggleSubjectCompleted(subject)}
                          >
                            {isCompleted ? <CheckCircle size={20} className="icon success" /> : <div className="square-placeholder"></div>}
                            <span>{subject}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="progress-card-detail">
                    <h3>{t('progress_exam_history')}</h3>
                    {scoreHistory.length > 0 ? (
                      <div className="score-records-list">
                        {scoreHistory.map((rec) => (
                          <div className="score-record-item" key={rec.id}>
                            <div className="record-info">
                              <span className="subject-tag">{rec.subject}</span>
                              <span className="timestamp">{rec.timestamp}</span>
                            </div>
                            <div className={`record-score ${rec.score >= 80 ? 'high' : rec.score >= 60 ? 'mid' : 'low'}`}>
                              {rec.score}%
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-scores">
                        <AlertCircle size={24} />
                        <p>{t('progress_no_exams')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
  );
}
