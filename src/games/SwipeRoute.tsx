import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import { Check, Hand, X } from 'lucide-react';
import { usePortal } from '../portal/context';
import { buildPairRound, minPoolFor } from './questionEngine';
import { swipeMultiplier, swipePoints } from './gameLogic';
import { useGameOutcome } from './useGameOutcome';
import GameShell from './components/GameShell';
import GameSummaryView from './components/GameSummary';
import type { GameResult, GameSummary, SwipePair } from './types';
import { t } from '../i18n';
import './games.css';

const ROUND_SIZE = 20;

// החלקה — Tinder-style: does the shown definition belong to the shown term?
// Drag/keys use PHYSICAL directions (framer x is unaffected by dir="rtl"):
// physical RIGHT = מתאים, physical LEFT = לא מתאים — stamps and buttons match.
export default function SwipeRoute() {
  const { allTermsList } = usePortal();
  const { finishRun } = useGameOutcome();

  const [round, setRound] = useState<SwipePair[]>(() => buildPairRound(allTermsList, ROUND_SIZE));
  const [index, setIndex] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [banner, setBanner] = useState<{ kind: 'good' | 'bad'; text: string } | null>(null);
  const [exitDir, setExitDir] = useState(1);
  const [done, setDone] = useState<{ summary: GameSummary; isNewBest: boolean } | null>(null);
  const resultsRef = useRef<GameResult[]>([]);
  const multipliersRef = useRef<number[]>([]);
  const startRef = useRef(Date.now());

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const matchStamp = useTransform(x, [60, 120], [0, 1]);
  const rejectStamp = useTransform(x, [-120, -60], [1, 0]);

  const current = round[index];

  const restart = () => {
    setRound(buildPairRound(allTermsList, ROUND_SIZE));
    setIndex(0);
    setStreak(0);
    setBestStreak(0);
    setBanner(null);
    setDone(null);
    resultsRef.current = [];
    multipliersRef.current = [];
    startRef.current = Date.now();
    x.set(0);
  };

  const finish = (finalBestStreak: number) => {
    const correct = resultsRef.current.filter(r => r.correct).length;
    const score = swipePoints(multipliersRef.current);
    const summary: GameSummary = {
      gameId: 'swipe',
      score,
      pointsAwarded: score,
      correct,
      total: resultsRef.current.length,
      bestStreak: finalBestStreak,
      durationMs: Date.now() - startRef.current,
      perfect: correct === resultsRef.current.length,
    };
    const { isNewBest } = finishRun(summary, resultsRef.current);
    setDone({ summary, isNewBest });
  };

  const judge = (saysMatch: boolean) => {
    if (!current || done) return;
    const isCorrect = saysMatch === current.isTruePair;
    resultsRef.current.push({ term: current.term, correct: isCorrect });

    let nextBest = bestStreak;
    if (isCorrect) {
      const mult = swipeMultiplier(streak);
      multipliersRef.current.push(mult);
      const nextStreak = streak + 1;
      nextBest = Math.max(bestStreak, nextStreak);
      setStreak(nextStreak);
      setBestStreak(nextBest);
      setBanner({ kind: 'good', text: `+${5 * mult} ✓` });
    } else {
      setStreak(0);
      setBanner({
        kind: 'bad',
        text: current.isTruePair
          ? t('game_swipe_wrong_was_match', { term: current.term })
          : t('game_swipe_wrong_belongs', { term: current.sourceTerm }),
      });
    }

    setExitDir(saysMatch ? 1 : -1);
    x.set(0);
    if (index + 1 >= round.length) {
      finish(nextBest);
    } else {
      setIndex(index + 1);
    }
  };

  // Clear the banner after a beat.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1500);
    return () => clearTimeout(t);
  }, [banner]);

  // Keyboard: physical arrows mirror the physical drag directions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === 'ArrowRight') judge(true);
      if (e.key === 'ArrowLeft') judge(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const missed = resultsRef.current
    .map((r, i) => ({ r, pair: round[i] }))
    .filter(({ r }) => !r.correct)
    .map(({ pair }) => ({
      label: pair.term,
      detail: pair.isTruePair
        ? t('game_swipe_missed_was_correct')
        : t('game_swipe_missed_belongs', { term: pair.sourceTerm }),
    }));

  if (!round.length && !done) {
    return (
      <GameShell title={t('game_swipe_name')} icon={<Hand size={24} />} runActive={false}>
        <p>{t('game_min_terms', { min: minPoolFor('swipe') })}</p>
      </GameShell>
    );
  }

  return (
    <GameShell
      title={t('game_swipe_name')}
      icon={<Hand size={24} />}
      runActive={!done && index > 0}
      hud={
        !done && (
          <>
            <span className="swipe-progress">{index + 1} / {round.length}</span>
            {streak >= 2 && <span className="streak-chip">🔥 {streak}</span>}
          </>
        )
      }
    >
      {done ? (
        <GameSummaryView summary={done.summary} isNewBest={done.isNewBest} missed={missed} onReplay={restart} />
      ) : (
        <div className="swipe-arena">
          <div className="swipe-stack">
            {round[index + 1] && (
              <div className="swipe-card" style={{ transform: 'scale(0.95) translateY(10px)', opacity: 0.6 }}>
                <h3 className="swipe-term">{round[index + 1].term}</h3>
              </div>
            )}
            <AnimatePresence mode="popLayout" custom={exitDir}>
              {current && (
                <motion.div
                  className="swipe-card"
                  key={current.id}
                  custom={exitDir}
                  style={{ x, rotate }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.8}
                  onDragEnd={(_, info) => {
                    if (info.offset.x > 100 || info.velocity.x > 500) judge(true);
                    else if (info.offset.x < -100 || info.velocity.x < -500) judge(false);
                  }}
                  initial={{ scale: 0.95, opacity: 0.8 }}
                  animate={{ scale: 1, opacity: 1 }}
                  variants={{
                    exit: (dir: number) => ({ x: dir * 480, opacity: 0, transition: { duration: 0.25 } }),
                  }}
                  exit="exit"
                >
                  <motion.span className="swipe-stamp match" style={{ opacity: matchStamp }}>{t('game_swipe_stamp_match')}</motion.span>
                  <motion.span className="swipe-stamp reject" style={{ opacity: rejectStamp }}>{t('game_swipe_stamp_reject')}</motion.span>
                  <h3 className="swipe-term">{current.term}</h3>
                  <hr className="swipe-divider" />
                  <p className="swipe-def">{current.definition}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="swipe-buttons">
            {/* Physical left = reject, physical right = match (same as the drag). */}
            <button className="swipe-btn reject" onClick={() => judge(false)}>
              <X size={18} />
              <span>{t('game_swipe_reject')}</span>
            </button>
            <button className="swipe-btn match" onClick={() => judge(true)}>
              <Check size={18} />
              <span>{t('game_swipe_match')}</span>
            </button>
          </div>

          <div className={`swipe-banner ${banner ? banner.kind : ''}`}>
            {banner?.text ?? ' '}
          </div>
        </div>
      )}
    </GameShell>
  );
}
