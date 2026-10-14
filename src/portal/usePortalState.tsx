import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload, fetchServerLimits, MB, type ServerLimits } from '../api/client';
import { keys } from '../api/keys';
import { useServerState } from '../api/useServerState';
import { generateAIQuestion, evaluateAIAnswer, generateStudyDeckFromMaterials, chatAboutCourse, generateStudyPlan, distillToCards, generateExamMCQs, regenerateTopicCards, categorizeMaterial, setOpenAiFallbackKey, type StudyDeck, type DeckMaterials } from '../services/gemini';
import { removeOrphanCards, ensureCardsForSubject, reconcileDeckCards } from '../data/cards';
import type { MaterialFile, MaterialCategory } from '../data/materials';
import { t, setCurrentLang, langDir, type Lang, type LangSetting } from '../i18n';
import { resolveAutoLang, invalidateAutoLang, cacheAutoLang, detectLang, browserLang } from '../i18n/detect';
import type { StudyPlanDay } from '../services/gemini';
import type { TheoryData, SubjectEntry, ExamQuestion, ScoreRecord, ChatMessage, PastExam } from '../lib/types';
import { extractTextFromFile } from '../lib/textExtract';
import { buildICS } from '../lib/calendar';
import { splitHighlight } from '../lib/highlight';
import { mergeDecks } from '../lib/deck';
import { useGuard } from '../lib/useGuard';
import { checkStreak, recordStudyDay, localDateStr } from '../lib/streak';
import { shuffleArray as engineShuffle, pickDistractors as enginePickDistractors } from '../games/questionEngine';

// Device-local preferences (everything else lives on the server).
const LS_THEME = 'tomurized_theme';
const LS_ACTIVE_COURSE = 'tomurized_active_course';
const LS_ENTERED = 'tomurized_entered';
const LS_CHAT_SIZE = 'tomurized_chat_size';

function readJSONPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Per-subject small server doc (kv key `meta`): language, exam date, checklist.
interface SubjectMeta {
  lang?: LangSetting;
  examDate?: string;
  completed?: Record<string, boolean>;
}

// Global server docs.
interface ProgressDoc {
  studyPoints?: number;
  streakDays?: number;
  streakShields?: number;
  lastStudyDate?: string;
  gameScores?: unknown; // owned by games/highScores.ts
}
interface SettingsDoc {
  geminiApiKey?: string;
  openaiApiKey?: string;
}

// Stable empty defaults (fresh references per render would loop useServerState).
const EMPTY_META: SubjectMeta = {};
const EMPTY_DECK: TheoryData = {};
const EMPTY_LIBRARY: MaterialFile[] = [];
const EMPTY_SCORES: ScoreRecord[] = [];
const EMPTY_CHAT: ChatMessage[] = [];
const EMPTY_PLAN: StudyPlanDay[] = [];
const EMPTY_COMPLETED: Record<string, boolean> = {};
const EMPTY_PROGRESS: ProgressDoc = {};
const EMPTY_SETTINGS: SettingsDoc = {};

// Course registry. A fresh install has none — the landing screen offers to
// create the first one.
async function fetchSubjects(): Promise<SubjectEntry[]> {
  const rows = await apiGet<{ id: string; name: string }[]>('/subjects');
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

// All of the study-portal's state, effects and handlers, extracted from the old
// monolithic PortalLayout. Consumed via <PortalContext.Provider> + usePortal().
export function usePortalState() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // --- Theme State ---
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem(LS_THEME) as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    localStorage.setItem(LS_THEME, theme);
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [theme]);

  // --- Subjects registry (server-backed) ---
  const subjectsQuery = useQuery({ queryKey: keys.subjects, queryFn: fetchSubjects });
  const subjectsList = useMemo<SubjectEntry[]>(() => subjectsQuery.data ?? [], [subjectsQuery.data]);

  const [storedSubjectId, setActiveSubjectId] = useState<string>(() => localStorage.getItem(LS_ACTIVE_COURSE) || '');
  // The remembered course may have been deleted (e.g. from another device) —
  // never point the per-course queries at a course the server doesn't have
  // (its saves would 404 and the edits silently vanish). Fall back to the
  // first course, or none on a fresh install.
  const activeSubjectId = useMemo(() => {
    if (!subjectsQuery.isSuccess) return storedSubjectId;
    if (subjectsList.some((s) => s.id === storedSubjectId)) return storedSubjectId;
    return subjectsList[0]?.id ?? '';
  }, [subjectsQuery.isSuccess, subjectsList, storedSubjectId]);
  const hasCourse = subjectsQuery.isSuccess && activeSubjectId !== '';

  const [showSubjectManager, setShowSubjectManager] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [renameSubjectName, setRenameSubjectName] = useState('');
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);

  // --- Core States (per-subject server docs; optimistic + debounced save) ---
  const [db, setDb, deckSync] = useServerState<TheoryData>({
    key: keys.deck(activeSubjectId),
    fetcher: () => apiGet<TheoryData | null>(`/subjects/${activeSubjectId}/deck`),
    saver: (deck) => apiPut(`/subjects/${activeSubjectId}/deck`, deck),
    defaultValue: EMPTY_DECK,
    enabled: hasCourse,
  });

  // Every deck term needs an FSRS card row. Create the missing ones whenever the
  // deck changes (new course, JSON import, chat → cards…) rather than only when
  // the flashcards page opens — the dashboard/progress/plan stats read card rows.
  // Add-only: removals go through the explicit reconcile paths (edit/regenerate).
  const [cardsVersion, setCardsVersion] = useState(0);
  useEffect(() => {
    if (!hasCourse || deckSync.isLoading || deckSync.isError) return;
    const subjectId = activeSubjectId;
    const timer = setTimeout(() => {
      void ensureCardsForSubject(subjectId, db)
        .then((added) => { if (added) setCardsVersion((v) => v + 1); })
        .catch((e) => console.error('[tomurized] creating cards for the deck failed', e));
    }, 600);
    return () => clearTimeout(timer);
  }, [db, activeSubjectId, hasCourse, deckSync.isLoading, deckSync.isError]);

  // Small per-subject doc: {lang, examDate, completed} — one kv key on the server.
  const [subjectMeta, setSubjectMeta, metaSync] = useServerState<SubjectMeta>({
    key: keys.meta(activeSubjectId),
    fetcher: () => apiGet<SubjectMeta | null>(`/subjects/${activeSubjectId}/kv/meta`),
    saver: (meta) => apiPut(`/subjects/${activeSubjectId}/kv/meta`, meta),
    defaultValue: EMPTY_META,
    enabled: hasCourse,
  });

  // Subject checklist completions (derived view over the meta doc).
  const completedSubjects = subjectMeta.completed ?? EMPTY_COMPLETED;
  const setCompletedSubjects: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
    (action) =>
      setSubjectMeta((prev) => ({
        ...prev,
        completed: typeof action === 'function' ? action(prev.completed ?? EMPTY_COMPLETED) : action,
      })),
    [setSubjectMeta]
  );

  // Score history
  const [scoreHistory, setScoreHistory] = useServerState<ScoreRecord[]>({
    key: keys.scores(activeSubjectId),
    fetcher: () => apiGet<ScoreRecord[] | null>(`/subjects/${activeSubjectId}/kv/scores`),
    saver: (scores) => apiPut(`/subjects/${activeSubjectId}/kv/scores`, scores),
    defaultValue: EMPTY_SCORES,
    enabled: hasCourse,
  });

  // Materials LIBRARY: every uploaded/pasted file of the course, AI-categorized
  // (summary/syllabus/past_exam/other) with manual override. Server-backed —
  // metadata + extracted text in SQLite, original uploads on disk.
  // `customContext` and `pastExams` are DERIVED from it further down.
  const materialsQuery = useQuery({
    queryKey: keys.materials(activeSubjectId),
    queryFn: () => apiGet<MaterialFile[]>(`/subjects/${activeSubjectId}/materials`),
    enabled: hasCourse,
    // A course library can run to >100MB of extracted text — fetch once per
    // session, not on every window focus. The app's own mutations keep the
    // cache current; cross-device material changes are rare (hard refresh covers them).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const library = materialsQuery.data ?? EMPTY_LIBRARY;

  // --- Language (per course): he | en | auto; 'auto' resolves from the deck ---
  // Lives in the per-subject meta doc — keyed per subject on the server, so one
  // course's setting can never leak into another while the doc is loading.
  const langSetting: LangSetting = subjectMeta.lang ?? 'auto';
  const setLangSetting: Dispatch<SetStateAction<LangSetting>> = useCallback(
    (action) =>
      setSubjectMeta((prev) => ({
        ...prev,
        lang: typeof action === 'function' ? action(prev.lang ?? 'auto') : action,
      })),
    [setSubjectMeta]
  );
  // Resolved language — never 'auto' past this line.
  const lang: Lang = useMemo(
    () => (langSetting === 'auto' ? resolveAutoLang(activeSubjectId, db) : langSetting),
    [langSetting, activeSubjectId, db]
  );
  const dir = langDir(lang);
  // Keep the module-level t() in sync BEFORE children render (idempotent).
  setCurrentLang(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = `Tomurized — ${t('landing_badge')}`;
  }, [lang, dir]);

  // API keys — global settings doc on the server (every device gets AI
  // without re-entering keys; single-user trust model, see README "Security").
  const [settingsDoc, setSettingsDoc, settingsSync] = useServerState<SettingsDoc>({
    key: keys.settings,
    fetcher: () => apiGet<SettingsDoc>('/settings'),
    saver: (doc) => apiPatch('/settings', doc),
    defaultValue: EMPTY_SETTINGS,
  });
  // The .env key is a DEV-only convenience; constant-folded out of prod builds.
  const devKey = import.meta.env.DEV ? import.meta.env.VITE_GEMINI_API_KEY || '' : '';
  const apiKey = settingsDoc.geminiApiKey || devKey || '';
  const setApiKey: Dispatch<SetStateAction<string>> = useCallback(
    (action) =>
      setSettingsDoc((prev) => ({
        ...prev,
        geminiApiKey: typeof action === 'function' ? action(prev.geminiApiKey ?? '') : action,
      })),
    [setSettingsDoc]
  );
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  // Optional OpenAI key — automatic fallback model when Gemini returns a
  // transient error (503 "high demand" spikes, 429, 5xx).
  const openAiKey = settingsDoc.openaiApiKey ?? '';
  const setOpenAiKey: Dispatch<SetStateAction<string>> = useCallback(
    (action) =>
      setSettingsDoc((prev) => ({
        ...prev,
        openaiApiKey: typeof action === 'function' ? action(prev.openaiApiKey ?? '') : action,
      })),
    [setSettingsDoc]
  );
  // Module-level sync so the services layer sees it without threading (same
  // pattern as setCurrentLang above). Idempotent per render.
  setOpenAiFallbackKey(openAiKey);

  // --- Gamification (global progress doc — points/streaks finally cross-device) ---
  const [progress, setProgress, progressSync] = useServerState<ProgressDoc>({
    key: keys.progress,
    fetcher: () => apiGet<ProgressDoc>('/progress'),
    saver: (doc) => apiPut('/progress', doc),
    defaultValue: EMPTY_PROGRESS,
  });
  // Always-fresh read for event handlers (the render closure can be stale).
  const currentProgress = useCallback(
    () => queryClient.getQueryData<ProgressDoc>(keys.progress) ?? EMPTY_PROGRESS,
    [queryClient]
  );
  const studyPoints = progress.studyPoints ?? 0;
  const setStudyPoints: Dispatch<SetStateAction<number>> = useCallback(
    (action) =>
      setProgress((prev) => ({
        ...prev,
        studyPoints: typeof action === 'function' ? action(prev.studyPoints ?? 0) : action,
      })),
    [setProgress]
  );
  const streakDays = progress.streakDays ?? 0;
  const setStreakDays: Dispatch<SetStateAction<number>> = useCallback(
    (action) =>
      setProgress((prev) => ({
        ...prev,
        streakDays: typeof action === 'function' ? action(prev.streakDays ?? 0) : action,
      })),
    [setProgress]
  );
  const streakShields = progress.streakShields ?? 0;
  const setStreakShields: Dispatch<SetStateAction<number>> = useCallback(
    (action) =>
      setProgress((prev) => ({
        ...prev,
        streakShields: typeof action === 'function' ? action(prev.streakShields ?? 0) : action,
      })),
    [setProgress]
  );

  // --- Search & Filters ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTheoryFilter, setSelectedTheoryFilter] = useState('all');

  // --- Flashcard States ---
  const [flashcardSubject, setFlashcardSubject] = useState('all');

  // --- Exam States ---
  const [examSubject, setExamSubject] = useState('all');
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [examActive, setExamActive] = useState(false);
  const [aiExamLoading, setAiExamLoading] = useState(false);

  // --- AI Mentor States ---
  const [aiSubject, setAiSubject] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestion, setAiQuestion] = useState<{ question: string; sampleAnswer: string } | null>(null);
  const [userAiAnswer, setUserAiAnswer] = useState('');
  const [aiEvaluation, setAiEvaluation] = useState<{
    isCorrect: boolean;
    evaluation: string;
    score: number;
    feedback: string;
  } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  // --- JSON Loader paste ---
  const [jsonPasteText, setJsonPasteText] = useState('');

  // --- Landing gate (home hub shown until a subject is chosen; sticky across refreshes) ---
  const [enteredPref, setEntered] = useState<boolean>(() => localStorage.getItem(LS_ENTERED) === '1');
  // No course to show (fresh install / last course deleted) → always the landing screen.
  const entered = enteredPref && (!subjectsQuery.isSuccess || hasCourse);

  // --- Course-material file upload ---
  const [fileParsing, setFileParsing] = useState(false);
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [fileError, setFileError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- AI deck builder (syllabus -> flashcards) ---
  const [deckGenerating, setDeckGenerating] = useState(false);
  const [deckOverview, setDeckOverview] = useState('');
  // Quality gate: generated deck awaiting the user's review/confirm before saving.
  // mode: 'merge' (default) adds parts to the current course; 'replace-subject'
  // swaps the ENTIRE deck; 'replace-topic' swaps one topic (replaceTopic key).
  const [pendingDeck, setPendingDeck] = useState<{
    deck: StudyDeck; targetName: string;
    mode?: 'merge' | 'replace-subject' | 'replace-topic'; replaceTopic?: string;
  } | null>(null);
  const [regeneratingTopic, setRegeneratingTopic] = useState<string | null>(null);
  const [buildSubjectName, setBuildSubjectName] = useState('');

  // --- Dashboard course chat ---
  const [chatMessages, setChatMessages] = useServerState<ChatMessage[]>({
    key: keys.chat(activeSubjectId),
    fetcher: () => apiGet<ChatMessage[] | null>(`/subjects/${activeSubjectId}/kv/chat`),
    saver: (messages) => apiPut(`/subjects/${activeSubjectId}/kv/chat`, messages),
    defaultValue: EMPTY_CHAT,
    enabled: hasCourse,
  });
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSize, setChatSize] = useState<{ w: number; h: number }>(() => readJSONPref(LS_CHAT_SIZE, { w: 380, h: 520 }));
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // --- Exam date (in the meta doc) + study plan ---
  const examDate = subjectMeta.examDate ?? '';
  const setExamDate: Dispatch<SetStateAction<string>> = useCallback(
    (action) =>
      setSubjectMeta((prev) => ({
        ...prev,
        examDate: typeof action === 'function' ? action(prev.examDate ?? '') : action,
      })),
    [setSubjectMeta]
  );
  const [studyPlan, setStudyPlan] = useServerState<StudyPlanDay[]>({
    key: keys.plan(activeSubjectId),
    fetcher: () => apiGet<StudyPlanDay[] | null>(`/subjects/${activeSubjectId}/kv/plan`),
    saver: (plan) => apiPut(`/subjects/${activeSubjectId}/kv/plan`, plan),
    defaultValue: EMPTY_PLAN,
    enabled: hasCourse,
  });
  const [planGenerating, setPlanGenerating] = useState(false);

  // --- Subject switch ---
  // Server-backed data reloads by itself: every per-subject query is keyed on
  // ['subject', id, ...], so switching course just changes the keys. Only the
  // transient view state needs resetting here — including the topic filters,
  // which name topics of the PREVIOUS course.
  useEffect(() => {
    if (activeSubjectId) localStorage.setItem(LS_ACTIVE_COURSE, activeSubjectId);
    else localStorage.removeItem(LS_ACTIVE_COURSE);

    // Reset view states
    setSearchQuery('');
    setSelectedTheoryFilter('all');
    setFlashcardSubject('all');
    setExamSubject('all');
    setChatInput('');
    setExamActive(false);
    setExamQuestions([]);
    setSelectedAnswers({});
    setExamSubmitted(false);
    setAiQuestion(null);
    setUserAiAnswer('');
    setAiEvaluation(null);
  }, [activeSubjectId]);

  // Sync AI Subject default when active db changes
  useEffect(() => {
    const keys = Object.keys(db);
    if (keys.length > 0) {
      setAiSubject(keys[0]);
    } else {
      setAiSubject('');
    }
  }, [db]);

  // Deck/meta/scores/chat/plan persist through their useServerState savers;
  // materials persist per-item through their mutations. Device-local:
  useEffect(() => {
    localStorage.setItem(LS_CHAT_SIZE, JSON.stringify(chatSize));
  }, [chatSize]);

  // Derived views over the library — keep every existing consumer working:
  // customContext = all study material (everything except past exams) as one
  // headed text blob for the AI; pastExams = the past-exam items.
  const customContext = useMemo(
    () => library
      .filter(m => m.category !== 'past_exam')
      .map(m => `===== ${m.name} =====\n${m.text}`)
      .join('\n\n'),
    [library]
  );
  const pastExams = useMemo<PastExam[]>(
    () => library
      .filter(m => m.category === 'past_exam')
      .map(m => ({ name: m.name, text: m.text, addedAt: m.addedAt })),
    [library]
  );

  // Auto-scroll the dashboard chat to the latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Streak validation — once, as soon as the progress doc has loaded (the doc
  // lives on the server now, so the check can't run before it arrives).
  // A missed day costs one shield; the bridged gap is persisted (lastStudyDate
  // moves to yesterday) so the next app start doesn't charge for it again.
  const streakChecked = useRef(false);
  useEffect(() => {
    if (streakChecked.current || progressSync.isLoading || progressSync.isError) return;
    streakChecked.current = true;
    const { next, shieldsUsed, reset } = checkStreak(currentProgress(), localDateStr());
    if (shieldsUsed === 0 && !reset) return;
    setProgress((prev) => ({ ...prev, ...next }));
    if (shieldsUsed > 0) alert(t('alert_shield_used'));
  }, [progressSync.isLoading, progressSync.isError, currentProgress, setProgress]);

  // Update streak days and last study date when studying
  const recordStudyActivity = (pointsAwarded = 0) => {
    if (pointsAwarded > 0) {
      setStudyPoints(prev => prev + pointsAwarded);
    }

    const { next, newDay } = recordStudyDay(currentProgress(), localDateStr());
    if (newDay) {
      setProgress((prev) => ({ ...prev, streakDays: next.streakDays, lastStudyDate: next.lastStudyDate }));
      triggerConfetti('success');
    } else {
      if (pointsAwarded > 0) {
        triggerConfetti('success');
      }
    }
  };

  // Purchase streak freeze shield
  const buyStreakShield = () => {
    if ((currentProgress().studyPoints ?? 0) >= 50) {
      setProgress((prev) => ({
        ...prev,
        studyPoints: (prev.studyPoints ?? 0) - 50,
        streakShields: (prev.streakShields ?? 0) + 1,
      }));
      triggerConfetti('perfect');
    } else {
      alert(t('alert_not_enough_points'));
    }
  };

  // Trigger celebration confetti
  const triggerConfetti = (type: 'success' | 'perfect') => {
    if (type === 'perfect') {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });
    } else {
      confetti({
        particleCount: 80,
        spread: 50,
        origin: { y: 0.7 }
      });
    }
  };

  // Toggle subject checklist
  const toggleSubjectCompleted = (subject: string) => {
    const newVal = !completedSubjects[subject];
    setCompletedSubjects(prev => ({ ...prev, [subject]: newVal }));
    if (newVal) {
      recordStudyActivity(10); // Award 10 points for completing a subject!
    }
  };

  // Text highlighting helper
  const highlightSearch = (text: string, query: string) => {
    if (!query) return text;
    return (
      <>
        {splitHighlight(text, query).map((part, i) =>
          part.match ? (
            <span key={i} className="highlight">
              {part.text}
            </span>
          ) : (
            part.text
          )
        )}
      </>
    );
  };

  // --- Helpers for Leitner Calculations ---
  const allTermsList = useMemo(() => {
    const list: { term: string; definition: string; subject: string }[] = [];
    Object.entries(db).forEach(([subject, terms]) => {
      terms.forEach(t => {
        list.push({ ...t, subject });
      });
    });
    return list;
  }, [db]);

  // --- Exam Logic ---

  // Shuffle + distractor picking live in the shared question engine (also used
  // by the study games); these are thin delegates with the original signatures.
  const shuffleArray = engineShuffle;

  const pickDistractors = (
    correct: { term: string; definition: string; subject: string },
    field: 'term' | 'definition'
  ): string[] => enginePickDistractors(allTermsList, correct, field);

  const startExam = () => {
    let pool: { term: string; definition: string; subject: string }[] = [];
    if (examSubject === 'all') {
      pool = [...allTermsList];
    } else {
      pool = (db[examSubject] || []).map(t => ({ ...t, subject: examSubject }));
    }

    if (pool.length < 4) {
      alert(t('alert_exam_pool_too_small'));
      return;
    }

    const questionsSelected = shuffleArray(pool).slice(0, Math.min(5, pool.length));

    const generatedQuestions: ExamQuestion[] = questionsSelected.map(q => {
      // definition-to-term: show the definition, options are TERMS.
      // term-to-definition: show the term, options are DEFINITIONS.
      const isDefToTerm = Math.random() > 0.5;
      const field = isDefToTerm ? 'term' : 'definition';
      const correctText = q[field].trim();
      const options = shuffleArray([correctText, ...pickDistractors(q, field)]);

      return {
        term: q.term,
        definition: q.definition,
        options,
        correctAnswer: correctText,
        questionType: isDefToTerm ? 'definition-to-term' : 'term-to-definition'
      } as ExamQuestion;
    });

    setExamQuestions(generatedQuestions);
    setSelectedAnswers({});
    setExamSubmitted(false);
    setExamActive(true);
  };

  // Cheap filename/content heuristic used when the AI classifier is
  // unavailable or fails — most uploads are study content.
  const guessCategory = (name: string, text: string): MaterialCategory => {
    if (/מבחן|מועד|exam|quiz|test/i.test(name)) return 'past_exam';
    if (/סילבוס|syllabus/i.test(name) || /סילבוס|syllabus/i.test(text.slice(0, 2000))) return 'syllabus';
    return 'summary';
  };

  // Classify one extracted file into a library item (AI when possible).
  const classifyToItem = async (name: string, text: string): Promise<MaterialFile> => {
    let category: MaterialCategory = guessCategory(name, text);
    let auto = false;
    if (apiKey) {
      try {
        category = await categorizeMaterial(apiKey, name, text);
        auto = true;
      } catch (e) {
        console.error('AI categorization failed, using heuristic:', e);
      }
    }
    return {
      id: Math.random().toString(36).slice(2),
      name, category, text,
      addedAt: new Date().toISOString(),
      autoCategorized: auto,
    };
  };

  // Sort library items into the role-based sections the deck generator expects:
  // syllabus drives structure, content drives cards, past exams drive emphasis.
  const toDeckMaterials = (items: MaterialFile[]): DeckMaterials => ({
    syllabus: items
      .filter(m => m.category === 'syllabus')
      .map(m => `===== ${m.name} =====\n${m.text}`)
      .join('\n\n'),
    content: items
      .filter(m => m.category === 'summary' || m.category === 'other')
      .map(m => ({ name: m.name, text: m.text })),
    pastExams: items
      .filter(m => m.category === 'past_exam')
      .map(m => ({ name: m.name, text: m.text })),
  });

  // Multipart POST of one material (extracted text + optional original file).
  // The server upserts BY NAME within the subject — same replace-on-reupload
  // semantics the IDB library had. NOTE: never pass the id when copying an item
  // to another subject (ids are global; reusing one would hijack the source row).
  const postMaterial = (subjectId: string, item: MaterialFile, file?: File): Promise<MaterialFile> => {
    const form = new FormData();
    if (item.id) form.set('id', item.id);
    form.set('name', item.name);
    form.set('text', item.text);
    form.set('category', item.category);
    form.set('autoCategorized', item.autoCategorized ? '1' : '0');
    if (file) form.set('file', file, file.name);
    return apiUpload<MaterialFile>(`/subjects/${subjectId}/materials`, form);
  };

  const addLibraryItems = (items: MaterialFile[], files?: Map<string, File>) => {
    if (!items.length) return;
    const materialsKey = keys.materials(activeSubjectId);
    // Optimistic replace-by-name so re-uploading a corrected file doesn't duplicate it.
    queryClient.setQueryData<MaterialFile[]>(materialsKey, (prev) => [
      ...(prev ?? []).filter(p => !items.some(a => a.name === p.name)),
      ...items,
    ]);
    void (async () => {
      const limits = await queryClient
        .fetchQuery({ queryKey: keys.limits, queryFn: fetchServerLimits, staleTime: Infinity })
        .catch(() => ({} as ServerLimits));
      for (const item of items) {
        const file = files?.get(item.name);
        const bytes = (file?.size ?? 0) + new Blob([item.text]).size;
        if (limits.maxUploadMb && bytes > limits.maxUploadMb * MB) {
          const msg = t('err_upload_too_large', { name: item.name, size: (bytes / MB).toFixed(1), limit: limits.maxUploadMb });
          setFileError(prev => (prev ? `${prev}\n${msg}` : msg));
          void queryClient.invalidateQueries({ queryKey: materialsKey }); // drop the optimistic row
          continue;
        }
        try {
          const saved = await postMaterial(activeSubjectId, item, file);
          // Adopt the server's canonical row (it owns the id on name-upserts) —
          // and re-add it if a resync meanwhile replaced the optimistic list.
          queryClient.setQueryData<MaterialFile[]>(materialsKey, (prev) => {
            const list = prev ?? [];
            return list.some(p => p.name === saved.name)
              ? list.map(p => (p.name === saved.name ? saved : p))
              : [...list, saved];
          });
        } catch (e) {
          console.error('material upload failed', item.name, e);
          // Tell the user — the optimistic row disappears on the resync below.
          const msg = t('err_upload_failed', { name: item.name, msg: e instanceof Error ? e.message : String(e) });
          setFileError(prev => (prev ? `${prev}\n${msg}` : msg));
          void queryClient.invalidateQueries({ queryKey: materialsKey });
        }
      }
    })();
  };

  const setMaterialCategory = (id: string, category: MaterialCategory) => {
    const materialsKey = keys.materials(activeSubjectId);
    queryClient.setQueryData<MaterialFile[]>(materialsKey, (prev) =>
      (prev ?? []).map(m => (m.id === id ? { ...m, category, autoCategorized: false } : m)));
    void apiPatch(`/materials/${id}`, { category, autoCategorized: false }).catch((e) => {
      console.error('material category update failed', e);
      void queryClient.invalidateQueries({ queryKey: materialsKey });
    });
  };

  const removeMaterial = (id: string) => {
    const materialsKey = keys.materials(activeSubjectId);
    queryClient.setQueryData<MaterialFile[]>(materialsKey, (prev) => (prev ?? []).filter(m => m.id !== id));
    void apiDelete(`/materials/${id}`).catch((e) => {
      console.error('material delete failed', e);
      void queryClient.invalidateQueries({ queryKey: materialsKey });
    });
  };

  // Paste raw text into the library as its own item.
  const doAddPastedText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const n = library.filter(m => m.name.startsWith(t('loader_pasted_text_prefix'))).length + 1;
    addLibraryItems([await classifyToItem(`${t('loader_pasted_text_prefix')} ${n}`, trimmed)]);
    triggerConfetti('success');
  };

  // AI exam: Gemini writes exam-style MCQs grounded in the deck, imitating the
  // uploaded previous exams (style, difficulty, question formats) when available.
  const doStartAiExam = async () => {
    if (!apiKey) { alert(t('alert_need_api_key')); return; }
    const pool = examSubject === 'all'
      ? [...allTermsList]
      : (db[examSubject] || []).map(t => ({ ...t, subject: examSubject }));
    if (pool.length < 4) {
      alert(t('alert_exam_pool_too_small'));
      return;
    }

    setAiExamLoading(true);
    try {
      const courseName = subjectsList.find(s => s.id === activeSubjectId)?.name || t('course_fallback_name');
      const pastText = pastExams
        .map(p => `===== ${p.name} =====\n${p.text}`)
        .join('\n\n');
      // At least 2 questions per topic (min 10 overall, capped to keep one
      // Gemini call reliable); a single-topic exam gets the 10-question floor.
      const topicCount = examSubject === 'all' ? Object.keys(db).length : 1;
      const questionCount = Math.min(30, Math.max(10, topicCount * 2));
      const mcqs = await generateExamMCQs(apiKey, courseName, pool, pastText, questionCount, lang);
      if (!mcqs.length) throw new Error(t('err_ai_no_valid_questions'));

      const deckTerms = new Set(pool.map(t => t.term));
      const generated: ExamQuestion[] = mcqs.map(m => {
        const correctText = m.options[m.correctIndex].trim();
        return {
          // Tag the deck concept the question tests (feeds FSRS on submit);
          // gradeExamResults skips terms that don't match a card.
          term: deckTerms.has(m.testedTerm) ? m.testedTerm : '',
          definition: pool.find(t => t.term === m.testedTerm)?.definition || '',
          options: shuffleArray(m.options.map(o => o.trim())),
          correctAnswer: correctText,
          questionType: 'ai',
          prompt: m.question.trim(),
          explanation: m.explanation?.trim() || '',
        };
      });

      setExamQuestions(generated);
      setSelectedAnswers({});
      setExamSubmitted(false);
      setExamActive(true);
    } catch (e) {
      console.error('AI exam generation failed:', e);
      alert(e instanceof Error ? e.message : t('alert_ai_exam_failed'));
    } finally {
      setAiExamLoading(false);
    }
  };

  const submitExam = () => {
    if (examSubmitted || !examQuestions.length) return;
    let correctCount = 0;
    examQuestions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctAnswer) {
        correctCount++;
      }
    });

    const score = Math.round((correctCount / examQuestions.length) * 100);
    setExamSubmitted(true);

    const newRecord: ScoreRecord = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      subject: examSubject === 'all' ? t('exam_all_topics') : examSubject.split(' - ')[0],
      score,
      totalQuestions: examQuestions.length
    };

    setScoreHistory(prev => [newRecord, ...prev]);

    // 10 points per correct answer — awarded on submit (it used to be granted
    // only when the student clicked "try again", so most exams earned nothing).
    recordStudyActivity(correctCount * 10);
    if (score === 100) {
      triggerConfetti('perfect');
    }
  };

  // --- AI Mentoring Logic ---
  const doHandleGenerateAIQuestion = async () => {
    if (!apiKey) {
      alert(t('alert_need_api_key'));
      return;
    }
    setAiLoading(true);
    setAiEvaluation(null);
    setUserAiAnswer('');
    setAiQuestion(null);

    try {
      const subjectTerms = db[aiSubject] || [];
      const question = await generateAIQuestion(apiKey, aiSubject, subjectTerms, customContext, lang);
      setAiQuestion(question);
    } catch (err: any) {
      alert(t('alert_question_gen_error', { msg: err.message || err }));
    } finally {
      setAiLoading(false);
    }
  };

  const doHandleEvaluateAIAnswer = async () => {
    if (!apiKey) {
      alert(t('alert_need_api_key'));
      return;
    }
    if (!userAiAnswer.trim()) {
      alert(t('alert_type_answer_first'));
      return;
    }
    if (!aiQuestion) return;

    setEvaluating(true);
    try {
      const result = await evaluateAIAnswer(
        apiKey,
        aiQuestion.question,
        aiQuestion.sampleAnswer,
        userAiAnswer,
        lang
      );
      setAiEvaluation(result);
      // Award on evaluation (20 points for >= 80%) — it used to wait for the
      // "next question" click, so a good answer followed by leaving earned nothing.
      recordStudyActivity(result.score >= 80 ? 20 : 0);
    } catch (err: any) {
      alert(t('alert_answer_check_error', { msg: err.message || err }));
    } finally {
      setEvaluating(false);
    }
  };

  // --- Subject lifecycle (server mutations with optimistic registry cache) ---

  // Create a subject row + deck on the server, pre-seed the local caches, so a
  // subsequent setActiveSubjectId(newId) finds everything in place.
  const createSubjectOnServer = async (id: string, name: string, deck: TheoryData) => {
    await apiPost('/subjects', { id, name, deck });
    queryClient.setQueryData<SubjectEntry[]>(keys.subjects, (prev) => [...(prev ?? []), { id, name }]);
    queryClient.setQueryData<TheoryData>(keys.deck(id), deck);
  };

  const renameSubject = (id: string, name: string) => {
    queryClient.setQueryData<SubjectEntry[]>(keys.subjects, (prev) =>
      (prev ?? []).map((s) => (s.id === id ? { ...s, name } : s))
    );
    void apiPatch(`/subjects/${id}`, { name }).catch((e) => {
      console.error('rename subject failed', e);
      void queryClient.invalidateQueries({ queryKey: keys.subjects });
    });
  };

  const deleteSubject = (id: string) => {
    const remaining = subjectsList.filter((s) => s.id !== id);
    queryClient.setQueryData<SubjectEntry[]>(keys.subjects, remaining);
    queryClient.removeQueries({ queryKey: ['subject', id] });
    invalidateAutoLang(id);
    void apiDelete(`/subjects/${id}`).catch((e) => {
      console.error('delete subject failed', e);
      void queryClient.invalidateQueries({ queryKey: keys.subjects });
    });
    if (activeSubjectId === id) setActiveSubjectId(remaining[0]?.id ?? '');
    if (!remaining.length) {
      // Deleted the last course → back to the landing screen to create one.
      setShowSubjectManager(false);
      goHome();
    }
  };

  // A course with no cards yet — for students without an AI key, or who'd
  // rather build the deck by hand (dictionary) or import JSON.
  const doCreateEmptyCourse = async (name: string) => {
    const newId = 'subject_' + Date.now();
    await createSubjectOnServer(newId, name, {});
    setActiveSubjectId(newId);
    localStorage.setItem(LS_ENTERED, '1');
    setEntered(true);
    navigate('/loader');
  };

  // Load custom JSON database
  const handleLoadCustomJson = async (createAsNew = false) => {
    try {
      const parsed = JSON.parse(jsonPasteText);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(t('err_json_not_object'));
      }
      let count = 0;
      Object.entries(parsed).forEach(([key, value]) => {
        if (!Array.isArray(value)) {
          throw new Error(t('err_json_topic_not_array', { key }));
        }
        value.forEach((item: any) => {
          if (typeof item.term !== 'string' || typeof item.definition !== 'string') {
            throw new Error(t('err_json_bad_item', { key }));
          }
          count++;
        });
      });

      if (createAsNew) {
        const subName = prompt(t('loader_prompt_subject_name'), t('loader_prompt_subject_default'));
        if (!subName || !subName.trim()) return;
        const newId = 'subject_' + Date.now();

        // Create on the server first, then switch — the deck query finds it seeded.
        await createSubjectOnServer(newId, subName.trim(), mergeDecks({}, parsed)); // dedupes terms
        setActiveSubjectId(newId);
        alert(t('alert_subject_created', { name: subName.trim(), count }));
      } else {
        // Merge into active subject card-by-card (the setter persists to the server).
        setDb(mergeDecks(db, parsed));
        invalidateAutoLang(activeSubjectId);
        alert(t('alert_json_merged', { groups: Object.keys(parsed).length, count }));
      }

      setJsonPasteText('');
      triggerConfetti('success');
    } catch (err: any) {
      alert(t('alert_json_load_error', { msg: err.message }));
    }
  };

  // Enter the portal from the landing screen with the chosen subject (sticky across refreshes)
  const enterPortal = (subjectId: string) => {
    if (subjectId !== activeSubjectId) setActiveSubjectId(subjectId);
    localStorage.setItem(LS_ENTERED, '1');
    setEntered(true);
    navigate('/');
  };

  // Return to the landing hub (e.g. by clicking the logo)
  function goHome() {
    localStorage.removeItem(LS_ENTERED);
    setEntered(false);
    navigate('/');
  }

  // Create a brand-new course from dropped files (syllabus -> full study set), then enter it.
  // Called from the landing screen; throws on error so the modal can show it.
  const doCreateCourseFromFiles = async (name: string, files: { name: string; text: string; file?: File }[]) => {
    if (!apiKey) throw new Error(t('err_missing_api_key_create'));
    const materials = files.map(f => `===== ${f.name} =====\n${f.text}`).join('\n\n');
    // The course doesn't exist yet — detect its language from the materials in
    // hand (best signal we'll ever have) and use it for generation too.
    const courseLang = detectLang(materials.slice(0, 24_000), browserLang());
    // Categorize FIRST (parallel per file, fast): the categories decide which
    // file plays which role in deck generation (syllabus = structure, lectures
    // = content, past exams = emphasis).
    const items = await Promise.all(files.map(f => classifyToItem(f.name, f.text)));
    const deck = await generateStudyDeckFromMaterials(apiKey, toDeckMaterials(items), courseLang);
    const built: TheoryData = {};
    let count = 0;
    (deck.parts || []).forEach(p => {
      const cards = (p.cards || []).filter(c => c && typeof c.term === 'string' && typeof c.definition === 'string' && c.term.trim());
      if (cards.length && p.title) { built[p.title.trim()] = cards; count += cards.length; }
    });
    if (count === 0) throw new Error(t('err_no_cards_from_materials'));

    const newId = 'subject_' + Date.now();
    // Pre-cache the detected language so 'auto' resolves instantly on entry.
    cacheAutoLang(newId, courseLang);
    // Subject row must exist before its materials (FK); materials land before
    // the switch so the library query finds them.
    await createSubjectOnServer(newId, name, built);
    const limits = await queryClient
      .fetchQuery({ queryKey: keys.limits, queryFn: fetchServerLimits, staleTime: Infinity })
      .catch(() => ({} as ServerLimits));
    for (const [i, item] of items.entries()) {
      // Keep the original upload too (same as uploads on the materials page) —
      // unless it would exceed the server's request limit; the text still goes up.
      let original = files[i].file;
      if (original && limits.maxUploadMb && original.size + new Blob([item.text]).size > limits.maxUploadMb * MB) original = undefined;
      await postMaterial(newId, item, original).catch(e => console.error('new-course material upload failed', e));
    }
    setActiveSubjectId(newId);
    localStorage.setItem(LS_ENTERED, '1');
    setEntered(true);
    navigate('/');
    recordStudyActivity(5);
    triggerConfetti('perfect');
  };

  // Read uploaded study-material files and append their text to the AI course-material context
  // Add uploaded files to the materials library: extract text, AI-categorize
  // (heuristic fallback), one library item per file.
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setFileParsing(true);
    setFileError('');
    const extracted: { name: string; text: string; file: File }[] = [];
    const errors: string[] = []; // one line per problem file (they used to overwrite each other)

    for (const file of Array.from(fileList)) {
      try {
        const text = await extractTextFromFile(file);
        if (text && text.trim()) {
          extracted.push({ name: file.name, text: text.trim(), file });
        } else {
          errors.push(t('err_file_no_text', { name: file.name }));
        }
      } catch (err: any) {
        errors.push(t('err_file_read', { name: file.name, msg: err?.message || err }));
      }
    }
    if (errors.length) setFileError(errors.join('\n'));

    if (extracted.length) {
      const items = await Promise.all(extracted.map(f => classifyToItem(f.name, f.text)));
      // Ship the originals too — they're kept on the server from now on.
      addLibraryItems(items, new Map(extracted.map(f => [f.name, f.file])));
      setUploadedFileNames(prev => [...prev, ...extracted.map(f => f.name)]);
      triggerConfetti('success');
    }
    setFileParsing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // AI: split the course by syllabus, then generate flashcards per part (into active or a new subject)
  const doHandleBuildDeck = async () => {
    if (!apiKey) { alert(t('alert_need_api_key')); return; }
    if (!customContext.trim()) { alert(t('alert_upload_or_paste_first')); return; }
    setDeckGenerating(true);
    setDeckOverview('');
    try {
      const deck = await generateStudyDeckFromMaterials(apiKey, toDeckMaterials(library), lang);
      const parts = (deck.parts || [])
        .map(p => ({
          title: (p.title || '').trim(),
          cards: (p.cards || []).filter(c => c && typeof c.term === 'string' && c.term.trim() && typeof c.definition === 'string'),
        }))
        .filter(p => p.title && p.cards.length);
      if (!parts.length) throw new Error(t('err_no_cards_try_detailed'));
      // Don't save yet — hand it to the review/confirm gate.
      setPendingDeck({ deck: { courseOverview: deck.courseOverview || '', parts }, targetName: buildSubjectName.trim() });
    } catch (err: any) {
      alert(t('alert_deck_build_error', { msg: err?.message || err }));
    } finally {
      setDeckGenerating(false);
    }
  };

  // Confirm the reviewed (possibly edited) deck → save it.
  const [confirmingDeck, setConfirmingDeck] = useState(false);
  const doConfirmPendingDeck = async (finalDeck: StudyDeck, targetName: string) => {
    if (confirmingDeck) return; // double-click would create the new course twice
    const built: TheoryData = {};
    let count = 0;
    finalDeck.parts.forEach(p => {
      if (p.title && p.cards.length) { built[p.title] = p.cards; count += p.cards.length; }
    });
    if (count === 0) { setPendingDeck(null); return; }
    if (targetName) {
      setConfirmingDeck(true);
      try {
        const newId = 'subject_' + Date.now();
        await createSubjectOnServer(newId, targetName, built);
        // Copy the active course's materials to the new course (text-only copies;
        // id stripped so the server mints fresh rows instead of hijacking the source's).
        for (const m of library) {
          await postMaterial(newId, { ...m, id: '' })
            .catch(e => console.error('copy material to new course failed', e));
        }
        setActiveSubjectId(newId);
        setBuildSubjectName('');
      } catch (e) {
        alert(t('alert_deck_build_error', { msg: e instanceof Error ? e.message : String(e) }));
        return; // keep the preview open so nothing is lost
      } finally {
        setConfirmingDeck(false);
      }
    } else {
      const mode = pendingDeck?.mode || 'merge';
      let updated: TheoryData;
      if (mode === 'replace-subject') {
        updated = built;
      } else if (mode === 'replace-topic' && pendingDeck?.replaceTopic) {
        // Replace IN PLACE — topics follow the syllabus order, so the
        // regenerated topic must not jump to the end of the deck.
        const replaced = pendingDeck.replaceTopic;
        updated = {};
        for (const [topic, cards] of Object.entries(db)) {
          if (topic === replaced) Object.assign(updated, built);
          else if (!(topic in built)) updated[topic] = cards;
        }
        Object.assign(updated, built); // no-op unless the topic vanished meanwhile
      } else {
        updated = mergeDecks(db, built);
      }
      setDb(updated); // the setter persists to the server (debounced)
      invalidateAutoLang(activeSubjectId); // deck content changed → re-detect on next 'auto' resolve
      if (mode !== 'merge') {
        // Reconcile FSRS: drop cards whose terms were replaced away, add the new
        // ones now (instead of waiting for the next review session). Surviving
        // terms keep their scheduling state. `updated` is passed explicitly —
        // the debounced deck save may not have reached the server yet.
        void removeOrphanCards(activeSubjectId, updated)
          .then(() => ensureCardsForSubject(activeSubjectId, updated))
          .catch(e => console.error('FSRS reconcile after regenerate failed', e));
      }
    }
    setDeckOverview(finalDeck.courseOverview || '');
    setPendingDeck(null);
    recordStudyActivity(5);
    triggerConfetti('perfect');
    alert(t('alert_deck_saved', { parts: finalDeck.parts.length, cards: count }));
  };
  const discardPendingDeck = () => setPendingDeck(null);

  // Regenerate the cards of ONE topic via AI → preview in the DeckReviewGate →
  // on confirm, replaces db[topic] (FSRS state of surviving terms preserved).
  const doRegenerateTopic = async (topic: string) => {
    if (!apiKey) { alert(t('alert_need_api_key')); return; }
    const existing = db[topic] || [];
    setRegeneratingTopic(topic);
    try {
      const cards = await regenerateTopicCards(apiKey, topic, existing, customContext, lang);
      if (!cards.length) throw new Error(t('err_ai_no_cards'));
      setPendingDeck({
        deck: { courseOverview: '', parts: [{ title: topic, cards }] },
        targetName: '',
        mode: 'replace-topic',
        replaceTopic: topic,
      });
    } catch (err) {
      alert(t('alert_topic_regen_failed', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setRegeneratingTopic(null);
    }
  };

  // Regenerate the WHOLE deck from the course materials → preview gate →
  // on confirm, replaces every topic of the current course.
  const doRegenerateWholeDeck = async () => {
    if (!apiKey) { alert(t('alert_need_api_key')); return; }
    if (!customContext.trim()) { alert(t('alert_no_materials')); return; }
    if (!window.confirm(t('confirm_regen_deck'))) return;
    setDeckGenerating(true);
    try {
      const deck = await generateStudyDeckFromMaterials(apiKey, toDeckMaterials(library), lang);
      const parts = (deck.parts || [])
        .map(p => ({
          title: (p.title || '').trim(),
          cards: (p.cards || []).filter(c => c && typeof c.term === 'string' && c.term.trim() && typeof c.definition === 'string'),
        }))
        .filter(p => p.title && p.cards.length);
      if (!parts.length) throw new Error(t('err_no_cards_short'));
      setPendingDeck({
        deck: { courseOverview: deck.courseOverview || '', parts },
        targetName: '',
        mode: 'replace-subject',
      });
    } catch (err) {
      alert(t('alert_deck_regen_failed', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeckGenerating(false);
    }
  };

  // --- Manual card editing (dictionary) -------------------------------------
  // Add or edit a single card by hand. `original` identifies the card being
  // edited (its old topic/term); omitted for a brand-new card. Terms must be
  // unique across the whole deck — the FSRS card id is `subjectId::term`.
  const saveCard = (input: {
    topic: string;
    term: string;
    definition: string;
    original?: { topic: string; term: string };
  }): boolean => {
    const topic = input.topic.trim();
    const term = input.term.trim();
    const definition = input.definition.trim();
    if (!topic || !term) return false;

    // Uniqueness guard (skip the card being edited itself).
    for (const [existingTopic, terms] of Object.entries(db)) {
      for (const c of terms) {
        if (c.term === term && !(input.original && input.original.topic === existingTopic && input.original.term === term)) {
          alert(t('err_term_exists', { term, topic: existingTopic }));
          return false;
        }
      }
    }

    const updated: TheoryData = { ...db };
    if (input.original) {
      const remaining = (updated[input.original.topic] ?? []).filter(c => c.term !== input.original!.term);
      if (remaining.length) updated[input.original.topic] = remaining;
      else delete updated[input.original.topic];
    }
    updated[topic] = [...(updated[topic] ?? []), { term, definition }];
    setDb(updated);
    invalidateAutoLang(activeSubjectId);
    // New terms become fresh FSRS cards; edited definitions/topics carry over
    // onto the existing card WITHOUT touching its scheduling.
    void reconcileDeckCards(activeSubjectId, updated)
      .catch(e => console.error('FSRS reconcile after manual card edit failed', e));
    return true;
  };

  // Delete one card (its review-log history is kept, like every card removal).
  const removeCard = (topic: string, term: string) => {
    const updated: TheoryData = { ...db };
    const remaining = (updated[topic] ?? []).filter(c => c.term !== term);
    if (remaining.length) updated[topic] = remaining;
    else delete updated[topic];
    setDb(updated);
    invalidateAutoLang(activeSubjectId);
    void reconcileDeckCards(activeSubjectId, updated)
      .catch(e => console.error('FSRS reconcile after manual card delete failed', e));
  };

  // Dashboard course chat
  const doSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    if (!apiKey) { alert(t('alert_need_api_key')); return; }
    const history = chatMessages;
    setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const dbSummary = Object.entries(db)
        .map(([k, terms]) => `${k}: ${terms.map(t => t.term).join(', ')}`)
        .join('\n');
      const context = `${t('chat_ctx_topics')}\n${dbSummary}\n\n${t('chat_ctx_materials')}\n${customContext}`;
      const reply = await chatAboutCourse(apiKey, context, history, msg, lang);
      setChatMessages(prev => [...prev, { role: 'model', text: reply }]);
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: 'model', text: t('chat_error', { msg: err?.message || err }) }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Distill a chat answer (or any text) into flashcards and merge into the active subject.
  const doSaveTextAsCards = async (text: string) => {
    if (!apiKey) { alert(t('alert_need_api_key')); return; }
    try {
      const cards = await distillToCards(apiKey, text, lang);
      if (!cards.length) { alert(t('alert_no_cards_from_text')); return; }
      const topic = t('chat_cards_topic');
      const updated = mergeDecks(db, { [topic]: cards }); // no duplicate terms
      setDb(updated); // persists via the server-state saver
      recordStudyActivity(2);
      triggerConfetti('success');
      alert(t('alert_cards_added', { count: cards.length, topic }));
    } catch (err: any) {
      alert(t('alert_cards_create_error', { msg: err?.message || err }));
    }
  };

  // Resize the floating chat window by dragging its top-left corner (window is pinned bottom-right)
  const onChatResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeStart.current = { x: e.clientX, y: e.clientY, w: chatSize.w, h: chatSize.h };
    const onMove = (ev: PointerEvent) => {
      const s = resizeStart.current;
      if (!s) return;
      const w = Math.min(760, Math.max(300, s.w + (s.x - ev.clientX)));
      const h = Math.min(window.innerHeight - 40, Math.max(340, s.h + (s.y - ev.clientY)));
      setChatSize({ w, h });
    };
    const onUp = () => {
      resizeStart.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Study plan from exam date
  const doHandleGeneratePlan = async () => {
    if (!apiKey) { alert(t('alert_need_api_key')); return; }
    if (!examDate) { alert(t('alert_pick_exam_date')); return; }
    const today = localDateStr();
    if (examDate < today) { alert(t('alert_exam_date_passed')); return; }
    setPlanGenerating(true);
    try {
      const partsSummary = Object.keys(db).length
        ? Object.entries(db).map(([k, terms], i) => t('plan_ctx_part', { n: i + 1, name: k, count: terms.length })).join('\n')
        : t('plan_ctx_no_parts');
      const plan = await generateStudyPlan(apiKey, partsSummary, examDate, today, lang);
      if (!plan.length) throw new Error(t('err_no_plan'));
      setStudyPlan(plan);
      recordStudyActivity(0);
      triggerConfetti('success');
    } catch (err: any) {
      alert(t('alert_plan_error', { msg: err?.message || err }));
    } finally {
      setPlanGenerating(false);
    }
  };

  // Download the whole plan (+ exam) as an .ics file for import into Google Calendar
  const downloadPlanICS = () => {
    const events = studyPlan.map(d => ({
      title: `📚 ${d.title}`,
      iso: d.date,
      details: `${d.focus || ''}${d.tasks && d.tasks.length ? '\n\n' + d.tasks.map(t => '• ' + t).join('\n') : ''}`.trim(),
    }));
    if (examDate) events.push({ title: t('plan_exam_event_title'), iso: examDate, details: t('plan_exam_event_details') });
    if (!events.length) return;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const blob = new Blob([buildICS(events, stamp)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tomurized-study-plan.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // (Leitner box stats replaced by FSRS-backed <MemoryTile/>.)

  // Async actions behind buttons run one at a time — a double-click must not
  // create two courses, send a chat message twice, etc. (see lib/useGuard).
  const guardDeckSave = useGuard();
  const guardCreate = useGuard();
  const guardDeckGen = useGuard();
  const guardExam = useGuard();
  const guardMentor = useGuard();
  const guardChat = useGuard();
  const guardChatCards = useGuard();
  const guardPlan = useGuard();
  const guardPaste = useGuard();
  const confirmPendingDeck = (finalDeck: StudyDeck, targetName: string) => guardDeckSave(() => doConfirmPendingDeck(finalDeck, targetName));
  const createEmptyCourse = (name: string) => guardCreate(() => doCreateEmptyCourse(name));
  const createCourseFromFiles = (name: string, files: { name: string; text: string; file?: File }[]) => guardCreate(() => doCreateCourseFromFiles(name, files));
  const handleBuildDeck = () => guardDeckGen(() => doHandleBuildDeck());
  const regenerateWholeDeck = () => guardDeckGen(() => doRegenerateWholeDeck());
  const regenerateTopic = (topic: string) => guardDeckGen(() => doRegenerateTopic(topic));
  const startAiExam = () => guardExam(() => doStartAiExam());
  const handleGenerateAIQuestion = () => guardMentor(() => doHandleGenerateAIQuestion());
  const handleEvaluateAIAnswer = () => guardMentor(() => doHandleEvaluateAIAnswer());
  const sendChat = () => guardChat(() => doSendChat());
  const saveTextAsCards = (text: string) => guardChatCards(() => doSaveTextAsCards(text));
  const handleGeneratePlan = () => guardPlan(() => doHandleGeneratePlan());
  const addPastedText = (text: string) => guardPaste(() => doAddPastedText(text));

  // --- Boot gate: App.tsx holds a spinner until the boot-critical queries
  // settle (subjects registry + active subject's deck/meta + the global
  // progress/settings docs — games/highScores.ts reads ['progress'] from the
  // cache synchronously and relies on this priming). On LAN this is
  // imperceptible; on failure App shows an error card with a retry.
  const bootLoading =
    subjectsQuery.isLoading || deckSync.isLoading || metaSync.isLoading ||
    progressSync.isLoading || settingsSync.isLoading;
  const bootError = subjectsQuery.isError && subjectsList.length === 0;
  const retryBoot = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const stats = useMemo(() => {
    const totalSubjects = Object.keys(db).length;
    const completedCount = Object.values(completedSubjects).filter(Boolean).length;
    const completionPercent = totalSubjects > 0 ? Math.round((completedCount / totalSubjects) * 100) : 0;
    
    const averageScore = scoreHistory.length > 0
      ? Math.round(scoreHistory.reduce((sum, r) => sum + r.score, 0) / scoreHistory.length)
      : null;

    return {
      totalSubjects,
      completedCount,
      completionPercent,
      averageScore
    };
  }, [db, completedSubjects, scoreHistory]);

  return {
    saveTextAsCards,
    saveCard,
    removeCard,
    pendingDeck,
    confirmPendingDeck,
    confirmingDeck,
    discardPendingDeck,
    regenerateTopic,
    regenerateWholeDeck,
    regeneratingTopic,
    theme,
    setTheme,
    subjectsList,
    renameSubject,
    deleteSubject,
    bootLoading,
    bootError,
    retryBoot,
    activeSubjectId,
    setActiveSubjectId,
    showSubjectManager,
    setShowSubjectManager,
    newSubjectName,
    setNewSubjectName,
    renameSubjectName,
    setRenameSubjectName,
    editingSubjectId,
    setEditingSubjectId,
    db,
    setDb,
    completedSubjects,
    setCompletedSubjects,
    scoreHistory,
    setScoreHistory,
    customContext,
    library,
    setMaterialCategory,
    removeMaterial,
    addPastedText,
    apiKey,
    setApiKey,
    openAiKey,
    setOpenAiKey,
    showApiKeyInput,
    setShowApiKeyInput,
    langSetting,
    setLangSetting,
    lang,
    dir,
    t,
    studyPoints,
    setStudyPoints,
    streakDays,
    setStreakDays,
    streakShields,
    setStreakShields,
    searchQuery,
    setSearchQuery,
    selectedTheoryFilter,
    setSelectedTheoryFilter,
    flashcardSubject,
    setFlashcardSubject,
    examSubject,
    setExamSubject,
    examQuestions,
    setExamQuestions,
    selectedAnswers,
    setSelectedAnswers,
    examSubmitted,
    setExamSubmitted,
    examActive,
    setExamActive,
    aiSubject,
    setAiSubject,
    aiLoading,
    setAiLoading,
    aiQuestion,
    setAiQuestion,
    userAiAnswer,
    setUserAiAnswer,
    aiEvaluation,
    setAiEvaluation,
    evaluating,
    setEvaluating,
    jsonPasteText,
    setJsonPasteText,
    entered,
    setEntered,
    fileParsing,
    setFileParsing,
    uploadedFileNames,
    setUploadedFileNames,
    fileError,
    setFileError,
    isDragging,
    setIsDragging,
    deckGenerating,
    setDeckGenerating,
    deckOverview,
    setDeckOverview,
    buildSubjectName,
    setBuildSubjectName,
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    chatLoading,
    setChatLoading,
    chatOpen,
    setChatOpen,
    chatSize,
    setChatSize,
    examDate,
    setExamDate,
    studyPlan,
    setStudyPlan,
    planGenerating,
    setPlanGenerating,
    navigate,
    location,
    fileInputRef,
    chatEndRef,
    resizeStart,
    recordStudyActivity,
    buyStreakShield,
    triggerConfetti,
    toggleSubjectCompleted,
    highlightSearch,
    allTermsList,
    startExam,
    submitExam,
    pastExams,
    startAiExam,
    aiExamLoading,
    handleGenerateAIQuestion,
    handleEvaluateAIAnswer,
    handleLoadCustomJson,
    enterPortal,
    goHome,
    createCourseFromFiles,
    createEmptyCourse,
    hasCourse,
    cardsVersion,
    handleFiles,
    handleBuildDeck,
    sendChat,
    onChatResizeStart,
    handleGeneratePlan,
    downloadPlanICS,
    stats,
  };
}

export type PortalValue = ReturnType<typeof usePortalState>;
