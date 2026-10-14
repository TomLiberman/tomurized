# Tomurized — guide for AI coding assistants and contributors

Self-hosted study portal: a **Vite + React (TypeScript)** SPA plus a small **Node API** (`server/`).
Hebrew-first (RTL) with full English support. See README.md for features and setup.

## Commands

- `npm run setup` — install web + server dependencies.
- `npm run dev` — API on :8080 (`node --watch`, data in `./data`) + Vite on :5173 (proxies `/api`).
- `npm test` (Vitest) · `npm run lint` (oxlint) · `npm run typecheck` · `npm run build`.
- `npm start` — production: one Node process serves `dist/` and `/api` on :8080.

## Architecture

- **Server is the single source of truth** for all user data: courses, decks, materials (+ original
  uploads on disk), FSRS cards and review logs, chats, scores, study plans, settings (AI keys),
  points/streaks, game high scores. The browser keeps only device prefs in localStorage
  (`tomurized_*`: theme, active course, chat window size, language-detection cache).
- **Backend** (`server/src`): Node 24 runs the `.ts` files directly (type stripping — no enums or
  namespaces), Hono, built-in `node:sqlite`. Routes mount at `/api`. DB `DATA_DIR/tomurized.db` (WAL),
  originals in `DATA_DIR/files/`. Also serves the built SPA (`STATIC_DIR`). No auth and no CORS by
  design (single-user, same-origin) — don't add a CORS wildcard.
- **API:** subjects CRUD (+ deck JSON per subject), per-subject kv docs `chat|plan|meta|scores`
  (`meta = {lang, examDate, completed}`), cards + `cards/sync` (ensure/orphan reconcile),
  `reviews` (+`/batch`, one transaction updates card FSRS + appends the log), materials (multipart
  upload keeps the original; upsert by name), `/settings`, `/progress`, `GET /export` +
  `POST /restore` (whole-database backup), `GET /health` (row counts — check it first when debugging).
- **Frontend data layer** (`src/api/`): TanStack Query. `useServerState` is a "server-backed useState":
  optimistic cache write + debounced (400 ms) save, `SetStateAction`-compatible. `queryClient.ts` is a
  module singleton so plain modules (e.g. `games/highScores.ts`) can read the cache synchronously —
  only for keys primed by the boot gate in `App.tsx`. Cross-device sync = `refetchOnWindowFocus`
  (last write wins). FSRS math and PDF/DOCX text extraction run client-side.
- **State:** `src/portal/usePortalState.tsx` holds the app state/handlers, exposed via
  `PortalContext` / `usePortal()`. Per-course queries are keyed `['subject', id, ...]` and are disabled
  when no course exists (fresh install → landing screen offers to create one).
- **Routing:** `HashRouter`. Assets are root-absolute, so the app must be served at a host root.
- **PWA:** vite-plugin-pwa (`autoUpdate`); `main.tsx` reloads open tabs when a new service worker takes
  over. `/api` is never cached. Each build logs `[tomurized] build <date>`.
- **AI:** client-side Gemini (`src/services/gemini.ts`, model in `GEMINI_MODEL`), retry + optional
  OpenAI fallback on transient errors, tolerant JSON parsing. Every generator takes the resolved course
  language as its last parameter.

## Conventions and gotchas

- **i18n:** add every UI string to BOTH `he` and `en` in `src/i18n/strings.ts` (the `satisfies`
  clause makes a missing key a compile error) and use `t('key')`. Course language is he | en | auto
  (auto = Hebrew-letter ratio of the deck, browser language when there is no content).
- **Never render a material's full extracted text into the DOM** — multi-MB RTL strings freeze the tab.
  Show names/sizes instead. The materials query uses `staleTime: Infinity` because it is large.
- **Exam questions:** the prompt must match the option type (definition→term shows TERM options,
  term→definition shows DEFINITION options). Shuffles are Fisher-Yates; distractors prefer the same
  topic. Pure logic lives in `games/questionEngine.ts` / `games/gameLogic.ts` (unit-tested).
- **Games** feed FSRS through `gradeExamResults` (worst-wins per term) and award points once per run via
  `useGameOutcome.finishRun`. Swipe uses PHYSICAL directions — never mirror them for RTL.
- **Card ids** are `${subjectId}::${term}` — terms are unique per course. Deck regeneration reconciles
  cards (`removeOrphanCards` + `ensureCardsForSubject`); surviving terms keep their FSRS state, review
  logs are never deleted.
- **Dates** for streaks/plans are LOCAL calendar days (`src/lib/streak.ts`), never `toISOString()`.
- **Async button actions** go through `useGuard` (`src/lib/useGuard.ts`): a double-click fires twice
  before React re-renders, so `disabled`/loading state alone can't prevent duplicates.
- **Adding cards to a deck** goes through `mergeDecks` (`src/lib/deck.ts`) — never `{ ...db, ...new }`,
  which replaces whole topics and silently drops cards.
- **Uploads** are size-checked in the browser against `/api/health` `limits` before sending (the server
  rejects oversized bodies before reading them, which browsers report only as "Failed to fetch").
- **Popovers near the header** must portal to `document.body` (the header's `backdrop-filter` traps
  `position: fixed` descendants).
