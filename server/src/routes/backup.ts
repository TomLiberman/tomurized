// Whole-database backup + restore.
//
//   GET  /api/export   -> JSON backup of every course, deck, card, review log,
//                         material (extracted text) and small doc. AI API keys
//                         are deliberately left out (backup files get copied
//                         around); original uploaded files are not inlined —
//                         back up DATA_DIR/files for those.
//   POST /api/restore  -> REPLACES all study data with a backup's contents.
//                         Accepts this format (version 2) and the older
//                         version-1 server export. The current AI keys are kept.

import { Hono } from 'hono';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FILES_DIR, db, nowIso, tx } from '../db.ts';
import { SUBJECT_ID_RE } from './subjects.ts';

export const backupRouter = new Hono();

const SETTINGS_KEY = 'global:settings';

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

backupRouter.get('/export', (c) => {
  const decks: Record<string, unknown> = {};
  for (const row of db.prepare('SELECT subject_id AS id, json FROM decks').all() as unknown as {
    id: string;
    json: string;
  }[]) {
    decks[row.id] = parseJson(row.json);
  }
  const kv: Record<string, unknown> = {};
  for (const row of db.prepare('SELECT key, value FROM kv WHERE key <> ?').all(SETTINGS_KEY) as unknown as {
    key: string;
    value: string;
  }[]) {
    kv[row.key] = parseJson(row.value);
  }
  const stamp = nowIso();
  c.header('Content-Disposition', `attachment; filename="tomurized-backup-${stamp.slice(0, 10)}.json"`);
  c.header('Cache-Control', 'no-store');
  return c.json({
    app: 'tomurized',
    kind: 'backup',
    version: 2,
    exportedAt: stamp,
    subjects: db.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM subjects').all(),
    decks,
    cards: db.prepare('SELECT * FROM cards').all(),
    reviewLogs: db.prepare('SELECT * FROM review_logs ORDER BY id').all(),
    materials: db.prepare(
      'SELECT id, subject_id, name, category, text, auto_categorized, file_path, mime, size, added_at FROM materials'
    ).all(),
    kv,
  });
});

type Row = Record<string, unknown>;
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object') : []);
// The fsrs column holds a JSON string; tolerate an already-parsed object too.
const jsonText = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? JSON.stringify(v) : null;

backupRouter.post('/restore', async (c) => {
  const backup = (await c.req.json()) as Row;
  const isV2 = backup?.app === 'tomurized' && backup?.kind === 'backup';
  const isV1 = backup?.app === 'tomurized-server';
  if (!isV2 && !isV1) return c.json({ error: 'not a Tomurized backup file' }, 400);

  const counts = { subjects: 0, decks: 0, cards: 0, reviewLogs: 0, materials: 0, kvDocs: 0 };
  const now = nowIso();

  tx(() => {
    db.exec('DELETE FROM review_logs');
    db.exec('DELETE FROM cards');
    db.exec('DELETE FROM materials');
    db.exec('DELETE FROM decks');
    db.exec('DELETE FROM subjects');
    db.prepare('DELETE FROM kv WHERE key <> ?').run(SETTINGS_KEY);

    const subjectIds = new Set<string>();
    const insSubject = db.prepare('INSERT INTO subjects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    for (const s of rows(backup.subjects)) {
      const id = str(s.id);
      if (!SUBJECT_ID_RE.test(id) || subjectIds.has(id)) continue;
      insSubject.run(id, str(s.name, id) || id, str(s.createdAt, now), str(s.updatedAt, str(s.createdAt, now)));
      subjectIds.add(id);
      counts.subjects++;
    }

    const insDeck = db.prepare('INSERT INTO decks (subject_id, json, updated_at) VALUES (?, ?, ?)');
    const decks = backup.decks && typeof backup.decks === 'object' ? (backup.decks as Row) : {};
    for (const [id, deck] of Object.entries(decks)) {
      if (!subjectIds.has(id) || !deck || typeof deck !== 'object' || Array.isArray(deck)) continue;
      insDeck.run(id, JSON.stringify(deck), now);
      counts.decks++;
    }

    const insCard = db.prepare(
      `INSERT OR REPLACE INTO cards (id, subject_id, topic_id, term, definition, cloze, fsrs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of rows(backup.cards)) {
      const subjectId = str(r.subject_id);
      if (!subjectIds.has(subjectId) || !str(r.id) || !str(r.term)) continue;
      insCard.run(
        str(r.id), subjectId, str(r.topic_id), str(r.term), str(r.definition), strOrNull(r.cloze),
        jsonText(r.fsrs), str(r.created_at, now), str(r.updated_at, now)
      );
      counts.cards++;
    }

    // Review logs are kept even for courses that no longer exist (same as live deletes).
    const insLog = db.prepare(
      `INSERT INTO review_logs (card_id, subject_id, topic_id, grade, predicted_confidence, typed_answer, ai_score, correct, reviewed_at, elapsed_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of rows(backup.reviewLogs)) {
      if (!str(r.card_id) || typeof r.grade !== 'number' || !str(r.reviewed_at)) continue;
      insLog.run(
        str(r.card_id), str(r.subject_id), strOrNull(r.topic_id), r.grade, numOrNull(r.predicted_confidence),
        strOrNull(r.typed_answer), numOrNull(r.ai_score), numOrNull(r.correct), str(r.reviewed_at), numOrNull(r.elapsed_days)
      );
      counts.reviewLogs++;
    }

    const insMaterial = db.prepare(
      `INSERT OR REPLACE INTO materials (id, subject_id, name, category, text, auto_categorized, file_path, mime, size, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of rows(backup.materials)) {
      const subjectId = str(r.subject_id);
      if (!subjectIds.has(subjectId) || !str(r.id) || !str(r.name)) continue;
      // Keep the link to the original upload only if that file is actually here.
      const filePath = strOrNull(r.file_path);
      const keepFile = filePath && existsSync(join(FILES_DIR, basename(filePath))) ? basename(filePath) : null;
      insMaterial.run(
        str(r.id), subjectId, str(r.name), str(r.category, 'other'), str(r.text), r.auto_categorized ? 1 : 0,
        keepFile, keepFile ? strOrNull(r.mime) : null, keepFile ? numOrNull(r.size) : null, str(r.added_at, now)
      );
      counts.materials++;
    }

    const insKv = db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)');
    const kv = backup.kv && typeof backup.kv === 'object' ? (backup.kv as Row) : {};
    for (const [key, value] of Object.entries(kv)) {
      if (key === SETTINGS_KEY) continue;
      const m = /^subject:([^:]+):/.exec(key);
      if (m && !subjectIds.has(m[1])) continue; // doc of a course that isn't in the backup
      if (!m && !key.startsWith('global:')) continue;
      insKv.run(key, JSON.stringify(value ?? null), now);
      counts.kvDocs++;
    }
  });

  // Remove uploaded originals that no restored material points at.
  const keep = new Set(
    (db.prepare('SELECT file_path AS f FROM materials WHERE file_path IS NOT NULL').all() as unknown as { f: string }[]).map(
      (r) => r.f
    )
  );
  for (const f of readdirSync(FILES_DIR)) {
    if (!keep.has(f)) {
      try {
        unlinkSync(join(FILES_DIR, f));
      } catch (e) {
        console.error('[tomurized-api] restore: could not remove orphan file', f, e);
      }
    }
  }

  return c.json({ ok: true, restored: counts });
});
