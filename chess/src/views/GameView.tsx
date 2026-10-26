import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Handshake,
  Lightbulb,
  Microscope,
  Plus,
  RefreshCw,
  Repeat,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { MoveList } from '../components/MoveList';
import { PlayerBar } from '../components/PlayerBar';
import { PromotionDialog } from '../components/PromotionDialog';
import { Modal, copyText } from '../components/ui';
import { formatScore, isPromotion, legalDests, opposite, outcomeFor, pvToSan, resultText, toPgn, turnOf } from '../lib/chessutil';
import { getAnalysisEngine } from '../lib/engine';
import { getLevel } from '../lib/levels';
import type { OnlineMatch } from '../lib/net';
import { loadOpenings, openingAt } from '../lib/openings';
import { navigate } from '../lib/router';
import { GameSession } from '../lib/session';
import { remember, store, useSettings } from '../lib/settings';
import { play } from '../lib/sound';
import { setActiveSession } from '../lib/store';
import type { Color, Score } from '../lib/types';

function useVersion(obj: { subscribe: (fn: () => void) => () => void; getVersion: () => number } | null | undefined) {
  return useSyncExternalStore(
    (fn) => (obj ? obj.subscribe(fn) : () => {}),
    () => (obj ? obj.getVersion() : 0),
  );
}

export function GameView({ session, match }: { session: GameSession; match?: OnlineMatch | null }) {
  useVersion(session);
  useVersion(match);
  const settings = useSettings();
  const mode = session.mode;
  const me = session.config.playerColor;
  const [orientation, setOrientation] = useState<Color>(me ?? 'white');
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: Key; to: Key } | null>(null);
  const [hint, setHint] = useState<{ fen: string; uci: string; line: string[] } | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [showEval, setShowEval] = useState<boolean>(() => remember('showEval', false));
  const [autoFlip, setAutoFlip] = useState<boolean>(() => remember('autoFlip', false));
  const [live, setLive] = useState<{ fen: string; score: Score; best?: string; depth: number } | null>(null);
  const [confirm, setConfirm] = useState<null | 'resign' | 'draw' | 'abort'>(null);
  const [overOpen, setOverOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [openingsReady, setOpeningsReady] = useState(false);
  const api = useRef<Api | null>(null);
  const prevStatus = useRef(session.status);

  const ply = viewPly ?? session.moves.length;
  const isLive = viewPly === null || viewPly === session.moves.length;
  const displayFen = ply === 0 ? session.startFen : session.moves[ply - 1].fen;
  const lastUci = ply > 0 ? session.moves[ply - 1].uci : null;
  const lastSan = ply > 0 ? session.moves[ply - 1].san : '';
  const evalAllowed = mode !== 'online' || session.status === 'over';

  useEffect(() => {
    void loadOpenings().then(() => setOpeningsReady(true));
  }, []);

  // Clock: flags and low-time warnings.
  useEffect(() => {
    const id = window.setInterval(() => session.tick(), 100);
    return () => window.clearInterval(id);
  }, [session]);

  // Resume: if the computer is to move, let it.
  useEffect(() => {
    session.maybeEngineMove();
  }, [session]);

  // Game-over dialog, once.
  useEffect(() => {
    if (prevStatus.current === 'playing' && session.status === 'over') {
      setOverOpen(true);
      setViewPly(null);
    }
    prevStatus.current = session.status;
  });

  // When it becomes our move, fire any queued premove.
  useEffect(() => {
    if (isLive && session.canMove()) {
      const t = window.setTimeout(() => api.current?.playPremove(), 0);
      return () => window.clearTimeout(t);
    }
  }, [session.moves.length, isLive, session]);

  // Pass-and-play: turn the board towards whoever is to move.
  useEffect(() => {
    if (mode === 'local' && autoFlip && session.status === 'playing') setOrientation(session.turn);
  }, [mode, autoFlip, session.moves.length, session.status, session]);

  // Hints only apply to the position they were asked for.
  useEffect(() => {
    if (hint && hint.fen !== displayFen) setHint(null);
  }, [displayFen, hint]);

  // Live evaluation for the position on the board.
  useEffect(() => {
    if (!showEval || !evalAllowed) {
      setLive(null);
      return;
    }
    const engine = getAnalysisEngine();
    let alive = true;
    engine.cancelAll('live');
    engine
      .search(
        displayFen,
        { depth: 20 },
        (lines, depth) => {
          if (alive && lines[0]) setLive({ fen: displayFen, score: lines[0].score, best: lines[0].pv[0], depth });
        },
        'live',
      )
      .catch(() => {});
    return () => {
      alive = false;
      engine.cancelAll('live');
    };
  }, [displayFen, showEval, evalAllowed]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft') setViewPly((p) => Math.max(0, (p ?? session.moves.length) - 1));
      else if (e.key === 'ArrowRight')
        setViewPly((p) => {
          const n = Math.min(session.moves.length, (p ?? session.moves.length) + 1);
          return n === session.moves.length ? null : n;
        });
      else if (e.key === 'ArrowUp' || e.key === 'Home') setViewPly(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') setViewPly(null);
      else if (e.key === 'f') setOrientation((o) => opposite(o));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const dests = useMemo(
    () => (isLive && session.status === 'playing' ? legalDests(session.chess) : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.fen, isLive, session.status],
  );

  const shapes: DrawShape[] = [];
  if (hint && hint.fen === displayFen) shapes.push({ orig: hint.uci.slice(0, 2) as Key, dest: hint.uci.slice(2, 4) as Key, brush: 'green' });
  if (live?.best && live.fen === displayFen && settings.showLegalMoves)
    shapes.push({ orig: live.best.slice(0, 2) as Key, dest: live.best.slice(2, 4) as Key, brush: 'paleBlue' });

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  };

  const onMove = (from: Key, to: Key) => {
    if (!isLive) return;
    if (isPromotion(session.chess, from, to)) {
      if (settings.autoQueen) doMove(from, to, 'q');
      else setPromo({ from, to });
      return;
    }
    doMove(from, to);
  };

  const doMove = (from: Key, to: Key, promotion?: string) => {
    setHint(null);
    if (!session.userMove(from, to, promotion)) {
      api.current?.set({ fen: session.fen });
      play('error');
    }
  };

  const askHint = async () => {
    if (hintBusy) return;
    setHintBusy(true);
    const fen = session.fen;
    try {
      const engine = getAnalysisEngine();
      engine.cancelAll('live');
      const r = await engine.search(fen, { depth: 16 }, undefined, 'hint');
      if (r.bestmove && session.fen === fen) {
        session.hintsUsed++;
        setHint({ fen, uci: r.bestmove, line: pvToSan(fen, r.lines[0]?.pv ?? [], 5) });
      }
    } finally {
      setHintBusy(false);
    }
  };

  /** The computer accepts a draw if it's worse, or if the game is long and level. */
  const offerDrawToComputer = async () => {
    const fen = session.fen;
    const r = await getAnalysisEngine().search(fen, { depth: 14 }, undefined, 'draw');
    const cp = r.lines[0]?.score.mate != null ? (r.lines[0].score.mate > 0 ? 1000 : -1000) : (r.lines[0]?.score.cp ?? 0);
    const engineSide = opposite(me!);
    const forEngine = engineSide === 'white' ? cp : -cp;
    if (forEngine < -80 || (Math.abs(cp) < 40 && session.moves.length >= 60)) {
      session.draw('agreement');
    } else {
      flash('The computer declines your draw offer.');
    }
  };

  const newSameGame = () => {
    const c = session.config;
    const next = new GameSession({ ...c, id: undefined, date: undefined });
    setActiveSession(next);
    setOverOpen(false);
  };

  const toggleEval = () => {
    store('showEval', !showEval);
    setShowEval(!showEval);
  };

  // ---- Names & bars ----
  const level = session.config.engineLevel ? getLevel(session.config.engineLevel) : null;
  const barFor = (color: Color) => {
    const name = color === 'white' ? session.config.white : session.config.black;
    let kind: 'human' | 'computer' | 'remote' = 'human';
    let sub: string | undefined;
    if (mode === 'computer' && color !== me) {
      kind = 'computer';
      sub = level ? `Level ${level.level} · ≈${level.elo}` : undefined;
    } else if (mode === 'online' && color !== me) {
      kind = 'remote';
      sub = match ? (match.status === 'connected' ? (match.rtt !== null ? `${match.rtt} ms` : 'online') : match.status) : undefined;
    }
    const active = session.status === 'playing' && session.turn === color;
    return <PlayerBar name={name} color={color} fen={displayFen} session={session} kind={kind} sub={sub} active={active} />;
  };

  const opening = openingsReady ? lastOpening(session, ply) : null;
  const outcome = outcomeFor(session, me);
  const thinking = session.engineThinking && session.status === 'playing';

  return (
    <div className="game-layout">
      <div className="board-column">
        {barFor(opposite(orientation))}
        <div className="board-row">
          {showEval && evalAllowed && <EvalBar score={live?.fen === displayFen ? live.score : null} orientation={orientation} />}
          <div className="board-holder">
            <Board
              fen={displayFen}
              orientation={orientation}
              turnColor={turnOf(displayFen)}
              movableColor={isLive ? session.movableColor : undefined}
              dests={dests}
              lastMove={lastUci ? [lastUci.slice(0, 2) as Key, lastUci.slice(2, 4) as Key] : undefined}
              check={/[+#]$/.test(lastSan)}
              premoves={mode !== 'local'}
              shapes={shapes}
              onMove={onMove}
              onReady={(a) => (api.current = a)}
            />
            {!isLive && (
              <button className="back-to-live" onClick={() => setViewPly(null)}>
                Viewing move {Math.ceil(ply / 2)} — back to game
              </button>
            )}
          </div>
        </div>
        {barFor(orientation)}
      </div>

      <aside className="side-panel">
        <div className="panel-head">
          <div className="status-line">
            {session.status === 'over' ? (
              <strong>{resultText(session.result, session.termination)}</strong>
            ) : thinking ? (
              <span className="thinking">Computer is thinking…</span>
            ) : mode === 'online' && match && match.status !== 'connected' ? (
              <span className="warn">{statusText(match)}</span>
            ) : (
              <span>
                {session.turn === 'white' ? 'White' : 'Black'} to move
                {mode !== 'local' && session.turn === me ? ' — your turn' : ''}
              </span>
            )}
          </div>
          {opening && (
            <div className="opening-name" title={opening.eco}>
              <span className="eco">{opening.eco}</span> {opening.name}
            </div>
          )}
          {showEval && evalAllowed && live?.fen === displayFen && (
            <div className="engine-line">
              <span className="score">{formatScore(live.score)}</span>
              <span className="muted">depth {live.depth}</span>
              {live.best && <span>best: {pvToSan(displayFen, [live.best], 1)[0]}</span>}
            </div>
          )}
          {hint && hint.fen === displayFen && (
            <div className="hint-line">
              <Lightbulb size={14} /> Try <strong>{hint.line[0]}</strong>
              {hint.line.length > 1 && <span className="muted"> ({hint.line.slice(1).join(' ')} …)</span>}
            </div>
          )}
        </div>

        <MoveList
          moves={session.moves}
          ply={ply}
          onSelect={(p) => setViewPly(p === session.moves.length ? null : p)}
          startsWithBlack={turnOf(session.startFen) === 'black'}
          firstMoveNumber={Number(session.startFen.split(' ')[5] || 1)}
        />

        <div className="nav-buttons">
          <button className="icon-btn" onClick={() => setViewPly(0)} aria-label="First move">
            <ChevronsLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => setViewPly(Math.max(0, ply - 1))} aria-label="Previous move">
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setViewPly(ply + 1 >= session.moves.length ? null : ply + 1)}
            aria-label="Next move"
          >
            <ChevronRight size={18} />
          </button>
          <button className="icon-btn" onClick={() => setViewPly(null)} aria-label="Last move">
            <ChevronsRight size={18} />
          </button>
          <button className="icon-btn" onClick={() => setOrientation(opposite(orientation))} aria-label="Flip board" title="Flip board (F)">
            <ArrowUpDown size={18} />
          </button>
          {mode === 'local' && (
            <button
              className={`icon-btn ${autoFlip ? 'on' : ''}`}
              onClick={() => (store('autoFlip', !autoFlip), setAutoFlip(!autoFlip))}
              aria-label="Auto-flip board"
              title="Turn the board to the player to move"
            >
              <RefreshCw size={18} />
            </button>
          )}
          {evalAllowed && (
            <button className={`icon-btn ${showEval ? 'on' : ''}`} onClick={toggleEval} aria-label="Toggle evaluation" title="Show engine evaluation">
              {showEval ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          )}
        </div>

        {match && <OnlineOffers match={match} />}

        <div className="action-buttons">
          {session.status === 'playing' ? (
            <>
              {mode === 'computer' && (
                <>
                  <button onClick={() => session.takeback()} disabled={!session.canTakeback}>
                    <Undo2 size={16} /> Takeback
                  </button>
                  <button onClick={askHint} disabled={!session.canMove() || hintBusy}>
                    <Lightbulb size={16} /> {hintBusy ? 'Thinking…' : 'Hint'}
                  </button>
                </>
              )}
              {mode === 'local' && (
                <button onClick={() => session.takeback()} disabled={!session.canTakeback}>
                  <Undo2 size={16} /> Undo
                </button>
              )}
              {mode === 'online' && match && (
                <button onClick={() => match.requestTakeback()} disabled={match.takeback !== 'none' || session.moves.length === 0 || match.status !== 'connected'}>
                  <Undo2 size={16} /> {match.takeback === 'sent' ? 'Takeback asked' : 'Takeback'}
                </button>
              )}
              {session.moves.length < 2 && mode !== 'online' ? (
                <button onClick={() => setConfirm('abort')}>
                  <X size={16} /> Abort
                </button>
              ) : (
                <>
                  <button
                    onClick={() => (mode === 'local' ? setConfirm('draw') : mode === 'online' ? match?.offerDraw() : offerDrawToComputer())}
                    disabled={mode === 'online' && (match?.draw === 'sent' || match?.status !== 'connected')}
                  >
                    <Handshake size={16} /> {match?.draw === 'sent' ? 'Draw offered' : 'Offer draw'}
                  </button>
                  <button className="danger" onClick={() => (settings.confirmResign ? setConfirm('resign') : resign())}>
                    <Flag size={16} /> Resign
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button className="primary" onClick={() => navigate(`review/${session.id}`)}>
                <Microscope size={16} /> Review game
              </button>
              {mode === 'online' && match ? (
                <button onClick={() => match.offerRematch()} disabled={match.rematch === 'sent' || match.status !== 'connected'}>
                  <Repeat size={16} /> {match.rematch === 'sent' ? 'Rematch offered' : match.rematch === 'received' ? 'Accept rematch' : 'Rematch'}
                </button>
              ) : (
                <button onClick={newSameGame}>
                  <Repeat size={16} /> Play again
                </button>
              )}
              <button onClick={() => navigate('')}>
                <Plus size={16} /> New game
              </button>
            </>
          )}
          <button
            onClick={async () => flash((await copyText(toPgn(session.toRecord()))) ? 'PGN copied' : 'Could not copy')}
            title="Copy the game as PGN"
          >
            <Copy size={16} /> PGN
          </button>
        </div>

        {match && <ChatBox match={match} />}
        {toast && <div className="toast">{toast}</div>}
      </aside>

      {promo && (
        <PromotionDialog
          color={session.turn}
          onPick={(p) => {
            const { from, to } = promo;
            setPromo(null);
            doMove(from, to, p);
          }}
          onCancel={() => {
            setPromo(null);
            api.current?.set({ fen: session.fen });
          }}
        />
      )}

      {confirm && (
        <Modal title={confirm === 'resign' ? 'Resign this game?' : confirm === 'abort' ? 'Abort this game?' : 'Agree to a draw?'} onClose={() => setConfirm(null)}>
          <p className="muted">
            {confirm === 'resign'
              ? mode === 'local'
                ? `${session.turn === 'white' ? 'White' : 'Black'} (the side to move) resigns.`
                : 'The game will be saved as a loss.'
              : confirm === 'abort'
                ? 'Nothing will be saved.'
                : 'The game ends in a draw.'}
          </p>
          <div className="modal-actions">
            <button onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className={confirm === 'resign' ? 'danger' : 'primary'}
              onClick={() => {
                if (confirm === 'resign') resign();
                else if (confirm === 'abort') {
                  session.abandon();
                  setActiveSession(null);
                  navigate('');
                } else session.draw('agreement');
                setConfirm(null);
              }}
            >
              {confirm === 'resign' ? 'Resign' : confirm === 'abort' ? 'Abort' : 'Draw'}
            </button>
          </div>
        </Modal>
      )}

      {overOpen && session.status === 'over' && (
        <Modal onClose={() => setOverOpen(false)}>
          <div className="game-over">
            <div className={`go-badge ${outcome ?? 'neutral'}`}>
              {outcome === 'win' ? 'You won!' : outcome === 'loss' ? 'You lost' : outcome === 'draw' ? 'Draw' : session.result === '1/2-1/2' ? 'Draw' : session.result === '1-0' ? 'White wins' : session.result === '0-1' ? 'Black wins' : 'Game over'}
            </div>
            <p>{resultText(session.result, session.termination)}</p>
            <p className="muted small">
              {session.moves.length} half-moves · saved to your history
              {settings.autoAnalyze && session.moves.length >= 2 ? ' · analysing in the background' : ''}
            </p>
            {match?.rematch === 'received' && <p className="ok">{match.oppName} wants a rematch!</p>}
            <div className="modal-actions">
              <button className={match?.rematch === 'received' ? '' : 'primary'} onClick={() => navigate(`review/${session.id}`)}>
                <Microscope size={16} /> Review
              </button>
              {mode === 'online' && match ? (
                <button
                  className={match.rematch === 'received' ? 'primary' : ''}
                  onClick={() => match.offerRematch()}
                  disabled={match.rematch === 'sent' || match.status !== 'connected'}
                >
                  <Repeat size={16} /> {match.rematch === 'received' ? 'Accept rematch' : match.rematch === 'sent' ? 'Rematch offered' : 'Rematch'}
                </button>
              ) : (
                <button onClick={newSameGame}>
                  <Repeat size={16} /> Play again
                </button>
              )}
              <button onClick={() => setOverOpen(false)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );

  function resign() {
    if (mode === 'online' && match) match.resign();
    else if (mode === 'local') session.resign(session.turn);
    else session.resign(me!);
  }
}

function lastOpening(session: GameSession, ply: number) {
  let found: { eco: string; name: string } | null = null;
  for (let i = 0; i < Math.min(ply, 40); i++) {
    const o = openingAt(session.moves[i].fen);
    if (o) found = o;
  }
  return found;
}

function statusText(m: OnlineMatch) {
  switch (m.status) {
    case 'reconnecting':
      return 'Connection lost — reconnecting…';
    case 'closed':
      return 'Opponent left';
    case 'error':
      return m.error;
    default:
      return 'Connecting…';
  }
}

function OnlineOffers({ match }: { match: OnlineMatch }) {
  const s = match.session;
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (match.status === 'reconnecting' || match.status === 'closed') setSince((t) => t ?? Date.now());
    else setSince(null);
  }, [match.status]);
  const [, force] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  const waited = since ? Math.floor((Date.now() - since) / 1000) : 0;

  return (
    <>
      {match.draw === 'received' && s?.status === 'playing' && (
        <div className="offer">
          <span>{match.oppName} offers a draw</span>
          <button className="primary" onClick={() => match.answerDraw(true)}>Accept</button>
          <button onClick={() => match.answerDraw(false)}>Decline</button>
        </div>
      )}
      {match.takeback === 'received' && s?.status === 'playing' && (
        <div className="offer">
          <span>{match.oppName} asks for a takeback</span>
          <button className="primary" onClick={() => match.answerTakeback(true)}>Accept</button>
          <button onClick={() => match.answerTakeback(false)}>Decline</button>
        </div>
      )}
      {match.rematch === 'received' && (
        <div className="offer">
          <span>{match.oppName} wants a rematch</span>
          <button className="primary" onClick={() => match.answerRematch(true)}>Accept</button>
          <button onClick={() => match.answerRematch(false)}>Decline</button>
        </div>
      )}
      {since !== null && s?.status === 'playing' && (
        <div className="offer warn">
          <span>
            {match.status === 'closed' ? `${match.oppName} left the game.` : `Waiting for ${match.oppName} to reconnect… ${waited}s`}
          </span>
          {(waited >= 30 || match.status === 'closed') && (
            <>
              <button onClick={() => match.claimAbandoned(true)}>Claim win</button>
              <button onClick={() => match.claimAbandoned(false)}>End, no result</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function ChatBox({ match }: { match: OnlineMatch }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
    match.markRead();
  }, [match.chat.length, match]);
  const quick = ['Good luck!', 'Nice move!', 'Oops 😅', 'Good game!', 'Thanks!'];
  return (
    <div className="chat">
      <div className="chat-log" ref={ref}>
        {match.chat.map((c, i) => (
          <div key={i} className={`chat-line ${c.from}`}>
            {c.from === 'them' && <strong>{match.oppName}: </strong>}
            {c.text}
          </div>
        ))}
      </div>
      <div className="chat-quick">
        {quick.map((q) => (
          <button key={q} onClick={() => match.sendChat(q)} disabled={match.status !== 'connected'}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          match.sendChat(text);
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" maxLength={300} aria-label="Chat message" />
        <button type="submit" className="icon-btn" aria-label="Send" disabled={!text.trim() || match.status !== 'connected'}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
