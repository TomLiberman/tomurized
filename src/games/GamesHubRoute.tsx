import { Brain, Hand, Sparkles, Swords, Trophy, Upload } from 'lucide-react';
import { usePortal } from '../portal/context';
import { uniqueByTerm, minPoolFor } from './questionEngine';
import { getBest } from './highScores';
import type { GameId } from './types';
import { t, type StringKey } from '../i18n';
import './games.css';

// name/desc are t() KEYS, resolved at render time so a language switch re-labels.
const GAMES: {
  id: GameId;
  path: string;
  nameKey: StringKey;
  descKey: StringKey;
  Icon: typeof Swords;
}[] = [
  {
    id: 'boss',
    path: '/games/boss',
    nameKey: 'game_boss_name',
    descKey: 'game_boss_desc',
    Icon: Swords,
  },
  {
    id: 'millionaire',
    path: '/games/millionaire',
    nameKey: 'game_million_name',
    descKey: 'game_million_desc',
    Icon: Trophy,
  },
  {
    id: 'memory',
    path: '/games/memory',
    nameKey: 'game_memory_name',
    descKey: 'game_memory_desc',
    Icon: Brain,
  },
  {
    id: 'swipe',
    path: '/games/swipe',
    nameKey: 'game_swipe_name',
    descKey: 'game_swipe_desc',
    Icon: Hand,
  },
];

export default function GamesHubRoute() {
  const { allTermsList, activeSubjectId, apiKey, navigate } = usePortal();
  const uniqueCount = uniqueByTerm(allTermsList).length;

  return (
    <div className="games-hub">
      <div className="view-intro">
        <h2>{t('game_hub_title')}</h2>
        <p>
          {t('game_hub_intro')}
        </p>
        {apiKey && (
          <span className="games-ai-chip">
            <Sparkles size={14} />
            {t('game_ai_chip')}
          </span>
        )}
      </div>

      {uniqueCount === 0 ? (
        <div className="game-card">
          <h3>{t('game_no_terms_title')}</h3>
          <p className="game-card-desc">{t('game_no_terms_text')}</p>
          <button className="btn btn-primary" onClick={() => navigate('/loader')}>
            <Upload size={16} />
            <span>{t('game_upload_btn')}</span>
          </button>
        </div>
      ) : (
        <div className="games-grid">
          {GAMES.map(({ id, path, nameKey, descKey, Icon }) => {
            const min = minPoolFor(id);
            const locked = uniqueCount < min;
            const best = getBest(activeSubjectId, id);
            return (
              <div className={`game-card ${locked ? 'disabled' : ''}`} key={id}>
                <span className="game-card-icon"><Icon size={24} /></span>
                <h3>{t(nameKey)}</h3>
                <p className="game-card-desc">{t(descKey)}</p>
                {locked ? (
                  <span className="game-card-min">{t('game_min_terms', { min })}</span>
                ) : (
                  <div className="game-card-meta">
                    <span className="best">{best ? t('game_best', { score: best.bestScore }) : t('game_not_played')}</span>
                    {best && <span>{t('game_plays', { n: best.plays })}</span>}
                  </div>
                )}
                <button className="btn btn-primary" disabled={locked} onClick={() => navigate(path)}>
                  {t('game_play')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
