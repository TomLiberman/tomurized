// Manual card add/edit modal for the dictionary ("הוספה, הורדה ועריכה של
// כרטיסיות ידנית"). Topic is free text with existing topics as suggestions —
// typing a new name creates that topic on save.

import { useState } from 'react';
import { X, Save } from 'lucide-react';
import { t } from '../i18n';
import { usePortal } from '../portal/context';

export interface CardEditTarget {
  topic: string;
  term: string;
  definition: string;
  /** The card being edited (old topic/term); absent for a new card. */
  original?: { topic: string; term: string };
}

export default function CardEditModal({ target, onClose }: { target: CardEditTarget; onClose: () => void }) {
  const { db, saveCard } = usePortal();
  const [topic, setTopic] = useState(target.topic);
  const [term, setTerm] = useState(target.term);
  const [definition, setDefinition] = useState(target.definition);
  const isEdit = !!target.original;
  const canSave = topic.trim() && term.trim();

  const save = () => {
    if (!canSave) return;
    if (saveCard({ topic, term, definition, original: target.original })) onClose();
  };

  return (
    <div className="create-modal-backdrop" onClick={onClose}>
      <div className="create-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="create-modal-head">
          <h3>{isEdit ? t('card_modal_title_edit') : t('card_modal_title_add')}</h3>
          <button className="btn-icon" onClick={onClose} title={t('card_cancel')}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {t('card_topic_label')}
            <input
              className="create-name-input"
              style={{ width: '100%', marginTop: '0.25rem', boxSizing: 'border-box' }}
              list="card-topic-options"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t('card_topic_placeholder')}
            />
            <datalist id="card-topic-options">
              {Object.keys(db).map((topicName) => <option key={topicName} value={topicName} />)}
            </datalist>
          </label>

          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {t('card_term_label')}
            <input
              className="create-name-input"
              style={{ width: '100%', marginTop: '0.25rem', boxSizing: 'border-box' }}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('card_term_placeholder')}
              autoFocus={!isEdit}
            />
          </label>

          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {t('card_def_label')}
            <textarea
              className="create-name-input"
              style={{ width: '100%', marginTop: '0.25rem', minHeight: 120, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5 }}
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder={t('card_def_placeholder')}
            />
          </label>

          {isEdit && target.original!.term !== term.trim() && term.trim() && (
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', margin: 0 }}>
              {t('card_rename_warning')}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              disabled={!canSave}
              onClick={save}
            >
              <Save size={16} /> {t('card_save')}
            </button>
            <button className="btn btn-outline" onClick={onClose}>{t('card_cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
