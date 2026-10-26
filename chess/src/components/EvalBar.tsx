import { formatScore, winPct } from '../lib/chessutil';
import type { Color, Score } from '../lib/types';

export function EvalBar({ score, orientation }: { score: Score | null; orientation: Color }) {
  const white = score ? winPct(score) : 50;
  const label = score ? formatScore(score) : '…';
  return (
    <div className={`eval-bar ${orientation === 'black' ? 'flipped' : ''}`} aria-label={`Evaluation ${label}`}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${white >= 50 ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}
