import { useState } from 'react';
import { X, Check, Trash2, Wand2, RotateCcw } from 'lucide-react';
import { usePortal } from '../portal/context';
import { t } from '../i18n';

// Quality gate: review the AI-generated deck (remove wrong cards) before it's saved.
export default function DeckReviewGate() {
  const { pendingDeck, confirmPendingDeck, confirmingDeck, discardPendingDeck } = usePortal();
  // Removals are positional ("part:card"), so they belong to ONE generated deck:
  // a new pendingDeck starts clean (they used to carry over and silently drop
  // the same positions from the next deck).
  const [removal, setRemoval] = useState<{ deck: unknown; keys: Set<string> }>({ deck: null, keys: new Set() });
  if (!pendingDeck) return null;
  if (removal.deck !== pendingDeck.deck) setRemoval({ deck: pendingDeck.deck, keys: new Set() });
  const removed = removal.deck === pendingDeck.deck ? removal.keys : new Set<string>();

  const { deck, targetName } = pendingDeck;
  const keyOf = (pi: number, ci: number) => `${pi}:${ci}`;
  const toggle = (k: string) =>
    setRemoval((prev) => {
      const n = new Set(prev.keys);
      if (n.has(k)) n.delete(k); else n.add(k);
      return { deck: prev.deck, keys: n };
    });

  const remaining = deck.parts.reduce((s, p, pi) => s + p.cards.filter((_, ci) => !removed.has(keyOf(pi, ci))).length, 0);

  const confirm = () => {
    void confirmPendingDeck(
      {
        courseOverview: deck.courseOverview,
        parts: deck.parts
          .map((p, pi) => ({ title: p.title, cards: p.cards.filter((_, ci) => !removed.has(keyOf(pi, ci))) }))
          .filter((p) => p.cards.length),
      },
      targetName
    );
  };

  return (
    <div className="create-modal-backdrop">
      <div className="create-modal" style={{ maxWidth: 660, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="create-modal-head">
          <h3><Wand2 size={20} /> {t('gate_title')}</h3>
          <button className="btn-icon" onClick={discardPendingDeck} title={t('gate_cancel')}><X size={18} /></button>
        </div>
        <p className="create-modal-sub">
          {t('gate_sub', { cards: remaining, parts: deck.parts.length, target: targetName ? t('gate_sub_target', { name: targetName }) : '' })}
        </p>
        {(pendingDeck.mode === 'replace-topic' || pendingDeck.mode === 'replace-subject') && (
          <p className="create-modal-sub" style={{ color: 'var(--warning)' }}>
            {t('gate_replace_warn', { what: pendingDeck.mode === 'replace-topic' ? t('gate_replace_topic', { topic: pendingDeck.replaceTopic ?? '' }) : t('gate_replace_all') })}
          </p>
        )}

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', paddingInlineEnd: '0.25rem' }}>
          {deck.parts.map((p, pi) => (
            <div key={pi}>
              <h4 style={{ margin: '0 0 0.5rem', color: 'var(--text-main)', fontSize: '0.95rem' }}>{p.title}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {p.cards.map((c, ci) => {
                  const k = keyOf(pi, ci);
                  const isRemoved = removed.has(k);
                  return (
                    <div key={ci} style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--surface-bg)', opacity: isRemoved ? 0.45 : 1 }}>
                      <div style={{ flex: 1 }}>
                        <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem', textDecoration: isRemoved ? 'line-through' : 'none' }}>{c.term}</strong>
                        <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.83rem', lineHeight: 1.55 }}>{c.definition}</p>
                      </div>
                      <button onClick={() => toggle(k)} title={isRemoved ? t('gate_restore') : t('gate_remove')} style={{ background: 'transparent', border: 'none', color: isRemoved ? 'var(--success)' : 'var(--danger)', cursor: 'pointer', alignSelf: 'flex-start', padding: 0, display: 'flex' }}>
                        {isRemoved ? <RotateCcw size={15} /> : <Trash2 size={15} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={confirm} disabled={remaining === 0 || confirmingDeck} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Check size={16} /> {t('gate_confirm', { n: remaining })}
          </button>
          <button className="btn btn-outline" onClick={discardPendingDeck} disabled={confirmingDeck}>{t('gate_cancel')}</button>
        </div>
      </div>
    </div>
  );
}
