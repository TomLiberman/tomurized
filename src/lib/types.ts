// Shared domain types for the study portal.

export type TheoryData = Record<string, { term: string; definition: string }[]>;

export interface SubjectEntry {
  id: string;
  name: string;
}

export interface ExamQuestion {
  term: string;
  definition: string;
  options: string[];
  correctAnswer: string;
  questionType: 'definition-to-term' | 'term-to-definition' | 'ai';
  /** Full question text (AI-generated questions only). */
  prompt?: string;
  /** Why the correct answer is right (AI-generated questions only). */
  explanation?: string;
}

/** A previous exam uploaded by the user, used to steer AI question generation. */
export interface PastExam {
  name: string;
  text: string;
  addedAt: string;
}

export interface ScoreRecord {
  id: string;
  timestamp: string;
  subject: string;
  score: number;
  totalQuestions: number;
}

export interface ChatMessage { role: 'user' | 'model'; text: string }
