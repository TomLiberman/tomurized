// Materials library: metadata + client-extracted text in SQLite, original
// uploads kept on disk. Text extraction stays on the CLIENT (pdfjs/mammoth) —
// uploads arrive as multipart with both the original file and the text.

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { db, nowIso, tx } from '../db.ts';
import { deleteOriginal, readOriginal, saveOriginal } from '../files.ts';

export const materialsRouter = new Hono();

const CATEGORIES = new Set(['summary', 'syllabus', 'past_exam', 'other']);

interface MaterialRow {
  id: string;
  subject_id: string;
  name: string;
  category: string;
  text: string;
  auto_categorized: number;
  file_path: string | null;
  mime: string | null;
  size: number | null;
  added_at: string;
}

// Client shape (src/data/materials.ts MaterialFile) + server extras.
function materialOut(row: MaterialRow, includeText: boolean) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    text: includeText ? row.text : '',
    addedAt: row.added_at,
    autoCategorized: !!row.auto_categorized,
    hasFile: !!row.file_path,
    mime: row.mime ?? undefined,
    size: row.size ?? undefined,
  };
}

const MATERIAL_COLS =
  'id, subject_id, name, category, text, auto_categorized, file_path, mime, size, added_at';

materialsRouter.get('/subjects/:id/materials', (c) => {
  const includeText = c.req.query('meta') !== '1';
  const rows = db
    .prepare(`SELECT ${MATERIAL_COLS} FROM materials WHERE subject_id = ? ORDER BY added_at, id`)
    .all(c.req.param('id')) as unknown as MaterialRow[];
  return c.json(rows.map((r) => materialOut(r, includeText)));
});

// Multipart upload: fields { id?, name, text, category, autoCategorized, file? }.
// Upserts BY NAME within the subject — re-uploading a file replaces it, matching
// the app's existing addLibraryItems semantics.
materialsRouter.post('/subjects/:id/materials', async (c) => {
  const subjectId = c.req.param('id');
  if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subjectId)) {
    return c.json({ error: 'subject not found' }, 404);
  }
  const body = await c.req.parseBody();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'name required' }, 400);
  // Browsers send multipart text fields with CRLF line breaks — store plain LF.
  const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n') : '';
  const category = typeof body.category === 'string' && CATEGORIES.has(body.category) ? body.category : 'other';
  const autoCategorized = body.autoCategorized === '1' || body.autoCategorized === 'true' ? 1 : 0;
  const file = body.file instanceof File ? body.file : null;
  const now = nowIso();

  const existing = db
    .prepare('SELECT id, file_path AS filePath FROM materials WHERE subject_id = ? AND name = ?')
    .get(subjectId, name) as { id: string; filePath: string | null } | undefined;

  const id = existing?.id ?? (typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID());

  let filePath: string | null = existing?.filePath ?? null;
  let mime: string | null = null;
  let size: number | null = null;
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (existing?.filePath) deleteOriginal(existing.filePath);
    filePath = saveOriginal(id, file.name || name, bytes);
    mime = file.type || 'application/octet-stream';
    size = bytes.byteLength;
  }

  tx(() => {
    if (existing) {
      db.prepare(
        `UPDATE materials SET category = ?, text = ?, auto_categorized = ?,
           file_path = ?, mime = COALESCE(?, mime), size = COALESCE(?, size), added_at = ?
         WHERE id = ?`
      ).run(category, text, autoCategorized, filePath, mime, size, now, id);
    } else {
      db.prepare(
        `INSERT INTO materials (id, subject_id, name, category, text, auto_categorized, file_path, mime, size, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, subjectId, name, category, text, autoCategorized, filePath, mime, size, now);
    }
  });

  const row = db.prepare(`SELECT ${MATERIAL_COLS} FROM materials WHERE id = ?`).get(id) as unknown as MaterialRow;
  return c.json(materialOut(row, true), existing ? 200 : 201);
});

materialsRouter.patch('/materials/:id', async (c) => {
  const id = c.req.param('id');
  const row = db.prepare(`SELECT ${MATERIAL_COLS} FROM materials WHERE id = ?`).get(id) as
    | MaterialRow
    | undefined;
  if (!row) return c.json({ error: 'material not found' }, 404);
  const body = (await c.req.json()) as { name?: unknown; category?: unknown; autoCategorized?: unknown };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : row.name;
  const category =
    typeof body.category === 'string' && CATEGORIES.has(body.category) ? body.category : row.category;
  const autoCategorized =
    typeof body.autoCategorized === 'boolean' ? (body.autoCategorized ? 1 : 0) : row.auto_categorized;
  db.prepare('UPDATE materials SET name = ?, category = ?, auto_categorized = ? WHERE id = ?').run(
    name,
    category,
    autoCategorized,
    id
  );
  const updated = db.prepare(`SELECT ${MATERIAL_COLS} FROM materials WHERE id = ?`).get(id) as unknown as MaterialRow;
  return c.json(materialOut(updated, true));
});

materialsRouter.delete('/materials/:id', (c) => {
  const id = c.req.param('id');
  const row = db.prepare('SELECT file_path AS filePath FROM materials WHERE id = ?').get(id) as
    | { filePath: string | null }
    | undefined;
  if (!row) return c.json({ error: 'material not found' }, 404);
  db.prepare('DELETE FROM materials WHERE id = ?').run(id);
  deleteOriginal(row.filePath);
  return c.json({ ok: true });
});

materialsRouter.get('/materials/:id/file', (c) => {
  const row = db
    .prepare('SELECT name, file_path AS filePath, mime FROM materials WHERE id = ?')
    .get(c.req.param('id')) as { name: string; filePath: string | null; mime: string | null } | undefined;
  if (!row || !row.filePath) return c.json({ error: 'no original file' }, 404);
  const bytes = readOriginal(row.filePath);
  if (!bytes) return c.json({ error: 'file missing on disk' }, 404);
  return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
    'Content-Type': row.mime || 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'Cache-Control': 'no-store',
  });
});
