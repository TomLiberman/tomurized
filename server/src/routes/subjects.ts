// Subjects CRUD + per-subject deck (JSON blob) + per-subject small kv docs.

import { Hono } from 'hono';
import { db, kvGet, kvSet, nowIso, tx } from '../db.ts';
import { deleteOriginal } from '../files.ts';

export const subjectsRouter = new Hono();

const SUBJECT_KV_KEYS = new Set(['chat', 'plan', 'meta', 'scores']);
export const SUBJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface SubjectRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

subjectsRouter.get('/subjects', (c) => {
  const rows = db
    .prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM subjects ORDER BY created_at')
    .all() as unknown as SubjectRow[];
  return c.json(rows);
});

subjectsRouter.post('/subjects', async (c) => {
  const body = (await c.req.json()) as { id?: unknown; name?: unknown; deck?: unknown };
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `subject_${Date.now()}`;
  // Ids appear in URLs and kv keys — keep them to a plain, URL-safe alphabet.
  if (!SUBJECT_ID_RE.test(id)) return c.json({ error: 'invalid subject id' }, 400);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : id;
  const now = nowIso();
  tx(() => {
    db.prepare(
      `INSERT INTO subjects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
    ).run(id, name, now, now);
    if (body.deck && typeof body.deck === 'object') {
      db.prepare(
        `INSERT INTO decks (subject_id, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      ).run(id, JSON.stringify(body.deck), now);
    }
  });
  return c.json({ id, name }, 201);
});

subjectsRouter.patch('/subjects/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as { name?: unknown };
  if (typeof body.name !== 'string' || !body.name.trim()) return c.json({ error: 'name required' }, 400);
  const result = db
    .prepare('UPDATE subjects SET name = ?, updated_at = ? WHERE id = ?')
    .run(body.name.trim(), nowIso(), id);
  if (result.changes === 0) return c.json({ error: 'subject not found' }, 404);
  return c.json({ id, name: body.name.trim() });
});

subjectsRouter.delete('/subjects/:id', (c) => {
  const id = c.req.param('id');
  const filePaths = db
    .prepare('SELECT file_path AS filePath FROM materials WHERE subject_id = ? AND file_path IS NOT NULL')
    .all(id) as unknown as { filePath: string }[];
  const deleted = tx(() => {
    // review_logs kept on purpose (append-only history survives course deletion,
    // matching the app's existing behavior for removed terms).
    const res = db.prepare('DELETE FROM subjects WHERE id = ?').run(id); // cascades decks/cards/materials
    // Exact prefix match — LIKE would treat "_" / "%" in course ids as wildcards
    // and could delete another course's docs.
    const prefix = `subject:${id}:`;
    db.prepare('DELETE FROM kv WHERE substr(key, 1, length(?)) = ?').run(prefix, prefix);
    return res.changes > 0;
  });
  if (!deleted) return c.json({ error: 'subject not found' }, 404);
  for (const f of filePaths) deleteOriginal(f.filePath);
  return c.json({ ok: true });
});

// ---- Deck -----------------------------------------------------------------

subjectsRouter.get('/subjects/:id/deck', (c) => {
  const row = db.prepare('SELECT json FROM decks WHERE subject_id = ?').get(c.req.param('id')) as
    | { json: string }
    | undefined;
  if (!row) return c.json(null);
  try {
    return c.json(JSON.parse(row.json));
  } catch {
    return c.json(null);
  }
});

subjectsRouter.put('/subjects/:id/deck', async (c) => {
  const id = c.req.param('id');
  const exists = db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(id);
  if (!exists) return c.json({ error: 'subject not found' }, 404);
  const deck = (await c.req.json()) as unknown;
  if (!deck || typeof deck !== 'object' || Array.isArray(deck)) {
    return c.json({ error: 'deck must be a JSON object' }, 400);
  }
  db.prepare(
    `INSERT INTO decks (subject_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(subject_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(id, JSON.stringify(deck), nowIso());
  return c.json({ ok: true });
});

// ---- Per-subject kv docs (chat | plan | meta | scores) ---------------------

subjectsRouter.get('/subjects/:id/kv/:key', (c) => {
  const key = c.req.param('key');
  if (!SUBJECT_KV_KEYS.has(key)) return c.json({ error: 'unknown key' }, 404);
  return c.json(kvGet(`subject:${c.req.param('id')}:${key}`));
});

subjectsRouter.put('/subjects/:id/kv/:key', async (c) => {
  const key = c.req.param('key');
  if (!SUBJECT_KV_KEYS.has(key)) return c.json({ error: 'unknown key' }, 404);
  const value = (await c.req.json()) as unknown;
  kvSet(`subject:${c.req.param('id')}:${key}`, value);
  return c.json({ ok: true });
});
