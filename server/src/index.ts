// Tomurized server — the JSON API under /api plus (in production) the built
// single-page app, from one Node process.
//
// Trust model: single user, no accounts. Run it on your own machine or home
// network; do NOT expose it to the internet without an authenticating reverse
// proxy in front (see README "Security"). No CORS headers are sent on purpose:
// the app is same-origin, and a wildcard would let any website you visit read
// your data (including the stored AI keys).

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_RESTORE_MB, MAX_UPLOAD_MB } from './config.ts';
import { DATA_DIR, closeDb } from './db.ts';
import { backupRouter } from './routes/backup.ts';
import { cardsRouter } from './routes/cards.ts';
import { materialsRouter } from './routes/materials.ts';
import { miscRouter } from './routes/misc.ts';
import { subjectsRouter } from './routes/subjects.ts';

const MB = 1024 * 1024;
// Default: the Vite build output next to the server (../../dist). Set STATIC_DIR
// to serve it from elsewhere, or STATIC_DIR="" to run the API only (dev mode).
const STATIC_DIR =
  process.env.STATIC_DIR === undefined
    ? fileURLToPath(new URL('../../dist', import.meta.url))
    : process.env.STATIC_DIR && resolve(process.env.STATIC_DIR);

const app = new Hono();

app.onError((err, c) => {
  console.error(`[tomurized-api] ${c.req.method} ${c.req.path} failed:`, err);
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
});

const tooLarge = (limitMb: number) =>
  bodyLimit({
    maxSize: limitMb * MB,
    onError: (c) => c.json({ error: `request body larger than ${limitMb} MB` }, 413),
  });
const restoreLimit = tooLarge(MAX_RESTORE_MB);
const uploadLimit = tooLarge(MAX_UPLOAD_MB);
app.use('/api/*', (c, next) => (c.req.path === '/api/restore' ? restoreLimit(c, next) : uploadLimit(c, next)));

app.route('/api', subjectsRouter);
app.route('/api', cardsRouter);
app.route('/api', materialsRouter);
app.route('/api', miscRouter);
app.route('/api', backupRouter);
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

const serveApp = !!STATIC_DIR && existsSync(join(STATIC_DIR, 'index.html'));
if (serveApp) {
  app.use(
    '/*',
    serveStatic({
      root: STATIC_DIR,
      onFound: (path, c) => {
        // Hashed bundles never change; everything else (index.html, sw.js,
        // manifest) must revalidate so new deploys are picked up.
        const immutable = /[\\/]assets[\\/]/.test(path);
        c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    })
  );
  // SPA fallback (the app uses hash routing, so this is just belt-and-braces).
  app.get('*', serveStatic({ root: STATIC_DIR, path: 'index.html', onFound: (_p, c) => c.header('Cache-Control', 'no-cache') }));
}
app.notFound((c) => c.json({ error: 'not found' }, 404));

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`[tomurized] listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${info.port}`);
  console.log(`[tomurized] data directory: ${DATA_DIR}`);
  if (serveApp) console.log(`[tomurized] serving the app from ${STATIC_DIR}`);
  else if (!STATIC_DIR) console.log('[tomurized] API only (development mode — the Vite dev server serves the app)');
  else console.log(`[tomurized] API only — no built app in ${STATIC_DIR} (run \`npm run build\` to serve it)`);
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[tomurized] ${signal} — closing`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => {
    closeDb();
    process.exit(0);
  }, 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
