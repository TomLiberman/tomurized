import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import { usePortal } from '../portal/context';
import { buildMemoryBoard, minPoolFor } from './questionEngine';
import { memoryScore, memoryPoints } from './gameLogic';
import { useGameOutcome } from './useGameOutcome';
import GameShell from './components/GameShell';
import GameSummaryView from './components/GameSummary';
import type { GameSummary, MemoryCard } from './types';
import { t } from '../i18n';
import './games.css';

const PAIRS = 6;
const TRUNCATE_AT = 90;

// משחק זיכרון — flip cards to match each term with its definition.
// Recognition-only evidence, so this game awards points but does NOT grade FSRS.
export default function MemoryMatchRoute() {
  const { allTermsList } = usePortal();
  const { finishRun } = useGameOutcome();

  const [board, setBoard] = useState<MemoryCard[]>(() => buildMemoryBoard(allTermsList, PAIRS, TRUNCATE_AT));
  const [flipped, setFlipped] = useState<string[]>([]); // card ids, max 2
  const [matched, setMatched] = useState<Set<string>>(new Set()); // pairIds
  const [moves, setMoves] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState<string>('');
  const [done, setDone] = useState<{ summary: GameSummary; isNewBest: boolean } | null>(null);
  const lockRef = useRef(false);

  const pairs = board.length / 2;

  useEffect(() => {
    if (done || startedAt === null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [done, startedAt]);

  const restart = () => {
    setBoard(buildMemoryBoard(allTermsList, PAIRS, TRUNCATE_AT));
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setStartedAt(null);
    setElapsed(0);
    setToast('');
    setDone(null);
    lockRef.current = false;
  };

  const flipCard = (card: MemoryCard) => {
    if (lockRef.current || done) return;
    if (flipped.includes(card.id) || matched.has(card.pairId)) return;
    if (startedAt === null) setStartedAt(Date.now());

    const nowFlipped = [...flipped, card.id];
    setFlipped(nowFlipped);
    if (nowFlipped.length < 2) return;

    const [a, b] = nowFlipped.map(id => board.find(c => c.id === id)!);
    const nextMoves = moves + 1;
    setMoves(nextMoves);

    if (a.pairId === b.pairId) {
      const nextMatched = new Set(matched).add(a.pairId);
      setMatched(nextMatched);
      setFlipped([]);
      const def = a.face === 'definition' ? a : b;
      const term = a.face === 'term' ? a : b;
      setToast(`${term.fullText}: ${def.fullText}`);

      if (nextMatched.size === pairs) {
        const seconds = startedAt === null ? 0 : Math.floor((Date.now() - startedAt) / 1000);
        const score = memoryScore(nextMoves, seconds, pairs);
        const summary: GameSummary = {
          gameId: 'memory',
          score,
          pointsAwarded: memoryPoints(score),
          correct: pairs,
          total: pairs,
          bestStreak: 0,
          durationMs: seconds * 1000,
          perfect: nextMoves <= pairs + 2,
        };
        // No FSRS grading — flip-matching is too weak as recall evidence.
        const { isNewBest } = finishRun(summary, []);
        setDone({ summary, isNewBest });
      }
    } else {
      lockRef.current = true;
      setTimeout(() => {
        setFlipped([]);
        lockRef.current = false;
      }, 900);
    }
  };

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  if (!board.length && !done) {
    return (
      <GameShell title={t('game_memory_name')} icon={<Brain size={24} />} runActive={false}>
        <p>{t('game_min_terms', { min: minPoolFor('memory') })}</p>
      </GameShell>
    );
  }

  return (
    <GameShell
      title={t('game_memory_name')}
      icon={<Brain size={24} />}
      runActive={!done && matched.size > 0}
      hud={
        !done && (
          <div className="memory-hud">
            <span>{t('game_memory_moves')} <b>{moves}</b></span>
            <span>{t('game_memory_time')} <b>{mmss}</b></span>
            <span>{t('game_memory_pairs')} <b>{matched.size}/{pairs}</b></span>
          </div>
        )
      }
    >
      {done ? (
        <GameSummaryView summary={done.summary} isNewBest={done.isNewBest} missed={[]} onReplay={restart} />
      ) : (
        <div className="boss-arena">
          <div className="memory-grid">
            {board.map(card => {
              const isUp = flipped.includes(card.id) || matched.has(card.pairId);
              return (
                <div
                  className={`memory-card ${matched.has(card.pairId) ? 'matched' : ''}`}
                  key={card.id}
                  onClick={() => flipCard(card)}
                  title={matched.has(card.pairId) ? card.fullText : undefined}
                >
                  <motion.div
                    className="memory-card-inner"
                    animate={{ rotateY: isUp ? 180 : 0 }}
                    transition={{ duration: 0.35 }}
                  >
                    <div className="memory-face back">?</div>
                    <div className={`memory-face front ${card.face === 'term' ? 'term-face' : ''}`}>
                      {card.text}
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
          {toast && <div className="memory-toast">{toast}</div>}
        </div>
      )}
    </GameShell>
  );
}
