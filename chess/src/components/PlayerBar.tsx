import { useEffect, useState } from 'react';
import { Cpu, User, Wifi } from 'lucide-react';
import { formatClock } from '../lib/clock';
import type { GameSession } from '../lib/session';
import type { Color } from '../lib/types';
import { PieceIcon } from './ui';

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const ROLES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

/** Pieces each side has captured, and the material balance, from a FEN. */
export function material(fen: string) {
  const placement = fen.split(' ')[0];
  const count = { white: {} as Record<string, number>, black: {} as Record<string, number> };
  for (const ch of placement) {
    if (!/[pnbrq]/i.test(ch)) continue;
    const side = ch === ch.toUpperCase() ? 'white' : 'black';
    const k = ch.toLowerCase();
    count[side][k] = (count[side][k] ?? 0) + 1;
  }
  const captured = { white: [] as string[], black: [] as string[] };
  let score = 0;
  for (const k of ['q', 'r', 'b', 'n', 'p']) {
    const w = count.white[k] ?? 0;
    const b = count.black[k] ?? 0;
    score += (w - b) * VALUES[k];
    // Pieces White captured are Black's missing ones (promotions can make this negative; ignore those).
    for (let i = 0; i < Math.max(0, START_COUNT[k] - b); i++) captured.white.push(k);
    for (let i = 0; i < Math.max(0, START_COUNT[k] - w); i++) captured.black.push(k);
  }
  return { captured, score };
}

export function PlayerBar({
  name,
  color,
  fen,
  session,
  kind,
  sub,
  active,
}: {
  name: string;
  color: Color;
  fen: string;
  session?: GameSession;
  kind: 'human' | 'computer' | 'remote';
  sub?: string;
  active: boolean;
}) {
  const { captured, score } = material(fen);
  const mine = captured[color];
  const adv = color === 'white' ? score : -score;
  const Icon = kind === 'computer' ? Cpu : kind === 'remote' ? Wifi : User;
  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <div className="player-id">
        <span className={`avatar ${color}`}>
          <Icon size={16} />
        </span>
        <div className="player-text">
          <div className="player-name">
            {name}
            {sub && <span className="player-sub">{sub}</span>}
          </div>
          <div className="captured" aria-label="Captured pieces">
            {mine.map((k, i) => (
              <PieceIcon key={i} role={ROLES[k]} color={color === 'white' ? 'black' : 'white'} size={18} />
            ))}
            {adv > 0 && <span className="material-adv">+{adv}</span>}
          </div>
        </div>
      </div>
      {session?.clock && <ClockView session={session} color={color} />}
    </div>
  );
}

export function ClockView({ session, color }: { session: GameSession; color: Color }) {
  const [, setTick] = useState(0);
  const clock = session.clock!;
  const running = clock.running === color && session.status === 'playing';
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [running]);
  const ms = clock.time(color);
  const low = ms < Math.min(20000, session.config.timeControl.initial * 100);
  return (
    <div className={`clock ${running ? 'running' : ''} ${low ? 'low' : ''}`} role="timer" aria-label={`${color} clock`}>
      {formatClock(ms)}
    </div>
  );
}
