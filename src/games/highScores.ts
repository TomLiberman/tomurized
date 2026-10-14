// Per-game, per-subject personal bests. Server-backed since M6: stored in the
// global `progress` doc (kv `global:progress`.gameScores) so bests follow the
// user across devices. The sync signatures are preserved by reading/patching
// the React Query cache directly — safe because the boot gate in App.tsx
// primes ['progress'] before any game can render.

import { apiPut } from '../api/client';
import { keys } from '../api/keys';
import { queryClient } from '../api/queryClient';
import type { GameId } from './types';

interface GameScoreEntry {
  bestScore: number;
  plays: number;
  lastPlayedAt: string;
}

interface ScoreStore {
  version: 1;
  subjects: Record<string, Partial<Record<GameId, GameScoreEntry>>>;
}

interface ProgressDoc {
  gameScores?: ScoreStore;
  [key: string]: unknown;
}

function readStore(): ScoreStore {
  const progress = queryClient.getQueryData<ProgressDoc>(keys.progress);
  const store = progress?.gameScores;
  if (store && store.version === 1 && store.subjects) return store;
  return { version: 1, subjects: {} };
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;

function persist(store: ScoreStore): void {
  const prev = queryClient.getQueryData<ProgressDoc>(keys.progress) ?? {};
  queryClient.setQueryData<ProgressDoc>(keys.progress, { ...prev, gameScores: store });
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const doc = queryClient.getQueryData<ProgressDoc>(keys.progress);
    if (doc) {
      apiPut('/progress', doc).catch((e) => console.error('game high-score save failed:', e));
    }
  }, 400);
}

export function getBest(subjectId: string, game: GameId): GameScoreEntry | null {
  return readStore().subjects[subjectId]?.[game] ?? null;
}

export function recordScore(subjectId: string, game: GameId, score: number): { isNewBest: boolean } {
  const store = structuredClone(readStore());
  const forSubject = store.subjects[subjectId] ?? (store.subjects[subjectId] = {});
  const prev = forSubject[game];
  const isNewBest = !prev || score > prev.bestScore;
  forSubject[game] = {
    bestScore: isNewBest ? score : prev.bestScore,
    plays: (prev?.plays ?? 0) + 1,
    lastPlayedAt: new Date().toISOString(),
  };
  persist(store);
  return { isNewBest };
}
