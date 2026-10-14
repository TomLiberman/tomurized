import { useState } from 'react';
import { usePortal } from '../portal/context';
import { AlertCircle, Search, RefreshCw, Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import Dropdown from '../components/Dropdown';
import DeckReviewGate from '../components/DeckReviewGate';
import CardEditModal, { type CardEditTarget } from '../components/CardEditModal';
import { t } from '../i18n';

export default function DictionaryRoute() {
  const { db, completedSubjects, searchQuery, setSearchQuery, selectedTheoryFilter, setSelectedTheoryFilter, navigate, toggleSubjectCompleted, highlightSearch, regenerateTopic, regeneratingTopic, removeCard } = usePortal();
  const [editCard, setEditCard] = useState<CardEditTarget | null>(null);

  const openAdd = (topic = '') =>
    setEditCard({ topic: topic || (selectedTheoryFilter !== 'all' ? selectedTheoryFilter : ''), term: '', definition: '' });

  return (
              <div className="dictionary-view">
                <DeckReviewGate />
                {editCard && <CardEditModal target={editCard} onClose={() => setEditCard(null)} />}
                <div className="view-intro">
                  <h2>{t('dict_title')}</h2>
                  <p>{t('dict_intro')}</p>
                </div>

                <div className="filter-bar">
                  <div className="search-input-wrapper">
                    <Search size={18} className="search-icon" />
                    <input
                      type="text"
                      placeholder={t('dict_search_placeholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <Dropdown
                    value={selectedTheoryFilter}
                    onChange={setSelectedTheoryFilter}
                    minWidth={200}
                    ariaLabel={t('dict_filter_aria')}
                    options={[{ value: 'all', label: t('dict_all_topics') }, ...Object.keys(db).map((subject) => ({ value: subject, label: subject.split(' - ')[0] }))]}
                  />

                  <button
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}
                    onClick={() => openAdd()}
                  >
                    <Plus size={16} /> {t('dict_add_card')}
                  </button>
                </div>

                <div className="subjects-list">
                  {Object.keys(db).length === 0 ? (
                    <div className="empty-state" style={{ textAlign: 'center', padding: '3rem', background: 'var(--surface-glass)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
                      <AlertCircle size={40} style={{ color: 'var(--warning)', marginBottom: '1rem', display: 'inline-block' }} />
                      <h3>{t('dict_empty_title')}</h3>
                      <p style={{ color: 'var(--text-muted)' }}>{t('dict_empty_text')}</p>
                      <button className="btn btn-primary" onClick={() => navigate('/loader')} style={{ marginTop: '1rem' }}>
                        {t('dict_upload_btn')}
                      </button>
                    </div>
                  ) : (
                    Object.entries(db).map(([subject, terms], subIdx) => {
                      if (selectedTheoryFilter !== 'all' && selectedTheoryFilter !== subject) {
                      return null;
                    }

                    const filteredTerms = terms.filter(t =>
                      t.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      t.definition.toLowerCase().includes(searchQuery.toLowerCase())
                    );

                    if (searchQuery && filteredTerms.length === 0) {
                      return null;
                    }

                    const isCompleted = !!completedSubjects[subject];

                    return (
                      <div className={`subject-section-card ${isCompleted ? 'completed' : ''}`} key={subIdx}>
                        <div className="subject-header">
                          <div className="subject-title-area">
                            <h2>{subject}</h2>
                            <span className="badge-count">{t('dict_terms_count', { n: terms.length })}</span>
                            <button
                              className="btn-icon"
                              title={t('dict_add_to_topic')}
                              onClick={() => openAdd(subject)}
                            >
                              <Plus size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              title={t('dict_regen_title')}
                              disabled={regeneratingTopic !== null}
                              onClick={() => {
                                if (window.confirm(t('confirm_regen_topic', { topic: subject }))) {
                                  void regenerateTopic(subject);
                                }
                              }}
                            >
                              {regeneratingTopic === subject ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                            </button>
                          </div>

                          <label className="checkbox-completed-wrapper">
                            <input
                              type="checkbox"
                              checked={isCompleted}
                              onChange={() => toggleSubjectCompleted(subject)}
                            />
                            <span className="custom-checkbox"></span>
                            <span className="label-text">{t('dict_done_learning')}</span>
                          </label>
                        </div>

                        <table className="dictionary-table">
                          <thead>
                            <tr>
                              <th>{t('dict_th_term')}</th>
                              <th>{t('dict_th_def')}</th>
                              <th className="actions-th" aria-label=""></th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTerms.map((t2, termIdx) => (
                              <tr key={termIdx}>
                                <td className="term-cell">
                                  <strong>{highlightSearch(t2.term, searchQuery)}</strong>
                                </td>
                                <td className="def-cell">
                                  {highlightSearch(t2.definition, searchQuery)}
                                </td>
                                <td className="actions-cell">
                                  <div className="card-row-actions">
                                    <button
                                      className="card-action-btn"
                                      title={t('dict_edit_card')}
                                      onClick={() => setEditCard({ topic: subject, term: t2.term, definition: t2.definition, original: { topic: subject, term: t2.term } })}
                                    >
                                      <Pencil size={13} />
                                    </button>
                                    <button
                                      className="card-action-btn danger"
                                      title={t('dict_delete_card')}
                                      onClick={() => {
                                        if (window.confirm(t('confirm_delete_card', { term: t2.term }))) {
                                          removeCard(subject, t2.term);
                                        }
                                      }}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })
                )}
                </div>
              </div>
  );
}
