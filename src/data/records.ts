// Shapes of the card + review-log rows the API stores (server/src/routes/cards.ts).

export interface CardRecord {
  id: string; // stable id, `${subjectId}::${term}`
  subjectId: string;
  topicId: string; // dictionary section / unit title
  term: string;
  definition: string;
  cloze?: string | null;
  fsrs?: unknown; // serialised ts-fsrs Card
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLogRecord {
  id?: number;
  cardId: string;
  subjectId: string;
  topicId?: string;
  grade: number; // ts-fsrs Rating 1..4
  predictedConfidence?: number; // 1..5, before reveal
  typedAnswer?: string;
  aiScore?: number;
  correct?: boolean;
  reviewedAt: string; // ISO
  elapsedDays?: number;
}
