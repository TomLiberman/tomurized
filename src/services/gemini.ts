// Gemini model used for question generation + answer evaluation.
// (gemini-1.5-flash was retired from the API — keep this to a currently-supported model.)
import { langName, t as uiText, type Lang } from '../i18n';

const GEMINI_MODEL = 'gemini-2.5-flash';

// Shared output-language instruction for every generator prompt. `lang` is the
// course's RESOLVED language ('auto' is unrepresentable at this layer).
const outLang = (lang: Lang) =>
  `Output language: ${langName(lang)}. Write ALL user-facing text in ${langName(lang)}; keep proper names, acronyms and citations as-is.`;

interface GeminiQuestion {
  question: string;
  testedTerms: string[];
  sampleAnswer: string;
}

interface GeminiEvaluation {
  isCorrect: boolean;
  evaluation: 'correct' | 'partial' | 'incorrect';
  score: number;
  feedback: string;
}

export async function generateAIQuestion(
  apiKey: string,
  subjectName: string,
  terms: { term: string; definition: string }[],
  customContext: string,
  lang: Lang
): Promise<GeminiQuestion> {
  const termsText = terms.map(t => `${t.term}: ${t.definition}`).join('\n');
  const prompt = `You are a university professor teaching this course. Based on the following course concepts for the topic "${subjectName}", generate a challenging and educational open-ended study question that tests the student's deep understanding of the concepts.
  
Knowledge Base:
${termsText}

${customContext ? `Additional Custom Study Material:\n${customContext}\n` : ''}

${outLang(lang)} You must return a JSON object with this exact JSON structure:
{
  "question": "The question",
  "testedTerms": ["list of terms tested by this question"],
  "sampleAnswer": "A brief explanation of what is expected in a correct answer"
}

Do not include any markdown formatting like \`\`\`json. Return only the raw JSON string.`;

  try {
    return await callGeminiParsed<GeminiQuestion>(apiKey, prompt);
  } catch (error) {
    console.error('Error calling Gemini API for question:', error);
    throw error;
  }
}

export async function evaluateAIAnswer(
  apiKey: string,
  question: string,
  sampleAnswer: string,
  userAnswer: string,
  lang: Lang
): Promise<GeminiEvaluation> {
  const prompt = `You are a university professor. Evaluate the student's answer to the following question.
  
Question:
${question}

Expected guidelines / Sample Answer:
${sampleAnswer}

User's Answer:
${userAnswer}

Evaluate if the answer is completely correct, partially correct, or incorrect. Provide detailed, encouraging, and constructive feedback. Explain why, point out what was got wrong or missed, and explain how the answer could be improved. ${outLang(lang)}
You must return a JSON object with this exact JSON structure:
{
  "isCorrect": true/false (set to true if completely correct, false if partial or incorrect),
  "evaluation": "correct" or "partial" or "incorrect",
  "score": 0 to 100 (integer representing accuracy of user's answer),
  "feedback": "Detailed feedback telling the user what they got right, what they missed or got wrong, and how they could improve their response."
}

Do not include any markdown formatting like \`\`\`json. Return only the raw JSON string.`;

  try {
    return await callGeminiParsed<GeminiEvaluation>(apiKey, prompt);
  } catch (error) {
    console.error('Error calling Gemini API for evaluation:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers + newer features (deck builder, course chat, study plan)
// ---------------------------------------------------------------------------

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ---------------------------------------------------------------------------
// Resilient model transport: Gemini first; on a transient failure (503 "high
// demand", 429, 5xx, network) retry once after a beat, then fall back to
// OpenAI when the user configured a fallback key in settings.
// ---------------------------------------------------------------------------

const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Set by usePortalState on every render (module-level, same pattern as the
// i18n current-language) so plain service calls can use it without threading.
let openAiFallbackKey = '';
export function setOpenAiFallbackKey(key: string) {
  openAiFallbackKey = key;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type ChatTurn = { role: 'user' | 'model'; text: string };

// Turn a provider's error response into a readable Error carrying the HTTP
// status (Gemini/OpenAI send JSON like {"error":{"message":"API key not valid"}}).
async function providerError(provider: string, response: Response): Promise<Error & { status: number }> {
  const raw = await response.text();
  let message = raw.slice(0, 300);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) message = parsed.error.message;
  } catch {
    /* not JSON — keep the raw text */
  }
  const err = new Error(`${provider} (${response.status}): ${message}`) as Error & { status: number };
  err.status = response.status;
  return err;
}

async function callGeminiOnce(apiKey: string, turns: ChatTurn[], json: boolean): Promise<string> {
  // Key in a header, not the query string — URLs end up in logs and proxies.
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: turns.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    }),
  });
  if (!response.ok) throw await providerError('Gemini', response);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Received empty response from Gemini');
  return text;
}

async function callOpenAIOnce(turns: ChatTurn[]): Promise<string> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiFallbackKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: turns.map((m) => ({ role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text })),
    }),
  });
  if (!response.ok) throw await providerError('OpenAI', response);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Received empty response from OpenAI');
  return text;
}

async function callModel(apiKey: string, promptOrTurns: string | ChatTurn[], json: boolean): Promise<string> {
  const turns: ChatTurn[] = typeof promptOrTurns === 'string' ? [{ role: 'user', text: promptOrTurns }] : promptOrTurns;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callGeminiOnce(apiKey, turns, json);
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      // Non-transient errors (400 bad request, 403 bad key...) — don't retry
      // or fail over; the fallback model can't fix those.
      if (status !== undefined && !RETRYABLE_STATUS.has(status)) throw e;
      if (attempt === 0) await wait(1200);
    }
  }
  if (openAiFallbackKey) {
    console.info('[tomurized] Gemini unavailable — falling back to OpenAI.');
    return callOpenAIOnce(turns);
  }
  throw lastErr;
}

// Low-level call that requests a JSON response and returns the raw text.
async function callGeminiJSON(apiKey: string, prompt: string): Promise<string> {
  return callModel(apiKey, prompt, true);
}

// Tolerant parse of a model's JSON reply: strips ```json fences and, if needed,
// extracts the outermost {...}/[...] block — so a stray sentence or fence doesn't
// discard the whole result.
export function parseModelJSON<T>(raw: string): T {
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    const starts = ['{', '['].map((c) => t.indexOf(c)).filter((i) => i !== -1);
    const first = starts.length ? Math.min(...starts) : -1;
    const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (first !== -1 && last > first) return JSON.parse(t.slice(first, last + 1)) as T;
    throw new Error(uiText('err_ai_json'));
  }
}

// Call the model for JSON, tolerantly parse, retry once on a PARSE failure.
// HTTP errors are not retried here: callModel already retried the transient
// ones, and a bad key / bad request can't succeed on a second try.
async function callGeminiParsed<T>(apiKey: string, prompt: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callGeminiJSON(apiKey, prompt); // HTTP errors propagate as-is
    try {
      return parseModelJSON<T>(raw);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(uiText('err_ai_bad_format'));
}

export interface DeckCard { term: string; definition: string }
export interface DeckPart { title: string; cards: DeckCard[] }
export interface StudyDeck { courseOverview: string; parts: DeckPart[] }

// Analyse raw course materials, split the course by its syllabus, then build flashcards per part.
// The course materials, pre-sorted by their library category so each section
// can be given a distinct role in the prompt (the syllabus drives structure,
// lectures drive content, past exams drive emphasis).
export interface DeckMaterials {
  /** Syllabus file(s), concatenated. '' when the course has none. */
  syllabus: string;
  /** Study content: presentations, lecture summaries, book chapters, articles. */
  content: { name: string; text: string }[];
  /** Previous exams — used as an emphasis signal only. */
  pastExams: { name: string; text: string }[];
}

export async function generateStudyDeckFromMaterials(apiKey: string, materials: DeckMaterials, lang: Lang): Promise<StudyDeck> {
  // Token budget: syllabus is small and load-bearing (keep generously), content
  // gets the bulk shared across files, past exams only need enough to show
  // what gets tested.
  const contentCap = Math.max(8_000, Math.floor(100_000 / Math.max(1, materials.content.length)));
  const contentText = materials.content
    .map(f => `===== ${f.name} =====\n${f.text.slice(0, contentCap)}`)
    .join('\n\n');
  const pastExamsText = materials.pastExams
    .map(f => `===== ${f.name} =====\n${f.text}`)
    .join('\n\n')
    .slice(0, 20_000);

  const prompt = `You are an expert academic tutor building a complete exam-prep flashcard deck for a university course.

${materials.syllabus.trim() ? `== SYLLABUS — the AUTHORITATIVE course structure ==
"""
${materials.syllabus.slice(0, 20_000)}
"""` : '(No syllabus file was provided for this course.)'}

== COURSE MATERIALS (${materials.content.length} files, each starts with "===== filename =====") ==
"""
${contentText}
"""

${pastExamsText ? `== PAST EXAMS — emphasis signal only, never a content source to copy ==
"""
${pastExamsText}
"""` : ''}

METHOD — follow strictly, in this order:
1. STRUCTURE: ${materials.syllabus.trim()
    ? "Derive the deck parts from the SYLLABUS: one part per course unit/week/chapter, in the syllabus's timeline order. Part titles must use the syllabus's own unit names (keep unit/week numbers). Do NOT invent a structure that differs from the syllabus."
    : 'Infer the course structure from the materials themselves: presentation/lecture files usually mark the units — order them in a logical teaching sequence.'}
2. MAP each material file onto those parts by its content${materials.syllabus.trim() ? ' and where it falls in the syllabus timeline' : ''}. Presentation/slide decks and lecture summaries are the PRIMARY source for their part's cards; textbook chapters add depth to them.
3. RESEARCH ARTICLES / empirical studies are NOT for memorization. Per article generate at most 2-4 cards covering only: the research question, the method in one line, the KEY FINDINGS, and what they demonstrate about the course's concepts. Never card-ify an article's literature review, statistics tables, or procedure details.
4. PAST EXAMS show what this course actually tests: every concept a past exam touches MUST be covered by a card, and repeatedly-tested themes deserve the deepest coverage. Do not copy exam questions into cards.
5. IGNORE administrative content everywhere: grading schemes, deadlines, office hours, bibliographies/reading lists, acknowledgments.

Card rules:
- ${outLang(lang)}
- One concept per card: a short "term" and a self-contained "definition" (1-4 sentences) that makes sense without seeing any other card.
- Cover the WHOLE course, not just the beginning — every part gets thorough coverage (typically 6-15 cards per part).

Return ONLY a raw JSON object (no markdown fences) with this exact structure:
{
  "courseOverview": "2-3 sentence overview of the course",
  "parts": [
    { "title": "unit/part title", "cards": [ { "term": "the term", "definition": "the definition" } ] }
  ]
}`;
  return callGeminiParsed<StudyDeck>(apiKey, prompt);
}

// Socratic tutor: instead of the answer, return guiding questions that lead the
// student to work it out themselves (NotebookLM "Learning Guide" pattern).
export interface SocraticSet { questions: string[]; hint: string }
export async function socraticQuestions(
  apiKey: string,
  concept: string,
  referenceText: string,
  lang: Lang
): Promise<SocraticSet> {
  const prompt = `You are a Socratic tutor. The student wants to understand the concept below. DO NOT give the answer or definition. Instead, ask 3-4 short guiding questions that lead them, step by step, to construct the understanding themselves — from what they likely already know toward the key idea. Also give one gentle nudge/hint. ${outLang(lang)}

Concept: ${concept}
Reference (for YOUR grounding only — do not quote it as the answer):
"""${referenceText.slice(0, 4000)}"""

Return ONLY raw JSON (no fences):
{ "questions": ["guiding question 1", "guiding question 2", "guiding question 3"], "hint": "one gentle hint" }`;
  return callGeminiParsed<SocraticSet>(apiKey, prompt);
}

// Distill a block of text (e.g. an AI chat answer) into a few review flashcards.
export async function distillToCards(apiKey: string, text: string, lang: Lang): Promise<DeckCard[]> {
  const prompt = `From the following study text, extract 1-5 of the most important review flashcards (key terms/concepts and their concise definitions). ${outLang(lang)}

Text:
"""${text.slice(0, 8000)}"""

Return ONLY a raw JSON array (no markdown fences):
[ { "term": "the term", "definition": "a concise 1-2 sentence definition" } ]`;
  const cards = await callGeminiParsed<DeckCard[]>(apiKey, prompt);
  return Array.isArray(cards) ? cards.filter((c) => c && typeof c.term === 'string' && c.term.trim()) : [];
}

// Classify an uploaded course file into one of the library categories.
export type MaterialCategoryAI = 'summary' | 'syllabus' | 'past_exam' | 'other';
export async function categorizeMaterial(
  apiKey: string,
  fileName: string,
  textSample: string
): Promise<MaterialCategoryAI> {
  const prompt = `Classify this university course file into exactly one category.

Categories:
- "summary": lecture notes, class summaries, slides, textbook chapters, articles — study CONTENT.
- "syllabus": course outline/syllabus — list of topics, schedule, requirements, grading.
- "past_exam": a previous exam or practice exam — numbered questions, multiple choice, "מועד א/ב", points per question.
- "other": anything else (admin forms, unrelated files).

File name: ${fileName}
File content (beginning):
"""
${textSample.slice(0, 4000)}
"""

Return ONLY raw JSON (no fences): { "category": "summary" | "syllabus" | "past_exam" | "other" }`;
  const parsed = await callGeminiParsed<{ category: string }>(apiKey, prompt);
  const c = parsed?.category;
  return c === 'summary' || c === 'syllabus' || c === 'past_exam' || c === 'other' ? c : 'other';
}

// Regenerate the flashcards of ONE topic from the course materials. The
// existing cards are given as reference for scope — the model should produce a
// better, more complete set, not merely echo them.
export async function regenerateTopicCards(
  apiKey: string,
  topicTitle: string,
  existingCards: DeckCard[],
  materials: string,
  lang: Lang
): Promise<DeckCard[]> {
  const existingText = existingCards.map(c => `${c.term}: ${c.definition}`).join('\n');
  const prompt = `You are an expert academic tutor. Regenerate the study flashcards for ONE topic of a university course.

Topic: "${topicTitle}"

Current cards (reference for scope — improve on them, fix errors, fill gaps; do not just copy):
"""
${existingText.slice(0, 15000)}
"""

${materials.trim() ? `Course materials (ground truth — prefer these):
"""
${materials.slice(0, 60000)}
"""` : 'No raw materials available — rely on the current cards and solid academic knowledge of the topic.'}

Rules:
- ${outLang(lang)}
- Comprehensive coverage of THIS topic only: key terms, thinkers, models, definitions a student must know for an exam (typically 6-18 cards).
- Each card: short "term" + self-contained "definition" (1-4 sentences).
- No duplicate terms.

Return ONLY a raw JSON array (no markdown fences):
[ { "term": "the term", "definition": "the definition" } ]`;
  const cards = await callGeminiParsed<DeckCard[]>(apiKey, prompt);
  if (!Array.isArray(cards)) throw new Error(uiText('err_ai_bad_card_list'));
  const seen = new Set<string>();
  return cards.filter(c => {
    if (!c || typeof c.term !== 'string' || !c.term.trim() || typeof c.definition !== 'string' || !c.definition.trim()) return false;
    const key = c.term.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Free-form chat about the course, grounded in the provided context.
export async function chatAboutCourse(
  apiKey: string,
  context: string,
  history: { role: 'user' | 'model'; text: string }[],
  userMessage: string,
  lang: Lang
): Promise<string> {
  const [sourceMark, generalMark] =
    lang === 'he' ? ['【מקור: filename】', '【ידע כללי — לאמת】'] : ['【Source: filename】', '【General knowledge — verify】'];
  const preamble = `You are a helpful study assistant for a student's course. Answer questions about the course clearly and concisely, in ${langName(lang)} (unless the student writes in another language). Prefer the course material below; if something isn't covered there, you may use general knowledge but note it briefly.

CITATIONS: The material is split by "===== filename =====" markers. When your answer draws on the material, cite the source inline like ${sourceMark} so the student can verify it. If you use general knowledge instead, say so explicitly with ${generalMark}. Never invent citations.

Course material:
"""
${context.slice(0, 60000)}
"""`;

  const turns: ChatTurn[] = [
    { role: 'user', text: preamble },
    { role: 'model', text: uiText('chat_model_ack') },
    ...history.slice(-12).map(m => ({ role: m.role, text: m.text })),
    { role: 'user', text: userMessage },
  ];

  const text = await callModel(apiKey, turns, false);
  return text.trim();
}

// Feynman technique: grade a student's plain-language explanation of a concept
// and surface the gaps (which can then become new review cards).
export interface ExplanationFeedback { score: number; strengths: string[]; gaps: string[] }

export async function explainConceptFeedback(
  apiKey: string,
  concept: string,
  referenceText: string,
  explanation: string,
  lang: Lang
): Promise<ExplanationFeedback> {
  const prompt = `You are a tutor using the Feynman technique. A student explained a concept in their own words, as if teaching it. Assess their explanation against the reference material.

Concept: ${concept}
Reference (correct) material:
"""${referenceText}"""

Student's explanation:
"""${explanation}"""

Return ONLY raw JSON (no markdown fences) with this exact shape:
{
  "score": 0-100 integer for conceptual completeness and correctness,
  "strengths": ["short bullets: what they explained correctly"],
  "gaps": ["short bullets: specific missing or incorrect points — phrase each so it could become a follow-up flashcard question"]
}
${outLang(lang)} Be concise and specific.`;
  return callGeminiParsed<ExplanationFeedback>(apiKey, prompt);
}

export interface GeneratedMCQ {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  testedTerm: string;
}

// Generate exam-style multiple-choice questions grounded in the course deck.
// When the student has uploaded previous exams, mimic their style, phrasing,
// difficulty and question formats — that's what makes these feel like the real thing.
export async function generateExamMCQs(
  apiKey: string,
  courseName: string,
  terms: { term: string; definition: string; subject?: string }[],
  pastExamsText: string,
  count: number,
  lang: Lang
): Promise<GeneratedMCQ[]> {
  // Group the knowledge base by topic so the model can be held to per-topic
  // coverage ("at least 2 questions from each topic").
  const byTopic = new Map<string, string[]>();
  for (const t of terms) {
    const key = t.subject || courseName;
    const lines = byTopic.get(key) ?? [];
    lines.push(`${t.term}: ${t.definition}`);
    byTopic.set(key, lines);
  }
  const topicCount = byTopic.size;
  const termsText = [...byTopic.entries()]
    .map(([topic, lines]) => `### ${topic}\n${lines.join('\n')}`)
    .join('\n\n');
  const prompt = `You are a university professor writing a multiple-choice exam for the course "${courseName}".

Course concepts (the knowledge base — every question must be answerable from these; "###" headers are the course topics):
"""
${termsText.slice(0, 40000)}
"""

${pastExamsText ? `PREVIOUS REAL EXAMS from this course. Imitate them closely: question style, phrasing, difficulty, length, and the KINDS of questions asked (application, comparison, "which theorist said...", scenario analysis, etc.). Do NOT copy questions verbatim — write new ones in the same spirit:
"""
${pastExamsText.slice(0, 50000)}
"""` : 'No previous exams were provided — write challenging academic multiple-choice questions that test understanding and application, not just recall.'}

Write ${count} NEW multiple-choice questions. ${outLang(lang)} Rules:
${topicCount > 1 ? `- Cover ALL ${topicCount} topics ("###" sections): write AT LEAST 2 questions from EACH topic, spreading the rest across the topics that matter most.\n` : ''}- Each question stands alone and is fully self-contained.
- Exactly 4 options per question; exactly one is correct.
- Distractors must be plausible (common confusions, related concepts) — never absurd, never near-duplicates of each other or of the correct answer.
- NEVER leak the answer inside the question text.
- Mix question styles: definition/identification, application to a scenario, comparison between concepts, critique. If previous exams are provided, match THEIR mix.
- "testedTerm" must be the single course concept (copied EXACTLY from the knowledge base term list) that the question primarily tests; use "" if none fits.
- "explanation": 1-2 sentences explaining why the correct answer is right.

Return ONLY a raw JSON array (no markdown fences):
[ { "question": "...", "options": ["...","...","...","..."], "correctIndex": 0, "explanation": "...", "testedTerm": "..." } ]`;

  const parsed = await callGeminiParsed<GeneratedMCQ[]>(apiKey, prompt);
  if (!Array.isArray(parsed)) throw new Error(uiText('err_ai_bad_question_list'));
  // Keep only well-formed questions: non-empty text, 4 distinct options, valid answer index.
  return parsed.filter(q =>
    q && typeof q.question === 'string' && q.question.trim() &&
    Array.isArray(q.options) && q.options.length === 4 &&
    q.options.every(o => typeof o === 'string' && o.trim()) &&
    new Set(q.options.map(o => o.trim())).size === 4 &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4
  );
}

// "שאל את המנטור" lifeline (Millionaire game): a nudge toward the underlying
// concept WITHOUT naming the correct option — the student still has to choose.
export async function mentorHint(
  apiKey: string,
  question: string,
  options: string[],
  lang: Lang
): Promise<string> {
  const prompt = `You are a friendly study mentor. A student is playing a quiz game and used their one "ask the mentor" lifeline on this question.

Question:
${question}

Options:
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Give ONE short hint (1-2 sentences) that points at the underlying concept, theorist, or distinction the question tests. ${outLang(lang)} STRICT RULES: never name, quote, or paraphrase any of the options; never state which option is correct or incorrect; no option numbers. Just nudge their thinking.

Return ONLY raw JSON (no fences): { "hint": "the hint" }`;
  const parsed = await callGeminiParsed<{ hint: string }>(apiKey, prompt);
  const hint = typeof parsed?.hint === 'string' ? parsed.hint.trim() : '';
  if (!hint) throw new Error(uiText('err_mentor_no_hint'));
  return hint;
}

export interface StudyPlanDay { date: string; title: string; focus: string; tasks: string[] }

// Build a day-by-day study plan spanning today → exam date, over the course parts.
export async function generateStudyPlan(
  apiKey: string,
  partsSummary: string,
  examDateISO: string,
  todayISO: string,
  lang: Lang
): Promise<StudyPlanDay[]> {
  const prompt = `You are a study coach. Build a realistic day-by-day study plan for a student preparing for an exam.

Today's date: ${todayISO}
Exam date: ${examDateISO}

Course parts to cover (in order):
${partsSummary}

Rules (grounded in learning science — spacing, interleaving, testing, sleep):
- Spread the parts across the days from today until the day before the exam. Front-load new learning early, with WIDE spacing between first exposures.
- Interleave: once a few parts are learned, mix a short review of earlier parts into later days (do not study one part in isolation).
- Mid-plan: add increasing amounts of practice testing (spaced-repetition review + quizzes). Schedule at least one FULL practice exam about 3-5 days before the real exam.
- Final 1-2 days: LIGHT review of the weakest/most-forgotten material only — no new material — plus a "protect your sleep" reminder (sleep consolidates memory; do not cram overnight).
- If there are more parts than available days, group parts together; if there are more days than parts, add review / practice / rest days.
- Keep a realistic daily load (1-3 focus items per day).
- ${outLang(lang)} Use real calendar dates in YYYY-MM-DD, chronological, none before today, none after the exam date.

Return ONLY a raw JSON array (no markdown fences):
[ { "date": "YYYY-MM-DD", "title": "short day title", "focus": "the material to focus on", "tasks": ["task 1", "task 2"] } ]`;
  const parsed = await callGeminiParsed<StudyPlanDay[]>(apiKey, prompt);
  return Array.isArray(parsed) ? parsed : [];
}
