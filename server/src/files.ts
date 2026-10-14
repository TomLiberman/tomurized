// Original-upload storage on disk (FILES_DIR = <DATA_DIR>/files).
// Files are stored as `<materialId>__<sanitized original name>` — the id prefix
// guarantees uniqueness; the pretty (Hebrew) name lives in the materials table.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FILES_DIR } from './db.ts';

export function sanitizeName(name: string): string {
  const base = basename(name).normalize('NFC');
  // Control characters are stripped on purpose (invalid/dangerous in file names).
  // oxlint-disable-next-line no-control-regex
  const safe = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
  return safe || 'file';
}

const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '');

export function saveOriginal(materialId: string, originalName: string, bytes: Uint8Array): string {
  const rel = `${safeId(materialId)}__${sanitizeName(originalName)}`;
  writeFileSync(join(FILES_DIR, rel), bytes);
  return rel;
}

export function deleteOriginal(relPath: string | null | undefined): void {
  if (!relPath) return;
  const p = join(FILES_DIR, basename(relPath)); // basename() blocks path traversal
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch (e) {
    console.error('[tomurized-api] failed to delete file', relPath, e);
  }
}

export function readOriginal(relPath: string): Buffer | null {
  try {
    return readFileSync(join(FILES_DIR, basename(relPath)));
  } catch {
    return null;
  }
}
