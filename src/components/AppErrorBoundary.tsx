import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

interface State { error: Error | null }

// Last-resort error boundary around the whole app. Without it, any uncaught
// render error unmounts the React tree — the user sees a dead blank page with
// no explanation ("the site crashed"). This shows the actual error + recovery
// buttons, and logs it so a bug report contains something actionable.
export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[tomurized] app crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div dir="auto" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontFamily: 'inherit' }}>
        <div style={{ maxWidth: 560, width: '100%', border: '1px solid #e5484d55', borderRadius: 12, padding: '1.5rem', background: 'rgba(229,72,77,0.06)' }}>
          <h2 style={{ margin: '0 0 0.5rem' }}>😵 {t('error_title')}</h2>
          <p style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>{t('error_body')}</p>
          <pre style={{ direction: 'ltr', textAlign: 'left', fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '0.75rem', maxHeight: 180, overflowY: 'auto', margin: '0 0 1rem' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => location.reload()}
              style={{ padding: '0.6rem 1.2rem', borderRadius: 8, border: 'none', background: '#6c5ce7', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}
            >
              {t('error_reload')}
            </button>
            <button
              onClick={async () => {
                // Unregister SWs + drop caches, then reload — recovers from a
                // corrupted/stale service-worker state without touching data.
                try {
                  const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
                  await Promise.all(regs.map(r => r.unregister()));
                  const keys = await caches?.keys?.() || [];
                  await Promise.all(keys.map(k => caches.delete(k)));
                } catch { /* best effort */ }
                location.reload();
              }}
              style={{ padding: '0.6rem 1.2rem', borderRadius: 8, border: '1px solid #6c5ce7', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              {t('error_deep_reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
