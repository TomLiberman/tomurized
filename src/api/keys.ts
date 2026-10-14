// Query-key factory — the single source of truth for React Query cache keys.
// Everything per-course lives under ['subject', id, ...] so switching course is
// just a key change (no manual reload/reset choreography).

export const keys = {
  subjects: ['subjects'] as const,
  deck: (subjectId: string) => ['subject', subjectId, 'deck'] as const,
  materials: (subjectId: string) => ['subject', subjectId, 'materials'] as const,
  meta: (subjectId: string) => ['subject', subjectId, 'meta'] as const, // {lang, examDate, completed}
  scores: (subjectId: string) => ['subject', subjectId, 'scores'] as const,
  chat: (subjectId: string) => ['subject', subjectId, 'chat'] as const,
  plan: (subjectId: string) => ['subject', subjectId, 'plan'] as const,
  cards: (subjectId: string) => ['subject', subjectId, 'cards'] as const,
  reviewLogs: (subjectId: string) => ['subject', subjectId, 'reviewLogs'] as const,
  allCards: ['cards', 'all'] as const,
  progress: ['progress'] as const, // points/streaks/shields/gameScores
  settings: ['settings'] as const, // API keys
  limits: ['limits'] as const, // server request-size limits (from /health)
};
