import { useEffect, useRef } from 'react';
import { CLASS_INFO } from '../lib/analysis';
import { formatClock } from '../lib/clock';
import type { MoveAnalysis, MoveRecord } from '../lib/types';

/**
 * Two-column move list. `ply` is the number of moves shown on the board
 * (0 = start position); clicking a move jumps there.
 */
export function MoveList({
  moves,
  ply,
  onSelect,
  startsWithBlack,
  firstMoveNumber = 1,
  analysis,
  showClocks,
}: {
  moves: MoveRecord[];
  ply: number;
  onSelect: (ply: number) => void;
  startsWithBlack?: boolean;
  firstMoveNumber?: number;
  analysis?: MoveAnalysis[];
  showClocks?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.mv.current') as HTMLElement | null;
    if (el && ref.current) {
      const box = ref.current;
      const top = el.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2;
    } else if (ref.current && ply === moves.length) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [ply, moves.length]);

  const rows: { no: number; white?: number; black?: number }[] = [];
  const offset = startsWithBlack ? 1 : 0;
  for (let i = 0; i < moves.length; i++) {
    const idx = i + offset;
    const rowIdx = Math.floor(idx / 2);
    rows[rowIdx] ??= { no: firstMoveNumber + rowIdx };
    if (idx % 2 === 0) rows[rowIdx].white = i;
    else rows[rowIdx].black = i;
  }

  const cell = (i: number | undefined) => {
    if (i === undefined) return <span className="mv empty" />;
    const m = moves[i];
    const a = analysis?.[i];
    const info = a ? CLASS_INFO[a.cls] : null;
    const notable = a && ['inaccuracy', 'mistake', 'blunder'].includes(a.cls);
    return (
      <button
        className={`mv ${ply === i + 1 ? 'current' : ''} ${a ? `cls-${a.cls}` : ''}`}
        onClick={() => onSelect(i + 1)}
        title={info ? `${info.label}${a?.bestSan && a.cls !== 'best' ? ` — best was ${a.bestSan}` : ''}` : undefined}
      >
        <span className="san">{m.san}</span>
        {notable && info && (
          <span className="cls-sym" style={{ color: info.color }}>
            {info.symbol}
          </span>
        )}
        {showClocks && m.clock !== undefined && <span className="mv-clock">{formatClock(m.clock)}</span>}
      </button>
    );
  };

  return (
    <div className="move-list" ref={ref}>
      {rows.length === 0 && <div className="move-list-empty">No moves yet</div>}
      {rows.map((r) => (
        <div className="move-row" key={r.no}>
          <span className="move-no">{r.no}.</span>
          {cell(r.white)}
          {cell(r.black)}
        </div>
      ))}
    </div>
  );
}
