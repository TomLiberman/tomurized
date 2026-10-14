import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleHelp, Loader2, Scissors, Shield, Sparkles, Trophy, Users } from 'lucide-react';
import { usePortal } from '../portal/context';
import { mentorHint } from '../services/gemini';
import { buildLocalQuestions } from './questionEngine';
import { LADDER, SAFE_HAVENS, prizeOnWrong, audiencePoll, fiftyFifty, millionairePoints } from './gameLogic';
import { useQuestionFeed } from './useQuestionFeed';
import { useGameOutcome } from './useGameOutcome';
import GameShell from './components/GameShell';
import GameSummaryView from './components/GameSummary';
import type { GameQuestion, GameResult, GameSummary } from './types';
import { t } from '../i18n';
import './games.css';

type Phase = 'question' | 'suspense' | 'reveal';

// מיליונר — a 10-question ladder with safe havens at Q3/Q6 and three lifelines.
// The ladder "prizes" are display flavor; study points come from millionairePoints.
export default function MillionaireRoute() {
  const { allTermsList, activeSubjectId, apiKey, subjectsList, pastExams, lang } = usePortal();
  const { finishRun } = useGameOutcome();

  const courseName = subjectsList.find(s => s.id === activeSubjectId)?.name || t('course_fallback_name');
  const pastExamsText = useMemo(
    () => pastExams.map(p => `===== ${p.name} =====\n${p.text}`).join('\n\n'),
    [pastExams]
  );
  const { takeAi } = useQuestionFeed({
    subjectId: activeSubjectId,
    fullPool: allTermsList,
    aiEnabled: !!apiKey,
    apiKey,
    courseName,
    pastExamsText,
    lang,
  });

  // AI-first: seed every ladder slot from the AI pool when it's already warm
  // (shared module cache — usually from the 2nd game run of the session on);
  // locally-built questions fill the gaps and get swapped out on advance.
  const [questions, setQuestions] = useState<GameQuestion[]>(() =>
    buildLocalQuestions(allTermsList, LADDER.length).map((local) => takeAi() ?? local)
  );
  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('question');
  const [selected, setSelected] = useState<string | null>(null);
  const [used, setUsed] = useState({ fifty: false, poll: false, mentor: false });
  const [kept, setKept] = useState<string[] | null>(null);
  const [poll, setPoll] = useState<Record<string, number> | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [done, setDone] = useState<{ summary: GameSummary; isNewBest: boolean; prize: number } | null>(null);
  const resultsRef = useRef<GameResult[]>([]);
  const missedRef = useRef<{ label: string; detail: string }[]>([]);
  const startRef = useRef(Date.now());

  const question = questions[qIndex];
  const visibleOptions = kept ?? question?.options ?? [];

  const finish = (won: boolean, correctCount: number, prize: number) => {
    const summary: GameSummary = {
      gameId: 'millionaire',
      score: prize,
      pointsAwarded: millionairePoints(correctCount, won),
      correct: correctCount,
      total: resultsRef.current.length,
      bestStreak: correctCount,
      durationMs: Date.now() - startRef.current,
      perfect: won,
    };
    const { isNewBest } = finishRun(summary, resultsRef.current);
    setDone({ summary, isNewBest, prize });
  };

  const select = (opt: string) => {
    if (phase !== 'question' || done) return;
    setSelected(opt);
    setPhase('suspense');
  };

  // Suspense beat, then reveal + record the result.
  useEffect(() => {
    if (phase !== 'suspense') return;
    const timer = setTimeout(() => {
      const correct = selected === question.correctAnswer;
      resultsRef.current.push({ term: question.term, correct });
      if (!correct) {
        missedRef.current.push({
          label: question.term || t('game_ai_question'),
          detail: question.definition || question.correctAnswer,
        });
      }
      setPhase('reveal');
    }, 1200);
    return () => clearTimeout(timer);
  }, [phase, selected, question]);

  const proceed = () => {
    if (phase !== 'reveal') return;
    const correct = selected === question.correctAnswer;
    const correctCount = resultsRef.current.filter(r => r.correct).length;

    if (!correct) {
      finish(false, correctCount, prizeOnWrong(qIndex));
      return;
    }
    // Small decks can yield fewer than 10 questions — the summit is the last one.
    if (qIndex + 1 >= Math.min(LADDER.length, questions.length)) {
      finish(true, correctCount, LADDER[qIndex]);
      return;
    }

    // Splice an AI question into the NEXT (not-yet-shown) slot when one is ready.
    const ai = takeAi();
    if (ai) {
      setQuestions(qs => {
        const next = [...qs];
        next[qIndex + 1] = ai;
        return next;
      });
    }
    setQIndex(qIndex + 1);
    setPhase('question');
    setSelected(null);
    setKept(null);
    setPoll(null);
    setHint(null);
  };

  const lifelineFifty = () => {
    if (used.fifty || phase !== 'question') return;
    setUsed(u => ({ ...u, fifty: true }));
    setKept(fiftyFifty(question.options, question.correctAnswer));
  };

  const lifelinePoll = () => {
    if (used.poll || phase !== 'question') return;
    setUsed(u => ({ ...u, poll: true }));
    setPoll(audiencePoll(visibleOptions, question.correctAnswer, qIndex));
  };

  const lifelineMentor = async () => {
    if (used.mentor || hintLoading || !apiKey || phase !== 'question') return;
    setUsed(u => ({ ...u, mentor: true }));
    setHintLoading(true);
    try {
      setHint(await mentorHint(apiKey, question.prompt, visibleOptions, lang));
    } catch (e) {
      console.warn('mentor hint failed:', e);
      setHint(t('game_million_mentor_unavailable'));
    } finally {
      setHintLoading(false);
    }
  };

  const restart = () => {
    setQuestions(buildLocalQuestions(allTermsList, LADDER.length));
    setQIndex(0);
    setPhase('question');
    setSelected(null);
    setUsed({ fifty: false, poll: false, mentor: false });
    setKept(null);
    setPoll(null);
    setHint(null);
    setDone(null);
    resultsRef.current = [];
    missedRef.current = [];
    startRef.current = Date.now();
  };

  if (!question && !done) {
    return (
      <GameShell title={t('game_million_name')} icon={<Trophy size={24} />} runActive={false}>
        <p>{t('game_million_no_pool')}</p>
      </GameShell>
    );
  }

  return (
    <GameShell
      title={t('game_million_name')}
      icon={<Trophy size={24} />}
      runActive={!done && qIndex > 0}
      hud={!done && <span className="swipe-progress">{t('game_million_qnum', { i: qIndex + 1, total: LADDER.length })}</span>}
    >
      {done ? (
        <GameSummaryView
          summary={done.summary}
          isNewBest={done.isNewBest}
          missed={missedRef.current}
          onReplay={restart}
          extra={
            <div className="mil-prize-banner">
              {done.summary.perfect ? t('game_million_champ') : ''}{t('game_million_prize', { prize: done.prize.toLocaleString() })}
            </div>
          }
        />
      ) : (
        <div className="mil-layout">
          <div className="boss-arena">
            <div className="mil-lifelines">
              <button className="lifeline-btn" disabled={used.fifty || phase !== 'question'} onClick={lifelineFifty}>
                <Scissors size={16} />
                <span>50:50</span>
              </button>
              <button className="lifeline-btn" disabled={used.poll || phase !== 'question'} onClick={lifelinePoll}>
                <Users size={16} />
                <span>{t('game_million_poll')}</span>
              </button>
              <button
                className="lifeline-btn"
                disabled={used.mentor || !apiKey || phase !== 'question'}
                title={!apiKey ? t('api_key_required') : undefined}
                onClick={() => void lifelineMentor()}
              >
                {hintLoading ? <Loader2 size={16} className="spin" /> : <CircleHelp size={16} />}
                <span>{t('game_million_ask_mentor')}</span>
              </button>
            </div>

            <div className="gq-card">
              {question.source === 'ai' && (
                <span className="gq-ai-marker">
                  <Sparkles size={14} />
                  {t('game_ai_marker')}
                </span>
              )}
              <p className="gq-prompt">{question.prompt}</p>
              <div className="gq-options">
                {question.options.map(opt => {
                  const hidden = kept !== null && !kept.includes(opt);
                  let cls = 'option-btn';
                  if (phase === 'suspense' && opt === selected) cls += ' selected';
                  if (phase === 'reveal') {
                    if (opt === question.correctAnswer) cls += ' correct';
                    else if (opt === selected) cls += ' incorrect';
                  }
                  return (
                    <motion.button
                      className={cls}
                      key={opt}
                      animate={
                        hidden
                          ? { opacity: 0.18 }
                          : phase === 'suspense' && opt === selected
                            ? { scale: [1, 1.02, 1], transition: { repeat: Infinity, duration: 0.6 } }
                            : { opacity: 1, scale: 1 }
                      }
                      disabled={hidden || phase !== 'question'}
                      onClick={() => select(opt)}
                    >
                      {opt}
                    </motion.button>
                  );
                })}
              </div>

              {poll && (
                <div className="mil-poll">
                  {visibleOptions.map(opt => (
                    <div className="mil-poll-row" key={opt}>
                      <span className="opt">{opt}</span>
                      <div className="mil-poll-track">
                        <motion.div
                          className="mil-poll-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${poll[opt] ?? 0}%` }}
                          transition={{ duration: 0.6 }}
                        />
                      </div>
                      <span>{poll[opt] ?? 0}%</span>
                    </div>
                  ))}
                </div>
              )}

              {hint && <p className="mil-hint">💡 {hint}</p>}

              {phase === 'reveal' && (
                <div className="gq-feedback">
                  <span className={`verdict ${selected === question.correctAnswer ? 'good' : 'bad'}`}>
                    {selected === question.correctAnswer
                      ? qIndex + 1 >= Math.min(LADDER.length, questions.length) ? t('game_million_correct_summit') : t('game_million_correct')
                      : `${t('game_million_wrong_prefix')}${prizeOnWrong(qIndex) > 0 ? t('game_million_dropped', { prize: prizeOnWrong(qIndex).toLocaleString() }) : t('game_million_no_haven')}`}
                  </span>
                  {selected !== question.correctAnswer && question.explanation && (
                    <p className="gq-explanation">{question.explanation}</p>
                  )}
                  <button className="btn btn-primary" onClick={proceed}>
                    {selected === question.correctAnswer && qIndex + 1 < Math.min(LADDER.length, questions.length) ? t('game_million_next_q') : t('game_finish')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mil-ladder">
            {LADDER.map((value, i) => (
              <div
                className={`mil-rung ${i === qIndex ? 'current' : ''} ${i < qIndex ? 'passed' : ''} ${SAFE_HAVENS.includes(i) ? 'haven' : ''}`}
                key={value}
              >
                <span>{i + 1}</span>
                <span>{value.toLocaleString()}</span>
                {SAFE_HAVENS.includes(i) && <Shield size={13} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </GameShell>
  );
}
