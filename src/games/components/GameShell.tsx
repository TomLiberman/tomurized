import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { usePortal } from '../../portal/context';
import { t } from '../../i18n';

// Shared chrome for a game screen: back-to-hub (confirming mid-run), title
// with icon, and an optional HUD slot (hearts / ladder position / score).
export default function GameShell(props: {
  title: string;
  icon: ReactNode;
  hud?: ReactNode;
  /** When true, leaving asks for confirmation (progress would be lost). */
  runActive: boolean;
  children: ReactNode;
}) {
  const { navigate } = usePortal();

  const exit = () => {
    if (props.runActive && !window.confirm(t('confirm_exit_game'))) return;
    navigate('/games');
  };

  return (
    <div className="game-shell">
      <div className="game-shell-header">
        <button className="game-shell-back" onClick={exit}>
          <ArrowRight size={16} />
          <span>{t('game_back_to_games')}</span>
        </button>
        <h2 className="game-shell-title">
          {props.icon}
          <span>{props.title}</span>
        </h2>
        {props.hud && <div className="game-shell-hud">{props.hud}</div>}
      </div>
      <div className="game-shell-body">{props.children}</div>
    </div>
  );
}
