// Materials LIBRARY: one per-course list of uploaded files, each AI-categorized
// (with manual override). Stored server-side (server/src/routes/materials.ts):
// metadata + extracted text in SQLite, the original upload on disk.

export type MaterialCategory = 'summary' | 'syllabus' | 'past_exam' | 'other';

export interface MaterialFile {
  id: string;
  name: string;
  category: MaterialCategory;
  text: string;
  addedAt: string;
  /** true when the category came from the AI classifier (vs manual override). */
  autoCategorized: boolean;
  /** Server extras: whether the original upload is stored, and its type/size. */
  hasFile?: boolean;
  mime?: string;
  size?: number;
}
