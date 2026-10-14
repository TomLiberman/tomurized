import { useState, useRef } from 'react';
import { motion, type Variants } from 'framer-motion';
import { AlertCircle, ChevronLeft, FilePlus, FileText, GraduationCap, Plus, RefreshCw, Settings, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { extractTextFromFile } from '../lib/textExtract';
import type { SubjectEntry } from '../lib/types';
import SettingsPanel from '../components/SettingsPanel';
import { useGuard } from '../lib/useGuard';
import { t } from '../i18n';

// --- Landing / Home screen ("Tomurized") animation variants ---
const BRAND = 'Tomurized';

const wordmarkV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } }
};

const letterV: Variants = {
  hidden: { y: 55, opacity: 0, rotateX: -90 },
  show: { y: 0, opacity: 1, rotateX: 0, transition: { type: 'spring', damping: 12, stiffness: 180 } }
};

const contentV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } }
};

const fadeUpV: Variants = {
  hidden: { y: 24, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.5, ease: 'easeOut' } }
};

export default function LandingScreen({
  subjects,
  onEnter,
  onCreateCourse,
  onCreateEmpty,
  apiKey,
  onApiKeyChange,
}: {
  subjects: SubjectEntry[];
  onEnter: (id: string) => void;
  onCreateCourse: (name: string, files: { name: string; text: string; file: File }[]) => Promise<void>;
  onCreateEmpty: (name: string) => Promise<void>;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'building' | 'empty'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const creating = phase !== 'idle';
  const guard = useGuard(); // double-click must not create the course twice
  // Captured when the dialog opens: the key field stays visible while typing
  // instead of vanishing after the first character.
  const [askForKey, setAskForKey] = useState(false);

  const openCreate = () => {
    setAskForKey(!apiKey);
    setShowCreate(true);
    setError('');
  };

  const handleCreateEmpty = async () => {
    if (creating) return;
    if (!courseName.trim()) { setError(t('landing_err_name')); return; }
    setError('');
    setPhase('empty');
    try {
      await onCreateEmpty(courseName.trim());
    } catch (e: any) {
      setError(e?.message || String(e));
      setPhase('idle');
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    setFiles(prev => [...prev, ...Array.from(list)]);
    setError('');
  };

  const handleCreate = async () => {
    if (creating) return;
    if (!courseName.trim()) { setError(t('landing_err_name')); return; }
    if (!files.length) { setError(t('landing_err_files')); return; }
    setError('');
    setPhase('extracting');
    try {
      const extracted: { name: string; text: string; file: File }[] = [];
      const skipped: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(t('landing_extracting', { name: files[i].name, i: i + 1, total: files.length }));
        try {
          const text = await extractTextFromFile(files[i]);
          if (text && text.trim()) extracted.push({ name: files[i].name, text: text.trim(), file: files[i] });
          else skipped.push(files[i].name);
        } catch {
          skipped.push(files[i].name);
        }
      }
      if (!extracted.length) throw new Error(t('landing_err_extract'));
      // Say which files won't be used (scanned PDFs, old .doc…) instead of silently dropping them.
      if (skipped.length && !confirm(t('landing_skipped_files', { names: skipped.join('\n') }))) {
        setPhase('idle');
        setProgress('');
        return;
      }
      setPhase('building');
      setProgress(t('landing_building'));
      await onCreateCourse(courseName.trim(), extracted);
      // success → parent enters the new course's portal and this component unmounts
    } catch (e: any) {
      setError(e?.message || String(e));
      setPhase('idle');
      setProgress('');
    }
  };

  return (
    <div className="landing-screen">
      <button
        className="btn-icon landing-settings-btn"
        onClick={() => setShowSettings(true)}
        title={t('landing_settings')}
        aria-label={t('landing_settings')}
      >
        <Settings size={18} />
      </button>

      <div className="landing-orbs" aria-hidden="true">
        <motion.span className="orb orb-1" animate={{ x: [0, 40, 0], y: [0, -30, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.span className="orb orb-2" animate={{ x: [0, -50, 0], y: [0, 40, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.span className="orb orb-3" animate={{ x: [0, 30, 0], y: [0, 50, 0] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <motion.div className="landing-content" variants={contentV} initial="hidden" animate="show">
        <motion.div className="landing-badge" variants={fadeUpV}>
          <Sparkles size={15} />
          <span>{t('landing_badge')}</span>
        </motion.div>

        <motion.h1 className="landing-wordmark" aria-label={BRAND} variants={wordmarkV}>
          {BRAND.split('').map((ch, i) => (
            <motion.span className="wm-letter" key={i} variants={letterV}>
              {ch}
            </motion.span>
          ))}
        </motion.h1>

        <motion.p className="landing-tagline" variants={fadeUpV}>
          {t('landing_tagline')}
        </motion.p>

        <motion.h2 className="landing-choose" variants={fadeUpV}>
          {subjects.length ? t('landing_choose') : t('landing_choose_first')}
        </motion.h2>

        <motion.div className="landing-subjects" variants={fadeUpV}>
          {subjects.map((sub, i) => (
            <motion.button
              className="landing-subject-card"
              key={sub.id}
              onClick={() => onEnter(sub.id)}
              whileHover={{ y: -6, scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 + i * 0.08 }}
            >
              <GraduationCap size={30} />
              <span className="ls-name" dir="auto">{sub.name}</span>
              <span className="ls-go">{t('landing_enter')} <ChevronLeft size={15} /></span>
            </motion.button>
          ))}

          {/* Create a new course from files */}
          <motion.button
            className="landing-subject-card create-course-card"
            onClick={openCreate}
            whileHover={{ y: -6, scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 + subjects.length * 0.08 }}
          >
            <Plus size={30} />
            <span className="ls-name">{t('landing_create_course')}</span>
            <span className="ls-go">{t('landing_create_sub')}</span>
          </motion.button>
        </motion.div>
      </motion.div>

      <motion.div className="landing-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}>
        {t('landing_footer')}
      </motion.div>

      {/* Create-course modal */}
      {showCreate && (
        <div className="create-modal-backdrop" onClick={() => { if (!creating) setShowCreate(false); }}>
          <div className="create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="create-modal-head">
              <h3><Wand2 size={20} /> {t('landing_create_course')}</h3>
              {!creating && (
                <button className="btn-icon" onClick={() => setShowCreate(false)} title={t('landing_close')}>
                  <X size={18} />
                </button>
              )}
            </div>
            <p className="create-modal-sub">
              {t('landing_modal_sub')}
            </p>

            <input
              className="create-name-input"
              type="text"
              placeholder={t('landing_name_placeholder')}
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              disabled={creating}
            />

            {askForKey && (
              <label className="create-key-field">
                <span>{t('landing_ai_key_label')}</span>
                <input
                  className="create-name-input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value.trim())}
                  placeholder={t('settings_api_key_placeholder')}
                  disabled={creating}
                  autoComplete="off"
                />
                <small>{t('landing_ai_key_hint')}</small>
              </label>
            )}

            <div
              className={`file-dropzone ${dragging ? 'dragging' : ''} ${creating ? 'busy' : ''}`}
              onClick={() => { if (!creating) inputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); if (!creating) setDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
              onDrop={(e) => { e.preventDefault(); setDragging(false); if (!creating) addFiles(e.dataTransfer.files); }}
              role="button"
              tabIndex={0}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.rtf"
                style={{ display: 'none' }}
                onChange={(e) => addFiles(e.target.files)}
              />
              <div className="dz-inner">
                <Upload size={26} />
                <span className="dz-title">{t('landing_dropzone_title')}</span>
                <span className="dz-sub">{t('landing_dropzone_sub')}</span>
              </div>
            </div>

            {files.length > 0 && (
              <div className="uploaded-files">
                {files.map((f, i) => (
                  <span className="file-chip" key={i}>
                    <FileText size={13} />
                    <span className="chip-name">{f.name}</span>
                    {!creating && (
                      <button className="chip-x" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} title={t('landing_remove_file')}>
                        <X size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            {error && (
              <div className="file-error"><AlertCircle size={14} /><span>{error}</span></div>
            )}

            {creating ? (
              <div className="create-progress">
                <RefreshCw size={18} className="spin" />
                <span>{phase === 'empty' ? '' : progress}</span>
              </div>
            ) : (
              <>
                <button className="btn btn-primary create-build-btn" onClick={() => void guard(handleCreate)} disabled={!apiKey} title={!apiKey ? t('api_key_required') : undefined}>
                  <GraduationCap size={18} /> {t('landing_build_btn')}
                </button>
                <div className="create-or"><span>{t('landing_or')}</span></div>
                <button className="btn btn-outline create-build-btn" onClick={() => void guard(handleCreateEmpty)}>
                  <FilePlus size={18} /> {t('landing_empty_course_btn')}
                </button>
                <p className="create-empty-hint">{t('landing_empty_course_hint')}</p>
              </>
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="create-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="create-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="create-modal-head">
              <h3><Settings size={20} /> {t('settings_title')}</h3>
              <button className="btn-icon" onClick={() => setShowSettings(false)} title={t('common_close')}>
                <X size={18} />
              </button>
            </div>
            <SettingsPanel inCourse={false} />
          </div>
        </div>
      )}
    </div>
  );
}

