import { useRef, useState } from 'react';
import { Download, Upload, AlertCircle, CheckCircle, ShieldCheck, Loader2 } from 'lucide-react';
import { ApiError, fetchServerLimits, MB, type ServerLimits } from '../api/client';
import { t } from '../i18n';

// Download / restore a whole-server backup (GET /api/export, POST /api/restore).
// Restore REPLACES everything, then reloads so every cached view refetches.
export default function BackupControls() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const download = async () => {
    setMsg(null);
    try {
      const res = await fetch('/api/export');
      if (!res.ok) throw new ApiError(res.status, `${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tomurized-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ kind: 'ok', text: t('backup_downloaded') });
    } catch (e) {
      setMsg({ kind: 'err', text: t('backup_export_failed', { msg: (e as Error)?.message || String(e) }) });
    }
  };

  const restore = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file || !confirm(t('confirm_restore_backup', { name: file.name }))) return;
    setBusy(true);
    setMsg({ kind: 'ok', text: t('backup_working') });
    try {
      const { maxRestoreMb } = await fetchServerLimits().catch(() => ({} as ServerLimits));
      if (maxRestoreMb && file.size > maxRestoreMb * MB) {
        throw new Error(t('err_upload_too_large', { name: file.name, size: (file.size / MB).toFixed(1), limit: maxRestoreMb }));
      }
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; restored?: { subjects: number; cards: number } };
      if (!res.ok) throw new Error(body.error || `${res.status}`);
      setMsg({ kind: 'ok', text: t('backup_restored', { subjects: body.restored?.subjects ?? 0, cards: body.restored?.cards ?? 0 }) });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setBusy(false);
      setMsg({ kind: 'err', text: t('backup_restore_failed', { msg: (e as Error)?.message || String(e) }) });
    }
  };

  const btn: React.CSSProperties = { flex: 1, fontSize: '0.8rem', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' };

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <ShieldCheck size={13} /> {t('backup_label')}
      </label>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{t('backup_hint')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button className="btn btn-outline" style={btn} onClick={() => void download()} disabled={busy}>
          <Download size={14} /> {t('backup_export')}
        </button>
        <button className="btn btn-outline" style={btn} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {t('backup_import')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => void restore(e.target.files?.[0])}
        />
      </div>
      {msg && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            marginTop: '0.5rem',
            fontSize: '0.75rem',
            color: msg.kind === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {msg.kind === 'ok' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}
