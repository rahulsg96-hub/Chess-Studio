import { useRef, useState } from 'react';
import { CLASS_INFO } from '../lib/analysis';
import { formatScore, winPct } from '../lib/chessutil';
import type { GameAnalysis } from '../lib/types';

/** Win-probability graph across the game. Click to jump to a move. */
export function EvalGraph({ analysis, ply, onSelect }: { analysis: GameAnalysis; ply: number; onSelect: (ply: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = [analysis.initial, ...analysis.moves].map((s) => winPct(s));
  const n = points.length - 1;
  const W = 600;
  const H = 120;
  const x = (i: number) => (n === 0 ? 0 : (i / n) * W);
  const y = (p: number) => H - (p / 100) * H;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;

  const plyAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round(((clientX - box.left) / box.width) * n)));
  };

  const hovered = hover !== null ? (hover === 0 ? analysis.initial : analysis.moves[hover - 1]) : null;

  return (
    <div className="eval-graph">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={(e) => setHover(plyAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onSelect(plyAt(e.clientX))}
        role="img"
        aria-label="Evaluation graph"
      >
        <rect x="0" y="0" width={W} height={H} className="eg-bg" />
        <path d={area} className="eg-area" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
        <path d={line} className="eg-line" vectorEffect="non-scaling-stroke" />
        {analysis.moves.map((m, i) =>
          m.cls === 'mistake' || m.cls === 'blunder' || m.cls === 'inaccuracy' ? (
            <circle key={i} cx={x(i + 1)} cy={y(points[i + 1])} r="4" fill={CLASS_INFO[m.cls].color} vectorEffect="non-scaling-stroke" />
          ) : null,
        )}
        <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} className="eg-cursor" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="eg-hover" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hovered && hover !== null && (
        <div className="eg-tip">
          {hover === 0 ? 'Start' : `Move ${Math.ceil(hover / 2)}`} · {formatScore(hovered)}
        </div>
      )}
    </div>
  );
}
