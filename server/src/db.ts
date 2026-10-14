// Tomurized API — SQLite storage (node:sqlite, zero native deps).
//
// Everything lives under DATA_DIR: the DB file (WAL) + original uploads in
// files/. Default ./data (relative to the working directory); the Docker image
// sets DATA_DIR=/data, which is the volume to back up. WAL is preferred; if the
// underlying filesystem rejects it we fall back to the default journal so the
// server still boots. Don't open the DB with other tools while the server runs.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DATA_DIR = resolve(process.env.DATA_DIR || 'data');
export const FILES_DIR = join(DATA_DIR, 'files');

mkdirSync(FILES_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'tomurized.db'));

try {
  db.exec('PRAGMA journal_mode = WAL');
} catch (e) {
  console.error('[tomurized-api] WAL unavailable, using default journal:', e);
}
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Deck stays a JSON blob per subject: it is regenerated wholesale by the AI
-- and always read whole; cards are the normalized per-term store.
CREATE TABLE IF NOT EXISTS decks (
  subject_id TEXT PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,               -- \`\${subjectId}::\${term}\`
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  cloze TEXT,
  fsrs TEXT,                         -- serialized ts-fsrs Card (JSON)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_subject ON cards(subject_id);

-- Append-only. Deliberately NO foreign key: logs outlive deleted cards
-- (the app keeps review history when terms are removed from a deck).
CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  topic_id TEXT,
  grade INTEGER NOT NULL,
  predicted_confidence INTEGER,
  typed_answer TEXT,
  ai_score REAL,
  correct INTEGER,
  reviewed_at TEXT NOT NULL,
  elapsed_days REAL
);
CREATE INDEX IF NOT EXISTS idx_logs_subject ON review_logs(subject_id);
CREATE INDEX IF NOT EXISTS idx_logs_card ON review_logs(card_id);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  text TEXT NOT NULL DEFAULT '',
  auto_categorized INTEGER NOT NULL DEFAULT 0,
  file_path TEXT,                    -- original upload under FILES_DIR (NULL when there is none)
  mime TEXT,
  size INTEGER,
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_subject ON materials(subject_id);

-- All small documents, JSON-encoded:
--   subject:<id>:chat | plan | meta | scores   (meta = {lang, examDate, completed})
--   global:progress                            (points/streaks/gameScores)
--   global:settings                            (AI API keys — see README "Security")
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

db.exec(SCHEMA);

export const nowIso = (): string => new Date().toISOString();

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function kvGet(key: string): unknown {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export function kvSet(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value ?? null), nowIso());
}

export function count(table: string): number {
  // table names are code-controlled, never user input
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/** Checkpoint the WAL and close — called on shutdown so the .db file is self-contained. */
export function closeDb(): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* not in WAL mode */
  }
  db.close();
}
