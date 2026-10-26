import { Chess } from 'chess.js';
import { getReviewEngine } from './engine';
import { moveAccuracy, pvToSan, terminalState, uciToSan, winPct } from './chessutil';
import { isBook, loadOpenings } from './openings';
import type { GameAnalysis, GameRecord, MoveAnalysis, MoveClass, Score } from './types';

interface PositionEval {
  score: Score;
  best: string;
  pv: string[];
  legalMoves: number;
}

async function evalPosition(fen: string, depth: number): Promise<PositionEval> {
  const chess = new Chess(fen);
  const legalMoves = chess.moves().length;
  const end = terminalState(chess);
  if (end) {
    const cp = end.result === '1-0' ? 10000 : end.result === '0-1' ? -10000 : 0;
    return { score: { cp, mate: null }, best: '', pv: [], legalMoves };
  }
  const r = await getReviewEngine().search(fen, { depth });
  const top = r.lines[0];
  return {
    score: top?.score ?? { cp: 0, mate: null },
    best: r.bestmove ?? '',
    pv: top?.pv ?? [],
    legalMoves,
  };
}

export function classify(loss: number, isBest: boolean, forced: boolean, book: boolean): MoveClass {
  if (forced) return 'forced';
  if (book) return 'book';
  if (isBest) return 'best';
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  if (loss < 10) return 'inaccuracy';
  if (loss < 15) return 'mistake';
  return 'blunder';
}

/**
 * Analyse every position of a game with Stockfish.
 * `onProgress` receives partial results so the review screen can fill in live.
 */
export async function analyzeGame(
  game: GameRecord,
  depth: number,
  onProgress?: (done: number, total: number, partial: Partial<GameAnalysis>) => void,
  isCancelled: () => boolean = () => false,
): Promise<GameAnalysis | null> {
  await loadOpenings();
  const fens = [game.startFen, ...game.moves.map((m) => m.fen)];
  const evals: PositionEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled()) return null;
    evals.push(await evalPosition(fens[i], depth));
    onProgress?.(i + 1, fens.length, { initial: evals[0].score });
  }
  if (isCancelled()) return null;

  const moves: MoveAnalysis[] = [];
  const acc = { white: [] as number[], black: [] as number[] };
  const counts = {
    white: { inaccuracy: 0, mistake: 0, blunder: 0 },
    black: { inaccuracy: 0, mistake: 0, blunder: 0 },
  };
  let stillBook = true;
  game.moves.forEach((m, i) => {
    const before = evals[i];
    const after = evals[i + 1];
    const mover = fens[i].split(' ')[1] === 'w' ? 'white' : 'black';
    const sign = mover === 'white' ? 1 : -1;
    const wb = sign > 0 ? winPct(before.score) : 100 - winPct(before.score);
    const wa = sign > 0 ? winPct(after.score) : 100 - winPct(after.score);
    const isBest = !!before.best && m.uci === before.best;
    const loss = isBest ? 0 : Math.max(0, wb - wa);
    stillBook = stillBook && i < 30 && isBook(m.fen);
    const cls = classify(loss, isBest, before.legalMoves === 1, stillBook);
    if (cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder') counts[mover][cls]++;
    acc[mover].push(moveAccuracy(wb, isBest ? wb : wa));
    moves.push({
      ...after.score,
      best: before.best,
      bestSan: before.best ? uciToSan(fens[i], before.best) : '',
      bestLine: before.best ? pvToSan(fens[i], before.pv, 8) : [],
      cls,
      loss: Math.round(loss * 10) / 10,
    });
  });

  return {
    depth,
    initial: evals[0].score,
    moves,
    accuracy: { white: gameAccuracy(acc.white), black: gameAccuracy(acc.black) },
    counts,
  };
}

/** Blend of arithmetic and harmonic mean — the harmonic part makes blunders hurt. */
function gameAccuracy(list: number[]): number {
  if (!list.length) return 0;
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const harmonic = list.length / list.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return Math.round(((mean + harmonic) / 2) * 10) / 10;
}

export const CLASS_INFO: Record<MoveClass, { label: string; symbol: string; color: string }> = {
  book: { label: 'Book', symbol: '📖', color: '#a88865' },
  forced: { label: 'Forced', symbol: '□', color: '#888' },
  best: { label: 'Best', symbol: '★', color: '#5c9e31' },
  excellent: { label: 'Excellent', symbol: '!', color: '#5c9e31' },
  good: { label: 'Good', symbol: '✓', color: '#77915f' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#e6a116' },
  mistake: { label: 'Mistake', symbol: '?', color: '#e5762f' },
  blunder: { label: 'Blunder', symbol: '??', color: '#d63b3b' },
};
