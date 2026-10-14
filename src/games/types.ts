// Shared types for the study games hub.

/** A deck entry as exposed by portal state (`allTermsList`); subject = topic key. */
export interface DeckTerm {
  term: string;
  definition: string;
  subject: string;
}

export interface GameQuestion {
  /** Unique within a session (used as a React key and for AI splicing). */
  id: string;
  /** Deck term tested; '' = unmatched AI question, skipped by FSRS grading. */
  term: string;
  definition: string;
  /** Fully-resolved display text (Hebrew), including the quoted term/definition. */
  prompt: string;
  /** Pre-shuffled; contains correctAnswer exactly once. */
  options: string[];
  correctAnswer: string;
  kind: 'definition-to-term' | 'term-to-definition' | 'ai';
  /** Why the correct answer is right (AI questions only). */
  explanation?: string;
  source: 'local' | 'ai';
}

/** Per-term outcome fed to FSRS via gradeExamResults (worst-wins after dedupe). */
export interface GameResult {
  term: string;
  correct: boolean;
}

export type GameId = 'boss' | 'millionaire' | 'memory' | 'swipe';

/** End-of-run summary a game hands to useGameOutcome.finishRun. */
export interface GameSummary {
  gameId: GameId;
  /** Game-native score — this is what's recorded as a high score. */
  score: number;
  /** Study points to grant (already capped by the game's formula). */
  pointsAwarded: number;
  correct: number;
  total: number;
  bestStreak: number;
  durationMs: number;
  /** Flawless run → 'perfect' confetti. */
  perfect: boolean;
}

/** One swipe card: a term shown together with a (possibly mismatched) definition. */
export interface SwipePair {
  id: string;
  term: string;
  definition: string;
  isTruePair: boolean;
  /** The term the shown definition really belongs to (== term when isTruePair). */
  sourceTerm: string;
}

/** One face-down card on the memory board. */
export interface MemoryCard {
  id: string;
  /** Both faces of the same term share a pairId — match by this, never by text. */
  pairId: string;
  face: 'term' | 'definition';
  /** Display text (definitions pre-truncated). */
  text: string;
  /** Untruncated text, kept reachable in the UI. */
  fullText: string;
}
