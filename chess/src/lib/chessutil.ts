import { Chess, type Square } from 'chess.js';
import type { Key } from 'chessground/types';
import type { Color, GameRecord, MoveRecord, Result, Score, Termination } from './types';

export const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white');
export const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

/** Legal destinations in chessground's format. */
export function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const list = dests.get(m.from as Key);
    if (list) list.push(m.to as Key);
    else dests.set(m.from as Key, [m.to as Key]);
  }
  return dests;
}

export function uciToMove(uci: string) {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

export function uciToSan(fen: string, uci: string): string {
  try {
    const c = new Chess(fen);
    return c.move(uciToMove(uci)).san;
  } catch {
    return uci;
  }
}

/** Convert a list of UCI moves (a PV) to SAN, stopping at the first illegal one. */
export function pvToSan(fen: string, pv: string[], max = 12): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      out.push(c.move(uciToMove(uci)).san);
    } catch {
      break;
    }
  }
  return out;
}

export function isPromotion(chess: Chess, from: string, to: string): boolean {
  const piece = chess.get(from as Square);
  if (!piece || piece.type !== 'p') return false;
  return (piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1');
}

/** Game-over state of a position, if any. */
export function terminalState(chess: Chess): { result: Result; termination: Termination } | null {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', termination: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', termination: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', termination: 'insufficient' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', termination: 'threefold' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', termination: 'fifty-move' };
  return null;
}

/** Can `color` still deliver mate with the material it has? (Used when the opponent's flag falls.) */
export function hasMatingMaterial(fen: string, color: Color): boolean {
  const placement = fen.split(' ')[0];
  const mine = color === 'white' ? placement.replace(/[^A-Z]/g, '') : placement.replace(/[^a-z]/g, '').toUpperCase();
  const pieces = mine.replace('K', '');
  if (/[PQR]/.test(pieces)) return true;
  // Two minor pieces (or more) can in principle mate; a lone minor cannot.
  return pieces.length >= 2;
}

export function resultText(result: Result, termination: Termination): string {
  const winner = result === '1-0' ? 'White' : result === '0-1' ? 'Black' : null;
  switch (termination) {
    case 'checkmate':
      return `${winner} wins by checkmate`;
    case 'resignation':
      return `${winner} wins — ${winner === 'White' ? 'Black' : 'White'} resigned`;
    case 'timeout':
      return `${winner} wins on time`;
    case 'timeout-insufficient':
      return 'Draw — time ran out, but the other side cannot mate';
    case 'stalemate':
      return 'Draw by stalemate';
    case 'threefold':
      return 'Draw by threefold repetition';
    case 'fifty-move':
      return 'Draw by the 50-move rule';
    case 'insufficient':
      return 'Draw — insufficient material';
    case 'agreement':
      return 'Draw by agreement';
    case 'abandoned':
      return winner ? `${winner} wins — opponent left` : 'Game abandoned';
    default:
      return 'In progress';
  }
}

/** Result from a particular player's perspective. */
export function outcomeFor(game: Pick<GameRecord, 'result'>, color: Color | undefined): 'win' | 'loss' | 'draw' | null {
  if (!color || game.result === '*') return null;
  if (game.result === '1/2-1/2') return 'draw';
  const whiteWon = game.result === '1-0';
  return whiteWon === (color === 'white') ? 'win' : 'loss';
}

// ---- Evaluation maths (same formulas lichess uses) ----

const MATE_CP = 1000;

export function scoreToCp(s: Score): number {
  if (s.mate !== null) return s.mate > 0 ? MATE_CP : s.mate < 0 ? -MATE_CP : 0;
  return Math.max(-MATE_CP, Math.min(MATE_CP, s.cp ?? 0));
}

/** Win probability for White, 0–100. */
export function winPct(s: Score): number {
  const cp = scoreToCp(s);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function moveAccuracy(winBefore: number, winAfter: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669 + 1;
  return Math.max(0, Math.min(100, a));
}

export function formatScore(s: Score | null | undefined): string {
  if (!s) return '';
  if (s.mate !== null) return s.mate === 0 ? '#' : `${s.mate > 0 ? '' : '-'}M${Math.abs(s.mate)}`;
  const cp = s.cp ?? 0;
  if (cp >= 10000) return '1-0';
  if (cp <= -10000) return '0-1';
  const v = cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

// ---- PGN ----

function pgnDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function clk(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function toPgn(g: GameRecord): string {
  const headers: [string, string][] = [
    ['Event', g.mode === 'online' ? 'Online game' : g.mode === 'computer' ? 'Game vs computer' : 'Casual game'],
    ['Site', 'Chess Studio'],
    ['Date', pgnDate(g.date)],
    ['White', g.white],
    ['Black', g.black],
    ['Result', g.result],
    ['TimeControl', g.timeControl.initial ? `${g.timeControl.initial}+${g.timeControl.increment}` : '-'],
    ['Termination', g.termination],
  ];
  if (g.opening) {
    headers.push(['ECO', g.opening.eco], ['Opening', g.opening.name]);
  }
  const startFen = g.startFen;
  const standard = startFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq');
  if (!standard) headers.push(['SetUp', '1'], ['FEN', startFen]);

  const startColor = turnOf(startFen);
  let moveNo = Number(startFen.split(' ')[5] || 1);
  const parts: string[] = [];
  g.moves.forEach((m, i) => {
    const white = (i % 2 === 0) === (startColor === 'white');
    if (white) parts.push(`${moveNo}.`);
    else if (i === 0) parts.push(`${moveNo}...`);
    parts.push(m.san);
    const comments: string[] = [];
    if (m.clock !== undefined && g.timeControl.initial) comments.push(`[%clk ${clk(m.clock)}]`);
    const a = g.analysis?.moves[i];
    if (a) {
      const e = a.mate !== null ? `#${a.mate}` : ((a.cp ?? 0) / 100).toFixed(2);
      comments.push(`[%eval ${e}]`);
      if (a.cls === 'inaccuracy' || a.cls === 'mistake' || a.cls === 'blunder') {
        comments.push(`${a.cls[0].toUpperCase()}${a.cls.slice(1)}. ${a.bestSan} was best.`);
      }
    }
    if (comments.length) parts.push(`{ ${comments.join(' ')} }`);
    if (!white) moveNo++;
  });
  parts.push(g.result);

  const lines: string[] = [];
  let line = '';
  for (const p of parts) {
    if (line.length + p.length + 1 > 80) {
      lines.push(line);
      line = p;
    } else line = line ? `${line} ${p}` : p;
  }
  if (line) lines.push(line);
  return `${headers.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join('\n')}\n\n${lines.join('\n')}\n`;
}

/** Split a file with one or more PGN games into separate games. */
export function splitPgn(text: string): string[] {
  const games: string[] = [];
  const chunks = text.replace(/\r\n/g, '\n').split(/\n\s*\n(?=\[)/);
  for (const c of chunks) if (c.trim()) games.push(c.trim());
  return games;
}

export function parsePgn(pgn: string): Omit<GameRecord, 'id'> | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const h = chess.getHeaders();
  const history = chess.history({ verbose: true });
  if (!history.length) return null;
  const startFen = history[0].before;
  const moves: MoveRecord[] = history.map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    fen: m.after,
  }));
  // Pull clock times out of comments if present.
  const comments = chess.getComments();
  const clockByFen = new Map<string, number>();
  for (const c of comments) {
    const m = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(c.comment);
    if (m) clockByFen.set(c.fen, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  }
  for (const m of moves) {
    const t = clockByFen.get(m.fen);
    if (t !== undefined) m.clock = t;
  }
  const result = (['1-0', '0-1', '1/2-1/2'].includes(h.Result ?? '') ? h.Result : '*') as Result;
  const terminal = terminalState(chess);
  let date = Date.now();
  if (h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date)) {
    const [y, mo, d] = h.Date.split('.').map(Number);
    const t = new Date(y, mo - 1, d, 12).getTime();
    if (!Number.isNaN(t)) date = t;
  }
  const tc = /^(\d+)\+(\d+)$/.exec(h.TimeControl ?? '');
  return {
    date,
    mode: 'local',
    white: h.White && h.White !== '?' ? h.White : 'White',
    black: h.Black && h.Black !== '?' ? h.Black : 'Black',
    timeControl: tc ? { initial: Number(tc[1]), increment: Number(tc[2]) } : { initial: 0, increment: 0 },
    startFen,
    moves,
    result: terminal?.result ?? result,
    termination: terminal?.termination ?? guessTermination(h.Termination, result),
    imported: true,
  };
}

function guessTermination(t: string | undefined, result: Result): Termination {
  const s = (t ?? '').toLowerCase();
  if (s.includes('time')) return 'timeout';
  if (s.includes('agree')) return 'agreement';
  if (s.includes('abandon')) return 'abandoned';
  if (result === '*') return 'ongoing';
  if (result === '1/2-1/2') return 'agreement';
  return 'resignation';
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
