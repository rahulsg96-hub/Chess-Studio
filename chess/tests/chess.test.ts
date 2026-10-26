import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { formatScore, hasMatingMaterial, parsePgn, splitPgn, terminalState, toPgn, winPct } from '../src/lib/chessutil';
import { formatClock } from '../src/lib/clock';
import { classify } from '../src/lib/analysis';
import { GameSession } from '../src/lib/session';
import { START_FEN } from '../src/lib/types';

test('formatClock shows tenths under ten seconds', () => {
  assert.equal(formatClock(600000), '10:00');
  assert.equal(formatClock(59001), '1:00');
  assert.equal(formatClock(9549), '0:09.5');
  assert.equal(formatClock(300), '0:00.3');
  assert.equal(formatClock(-5), '0:00.0');
  assert.equal(formatClock(3723000), '1:02:03');
});

test('mating material', () => {
  assert.equal(hasMatingMaterial('8/8/8/8/8/k7/8/K7 w - - 0 1', 'white'), false);
  assert.equal(hasMatingMaterial('8/8/8/8/8/k7/8/KN6 w - - 0 1', 'white'), false);
  assert.equal(hasMatingMaterial('8/8/8/8/8/k7/8/KNB5 w - - 0 1', 'white'), true);
  assert.equal(hasMatingMaterial('8/8/8/8/8/k7/p7/K7 w - - 0 1', 'black'), true);
  assert.equal(hasMatingMaterial(START_FEN, 'black'), true);
});

test('terminal states', () => {
  const mate = new Chess();
  for (const m of ['f3', 'e5', 'g4', 'Qh4#']) mate.move(m);
  assert.deepEqual(terminalState(mate), { result: '0-1', termination: 'checkmate' });
  assert.deepEqual(terminalState(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), { result: '1/2-1/2', termination: 'stalemate' });
  assert.equal(terminalState(new Chess()), null);
});

test('evaluation helpers', () => {
  assert.equal(Math.round(winPct({ cp: 0, mate: null })), 50);
  assert.ok(winPct({ cp: 300, mate: null }) > 75);
  assert.ok(winPct({ cp: null, mate: -2 }) < 3);
  assert.equal(formatScore({ cp: 123, mate: null }), '+1.2');
  assert.equal(formatScore({ cp: null, mate: -3 }), '-M3');
  assert.equal(classify(0, true, false, false), 'best');
  assert.equal(classify(7, false, false, false), 'inaccuracy');
  assert.equal(classify(12, false, false, false), 'mistake');
  assert.equal(classify(30, false, false, false), 'blunder');
  assert.equal(classify(30, false, true, false), 'forced');
});

test('PGN export and import round-trip', () => {
  const s = new GameSession({ mode: 'local', timeControl: { initial: 0, increment: 0 }, white: 'Rahul', black: 'Meghana' });
  for (const [f, t] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']]) assert.ok(s.userMove(f, t));
  s.resign('white');
  const pgn = toPgn(s.toRecord());
  assert.match(pgn, /\[White "Rahul"\]/);
  assert.match(pgn, /1\. e4 e5 2\. Nf3 Nc6 0-1/);
  const back = parsePgn(pgn)!;
  assert.equal(back.white, 'Rahul');
  assert.equal(back.result, '0-1');
  assert.deepEqual(back.moves.map((m) => m.san), ['e4', 'e5', 'Nf3', 'Nc6']);
  assert.equal(splitPgn(`${pgn}\n${pgn}`).length, 2);
});

test('session: checkmate, takeback and flag rules', () => {
  const local = new GameSession({ mode: 'local', timeControl: { initial: 0, increment: 0 }, white: 'W', black: 'B' });
  assert.ok(local.userMove('f2', 'f3'));
  assert.ok(local.userMove('e7', 'e5'));
  local.takeback();
  assert.equal(local.moves.length, 1);
  assert.equal(local.turn, 'black');
  assert.ok(local.userMove('e7', 'e5'));
  assert.ok(local.userMove('g2', 'g4'));
  assert.ok(local.userMove('d8', 'h4'));
  assert.equal(local.status, 'over');
  assert.equal(local.result, '0-1');
  assert.equal(local.termination, 'checkmate');
  assert.equal(local.userMove('a2', 'a3'), false, 'no moves after the game ends');

  // Flag with only a king left for the winner is a draw.
  const bare = new GameSession({ mode: 'local', timeControl: { initial: 60, increment: 0 }, white: 'W', black: 'B', startFen: '8/8/8/8/8/k7/8/KQ6 w - - 0 1' });
  bare.flag('white');
  assert.equal(bare.result, '1/2-1/2');
  assert.equal(bare.termination, 'timeout-insufficient');
  const queen = new GameSession({ mode: 'local', timeControl: { initial: 60, increment: 0 }, white: 'W', black: 'B', startFen: '8/8/8/8/8/k7/8/KQ6 w - - 0 1' });
  queen.flag('black');
  assert.equal(queen.result, '1-0');
});

test('session: increment is added after each move', () => {
  const s = new GameSession({ mode: 'local', timeControl: { initial: 60, increment: 5 }, white: 'W', black: 'B' });
  s.userMove('e2', 'e4');
  assert.ok(s.clock!.white >= 64000, `white has ${s.clock!.white}`);
  assert.equal(s.clock!.running, 'black');
});
