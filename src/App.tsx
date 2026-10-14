import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import { BookOpen, Layers, Award, Cpu, Upload, TrendingUp, Send, RefreshCw, Trash2, BookMarked, Gauge, Sparkles, Settings, Sun, Moon, X, MessageCircle, CalendarDays, Gamepad2 } from 'lucide-react';
import SettingsPanel from './components/SettingsPanel';
import Dropdown from './components/Dropdown';
import './App.css';
import './styles/tokens.css';
import './styles/polish.css';

import MarkdownText from './components/MarkdownText';
import LandingScreen from './routes/LandingScreen';
import { DirectionProvider } from '@base-ui-components/react/direction-provider';
import DashboardRoute from './routes/DashboardRoute';
import DictionaryRoute from './routes/DictionaryRoute';
import ReviewRoute from './routes/ReviewRoute';
import ExamRoute from './routes/ExamRoute';
import MentorRoute from './routes/MentorRoute';
import LoaderRoute from './routes/LoaderRoute';
import ProgressRoute from './routes/ProgressRoute';
import PlanRoute from './routes/PlanRoute';
import GamesHubRoute from './games/GamesHubRoute';
import BossBattleRoute from './games/BossBattleRoute';
import MillionaireRoute from './games/MillionaireRoute';
import MemoryMatchRoute from './games/MemoryMatchRoute';
import SwipeRoute from './games/SwipeRoute';
import { usePortalState } from './portal/usePortalState';
import { PortalContext } from './portal/context';
import { t } from './i18n';

export default function App() {
  return (
    <HashRouter>
      <PortalLayout />
    </HashRouter>
  );
}

function PortalLayout() {
  const s = usePortalState();
  const { theme, setTheme, subjectsList, bootLoading, bootError, retryBoot, activeSubjectId, setActiveSubjectId, showSubjectManager, setShowSubjectManager, entered, chatMessages, setChatMessages, chatInput, setChatInput, chatLoading, chatOpen, setChatOpen, chatSize, location, chatEndRef, enterPortal, goHome, createCourseFromFiles, createEmptyCourse, apiKey, setApiKey, sendChat, saveTextAsCards, onChatResizeStart } = s;

  // Position the settings popover on open by measuring the gear and clamping to
  // the viewport, so a wide panel anchored to an edge button never spills off-screen.
  const gearRef = useRef<HTMLButtonElement>(null);
  const [settingsPos, setSettingsPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!showSubjectManager) return;
    const place = () => {
      const el = gearRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const left = Math.min(Math.max(12, r.left), window.innerWidth - width - 12);
      const top = r.bottom + 8;
      setSettingsPos({ top, left, width, maxHeight: window.innerHeight - top - 12 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [showSubjectManager]);

  // Boot gate: the server is the source of truth — hold rendering until the
  // boot-critical queries settle (ms on LAN), or surface a retryable error.
  if (bootLoading || bootError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        {bootError ? (
          <>
            <p style={{ color: 'var(--text-main)', fontSize: '1rem', margin: 0 }}>{t('err_server_unreachable')}</p>
            <button className="btn btn-primary" onClick={retryBoot}>{t('boot_retry')}</button>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0 }}>{t('boot_loading')}</p>
        )}
      </div>
    );
  }

  // Show the animated "Tomurized" home screen until a subject is chosen.
  // Both branches are inside the provider + a dynamic DirectionProvider so the
  // whole tree (landing included) follows the resolved course language.
  if (!entered) {
    return (
      <PortalContext.Provider value={s}>
        <DirectionProvider direction={s.dir}>
          <LandingScreen
            subjects={subjectsList}
            onEnter={enterPortal}
            onCreateCourse={createCourseFromFiles}
            onCreateEmpty={createEmptyCourse}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
          />
        </DirectionProvider>
      </PortalContext.Provider>
    );
  }

  return (
    <PortalContext.Provider value={s}>
    <DirectionProvider direction={s.dir}>
    <div className="portal-container">
      {/* Header Bar */}
      <header className="portal-header">
        <div
          className="header-info header-home-btn"
          onClick={goHome}
          role="button"
          tabIndex={0}
          title={t('header_home_title')}
        >
          <BookMarked className="icon-main" />
          <div>
            <h1>{t('header_portal_title', { course: subjectsList.find(s => s.id === activeSubjectId)?.name || t('header_loading') })}</h1>
            <p className="subtitle">{t('header_subtitle')}</p>
          </div>
        </div>

        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Dropdown
            value={activeSubjectId}
            options={subjectsList.map(sub => ({ value: sub.id, label: sub.name }))}
            onChange={setActiveSubjectId}
            ariaLabel={t('header_pick_subject')}
          />

          <button
            className="btn-icon"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? t('header_theme_dark') : t('header_theme_light')}
            aria-label={t('header_theme_toggle')}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <div className="settings-wrapper" style={{ position: 'relative' }}>
            <button
              ref={gearRef}
              className="btn-icon"
              onClick={() => setShowSubjectManager(!showSubjectManager)}
              title={t('settings_title')}
              aria-label={t('settings_title')}
            >
              <Settings size={18} />
            </button>

            {showSubjectManager && createPortal((
              <>
                <div className="popover-backdrop" onClick={() => setShowSubjectManager(false)} />
                <div className="api-popover subject-manager-popover" style={{ position: 'fixed', top: settingsPos?.top ?? 64, left: settingsPos?.left ?? 12, right: 'auto', width: settingsPos?.width ?? 320, maxHeight: settingsPos?.maxHeight ?? undefined, overflowY: 'auto' }}>
                  <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-main)' }}>{t('settings_title')}</h4>
                  </div>

                  <SettingsPanel inCourse />
                </div>
              </>
            ), document.body)}
          </div>
        </div>
      </header>

      {/* Workspace Dashboard Layout */}
      <div className="portal-workspace">
        {/* Navigation Sidebar */}
        <aside className="portal-sidebar">
          <h3>{t('nav_menu')}</h3>
          <nav className="portal-nav">
            <Link to="/" className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}>
              <Gauge size={18} />
              <span>{t('nav_dashboard')}</span>
            </Link>
            <Link to="/dictionary" className={`nav-item ${location.pathname === '/dictionary' ? 'active' : ''}`}>
              <BookOpen size={18} />
              <span>{t('nav_dictionary')}</span>
            </Link>
            <Link to="/flashcards" className={`nav-item ${location.pathname === '/flashcards' ? 'active' : ''}`}>
              <Layers size={18} />
              <span>{t('nav_flashcards')}</span>
            </Link>
            <Link to="/games" className={`nav-item ${location.pathname.startsWith('/games') ? 'active' : ''}`}>
              <Gamepad2 size={18} />
              <span>{t('nav_games')}</span>
            </Link>
            <Link to="/exam" className={`nav-item ${location.pathname === '/exam' ? 'active' : ''}`}>
              <Award size={18} />
              <span>{t('nav_exam')}</span>
            </Link>
            <Link to="/ai" className={`nav-item ${location.pathname === '/ai' ? 'active' : ''}`}>
              <Cpu size={18} />
              <span>{t('nav_mentor')}</span>
            </Link>
            <Link to="/loader" className={`nav-item ${location.pathname === '/loader' ? 'active' : ''}`}>
              <Upload size={18} />
              <span>{t('nav_loader')}</span>
            </Link>
            <Link to="/progress" className={`nav-item ${location.pathname === '/progress' ? 'active' : ''}`}>
              <TrendingUp size={18} />
              <span>{t('nav_progress')}</span>
            </Link>
            <Link to="/plan" className={`nav-item ${location.pathname === '/plan' ? 'active' : ''}`}>
              <CalendarDays size={18} />
              <span>{t('nav_plan')}</span>
            </Link>
          </nav>
        </aside>

        {/* Main Content Pane */}
        <main className="portal-main-pane">
          <Routes>
            {/* --- ROUTE: BENTO DASHBOARD --- */}
            <Route path="/" element={<DashboardRoute />} />

            {/* --- ROUTE: DICTIONARY --- */}
            <Route path="/dictionary" element={<DictionaryRoute />} />

            {/* --- ROUTE: FLASHCARDS (Leitner boxes) --- */}
            <Route path="/flashcards" element={<ReviewRoute />} />

            {/* --- ROUTES: STUDY GAMES --- */}
            <Route path="/games" element={<GamesHubRoute />} />
            <Route path="/games/boss" element={<BossBattleRoute />} />
            <Route path="/games/millionaire" element={<MillionaireRoute />} />
            <Route path="/games/memory" element={<MemoryMatchRoute />} />
            <Route path="/games/swipe" element={<SwipeRoute />} />

            {/* --- ROUTE: EXAM MODE --- */}
            <Route path="/exam" element={<ExamRoute />} />

            {/* --- ROUTE: AI MENTOR --- */}
            <Route path="/ai" element={<MentorRoute />} />

            {/* --- ROUTE: DATA LOADER --- */}
            <Route path="/loader" element={<LoaderRoute />} />

            {/* --- ROUTE: PROGRESS --- */}
            <Route path="/progress" element={<ProgressRoute />} />

            {/* --- ROUTE: STUDY PLAN + CALENDAR --- */}
            <Route path="/plan" element={<PlanRoute />} />
          </Routes>
        </main>
      </div>

      {/* Floating course chat — available on every page within the subject */}
      <div className="floating-chat">
        {chatOpen ? (
          <div className="chat-window" style={{ width: chatSize.w, height: chatSize.h }}>
            <div className="chat-resize-handle" onPointerDown={onChatResizeStart} title={t('chat_resize_title')} />
            <div className="chat-window-header">
              <div className="cw-title">
                <MessageCircle size={17} />
                <span>{t('chat_title', { course: subjectsList.find(s => s.id === activeSubjectId)?.name || '' })}</span>
              </div>
              <div className="cw-actions">
                {chatMessages.length > 0 && (
                  <button className="btn-icon" onClick={() => setChatMessages([])} title={t('chat_clear')}>
                    <Trash2 size={15} />
                  </button>
                )}
                <button className="btn-icon" onClick={() => setChatOpen(false)} title={t('chat_close')}>
                  <X size={17} />
                </button>
              </div>
            </div>

            <div className="chat-messages">
              {chatMessages.length === 0 && !chatLoading && (
                <div className="chat-empty">
                  <MessageCircle size={26} />
                  <p>{t('chat_empty')}</p>
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div className={`chat-bubble ${m.role === 'user' ? 'user' : 'model'}`} key={i}>
                  {m.role === 'model' ? <MarkdownText withCitations>{m.text}</MarkdownText> : m.text}
                  {m.role === 'model' && !m.text.startsWith('⚠️') && (
                    <button
                      onClick={() => saveTextAsCards(m.text)}
                      title={t('chat_save_as_cards_title')}
                      style={{ marginTop: '8px', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 8px', color: 'var(--secondary-accent)', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <Sparkles size={11} /> {t('chat_save_as_cards')}
                    </button>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="chat-bubble model chat-typing">
                  <RefreshCw size={14} className="spin" /> {t('chat_thinking')}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-input-row">
              <input
                type="text"
                placeholder={t('chat_input_placeholder')}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                disabled={chatLoading}
              />
              <button className="btn btn-primary" onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>
                <Send size={16} />
              </button>
            </div>
          </div>
        ) : (
          <button className="chat-fab" onClick={() => setChatOpen(true)} title={t('chat_open')} aria-label={t('chat_open')}>
            <MessageCircle size={24} />
          </button>
        )}
      </div>
    </div>
    </DirectionProvider>
    </PortalContext.Provider>
  );
}
