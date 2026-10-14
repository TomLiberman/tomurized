import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Heart, Sparkles, Swords } from 'lucide-react';
import { usePortal } from '../portal/context';
import { buildLocalQuestions } from './questionEngine';
import { buildBosses, attackDamage, bossScore, PLAYER_MAX_HP } from './gameLogic';
import { useQuestionFeed } from './useQuestionFeed';
import { useGameOutcome } from './useGameOutcome';
import GameShell from './components/GameShell';
import GameSummaryView from './components/GameSummary';
import type { GameQuestion, GameResult, GameSummary } from './types';
import { t } from '../i18n';
import './games.css';

type NextStep = 'continue' | 'nextboss' | 'redemption' | 'revive' | 'gameover' | 'complete';

interface Feedback {
  correct: boolean;
  crit: boolean;
  chosen: string;
  next: NextStep;
}

// קרב בוסים — each deck topic is a boss; correct answers deal damage, wrong
// answers cost hearts. One redemption question can revive a dead run.
export default function BossBattleRoute() {
  const { db, allTermsList, activeSubjectId, apiKey, subjectsList, pastExams, triggerConfetti, lang } = usePortal();
  const { finishRun } = useGameOutcome();

  const bosses = useMemo(() => buildBosses(db), [db]);
  const courseName = subjectsList.find(s => s.id === activeSubjectId)?.name || t('course_fallback_name');
  const pastExamsText = useMemo(
    () => pastExams.map(p => `===== ${p.name} =====\n${p.text}`).join('\n\n'),
    [pastExams]
  );
  const { takeAi, aiStatus } = useQuestionFeed({
    subjectId: activeSubjectId,
    fullPool: allTermsList,
    aiEnabled: !!apiKey,
    apiKey,
    courseName,
    pastExamsText,
    lang,
  });

  const [bossIndex, setBossIndex] = useState(0);
  const [bossHp, setBossHp] = useState(() => (bosses[0]?.hp ?? 4));
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [isRedemption, setIsRedemption] = useState(false);
  const [redemptionUsed, setRedemptionUsed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [done, setDone] = useState<{ summary: GameSummary; isNewBest: boolean } | null>(null);

  const queuesRef = useRef(new Map<string, GameQuestion[]>());
  const resultsRef = useRef<GameResult[]>([]);
  const missedRef = useRef<{ label: string; detail: string }[]>([]);
  const countersRef = useRef({ correct: 0, total: 0, crits: 0, bossesDefeated: 0 });
  const startRef = useRef(Date.now());

  const drawLocal = (topic: string): GameQuestion => {
    let queue = queuesRef.current.get(topic) ?? [];
    if (!queue.length) {
      const topicPool = allTermsList.filter(t => t.subject === topic);
      queue = buildLocalQuestions(topicPool, topicPool.length, { distractorPool: allTermsList });
    }
    const q = queue.shift()!;
    queuesRef.current.set(topic, queue);
    return q;
  };

  const drawQuestion = (topic: string): GameQuestion => takeAi(topic) ?? drawLocal(topic);

  const [question, setQuestion] = useState<GameQuestion>(() => drawQuestion(bosses[0]?.topic ?? ''));

  const boss = bosses[bossIndex];

  const finish = (completed: boolean) => {
    const c = countersRef.current;
    const score = bossScore({ correct: c.correct, crits: c.crits, bossesDefeated: c.bossesDefeated });
    const summary: GameSummary = {
      gameId: 'boss',
      score,
      pointsAwarded: score,
      correct: c.correct,
      total: c.total,
      bestStreak,
      durationMs: Date.now() - startRef.current,
      perfect: completed && c.correct === c.total,
    };
    const { isNewBest } = finishRun(summary, resultsRef.current);
    setDone({ summary, isNewBest });
  };

  const answer = (opt: string) => {
    if (feedback || done) return;
    const correct = opt === question.correctAnswer;
    resultsRef.current.push({ term: question.term, correct });
    countersRef.current.total++;
    if (!correct) {
      // Reinforcement pairing: the tested term with its real definition when we
      // know it, otherwise the correct option text (unmatched AI questions).
      missedRef.current.push({
        label: question.term || t('game_ai_question'),
        detail: question.definition || question.correctAnswer,
      });
    }

    let next: NextStep;
    let crit = false;

    if (isRedemption) {
      next = correct ? 'revive' : 'gameover';
      if (correct) countersRef.current.correct++;
      setStreak(0);
    } else if (correct) {
      countersRef.current.correct++;
      const newStreak = streak + 1;
      setStreak(newStreak);
      setBestStreak(b => Math.max(b, newStreak));
      const hit = attackDamage(newStreak);
      crit = hit.crit;
      if (crit) countersRef.current.crits++;
      const newBossHp = Math.max(0, bossHp - hit.dmg);
      setBossHp(newBossHp);
      if (newBossHp <= 0) {
        countersRef.current.bossesDefeated++;
        triggerConfetti('success');
        next = bossIndex + 1 >= bosses.length ? 'complete' : 'nextboss';
      } else {
        next = 'continue';
      }
    } else {
      setStreak(0);
      const newHp = playerHp - 1;
      setPlayerHp(newHp);
      if (newHp <= 0) {
        next = redemptionUsed ? 'gameover' : 'redemption';
      } else {
        next = 'continue';
      }
    }

    setFeedback({ correct, crit, chosen: opt, next });
  };

  const proceed = () => {
    if (!feedback) return;
    const step = feedback.next;
    setFeedback(null);
    switch (step) {
      case 'continue':
        setQuestion(drawQuestion(boss.topic));
        break;
      case 'nextboss': {
        const ni = bossIndex + 1;
        setBossIndex(ni);
        setBossHp(bosses[ni].hp);
        setQuestion(drawQuestion(bosses[ni].topic));
        break;
      }
      case 'redemption':
        setIsRedemption(true);
        setQuestion(drawQuestion(boss.topic));
        break;
      case 'revive':
        setIsRedemption(false);
        setRedemptionUsed(true);
        setPlayerHp(1);
        setQuestion(drawQuestion(boss.topic));
        break;
      case 'gameover':
        finish(false);
        break;
      case 'complete':
        finish(true);
        break;
    }
  };

  const restart = () => {
    queuesRef.current = new Map();
    resultsRef.current = [];
    missedRef.current = [];
    countersRef.current = { correct: 0, total: 0, crits: 0, bossesDefeated: 0 };
    startRef.current = Date.now();
    setBossIndex(0);
    setBossHp(bosses[0]?.hp ?? 4);
    setPlayerHp(PLAYER_MAX_HP);
    setStreak(0);
    setBestStreak(0);
    setIsRedemption(false);
    setRedemptionUsed(false);
    setFeedback(null);
    setDone(null);
    setQuestion(drawQuestion(bosses[0]?.topic ?? ''));
  };

  if (!boss) {
    return (
      <GameShell title={t('game_boss_name')} icon={<Swords size={24} />} runActive={false}>
        <p>{t('game_boss_no_topics')}</p>
      </GameShell>
    );
  }

  const runActive = !done && countersRef.current.total > 0;

  return (
    <GameShell
      title={t('game_boss_name')}
      icon={<Swords size={24} />}
      runActive={runActive}
      hud={
        !done && (
          <>
            <span className="hearts">
              {Array.from({ length: PLAYER_MAX_HP }, (_, i) => (
                <Heart key={i} size={20} className={i < playerHp ? '' : 'empty'} fill={i < playerHp ? 'currentColor' : 'none'} />
              ))}
            </span>
            {streak >= 2 && <span className="streak-chip">🔥 {streak}</span>}
          </>
        )
      }
    >
      {done ? (
        <GameSummaryView summary={done.summary} isNewBest={done.isNewBest} missed={missedRef.current} onReplay={restart} />
      ) : (
        <div className="boss-arena">
          <motion.div
            className="boss-card"
            style={{ '--boss-hue': boss.hue } as CSSProperties}
            animate={feedback?.correct ? { x: [0, -10, 10, -5, 0] } : { x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <span className="boss-avatar">{boss.emoji}</span>
            <div className="boss-info">
              {boss.unit && <span className="unit">{boss.unit}</span>}
              <h3>{boss.name}</h3>
              <div className="boss-hp-bar">
                <motion.div
                  className="boss-hp-fill"
                  animate={{ width: `${(bossHp / boss.hp) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                />
              </div>
            </div>
            <span className="boss-progress">{t('game_boss_progress', { i: bossIndex + 1, total: bosses.length })}</span>
          </motion.div>

          <motion.div
            className={`gq-card ${isRedemption ? 'redemption-card' : ''}`}
            key={question.id}
            initial={{ opacity: 0, y: 12 }}
            animate={feedback && !feedback.correct ? { opacity: 1, y: 0, x: [0, -8, 8, -4, 0] } : { opacity: 1, y: 0 }}
          >
            {isRedemption && <p className="redemption-title">{t('game_boss_redemption_title')}</p>}
            {question.source === 'ai' && (
              <span className="gq-ai-marker">
                <Sparkles size={14} />
                {t('game_ai_marker')}
              </span>
            )}
            <p className="gq-prompt">{question.prompt}</p>
            <div className="gq-options">
              {question.options.map(opt => {
                let cls = 'option-btn';
                if (feedback) {
                  if (opt === question.correctAnswer) cls += ' correct';
                  else if (opt === feedback.chosen) cls += ' incorrect';
                }
                return (
                  <button className={cls} key={opt} disabled={!!feedback} onClick={() => answer(opt)}>
                    {opt}
                  </button>
                );
              })}
            </div>

            {feedback && (
              <div className="gq-feedback">
                <span className={`verdict ${feedback.correct ? 'good' : 'bad'}`}>
                  {feedback.next === 'revive'
                    ? t('game_boss_revived')
                    : feedback.correct
                      ? feedback.crit
                        ? <>{t('game_boss_crit_prefix')}<span className="crit-flash">−2</span></>
                        : t('game_boss_hit')
                      : isRedemption
                        ? t('game_boss_miss_redemption')
                        : t('game_boss_player_hit')}
                </span>
                {!feedback.correct && question.explanation && (
                  <p className="gq-explanation">{question.explanation}</p>
                )}
                <button className="btn btn-primary" onClick={proceed}>
                  {feedback.next === 'nextboss' ? t('game_boss_next')
                    : feedback.next === 'complete' ? t('game_boss_victory')
                    : feedback.next === 'redemption' ? t('game_boss_to_redemption')
                    : feedback.next === 'gameover' ? t('game_finish')
                    : t('game_continue')}
                </button>
              </div>
            )}
          </motion.div>
          {aiStatus === 'loading' && (
            <span className="gq-ai-marker">
              <Sparkles size={12} />
              {t('game_ai_loading')}
            </span>
          )}
        </div>
      )}
    </GameShell>
  );
}
