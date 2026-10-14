import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Build stamp, logged on startup — lets us tell at a glance which build a
  // browser is actually running (the PWA service worker can lag one deploy behind).
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  // Dev server: proxy /api to the backend started by `npm run dev`
  // (scripts/dev.mjs → localhost:8080). Point TOMURIZED_API elsewhere to use
  // another server.
  server: {
    proxy: {
      '/api': process.env.TOMURIZED_API || 'http://localhost:8080',
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Tomurized — פורטל למידה',
        short_name: 'Tomurized',
        description: 'פורטל למידה חכם: חזרה מרווחת (FSRS), כרטיסיות שינון, מבחנים ומנטור AI',
        lang: 'he',
        dir: 'rtl',
        theme_color: '#0E1116',
        background_color: '#0E1116',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // NOTE: do NOT add a client.navigate()-on-activate "force reload" here —
        // it reliably wedged tabs in testing (frozen renderer). Stale clients are
        // handled by the in-page controllerchange auto-reload + hourly update().
        // Precache the app shell so FSRS review / Recall / MCQ work fully offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Never serve the app shell for API calls (let them hit network).
        navigateFallbackDenylist: [/^\/api\//],
        // Belt-and-braces: the API must never be cached by the service worker —
        // the server is the single source of truth for user data.
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
})
