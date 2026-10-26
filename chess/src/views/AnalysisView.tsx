import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { ArrowUpDown, ChevronLeft, ChevronRight, Copy, Play, RotateCcw, Upload } from 'lucide-react';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { MoveList } from '../components/MoveList';
import { PromotionDialog } from '../components/PromotionDialog';
import { Modal, copyText } from '../components/ui';
import { formatScore, isPromotion, legalDests, opposite, pvToSan, turnOf, uciToMove } from '../lib/chessutil';
import { getAnalysisEngine, type EngineLine } from '../lib/engine';
import { loadOpenings, openingAt } from '../lib/openings';
import { navigate, useRoute } from '../lib/router';
import { GameSession } from '../lib/session';
import { useSettings } from '../lib/settings';
import { setActiveSession } from '../lib/store';
import { START_FEN, type Color, type MoveRecord } from '../lib/types';

/** Free analysis board: move pieces for both sides, Stockfish shows its top lines. */
export function AnalysisView() {
  const { query } = useRoute();
  const settings = useSettings();
  const initial = useMemo(() => {
    const f = query.get('fen');
    try {
      if (f) return new Chess(f).fen();
    } catch {
      /* fall through */
    }
    return START_FEN;
  }, [query]);
  const [startFen, setStartFen] = useState(initial);
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<Color>(turnOf(initial));
  const [lines, setLines] = useState<{ fen: string; lines: EngineLine[]; depth: number } | null>(null);
  const [multiPv, setMultiPv] = useState(3);
  const [engineOn, setEngineOn] = useState(true);
  const [promo, setPromo] = useState<{ from: Key; to: Key } | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const [openingsReady, setOpeningsReady] = useState(false);

  useEffect(() => {
    setStartFen(initial);
    setMoves([]);
    setPly(0);
  }, [initial]);

  useEffect(() => {
    void loadOpenings().then(() => setOpeningsReady(true));
  }, []);

  const fen = ply === 0 ? startFen : moves[ply - 1].fen;
  const chess = useMemo(() => new Chess(fen), [fen]);
  const last = ply > 0 ? moves[ply - 1] : null;

  useEffect(() => {
    if (!engineOn) return;
    const engine = getAnalysisEngine();
    let alive = true;
    engine.cancelAll('explore');
    setLines(null);
    if (chess.isGameOver()) return;
    engine
      .search(fen, { depth: 22, multiPv }, (l, depth) => alive && setLines({ fen, lines: l, depth }), 'explore')
      .catch(() => {});
    return () => {
      alive = false;
      engine.cancelAll('explore');
    };
  }, [fen, multiPv, engineOn, chess]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(moves.length, p + 1));
      else if (e.key === 'f') setOrientation((o) => opposite(o));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moves.length]);

  const play = (uci: string) => {
    const c = new Chess(fen);
    let mv;
    try {
      mv = c.move(uciToMove(uci));
    } catch {
      return;
    }
    const rec: MoveRecord = { san: mv.san, uci: mv.from + mv.to + (mv.promotion ?? ''), fen: mv.after };
    // Playing a new move from an earlier position replaces the rest of the line.
    const next = [...moves.slice(0, ply), rec];
    setMoves(next);
    setPly(next.length);
  };

  const onMove = (from: Key, to: Key) => {
    if (isPromotion(chess, from, to) && !settings.autoQueen) setPromo({ from, to });
    else play(from + to + (isPromotion(chess, from, to) ? 'q' : ''));
  };

  const top = lines?.fen === fen ? lines.lines : [];
  const shapes: DrawShape[] = top.slice(0, 3).map((l, i) => ({
    orig: l.pv[0].slice(0, 2) as Key,
    dest: l.pv[0].slice(2, 4) as Key,
    brush: i === 0 ? 'blue' : 'paleBlue',
  }));

  let opening: { eco: string; name: string } | null = null;
  if (openingsReady) for (let i = 0; i < ply; i++) opening = openingAt(moves[i].fen) ?? opening;

  const playFromHere = (color: Color) => {
    const s = new GameSession({
      mode: 'computer',
      playerColor: color,
      engineLevel: 6,
      timeControl: { initial: 0, increment: 0 },
      white: color === 'white' ? settings.playerName : 'Stockfish L6',
      black: color === 'black' ? settings.playerName : 'Stockfish L6',
      startFen: fen,
    });
    setActiveSession(s);
    navigate('play');
  };

  return (
    <div className="game-layout">
      <div className="board-column">
        <div className="board-row">
          {engineOn && <EvalBar score={top[0]?.score ?? null} orientation={orientation} />}
          <div className="board-holder">
            <Board
              fen={fen}
              orientation={orientation}
              turnColor={turnOf(fen)}
              movableColor={chess.isGameOver() ? undefined : turnOf(fen)}
              dests={legalDests(chess)}
              lastMove={last ? [last.uci.slice(0, 2) as Key, last.uci.slice(2, 4) as Key] : undefined}
              check={chess.inCheck()}
              shapes={engineOn ? shapes : []}
              onMove={onMove}
            />
          </div>
        </div>
      </div>
      <aside className="side-panel">
        <div className="panel-head">
          <h2 className="train-title">Analysis board</h2>
          {opening && (
            <div className="opening-name">
              <span className="eco">{opening.eco}</span> {opening.name}
            </div>
          )}
          <div className="row-gap wrap">
            <label className="toggle-inline">
              <input type="checkbox" checked={engineOn} onChange={(e) => setEngineOn(e.target.checked)} /> Stockfish
            </label>
            <label className="toggle-inline">
              Lines
              <select value={multiPv} onChange={(e) => setMultiPv(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            {lines?.fen === fen && <span className="muted small">depth {lines.depth}</span>}
          </div>
          {engineOn && (
            <div className="pv-lines">
              {chess.isGameOver() && <div className="muted">Game over in this position.</div>}
              {top.map((l) => (
                <button key={l.multipv} className="pv" onClick={() => play(l.pv[0])} title="Play the first move of this line">
                  <span className="score">{formatScore(l.score)}</span>
                  <span className="pv-moves">{pvToSan(fen, l.pv, 10).join(' ')}</span>
                </button>
              ))}
              {!top.length && !chess.isGameOver() && <div className="muted small">Thinking…</div>}
            </div>
          )}
        </div>
        <MoveList moves={moves} ply={ply} onSelect={setPly} startsWithBlack={turnOf(startFen) === 'black'} firstMoveNumber={Number(startFen.split(' ')[5] || 1)} />
        <div className="nav-buttons">
          <button className="icon-btn" onClick={() => setPly(Math.max(0, ply - 1))} aria-label="Previous move">
            <ChevronLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => setPly(Math.min(moves.length, ply + 1))} aria-label="Next move">
            <ChevronRight size={18} />
          </button>
          <button className="icon-btn" onClick={() => setOrientation(opposite(orientation))} aria-label="Flip board">
            <ArrowUpDown size={18} />
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              setStartFen(START_FEN);
              setMoves([]);
              setPly(0);
            }}
            aria-label="Reset to start position"
            title="Reset"
          >
            <RotateCcw size={18} />
          </button>
        </div>
        <div className="action-buttons">
          <button onClick={() => setLoadOpen(true)}>
            <Upload size={16} /> Load FEN / PGN
          </button>
          <button
            onClick={async () => {
              setCopied((await copyText(fen)) ? 'FEN copied' : '');
              setTimeout(() => setCopied(''), 2000);
            }}
          >
            <Copy size={16} /> {copied || 'Copy FEN'}
          </button>
          <button onClick={() => playFromHere(turnOf(fen))} disabled={chess.isGameOver()}>
            <Play size={16} /> Play from here
          </button>
        </div>
        <p className="muted small fen-text">{fen}</p>
      </aside>
      {promo && (
        <PromotionDialog
          color={turnOf(fen)}
          onPick={(p) => {
            const { from, to } = promo;
            setPromo(null);
            play(from + to + p);
          }}
          onCancel={() => setPromo(null)}
        />
      )}
      {loadOpen && (
        <LoadDialog
          onClose={() => setLoadOpen(false)}
          onLoad={(start, list) => {
            setStartFen(start);
            setMoves(list);
            setPly(list.length);
            setOrientation(turnOf(start));
            setLoadOpen(false);
          }}
        />
      )}
    </div>
  );
}

function LoadDialog({ onClose, onLoad }: { onClose: () => void; onLoad: (start: string, moves: MoveRecord[]) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const load = () => {
    const t = text.trim();
    try {
      const c = new Chess(t);
      onLoad(c.fen(), []);
      return;
    } catch {
      /* not a FEN; try PGN */
    }
    try {
      const c = new Chess();
      c.loadPgn(t);
      const h = c.history({ verbose: true });
      const start = h[0]?.before ?? c.fen();
      onLoad(
        start,
        h.map((m) => ({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: m.after })),
      );
    } catch {
      setErr("That doesn't look like a valid FEN or PGN.");
    }
  };
  return (
    <Modal title="Load a position or game" onClose={onClose}>
      <textarea className="mono" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a FEN or a PGN" />
      {err && <p className="error">{err}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={load} disabled={!text.trim()}>
          Load
        </button>
      </div>
    </Modal>
  );
}
