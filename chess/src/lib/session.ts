import { Chess } from 'chess.js';
import { ChessClock } from './clock';
import { hasMatingMaterial, opposite, terminalState, uciToMove, uid } from './chessutil';
import { getPlayEngine } from './engine';
import { getLevel } from './levels';
import { detectOpening, loadOpenings } from './openings';
import { moveSound, play } from './sound';
import type { Color, GameRecord, Mode, MoveRecord, Result, Termination, TimeControl } from './types';
import { START_FEN } from './types';

export interface SessionConfig {
  id?: string;
  mode: Mode;
  /** Your side (vs computer or online). */
  playerColor?: Color;
  engineLevel?: number;
  timeControl: TimeControl;
  white: string;
  black: string;
  startFen?: string;
  date?: number;
}

export interface SavedSession {
  config: SessionConfig;
  moves: string[];
  clocks: { white: number; black: number } | null;
  hintsUsed: number;
  takebacks: number;
}

type Listener = () => void;

/**
 * One game in progress: rules, clocks, the computer opponent and the move record.
 * The React views subscribe to it and re-render on `version` changes.
 */
export class GameSession {
  readonly id: string;
  readonly config: SessionConfig;
  readonly chess: Chess;
  readonly startFen: string;
  readonly date: number;
  moves: MoveRecord[] = [];
  clock: ChessClock | null;
  status: 'playing' | 'over' = 'playing';
  result: Result = '*';
  termination: Termination = 'ongoing';
  engineThinking = false;
  hintsUsed = 0;
  takebacks = 0;
  version = 0;
  /** Called after a move made on this device (used to send it to an online opponent). */
  onLocalMove?: (m: MoveRecord) => void;
  /** Called once when the game finishes. */
  onEnd?: (s: GameSession) => void;

  private listeners = new Set<Listener>();
  private engineGen = 0;
  private lowTimeWarned: Record<Color, boolean> = { white: false, black: false };

  constructor(config: SessionConfig) {
    this.config = config;
    this.id = config.id ?? uid();
    this.date = config.date ?? Date.now();
    this.startFen = config.startFen ?? START_FEN;
    this.chess = new Chess(this.startFen);
    const tc = config.timeControl;
    this.clock = tc.initial > 0 ? new ChessClock(tc.initial * 1000, tc.increment * 1000) : null;
    void loadOpenings();
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  get fen() {
    return this.chess.fen();
  }

  get turn(): Color {
    return this.chess.turn() === 'w' ? 'white' : 'black';
  }

  get mode() {
    return this.config.mode;
  }

  /** Whether the person at this device may move `color` right now. */
  canMove(color: Color = this.turn): boolean {
    if (this.status !== 'playing' || color !== this.turn) return false;
    if (this.mode === 'local') return true;
    if (this.mode === 'computer') return color === this.config.playerColor && !this.engineThinking;
    return color === this.config.playerColor;
  }

  /** The colour(s) the board should let this device move (including premoves). */
  get movableColor(): Color | 'both' | undefined {
    if (this.status !== 'playing') return undefined;
    if (this.mode === 'local') return this.turn;
    return this.config.playerColor;
  }

  userMove(from: string, to: string, promotion?: string): boolean {
    if (!this.canMove()) return false;
    const rec = this.applyMove({ from, to, promotion });
    if (!rec) return false;
    this.onLocalMove?.(rec);
    this.maybeEngineMove();
    return true;
  }

  /** A move received from the online opponent, with their clock after it. */
  remoteMove(uci: string, clock?: number): boolean {
    if (this.status !== 'playing' || this.turn === this.config.playerColor) return false;
    const mover = this.turn;
    const rec = this.applyMove(uciToMove(uci));
    if (!rec) return false;
    if (clock !== undefined && this.clock) {
      this.clock.set(mover, clock);
      rec.clock = clock;
    }
    this.emit();
    return true;
  }

  private applyMove(input: { from: string; to: string; promotion?: string }): MoveRecord | null {
    let mv;
    try {
      mv = this.chess.move({ from: input.from, to: input.to, promotion: input.promotion ?? 'q' });
    } catch {
      return null;
    }
    const mover: Color = mv.color === 'w' ? 'white' : 'black';
    const rec: MoveRecord = { san: mv.san, uci: mv.from + mv.to + (mv.promotion ?? ''), fen: mv.after };
    if (this.clock) {
      const { spent, remaining } = this.clock.press(mover);
      rec.clock = Math.round(remaining);
      rec.spent = Math.round(spent);
    }
    this.moves.push(rec);
    moveSound(mv.san);
    const end = terminalState(this.chess);
    if (end) this.finish(end.result, end.termination);
    this.emit();
    this.persist();
    return rec;
  }

  /** Call regularly while the game is on screen: detects flags and low time. */
  tick() {
    if (!this.clock || this.status !== 'playing' || !this.clock.running) return;
    const side = this.clock.running;
    const t = this.clock.time(side);
    if (t <= 0) {
      // Online, only call our own flag immediately; give the opponent's clock a moment for lag.
      if (this.mode === 'online' && side !== this.config.playerColor && t > -1500) return;
      this.flag(side);
      return;
    }
    const total = this.config.timeControl.initial * 1000;
    if (!this.lowTimeWarned[side] && t < Math.min(20000, total * 0.1) && this.canMove(side)) {
      this.lowTimeWarned[side] = true;
      play('lowtime');
    }
  }

  flag(color: Color) {
    if (this.status !== 'playing') return;
    this.clock?.stop();
    if (this.clock) this.clock[color] = 0;
    const winner = opposite(color);
    if (hasMatingMaterial(this.fen, winner)) this.finish(winner === 'white' ? '1-0' : '0-1', 'timeout');
    else this.finish('1/2-1/2', 'timeout-insufficient');
    this.emit();
  }

  resign(color: Color) {
    if (this.status !== 'playing') return;
    this.finish(color === 'white' ? '0-1' : '1-0', 'resignation');
    this.emit();
  }

  draw(termination: Termination = 'agreement') {
    if (this.status !== 'playing') return;
    this.finish('1/2-1/2', termination);
    this.emit();
  }

  /** End without a result (opponent disconnected and you chose to stop, or nothing was played). */
  abandon(winner?: Color) {
    if (this.status !== 'playing') return;
    this.finish(winner ? (winner === 'white' ? '1-0' : '0-1') : '*', 'abandoned');
    this.emit();
  }

  /** Can the computer currently be asked for a takeback? */
  get canTakeback(): boolean {
    if (this.status !== 'playing' || this.moves.length === 0) return false;
    if (this.mode === 'computer') {
      const myMoves = this.moves.filter((_, i) => this.colorOfPly(i) === this.config.playerColor).length;
      return myMoves > 0;
    }
    return true;
  }

  colorOfPly(i: number): Color {
    const first: Color = this.startFen.split(' ')[1] === 'b' ? 'black' : 'white';
    return i % 2 === 0 ? first : opposite(first);
  }

  /** Vs computer: undo back to your last move. Pass-and-play: undo one move. */
  takeback() {
    if (!this.canTakeback) return;
    this.cancelEngine();
    if (this.mode === 'computer') {
      do this.undoOne();
      while (this.moves.length && this.turn !== this.config.playerColor);
      if (this.turn !== this.config.playerColor) {
        // Computer had the first move; let it play again.
        this.maybeEngineMove();
      }
    } else {
      this.undoOne();
    }
    this.takebacks++;
    this.emit();
    this.persist();
  }

  /** Undo `n` plies (used by accepted online takebacks). */
  undoPlies(n: number) {
    for (let i = 0; i < n && this.moves.length; i++) this.undoOne();
    this.takebacks++;
    this.emit();
  }

  private undoOne() {
    this.chess.undo();
    this.moves.pop();
    if (this.clock && this.moves.length > 0) this.clock.resume(this.turn);
    else this.clock?.stop();
  }

  private finish(result: Result, termination: Termination) {
    this.status = 'over';
    this.result = result;
    this.termination = termination;
    this.clock?.stop();
    this.cancelEngine();
    if (termination !== 'checkmate') play('end');
    this.clearPersisted();
    this.onEnd?.(this);
  }

  // ---- Computer opponent ----

  maybeEngineMove() {
    if (this.mode !== 'computer' || this.status !== 'playing' || this.turn === this.config.playerColor) return;
    const gen = ++this.engineGen;
    this.engineThinking = true;
    this.emit();
    void this.thinkAndMove(gen);
  }

  private async thinkAndMove(gen: number) {
    const level = getLevel(this.config.engineLevel);
    const started = performance.now();
    const fen = this.fen;
    let uci: string | null = null;
    const legal = this.chess.moves({ verbose: true });
    if (level.randomness > 0 && Math.random() < level.randomness && legal.length > 1) {
      const m = legal[Math.floor(Math.random() * legal.length)];
      uci = m.from + m.to + (m.promotion ?? '');
    } else {
      const opts = { ...level.search };
      // On a running clock, don't let the computer burn more than a fair share of its time.
      if (this.clock) {
        const left = this.clock.time(this.turn);
        const budget = Math.max(100, Math.min(opts.movetime ?? 1000, left / 30 + this.clock.incrementMs * 0.5));
        opts.movetime = Math.round(budget);
      }
      try {
        const r = await getPlayEngine().search(fen, opts);
        uci = r.bestmove;
      } catch (e) {
        console.error('Engine failed', e);
        const m = legal[Math.floor(Math.random() * legal.length)];
        uci = m ? m.from + m.to + (m.promotion ?? '') : null;
      }
    }
    // Feel a little more human: don't answer instantly.
    const minDelay = this.clock && this.clock.time(this.turn) < 15000 ? 100 : 350 + Math.random() * 400;
    const wait = minDelay - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (gen !== this.engineGen || this.status !== 'playing' || this.fen !== fen) return;
    this.engineThinking = false;
    if (uci) this.applyMove(uciToMove(uci));
    else this.emit();
  }

  cancelEngine() {
    this.engineGen++;
    if (this.engineThinking) {
      this.engineThinking = false;
      getPlayEngine().cancelAll();
    }
  }

  // ---- Records & persistence ----

  toRecord(): GameRecord {
    const c = this.config;
    return {
      id: this.id,
      date: this.date,
      mode: c.mode,
      white: c.white,
      black: c.black,
      playerColor: c.playerColor,
      engineLevel: c.engineLevel,
      timeControl: c.timeControl,
      startFen: this.startFen,
      moves: [...this.moves],
      result: this.result,
      termination: this.termination,
      opening: detectOpening(this.moves),
      hintsUsed: this.hintsUsed,
      takebacks: this.takebacks,
    };
  }

  private persist() {
    if (this.mode === 'online' || this.status !== 'playing') return;
    const saved: SavedSession = {
      config: { ...this.config, id: this.id, date: this.date, startFen: this.startFen },
      moves: this.moves.map((m) => m.uci),
      clocks: this.clock ? { white: this.clock.time('white'), black: this.clock.time('black') } : null,
      hintsUsed: this.hintsUsed,
      takebacks: this.takebacks,
    };
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify(saved));
    } catch {
      /* storage unavailable */
    }
  }

  private clearPersisted() {
    try {
      const raw = localStorage.getItem(RESUME_KEY);
      if (raw && (JSON.parse(raw) as SavedSession).config.id === this.id) localStorage.removeItem(RESUME_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  /** Keep the saved copy's clocks fresh when leaving the screen mid-game. */
  suspend() {
    if (this.status === 'playing') this.persist();
    this.cancelEngine();
  }

  static restore(saved: SavedSession): GameSession {
    const s = new GameSession(saved.config);
    for (const uci of saved.moves) {
      const mv = s.chess.move(uciToMove(uci));
      s.moves.push({ san: mv.san, uci, fen: mv.after });
    }
    if (s.clock && saved.clocks) {
      s.clock.white = saved.clocks.white;
      s.clock.black = saved.clocks.black;
      if (s.moves.length > 0) s.clock.start(s.turn);
    }
    s.hintsUsed = saved.hintsUsed;
    s.takebacks = saved.takebacks;
    return s;
  }
}

const RESUME_KEY = 'chess-studio:resume';

export function savedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function discardSavedSession() {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* storage unavailable */
  }
}
