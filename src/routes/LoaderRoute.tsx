import { useState } from 'react';
import { usePortal } from '../portal/context';
import { AlertCircle, BookOpen, ClipboardList, Download, File, FileQuestion, GraduationCap, RefreshCw, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import MarkdownText from '../components/MarkdownText';
import DeckReviewGate from '../components/DeckReviewGate';
import Dropdown from '../components/Dropdown';
import type { MaterialCategory } from '../data/materials';
import { t, type StringKey } from '../i18n';

// Labels are t() KEYS (resolved at render time so a language switch re-labels).
const CATEGORY_META: Record<MaterialCategory, { labelKey: StringKey; icon: typeof BookOpen }> = {
  summary: { labelKey: 'loader_cat_summary', icon: BookOpen },
  syllabus: { labelKey: 'loader_cat_syllabus', icon: ClipboardList },
  past_exam: { labelKey: 'loader_cat_past_exam', icon: FileQuestion },
  other: { labelKey: 'loader_cat_other', icon: File },
};
const CATEGORY_ORDER: MaterialCategory[] = ['summary', 'syllabus', 'past_exam', 'other'];

// The course's single materials hub: upload everything here; the AI categorizes
// each file (with manual override). Deck building, the AI mentor/chat and the
// exam generator all read from this library. NOTE: the full extracted text is
// deliberately never rendered — multi-MB RTL text in a textarea froze the tab.
export default function LoaderRoute() {
  const { library, setMaterialCategory, removeMaterial, addPastedText, customContext, jsonPasteText, setJsonPasteText, fileParsing, fileError, isDragging, setIsDragging, deckGenerating, deckOverview, buildSubjectName, setBuildSubjectName, fileInputRef, handleLoadCustomJson, handleFiles, handleBuildDeck, regenerateWholeDeck } = usePortal();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  const categoryOptions = CATEGORY_ORDER.map((c) => ({ value: c, label: t(CATEGORY_META[c].labelKey) }));

  const savePaste = async () => {
    if (!pasteText.trim()) return;
    setPasting(true);
    try {
      await addPastedText(pasteText);
      setPasteText('');
      setPasteOpen(false);
    } finally {
      setPasting(false);
    }
  };

  return (
              <div className="loader-view">
                <DeckReviewGate />
                <div className="view-intro">
                  <h2>{t('loader_title')}</h2>
                  <p>{t('loader_intro')}</p>
                </div>

                {/* AI auto-build deck (syllabus -> flashcards) */}
                <div className="deck-builder-card">
                  <div className="deck-builder-head">
                    <Wand2 size={22} />
                    <div>
                      <h3>{t('loader_deck_builder_title')}</h3>
                      <p className="hint-text">
                        {t('loader_deck_builder_hint')}
                      </p>
                    </div>
                  </div>

                  <div className="deck-builder-controls">
                    <input
                      type="text"
                      placeholder={t('loader_new_subject_placeholder')}
                      value={buildSubjectName}
                      onChange={(e) => setBuildSubjectName(e.target.value)}
                      disabled={deckGenerating}
                    />
                    <button className="btn btn-primary" onClick={handleBuildDeck} disabled={deckGenerating || !customContext.trim()}>
                      {deckGenerating ? (
                        <><RefreshCw size={16} className="spin" /> <span>{t('loader_building')}</span></>
                      ) : (
                        <><GraduationCap size={16} /> <span>{t('loader_build_btn')}</span></>
                      )}
                    </button>
                    <button
                      className="btn btn-outline"
                      title={t('loader_regen_title')}
                      onClick={() => void regenerateWholeDeck()}
                      disabled={deckGenerating || !customContext.trim()}
                    >
                      <RefreshCw size={16} /> <span>{t('loader_regen_btn')}</span>
                    </button>
                  </div>

                  {!customContext.trim() && (
                    <p className="deck-builder-note"><AlertCircle size={14} /> {t('loader_upload_to_enable')}</p>
                  )}
                  {deckOverview && (
                    <div className="deck-overview">
                      <strong>{t('loader_course_overview')}</strong>
                      <MarkdownText>{deckOverview}</MarkdownText>
                    </div>
                  )}
                </div>

                <div className="loader-workspace-panels">
                  <div className="loader-card">
                    <h3>{t('loader_library_title')}</h3>
                    <p className="hint-text">{t('loader_library_hint')}</p>

                    {/* File upload dropzone */}
                    <div
                      className={`file-dropzone ${isDragging ? 'dragging' : ''} ${fileParsing ? 'busy' : ''}`}
                      onClick={() => { if (!fileParsing) fileInputRef.current?.click(); }}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
                      role="button"
                      tabIndex={0}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.rtf"
                        style={{ display: 'none' }}
                        onChange={(e) => handleFiles(e.target.files)}
                      />
                      {fileParsing ? (
                        <div className="dz-inner">
                          <RefreshCw size={26} className="spin" />
                          <span className="dz-title">{t('loader_extracting')}</span>
                        </div>
                      ) : (
                        <div className="dz-inner">
                          <Upload size={26} />
                          <span className="dz-title">{t('loader_dropzone_title')}</span>
                          <span className="dz-sub">{t('loader_dropzone_sub')}</span>
                        </div>
                      )}
                    </div>

                    {fileError && (
                      <div className="file-error">
                        <AlertCircle size={14} />
                        <span>{fileError}</span>
                      </div>
                    )}

                    {/* Library, grouped by category */}
                    {library.length === 0 ? (
                      <p className="hint-text" style={{ textAlign: 'center', padding: '0.75rem 0' }}>{t('loader_library_empty')}</p>
                    ) : (
                      CATEGORY_ORDER.map((cat) => {
                        const items = library.filter((m) => m.category === cat);
                        if (!items.length) return null;
                        const Icon = CATEGORY_META[cat].icon;
                        return (
                          <div className="material-group" key={cat}>
                            <h4 className="material-group-title"><Icon size={15} /> {t(CATEGORY_META[cat].labelKey)} <span className="badge-count">{items.length}</span></h4>
                            <ul className="material-list">
                              {items.map((m) => (
                                <li className="material-row" key={m.id}>
                                  <span className="material-name" title={m.name} dir="auto">{m.name}</span>
                                  <span className="material-size">{t('loader_chars_k', { n: Math.max(1, Math.round(m.text.length / 1000)) })}</span>
                                  {m.autoCategorized && <span className="material-auto" title={t('loader_auto_categorized')}>🤖</span>}
                                  {m.hasFile && (
                                    <a
                                      className="btn-icon"
                                      href={`/api/materials/${encodeURIComponent(m.id)}/file`}
                                      download
                                      title={t('loader_download_original')}
                                      aria-label={t('loader_download_original')}
                                    >
                                      <Download size={14} />
                                    </a>
                                  )}
                                  <Dropdown
                                    value={m.category}
                                    onChange={(v) => setMaterialCategory(m.id, v as MaterialCategory)}
                                    options={categoryOptions}
                                    minWidth={130}
                                    ariaLabel={t('loader_category_of', { name: m.name })}
                                  />
                                  <button
                                    className="btn-icon"
                                    title={t('loader_delete_title')}
                                    onClick={() => { if (confirm(t('confirm_delete_material', { name: m.name }))) removeMaterial(m.id); }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })
                    )}

                    {/* Paste raw text as a library item */}
                    {pasteOpen ? (
                      <div className="paste-box">
                        <textarea
                          placeholder={t('loader_paste_placeholder')}
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                          rows={5}
                        ></textarea>
                        <div className="loader-actions">
                          <button className="btn btn-primary btn-sm" onClick={() => void savePaste()} disabled={pasting || !pasteText.trim()}>
                            {pasting ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} {t('loader_paste_add')}
                          </button>
                          <button className="btn btn-outline btn-sm" onClick={() => { setPasteOpen(false); setPasteText(''); }}>{t('loader_paste_cancel')}</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-outline btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setPasteOpen(true)}>
                        {t('loader_paste_open')}
                      </button>
                    )}
                  </div>

                  <div className="loader-card">
                    <h3>{t('loader_json_title')}</h3>
                    <p className="hint-text">{t('loader_json_hint')}</p>
                    <textarea
                      placeholder={t('loader_json_placeholder')}
                      value={jsonPasteText}
                      onChange={(e) => setJsonPasteText(e.target.value)}
                      rows={6}
                      style={{ fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}
                    ></textarea>

                    <div className="loader-actions" style={{ display: 'flex', gap: '0.75rem' }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleLoadCustomJson(false)}
                        disabled={!jsonPasteText.trim()}
                      >
                        {t('loader_json_merge')}
                      </button>
                      <button
                        className="btn btn-outline"
                        onClick={() => handleLoadCustomJson(true)}
                        disabled={!jsonPasteText.trim()}
                        style={{ borderColor: 'var(--primary-accent)', color: 'var(--primary-accent)' }}
                      >
                        {t('loader_json_new')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
  );
}
