export type Color = 'white' | 'black';
export type Mode = 'computer' | 'local' | 'online';
export type Result = '1-0' | '0-1' | '1/2-1/2' | '*';
export type Termination =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'timeout-insufficient'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'
  | 'agreement'
  | 'abandoned'
  | 'ongoing';

/** Seconds. initial = 0 means no clock. */
export interface TimeControl {
  initial: number;
  increment: number;
}

export interface MoveRecord {
  san: string;
  uci: string;
  /** Position after the move. */
  fen: string;
  /** Mover's remaining clock after the move (incl. increment), ms. */
  clock?: number;
  /** Time the mover spent on this move, ms. */
  spent?: number;
}

export type MoveClass =
  | 'book'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'forced';

export interface Score {
  /** Centipawns from White's point of view. */
  cp: number | null;
  /** Mate in N from White's point of view (positive = White mates). */
  mate: number | null;
}

export interface MoveAnalysis extends Score {
  /** Engine's best move (UCI) in the position before this move. */
  best: string;
  bestSan: string;
  /** Principal variation (SAN) after the best move, for display. */
  bestLine: string[];
  cls: MoveClass;
  /** Drop in win % for the mover (0–100). */
  loss: number;
}

export interface GameAnalysis {
  depth: number;
  initial: Score;
  moves: MoveAnalysis[];
  accuracy: { white: number; black: number };
  counts: {
    white: Record<'inaccuracy' | 'mistake' | 'blunder', number>;
    black: Record<'inaccuracy' | 'mistake' | 'blunder', number>;
  };
}

export interface GameRecord {
  id: string;
  /** Start time, epoch ms. */
  date: number;
  mode: Mode;
  white: string;
  black: string;
  /** Which side "you" played. Undefined for pass-and-play. */
  playerColor?: Color;
  engineLevel?: number;
  timeControl: TimeControl;
  startFen: string;
  moves: MoveRecord[];
  result: Result;
  termination: Termination;
  opening?: { eco: string; name: string };
  analysis?: GameAnalysis;
  hintsUsed?: number;
  takebacks?: number;
  notes?: string;
  favorite?: boolean;
  /** Imported from a PGN rather than played here. */
  imported?: boolean;
}

export interface Settings {
  playerName: string;
  boardTheme: string;
  showCoords: boolean;
  showLegalMoves: boolean;
  animation: boolean;
  sound: boolean;
  premoves: boolean;
  autoQueen: boolean;
  confirmResign: boolean;
  autoAnalyze: boolean;
  analysisDepth: number;
  lowTimeWarning: boolean;
  theme: 'system' | 'light' | 'dark';
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
