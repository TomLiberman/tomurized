import { usePortal } from '../portal/context';
import { AlertCircle, Flame, Gamepad2, Shield, ShoppingBag, Sparkles, Zap } from 'lucide-react';
import MemoryTile from '../components/MemoryTile';
import TopicStrengthTile from '../components/TopicStrengthTile';
import { t } from '../i18n';

export default function DashboardRoute() {
  const { activeSubjectId, scoreHistory, studyPoints, streakDays, streakShields, navigate, buyStreakShield, stats } = usePortal();
  return (
              <div className="bento-dashboard-view">
                <div className="view-intro">
                  <h2>{t('dash_title')}</h2>
                  <p>{t('dash_intro')}</p>
                </div>

                <div className="bento-grid">
                  {/* Hero Tile: Progress Gauge */}
                  <div className="bento-tile hero-tile">
                    <div className="progress-radial-wrapper">
                      <svg width="120" height="120" viewBox="0 0 120 120" className="circular-progress">
                        <circle cx="60" cy="60" r="50" className="bg-circle" />
                        <circle cx="60" cy="60" r="50" className="fg-circle" style={{
                          strokeDasharray: `${(stats.completionPercent / 100) * 314} 314`
                        }} />
                      </svg>
                      <div className="progress-percentage">
                        <span className="percent">{stats.completionPercent}%</span>
                        <span className="lbl">{t('dash_completed_lbl')}</span>
                      </div>
                    </div>

                    <div className="hero-content">
                      <h3>{t('dash_progress_title')}</h3>
                      <p>{t('dash_progress_text', { done: stats.completedCount, total: stats.totalSubjects })}</p>
                      <button className="btn btn-primary" onClick={() => navigate('/dictionary')}>
                        {t('dash_continue_learning')}
                      </button>
                    </div>
                  </div>

                  {/* Streak Tile */}
                  <div className="bento-tile streak-tile">
                    <div className="streak-icon-wrap">
                      <Flame className="streak-flame-icon active" size={48} />
                      <div className="streak-num">
                        <span className="num">{streakDays}</span>
                        <span className="lbl">{t('dash_streak_days')}</span>
                      </div>
                    </div>
                    <div className="streak-details">
                      <h3>{t('dash_streak_title')}</h3>
                      <div className="shield-display">
                        <Shield className={`shield-icon ${streakShields > 0 ? 'charged' : 'empty'}`} size={20} />
                        <span>{t('dash_shields_active', { n: streakShields })}</span>
                      </div>
                    </div>
                  </div>

                  {/* Study Points Shop Tile */}
                  <div className="bento-tile shop-tile">
                    <div className="shop-header">
                      <div className="points-display">
                        <Zap className="points-zap-icon" size={24} />
                        <span className="points-val">{studyPoints}</span>
                        <span className="points-lbl">{t('dash_points_lbl')}</span>
                      </div>
                    </div>
                    <div className="shop-buy-action">
                      <h3>{t('dash_shop_title')}</h3>
                      <p>{t('dash_shop_text')}</p>
                      <button className="btn btn-outline shop-btn" onClick={buyStreakShield} disabled={studyPoints < 50}>
                        <ShoppingBag size={16} />
                        <span>{t('dash_buy_shield')}</span>
                      </button>
                    </div>
                  </div>

                  {/* Leitner Box Status Tile */}
                  <div className="bento-tile leitner-tile">
                    <MemoryTile subjectId={activeSubjectId} />
                  </div>

                  {/* Per-topic strength/weakness Tile */}
                  <div className="bento-tile topic-strength-tile">
                    <TopicStrengthTile />
                  </div>

                  {/* Recent Exam Scores Tile */}
                  <div className="bento-tile scores-tile">
                    <h3>{t('dash_recent_exams')}</h3>
                    {scoreHistory.length > 0 ? (
                      <div className="bento-score-list">
                        {scoreHistory.slice(0, 3).map((rec) => (
                          <div className="bento-score-item" key={rec.id}>
                            <span className="subject">{rec.subject}</span>
                            <span className={`score ${rec.score >= 80 ? 'high' : rec.score >= 60 ? 'mid' : 'low'}`}>{rec.score}%</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-scores">
                        <AlertCircle size={20} />
                        <p>{t('dash_no_exams')}</p>
                      </div>
                    )}
                    <button className="btn btn-outline btn-sm btn-full" onClick={() => navigate('/exam')}>
                      {t('dash_start_exam')}
                    </button>
                  </div>

                  {/* AI Quick Study Tile */}
                  <div className="bento-tile ai-quick-tile">
                    <Sparkles className="spark-icon" size={24} />
                    <h3>{t('dash_ai_title')}</h3>
                    <p>{t('dash_ai_text')}</p>
                    <button className="btn btn-primary" onClick={() => navigate('/ai')}>
                      {t('dash_open_mentor')}
                    </button>
                  </div>

                  {/* Study Games Tile */}
                  <div className="bento-tile ai-quick-tile">
                    <Gamepad2 className="spark-icon" size={24} />
                    <h3>{t('dash_games_title')}</h3>
                    <p>{t('dash_games_text')}</p>
                    <button className="btn btn-primary" onClick={() => navigate('/games')}>
                      {t('dash_to_games')}
                    </button>
                  </div>
                </div>
              </div>
  );
}
