// AI question pool for the games — AI-FIRST since the "focus on AI questions
// only" dev task: a per-subject pool of Gemini exam MCQs that REFILLS itself in
// the background whenever it runs low, so games can draw AI questions for every
// slot. Batches are topic-covering (generateExamMCQs guarantees ≥2 questions
// per topic), so topic-scoped draws (boss battles) actually hit. Locally-built
// questions remain the silent fallback: no key / fetch not landed yet / error.

import { useEffect, useRef, useState } from 'react';
import { generateExamMCQs, type GeneratedMCQ } from '../services/gemini';
import { mcqToGameQuestion } from './questionEngine';
import type { DeckTerm, GameQuestion } from './types';
import type { Lang } from '../i18n';

export type AiFeedStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CacheEntry {
  batch: GeneratedMCQ[];
  status: AiFeedStatus;
  promise: Promise<void> | null;
}

// Refill when the pool drops below this many questions.
const LOW_WATER = 5;

// Per-subject-and-language cache, shared across game sessions for the lifetime
// of the tab. Language is part of the key so switching the course language
// never serves stale-language questions.
const aiCache = new Map<string, CacheEntry>();

function cacheFor(cacheKey: string): CacheEntry {
  let entry = aiCache.get(cacheKey);
  if (!entry) {
    entry = { batch: [], status: 'idle', promise: null };
    aiCache.set(cacheKey, entry);
  }
  return entry;
}

// One batch covers every topic at least twice (mirrors the AI exam sizing).
function batchSize(fullPool: DeckTerm[]): number {
  const topics = new Set(fullPool.map((t) => t.subject)).size;
  return Math.min(30, Math.max(20, topics * 2));
}

interface FeedOpts {
  subjectId: string;
  /** Whole-deck pool — used for AI generation and testedTerm matching. */
  fullPool: DeckTerm[];
  aiEnabled: boolean;
  apiKey: string;
  courseName: string;
  pastExamsText: string;
  lang: Lang;
}

// Kick off a background batch fetch unless one is already in flight.
function refill(cacheKey: string, opts: FeedOpts, onSettled?: (status: AiFeedStatus) => void): void {
  const entry = cacheFor(cacheKey);
  if (entry.promise || !opts.aiEnabled || !opts.apiKey || opts.fullPool.length < 4) return;
  if (!entry.batch.length) entry.status = 'loading';
  entry.promise = generateExamMCQs(
    opts.apiKey, opts.courseName, opts.fullPool, opts.pastExamsText, batchSize(opts.fullPool), opts.lang
  )
    .then((mcqs) => {
      entry.batch.push(...mcqs);
      entry.status = entry.batch.length ? 'ready' : 'error';
    })
    .catch((e) => {
      console.warn('AI question batch failed, staying local-only:', e);
      entry.status = entry.batch.length ? 'ready' : 'error';
    })
    .then(() => {
      entry.promise = null;
      onSettled?.(entry.status);
    });
}

export function useQuestionFeed(opts: FeedOpts) {
  const { subjectId, fullPool, lang } = opts;
  const cacheKey = `${subjectId}::${lang}`;
  const [aiStatus, setAiStatus] = useState<AiFeedStatus>(() => cacheFor(cacheKey).status);
  const mounted = useRef(true);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const entry = cacheFor(cacheKey);
    const settle = (status: AiFeedStatus) => {
      if (mounted.current) setAiStatus(status);
    };
    if (entry.batch.length < LOW_WATER) refill(cacheKey, optsRef.current, settle);
    setAiStatus(entry.status);
    // Piggyback on an in-flight fetch (possibly started by another game).
    if (entry.promise) void entry.promise.then(() => settle(cacheFor(cacheKey).status));
    // Keyed on subject+lang; refills are driven by pool level, not re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, opts.aiEnabled, opts.apiKey]);

  /**
   * Pop one AI question from the pool, optionally restricted to a topic
   * (matched via the question's testedTerm). Returns null when none is
   * available. Draining the pool below the low-water mark triggers a
   * background refill so the next draws keep hitting AI questions.
   */
  const takeAi = (topic?: string): GameQuestion | null => {
    const entry = cacheFor(cacheKey);
    const idx = entry.batch.findIndex((m) => {
      if (!topic) return true;
      const matched = fullPool.find((t) => t.term === m.testedTerm);
      return matched?.subject === topic;
    });
    const result = idx === -1 ? null : mcqToGameQuestion(entry.batch.splice(idx, 1)[0], fullPool);
    if (entry.batch.length < LOW_WATER) {
      refill(cacheKey, optsRef.current, (status) => {
        if (mounted.current) setAiStatus(status);
      });
    }
    return result;
  };

  return { takeAi, aiStatus };
}
