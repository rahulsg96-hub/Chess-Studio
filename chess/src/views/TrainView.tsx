import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'chessground/types';
import { Chess } from 'chess.js';
import { Check, ChevronRight, Eye, RotateCcw, Target } from 'lucide-react';
import { Board } from '../components/Board';
import { PromotionDialog } from '../components/PromotionDialog';
import { CLASS_INFO } from '../lib/analysis';
import { isPromotion, legalDests, opposite, turnOf, uciToMove, winPct } from '../lib/chessutil';
import { allDrills, saveDrill, type DrillState } from '../lib/db';
import { getAnalysisEngine } from '../lib/engine';
import { navigate, useRoute } from '../lib/router';
import { useSettings } from '../lib/settings';
import { play } from '../lib/sound';
import { useGames } from '../lib/store';
import type { Color, GameRecord, MoveAnalysis } from '../lib/types';

export interface Drill {
  id: string;
  game: GameRecord;
  ply: number;
  fen: string;
  played: string;
  playedUci: string;
  analysis: MoveAnalysis;
  /** Win % (for the mover) with the best move. */
  bestWin: number;
  color: Color;
}

/** Positions where you made a mistake or blunder in an analysed game. */
export function collectDrills(games: GameRecord[], includeInaccuracies = false): Drill[] {
  const out: Drill[] = [];
  for (const g of games) {
    if (!g.analysis || !g.playerColor) continue;
    const startTurn = turnOf(g.startFen);
    g.moves.forEach((m, i) => {
      const a = g.analysis!.moves[i];
      if (!a || !a.best) return;
      const color: Color = i % 2 === 0 ? startTurn : opposite(startTurn);
      if (color !== g.playerColor) return;
      const bad = a.cls === 'mistake' || a.cls === 'blunder' || (includeInaccuracies && a.cls === 'inaccuracy');
      if (!bad) return;
      const before = i === 0 ? g.analysis!.initial : g.analysis!.moves[i - 1];
      const w = winPct(before);
      out.push({
        id: `${g.id}:${i}`,
        game: g,
        ply: i,
        fen: i === 0 ? g.startFen : g.moves[i - 1].fen,
        played: m.san,
        playedUci: m.uci,
        analysis: a,
        bestWin: color === 'white' ? w : 100 - w,
        color,
      });
    });
  }
  return out;
}

export function mistakeCount(games: GameRecord[]) {
  return collectDrills(games).length;
}

type Phase = 'solving' | 'checking' | 'correct' | 'wrong' | 'revealed';

export function TrainView() {
  const { games, loading } = useGames();
  const settings = useSettings();
  const [drills, setDrills] = useState<DrillState[] | null>(null);
  const [includeInacc, setIncludeInacc] = useState(false);
  const gameFilter = useRoute().query.get('game');
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('solving');
  const [tries, setTries] = useState(0);
  const [fen, setFen] = useState('');
  const [message, setMessage] = useState('');
  const [promo, setPromo] = useState<{ from: Key; to: Key } | null>(null);
  const [session, setSession] = useState({ solved: 0, attempted: 0 });

  useEffect(() => {
    void allDrills().then(setDrills);
  }, []);

  const queue = useMemo(() => {
    if (!drills) return [];
    const state = new Map(drills.map((d) => [d.id, d]));
    const now = Date.now();
    let list = collectDrills(games, includeInacc);
    if (gameFilter) list = list.filter((d) => d.game.id === gameFilter);
    else list = list.filter((d) => (state.get(d.id)?.due ?? 0) <= now);
    // Blunders first, then the most recent.
    const weight = (d: Drill) => (d.analysis.cls === 'blunder' ? 2 : d.analysis.cls === 'mistake' ? 1 : 0);
    return list.sort((a, b) => weight(b) - weight(a) || b.game.date - a.game.date);
    // Only rebuild when the inputs change, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, drills === null, includeInacc, gameFilter]);

  const drill = queue[index] as Drill | undefined;

  useEffect(() => {
    if (!drill) return;
    setFen(drill.fen);
    setPhase('solving');
    setTries(0);
    setMessage('');
  }, [drill?.id]);

  if (loading || drills === null) return <div className="page"><p className="muted">Loading…</p></div>;

  const total = collectDrills(games, includeInacc).length;
  if (!drill) {
    return (
      <div className="page narrow">
        <h1>
          <Target size={22} /> Train on your mistakes
        </h1>
        {total === 0 ? (
          <p>
            Once your games are analysed, every position where you made a mistake or blunder shows up here as a puzzle: find the move you missed.
            Play a few games (analysis runs automatically when a game ends) and come back.
          </p>
        ) : (
          <p>
            All caught up! You've worked through every position that is due. Solved positions come back after a few days (spaced repetition) so
            the lessons stick.
          </p>
        )}
        <label className="toggle-inline">
          <input type="checkbox" checked={includeInacc} onChange={(e) => setIncludeInacc(e.target.checked)} /> Include inaccuracies
        </label>
        {session.attempted > 0 && (
          <p>
            This session: <strong>{session.solved}</strong> / {session.attempted} solved.
          </p>
        )}
        <button className="primary" onClick={() => navigate('')}>
          Play a game
        </button>
      </div>
    );
  }

  const chess = new Chess(fen || drill.fen);
  const solving = phase === 'solving' && fen === drill.fen;

  const record = async (solved: boolean) => {
    const prev = drills.find((d) => d.id === drill.id);
    const streak = solved ? (prev?.solved ?? 0) + 1 : 0;
    const days = [1, 3, 7, 21, 60][Math.min(streak, 5) - 1] ?? 0;
    const next: DrillState = {
      id: drill.id,
      attempts: (prev?.attempts ?? 0) + 1,
      solved: streak,
      lastSeen: Date.now(),
      due: solved ? Date.now() + days * 86400000 : Date.now() + 10 * 60000,
    };
    await saveDrill(next);
    setDrills((list) => [...(list ?? []).filter((d) => d.id !== next.id), next]);
  };

  const attempt = async (from: Key, to: Key, promotion?: string) => {
    if (!solving) return;
    const uci = from + to + (promotion ?? (isPromotion(chess, from, to) ? 'q' : ''));
    let after: string;
    try {
      const c = new Chess(drill.fen);
      after = c.move(uciToMove(uci)).after;
    } catch {
      return;
    }
    setFen(after);
    const firstTry = tries === 0;
    if (uci === drill.analysis.best) {
      play('notify');
      setPhase('correct');
      setMessage('Correct — that was the best move!');
      if (firstTry) setSession((s) => ({ solved: s.solved + 1, attempted: s.attempted + 1 }));
      await record(firstTry);
      return;
    }
    // Not the engine's first choice — check whether it's nearly as good.
    setPhase('checking');
    setMessage('Checking your move…');
    const r = await getAnalysisEngine().search(after, { depth: 14 }, undefined, 'train');
    const s = r.lines[0]?.score;
    const w = s ? winPct(s) : 50;
    const mine = drill.color === 'white' ? w : 100 - w;
    if (drill.bestWin - mine < 3) {
      play('notify');
      setPhase('correct');
      setMessage(`Good find — that works too! (The engine's top choice was ${drill.analysis.bestSan}.)`);
      if (firstTry) setSession((x) => ({ solved: x.solved + 1, attempted: x.attempted + 1 }));
      await record(firstTry);
    } else {
      play('error');
      setPhase('wrong');
      setTries((t) => t + 1);
      setMessage(uci === drill.playedUci ? "That's the move you played in the game — look for something better." : 'Not quite. Try again!');
      if (firstTry) {
        setSession((x) => ({ ...x, attempted: x.attempted + 1 }));
        await record(false);
      }
    }
  };

  const retry = () => {
    setFen(drill.fen);
    setPhase('solving');
    setMessage('');
  };

  const reveal = () => {
    setPhase('revealed');
    setFen(drill.fen);
    setMessage(`Best was ${drill.analysis.bestSan}: ${drill.analysis.bestLine.join(' ')}`);
  };

  const next = () => setIndex((i) => i + 1);

  const info = CLASS_INFO[drill.analysis.cls];
  const moveNo = Math.floor(drill.ply / 2) + Number(drill.game.startFen.split(' ')[5] || 1);
  const shapes =
    phase === 'revealed' || phase === 'correct'
      ? [{ orig: drill.analysis.best.slice(0, 2) as Key, dest: drill.analysis.best.slice(2, 4) as Key, brush: 'green' }]
      : [];

  return (
    <div className="game-layout train">
      <div className="board-column">
        <div className="board-holder">
          <Board
            fen={fen || drill.fen}
            orientation={drill.color}
            turnColor={turnOf(fen || drill.fen)}
            movableColor={solving ? drill.color : undefined}
            dests={solving ? legalDests(chess) : new Map()}
            shapes={shapes}
            onMove={(from, to) => {
              if (isPromotion(chess, from, to) && !settings.autoQueen) setPromo({ from, to });
              else void attempt(from, to);
            }}
          />
        </div>
      </div>
      <aside className="side-panel">
        <div className="panel-head">
          <div className="card-kicker">
            Position {index + 1} of {queue.length}
            {gameFilter ? ' (this game)' : ''}
          </div>
          <h2 className="train-title">
            {drill.color === 'white' ? 'White' : 'Black'} to move — find the best move
          </h2>
          <p className="muted">
            In your game vs {drill.color === 'white' ? drill.game.black : drill.game.white} you played{' '}
            <strong>
              {moveNo}
              {drill.color === 'white' ? '.' : '...'} {drill.played}
            </strong>{' '}
            here — <span style={{ color: info.color }}>{info.label.toLowerCase()}</span> (−{drill.analysis.loss}% win chance).
          </p>
        </div>
        {message && <div className={`train-msg ${phase}`}>{message}</div>}
        <div className="action-buttons">
          {phase === 'wrong' && (
            <button className="primary" onClick={retry}>
              <RotateCcw size={16} /> Try again
            </button>
          )}
          {(phase === 'wrong' || phase === 'solving') && (
            <button onClick={reveal}>
              <Eye size={16} /> Show solution
            </button>
          )}
          {(phase === 'correct' || phase === 'revealed' || phase === 'wrong') && (
            <button className={phase === 'wrong' ? '' : 'primary'} onClick={next}>
              <ChevronRight size={16} /> Next position
            </button>
          )}
          <button onClick={() => navigate(`review/${drill.game.id}?ply=${drill.ply}`)}>Open game</button>
        </div>
        {phase === 'correct' && drill.analysis.bestLine.length > 1 && (
          <p className="muted small">
            <Check size={14} /> Engine line: {drill.analysis.bestLine.join(' ')}
          </p>
        )}
        <label className="toggle-inline">
          <input type="checkbox" checked={includeInacc} onChange={(e) => (setIncludeInacc(e.target.checked), setIndex(0))} /> Include inaccuracies
        </label>
        {session.attempted > 0 && (
          <p className="muted small">
            This session: {session.solved} / {session.attempted} solved on the first try
          </p>
        )}
      </aside>
      {promo && (
        <PromotionDialog
          color={drill.color}
          onPick={(p) => {
            const { from, to } = promo;
            setPromo(null);
            void attempt(from, to, p);
          }}
          onCancel={() => setPromo(null)}
        />
      )}
    </div>
  );
}
