import { usePortal } from '../portal/context';
import Dropdown from '../components/Dropdown';
import ReviewSession from '../components/ReviewSession';
import { t } from '../i18n';

export default function ReviewRoute() {
  const { activeSubjectId, db, flashcardSubject, setFlashcardSubject, recordStudyActivity } = usePortal();
  return (
              <div className="flashcards-view">
                <div className="view-intro">
                  <h2>{t('review_title')}</h2>
                  <p>{t('review_intro')}</p>
                </div>

                <div className="flashcards-controls">
                  <label>{t('review_topic_label')}</label>
                  <Dropdown
                    value={flashcardSubject}
                    onChange={setFlashcardSubject}
                    minWidth={220}
                    ariaLabel={t('review_topic_aria')}
                    options={[{ value: 'all', label: t('review_all_topics_mix') }, ...Object.keys(db).map((subject) => ({ value: subject, label: subject.split(' - ')[0] }))]}
                  />
                </div>

                <ReviewSession
                  key={`${activeSubjectId}:${flashcardSubject}`}
                  subjectId={activeSubjectId}
                  topicFilter={flashcardSubject}
                  onReviewed={(pts) => recordStudyActivity(pts)}
                />
              </div>
  );
}
