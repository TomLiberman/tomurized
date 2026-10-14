import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { QueryClientProvider } from '@tanstack/react-query'
import './styles/tailwind.css'
import './index.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
import { queryClient } from './api/queryClient'

// Build stamp (injected by vite define) — check the console / window.__TOMURIZED_BUILD
// to know which deploy a browser is actually running.
declare const __BUILD_ID__: string
console.info(`[tomurized] build ${__BUILD_ID__}`)
;(window as unknown as Record<string, unknown>).__TOMURIZED_BUILD = __BUILD_ID__

// PWA: register via the virtual module (not the plain injected script) so that in
// autoUpdate mode a freshly deployed build RELOADS open tabs as soon as the new
// service worker takes control — otherwise users are stuck one deploy behind
// until they happen to hard-refresh. The hourly update() covers long-lived tabs
// and installed-PWA windows, which otherwise only check for a new SW on
// navigation (hash-route changes never count as navigations).
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
  },
})

// DirectionProvider now lives inside App (dynamic per-course direction).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
