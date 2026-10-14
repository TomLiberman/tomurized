import { usePortal } from '../portal/context';
import Dropdown from './Dropdown';
import BackupControls from './BackupControls';
import { t, type LangSetting } from '../i18n';

// Settings body — rendered in the header popover inside a course and in a modal
// on the landing screen (so a fresh install can set the AI key before the
// first course exists). `inCourse` adds the per-course language picker.
export default function SettingsPanel({ inCourse }: { inCourse: boolean }) {
  const {
    subjectsList, renameSubject, deleteSubject, renameSubjectName, setRenameSubjectName, editingSubjectId,
    setEditingSubjectId, apiKey, setApiKey, openAiKey, setOpenAiKey, langSetting, setLangSetting, lang,
  } = usePortal();

  return (
    <>
      {subjectsList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('settings_existing_subjects')}</label>
          {subjectsList.map(sub => (
            <div key={sub.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.25rem 0.5rem', borderRadius: 'var(--r-sm)', backgroundColor: 'var(--elev-2)', border: '1px solid var(--border)' }}>
              {editingSubjectId === sub.id ? (
                <div style={{ display: 'flex', gap: '0.25rem', flex: 1 }}>
                  <input
                    type="text"
                    value={renameSubjectName}
                    onChange={(e) => setRenameSubjectName(e.target.value)}
                    style={{ flex: 1, padding: '0.25rem', fontSize: '0.8rem' }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      if (!renameSubjectName.trim()) return;
                      renameSubject(sub.id, renameSubjectName.trim());
                      setEditingSubjectId(null);
                      setRenameSubjectName('');
                    }}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    {t('settings_save')}
                  </button>
                </div>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>{sub.name}</span>
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setEditingSubjectId(sub.id);
                      setRenameSubjectName(sub.name);
                    }}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    {t('settings_edit')}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      if (confirm(t('confirm_delete_course', { name: sub.name }))) {
                        deleteSubject(sub.id); // server cascade; last course → back to the landing screen
                      }
                    }}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger)' }}
                  >
                    {t('settings_delete')}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: subjectsList.length ? '0.75rem' : 0, paddingTop: subjectsList.length ? '0.75rem' : 0, borderTop: subjectsList.length ? '1px solid var(--border)' : 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('settings_api_key_label')}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t('settings_api_key_placeholder')}
          style={{ padding: '0.5rem', fontSize: '0.85rem' }}
        />
        <p style={{ fontSize: '0.72rem', color: apiKey ? 'var(--success)' : 'var(--text-muted)', margin: 0 }}>
          {apiKey ? t('settings_api_connected') : t('settings_api_needed')}
        </p>

        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{t('settings_openai_label')}</label>
        <input
          type="password"
          value={openAiKey}
          onChange={(e) => setOpenAiKey(e.target.value)}
          placeholder={t('settings_openai_placeholder')}
          style={{ padding: '0.5rem', fontSize: '0.85rem' }}
        />
        <p style={{ fontSize: '0.72rem', color: openAiKey ? 'var(--success)' : 'var(--text-muted)', margin: 0 }}>
          {openAiKey ? t('settings_openai_active') : t('settings_openai_hint')}
        </p>
      </div>

      {inCourse && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('settings_course_lang')}</label>
          <Dropdown
            value={langSetting}
            onChange={(v) => setLangSetting(v as LangSetting)}
            ariaLabel={t('settings_course_lang')}
            options={[
              { value: 'auto', label: t('lang_auto') },
              // Language names stay in their own language (picker convention).
              { value: 'he', label: 'עברית' },
              { value: 'en', label: 'English' },
            ]}
          />
          {langSetting === 'auto' && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
              {t('settings_lang_resolved', { lang: lang === 'he' ? 'עברית' : 'English' })}
            </p>
          )}
        </div>
      )}

      <BackupControls />
    </>
  );
}
