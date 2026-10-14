// Health + the global settings/progress docs.

import { Hono } from 'hono';
import { MAX_RESTORE_MB, MAX_UPLOAD_MB } from '../config.ts';
import { count, kvGet, kvSet } from '../db.ts';

export const miscRouter = new Hono();

miscRouter.get('/health', (c) =>
  c.json({
    ok: true,
    version: 2,
    // The client checks file sizes against these BEFORE uploading: an oversized
    // request is rejected before its body is read, which browsers only report
    // as a generic network error.
    limits: { maxUploadMb: MAX_UPLOAD_MB, maxRestoreMb: MAX_RESTORE_MB },
    counts: {
      subjects: count('subjects'),
      decks: count('decks'),
      cards: count('cards'),
      reviewLogs: count('review_logs'),
      materials: count('materials'),
      kvDocs: count('kv'),
    },
  })
);

// ---- Global docs -----------------------------------------------------------

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// AI keys: the browser calls the AI providers directly, so it needs them back.
// Anyone who can reach this API can read them — see README "Security".
miscRouter.get('/settings', (c) => c.json(asObject(kvGet('global:settings'))));

miscRouter.patch('/settings', async (c) => {
  const patch = asObject(await c.req.json());
  const merged = { ...asObject(kvGet('global:settings')), ...patch };
  kvSet('global:settings', merged);
  return c.json(merged);
});

miscRouter.get('/progress', (c) => c.json(asObject(kvGet('global:progress'))));

miscRouter.put('/progress', async (c) => {
  const value = asObject(await c.req.json());
  kvSet('global:progress', value);
  return c.json({ ok: true });
});
