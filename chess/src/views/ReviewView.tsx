import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Cpu,
  Download,
  Microscope,
  Play,
  Star,
  Target,
  Trash2,
} from 'lucide-react';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { PlayerBar } from '../components/PlayerBar';
import { Modal, copyText, downloadFile } from '../components/ui';
import { CLASS_INFO } from '../lib/analysis';
import { cancelAnalysis, queueAnalysis, useAnalysisProgress } from '../lib/analysisQueue';
import { formatScore, opposite, resultText, toPgn, turnOf } from '../lib/chessutil';
import { formatClock } from '../lib/clock';
import { deleteGame, getGame, onGamesChanged, saveGame } from '../lib/db';
import { formatTimeControl, getLevel } from '../lib/levels';
import { navigate, useRoute } from '../lib/router';
import { GameSession } from '../lib/session';
import { useSettings } from '../lib/settings';
import { setActiveSession } from '../lib/store';
import type { Color, GameRecord, MoveClass } from '../lib/types';

export function ReviewView({ id }: { id: string }) {
  const { query } = useRoute();
  const settings = useSettings();
  const [game, setGame] = useState<GameRecord | null | undefined>(undefined);
  const [ply, setPly] = useState<number>(() => {
    const q = Number(query.get('ply'));
    return Number.isFinite(q) && query.has('ply') ? q : -1;
  });
  const [orientation, setOrientation] = useState<Color>('white');
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [continueOpen, setContinueOpen] = useState(false);
  const progress = useAnalysisProgress(id);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getGame(id).then((g) => {
        if (!alive) return;
        setGame(g ?? null);
        if (g) setNotes((n) => (n === '' ? (g.notes ?? '') : n));
      });
    void load();
    const off = onGamesChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [id]);

  useEffect(() => {
    if (game?.playerColor) setOrientation(game.playerColor);
  }, [game?.id]);

  // Start at the end of the game unless a move was asked for.
  const current = game ? (ply < 0 ? game.moves.length : Math.min(ply, game.moves.length)) : 0;

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      const n = game.moves.length;
      if (e.key === 'ArrowLeft') setPly(Math.max(0, current - 1));
      else if (e.key === 'ArrowRight') setPly(Math.min(n, current + 1));
      else if (e.key === 'ArrowUp' || e.key === 'Home') setPly(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') setPly(n);
      else if (e.key === 'f') setOrientation((o) => opposite(o));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, current]);

  const analysis = game?.analysis;
  const keyMoments = useMemo(
    () =>
      analysis
        ? analysis.moves
            .map((m, i) => ({ m, i }))
            .filter(({ m }) => m.cls === 'mistake' || m.cls === 'blunder' || m.cls === 'inaccuracy')
        : [],
    [analysis],
  );

  if (game === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (game === null)
    return (
      <div className="page">
        <p>That game isn't in your history.</p>
        <button onClick={() => navigate('history')}>Back to history</button>
      </div>
    );

  const fen = current === 0 ? game.startFen : game.moves[current - 1].fen;
  const move = current > 0 ? game.moves[current - 1] : null;
  const a = current > 0 ? analysis?.moves[current - 1] : null;
  const score = analysis ? (current === 0 ? analysis.initial : analysis.moves[current - 1]) : null;
  const nextA = analysis?.moves[current];
  const shapes: DrawShape[] = [];
  // Arrow for the move that should have been played here (if the actual move was worse).
  if (a && a.best && a.best !== move?.uci && !['best', 'book', 'forced'].includes(a.cls)) {
    shapes.push({ orig: a.best.slice(0, 2) as Key, dest: a.best.slice(2, 4) as Key, brush: 'green' });
  }
  // Otherwise, the engine's suggestion for the position shown.
  else if (nextA?.best && settings.showLegalMoves) shapes.push({ orig: nextA.best.slice(0, 2) as Key, dest: nextA.best.slice(2, 4) as Key, brush: 'paleBlue' });

  const setFav = () => saveGame({ ...game, favorite: !game.favorite });
  const saveNotes = () => {
    if ((game.notes ?? '') !== notes) void saveGame({ ...game, notes });
  };
  const analyse = (depth: number) => queueAnalysis(game, depth);

  const continueVsComputer = (color: Color, level: number) => {
    const s = new GameSession({
      mode: 'computer',
      playerColor: color,
      engineLevel: level,
      timeControl: { initial: 0, increment: 0 },
      white: color === 'white' ? settings.playerName : `Stockfish L${level}`,
      black: color === 'black' ? settings.playerName : `Stockfish L${level}`,
      startFen: fen,
    });
    setActiveSession(s);
    navigate('play');
  };

  const level = game.engineLevel ? getLevel(game.engineLevel) : null;
  const bar = (color: Color) => (
    <PlayerBar
      name={color === 'white' ? game.white : game.black}
      color={color}
      fen={fen}
      kind={game.mode === 'computer' && color !== game.playerColor ? 'computer' : game.mode === 'online' && color !== game.playerColor ? 'remote' : 'human'}
      sub={game.mode === 'computer' && color !== game.playerColor && level ? `Level ${level.level}` : undefined}
      active={false}
    />
  );
  const clockAt = (color: Color) => {
    for (let i = current - 1; i >= 0; i--) {
      const mover = i % 2 === 0 ? turnOf(game.startFen) : opposite(turnOf(game.startFen));
      if (mover === color && game.moves[i].clock !== undefined) return game.moves[i].clock!;
    }
    return game.timeControl.initial ? game.timeControl.initial * 1000 : null;
  };

  return (
    <div className="game-layout review">
      <div className="board-column">
        <div className="bar-with-clock">
          {bar(opposite(orientation))}
          {clockAt(opposite(orientation)) !== null && <div className="clock static">{formatClock(clockAt(opposite(orientation))!)}</div>}
        </div>
        <div className="board-row">
          {analysis && <EvalBar score={score ?? null} orientation={orientation} />}
          <div className="board-holder">
            <Board
              fen={fen}
              orientation={orientation}
              turnColor={turnOf(fen)}
              viewOnly
              lastMove={move ? [move.uci.slice(0, 2) as Key, move.uci.slice(2, 4) as Key] : undefined}
              check={/[+#]$/.test(move?.san ?? '')}
              shapes={shapes}
            />
          </div>
        </div>
        <div className="bar-with-clock">
          {bar(orientation)}
          {clockAt(orientation) !== null && <div className="clock static">{formatClock(clockAt(orientation)!)}</div>}
        </div>
        {analysis && <EvalGraph analysis={analysis} ply={current} onSelect={setPly} />}
      </div>

      <aside className="side-panel">
        <div className="panel-head">
          <div className="review-title">
            <div>
              <strong>{resultText(game.result, game.termination)}</strong>
              <div className="muted small">
                {new Date(game.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {formatTimeControl(game.timeControl)} ·{' '}
                {game.mode === 'computer' ? 'vs computer' : game.mode === 'online' ? 'online' : game.imported ? 'imported' : 'same device'}
                {game.hintsUsed ? ` · ${game.hintsUsed} hints` : ''}
                {game.takebacks ? ` · ${game.takebacks} takebacks` : ''}
              </div>
              {game.opening && (
                <div className="opening-name">
                  <span className="eco">{game.opening.eco}</span> {game.opening.name}
                </div>
              )}
            </div>
            <button className={`icon-btn ${game.favorite ? 'fav' : ''}`} onClick={setFav} aria-label="Favourite" title="Favourite">
              <Star size={18} fill={game.favorite ? 'currentColor' : 'none'} />
            </button>
          </div>

          {analysis ? (
            <AccuracySummary game={game} />
          ) : progress ? (
            <div className="analysis-progress">
              <div className="muted small">
                Analysing… {progress.done}/{progress.total} positions
              </div>
              <progress value={progress.done} max={progress.total} />
              <button className="link-btn" onClick={() => cancelAnalysis(game.id)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="primary" onClick={() => analyse(settings.analysisDepth)} disabled={game.moves.length === 0}>
              <Cpu size={16} /> Analyse with Stockfish
            </button>
          )}

          {a && move && (
            <div className="move-verdict" style={{ borderColor: CLASS_INFO[a.cls].color }}>
              <span className="verdict-badge" style={{ background: CLASS_INFO[a.cls].color }}>
                {CLASS_INFO[a.cls].symbol}
              </span>
              <div>
                <div>
                  <strong>{move.san}</strong> is {articleFor(a.cls)} <strong style={{ color: CLASS_INFO[a.cls].color }}>{CLASS_INFO[a.cls].label.toLowerCase()}</strong>
                  <span className="muted"> · {formatScore(a)}</span>
                  {move.spent !== undefined && <span className="muted"> · {(move.spent / 1000).toFixed(1)}s</span>}
                </div>
                {!['best', 'book', 'forced'].includes(a.cls) && a.bestSan && (
                  <div className="small">
                    Best was <strong>{a.bestSan}</strong>
                    {a.bestLine.length > 1 && <span className="muted"> — {a.bestLine.slice(0, 6).join(' ')}</span>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <MoveList
          moves={game.moves}
          ply={current}
          onSelect={setPly}
          analysis={analysis?.moves}
          showClocks={!!game.timeControl.initial}
          startsWithBlack={turnOf(game.startFen) === 'black'}
          firstMoveNumber={Number(game.startFen.split(' ')[5] || 1)}
        />

        <div className="nav-buttons">
          <button className="icon-btn" onClick={() => setPly(0)} aria-label="First move">
            <ChevronsLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => setPly(Math.max(0, current - 1))} aria-label="Previous move">
            <ChevronLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => setPly(Math.min(game.moves.length, current + 1))} aria-label="Next move">
            <ChevronRight size={18} />
          </button>
          <button className="icon-btn" onClick={() => setPly(game.moves.length)} aria-label="Last move">
            <ChevronsRight size={18} />
          </button>
          <button className="icon-btn" onClick={() => setOrientation(opposite(orientation))} aria-label="Flip board">
            <ArrowUpDown size={18} />
          </button>
        </div>

        {keyMoments.length > 0 && (
          <div className="key-moments">
            <h3>Key moments</h3>
            <div className="chips">
              {keyMoments.map(({ m, i }) => (
                <button
                  key={i}
                  className={`chip ${current === i + 1 ? 'on' : ''}`}
                  style={{ borderColor: CLASS_INFO[m.cls].color }}
                  onClick={() => setPly(i + 1)}
                  title={`${CLASS_INFO[m.cls].label}; best was ${m.bestSan}`}
                >
                  {Math.floor(i / 2) + 1}
                  {i % 2 === 0 ? '.' : '…'} {game.moves[i].san}
                  <span style={{ color: CLASS_INFO[m.cls].color }}>{CLASS_INFO[m.cls].symbol}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="action-buttons">
          {analysis && game.playerColor && (
            <button className="primary" onClick={() => navigate(`train?game=${game.id}`)}>
              <Target size={16} /> Practise my mistakes
            </button>
          )}
          <button onClick={() => navigate(`analysis?fen=${encodeURIComponent(fen)}`)}>
            <Microscope size={16} /> Explore position
          </button>
          <button onClick={() => setContinueOpen(true)}>
            <Play size={16} /> Play from here
          </button>
          {analysis && !progress && (
            <button onClick={() => analyse(Math.min(22, Math.max(settings.analysisDepth, analysis.depth) + 4))} title="Analyse again, deeper">
              <Cpu size={16} /> Deeper analysis
            </button>
          )}
          <button
            onClick={async () => {
              setCopied(await copyText(toPgn(game)));
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Copy size={16} /> {copied ? 'Copied!' : 'Copy PGN'}
          </button>
          <button onClick={() => downloadFile(`${game.white}-vs-${game.black}-${new Date(game.date).toISOString().slice(0, 10)}.pgn`, toPgn(game))}>
            <Download size={16} /> Download
          </button>
          <button className="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} /> Delete
          </button>
        </div>

        <label className="notes">
          <span className="field-label">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="What did you learn from this game?"
            rows={3}
          />
        </label>
      </aside>

      {confirmDelete && (
        <Modal title="Delete this game?" onClose={() => setConfirmDelete(false)}>
          <p className="muted">It will be removed from your history and statistics. This can't be undone.</p>
          <div className="modal-actions">
            <button onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              className="danger"
              onClick={async () => {
                cancelAnalysis(game.id);
                await deleteGame(game.id);
                navigate('history');
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {continueOpen && <ContinueDialog fen={fen} onClose={() => setContinueOpen(false)} onStart={continueVsComputer} defaultLevel={game.engineLevel ?? 5} />}
    </div>
  );
}

function articleFor(cls: MoveClass) {
  return ['inaccuracy', 'excellent'].includes(cls) ? 'an' : 'a';
}

function ContinueDialog({
  fen,
  onClose,
  onStart,
  defaultLevel,
}: {
  fen: string;
  onClose: () => void;
  onStart: (c: Color, level: number) => void;
  defaultLevel: number;
}) {
  const [level, setLevel] = useState(defaultLevel);
  const side = turnOf(fen);
  const lvl = getLevel(level);
  return (
    <Modal title="Play this position vs the computer" onClose={onClose}>
      <label className="field-label">
        Level {lvl.level} — {lvl.name} (≈{lvl.elo})
      </label>
      <input type="range" min={1} max={12} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
      <div className="modal-actions">
        <button className="primary" onClick={() => onStart(side, level)}>
          Play as {side} (to move)
        </button>
        <button onClick={() => onStart(opposite(side), level)}>Play as {opposite(side)}</button>
      </div>
    </Modal>
  );
}

function AccuracySummary({ game }: { game: GameRecord }) {
  const a = game.analysis!;
  const row = (color: Color) => {
    const c = a.counts[color];
    return (
      <div className={`acc-row ${game.playerColor === color ? 'me' : ''}`}>
        <span className="acc-name">{color === 'white' ? game.white : game.black}</span>
        <span className="acc-num">{a.accuracy[color].toFixed(0)}%</span>
        <span className="acc-counts">
          <span style={{ color: CLASS_INFO.inaccuracy.color }} title="Inaccuracies">
            {c.inaccuracy}?!
          </span>
          <span style={{ color: CLASS_INFO.mistake.color }} title="Mistakes">
            {c.mistake}?
          </span>
          <span style={{ color: CLASS_INFO.blunder.color }} title="Blunders">
            {c.blunder}??
          </span>
        </span>
      </div>
    );
  };
  return (
    <div className="accuracy">
      <div className="acc-head muted small">
        Accuracy · Stockfish depth {a.depth}
      </div>
      {row('white')}
      {row('black')}
    </div>
  );
}
