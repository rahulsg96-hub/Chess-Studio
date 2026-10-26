import type { SearchOptions } from './engine';

export interface Level {
  level: number;
  name: string;
  /** Rough rating against humans; engine levels are never a perfect match for people. */
  elo: number;
  search: SearchOptions;
  /** Chance of playing a random legal move instead of the engine's choice. */
  randomness: number;
}

export const LEVELS: Level[] = [
  { level: 1, name: 'Newcomer', elo: 400, search: { skill: 0, depth: 1 }, randomness: 0.3 },
  { level: 2, name: 'Beginner', elo: 600, search: { skill: 0, depth: 2 }, randomness: 0.15 },
  { level: 3, name: 'Novice', elo: 800, search: { skill: 1, depth: 3 }, randomness: 0.05 },
  { level: 4, name: 'Casual', elo: 1000, search: { skill: 3, depth: 4 }, randomness: 0 },
  { level: 5, name: 'Club rookie', elo: 1200, search: { skill: 5, depth: 6, movetime: 300 }, randomness: 0 },
  { level: 6, name: 'Club player', elo: 1400, search: { elo: 1400, movetime: 500 }, randomness: 0 },
  { level: 7, name: 'Strong club', elo: 1600, search: { elo: 1600, movetime: 500 }, randomness: 0 },
  { level: 8, name: 'Expert', elo: 1800, search: { elo: 1800, movetime: 700 }, randomness: 0 },
  { level: 9, name: 'Candidate master', elo: 2000, search: { elo: 2000, movetime: 800 }, randomness: 0 },
  { level: 10, name: 'Master', elo: 2200, search: { elo: 2200, movetime: 1000 }, randomness: 0 },
  { level: 11, name: 'Grandmaster', elo: 2500, search: { elo: 2500, movetime: 1200 }, randomness: 0 },
  { level: 12, name: 'Stockfish (full)', elo: 3200, search: { movetime: 1500 }, randomness: 0 },
];

export function getLevel(n: number | undefined): Level {
  return LEVELS.find((l) => l.level === n) ?? LEVELS[4];
}

export const TIME_PRESETS: { label: string; group: string; initial: number; increment: number }[] = [
  { label: '1+0', group: 'Bullet', initial: 60, increment: 0 },
  { label: '2+1', group: 'Bullet', initial: 120, increment: 1 },
  { label: '3+0', group: 'Blitz', initial: 180, increment: 0 },
  { label: '3+2', group: 'Blitz', initial: 180, increment: 2 },
  { label: '5+0', group: 'Blitz', initial: 300, increment: 0 },
  { label: '5+3', group: 'Blitz', initial: 300, increment: 3 },
  { label: '10+0', group: 'Rapid', initial: 600, increment: 0 },
  { label: '10+5', group: 'Rapid', initial: 600, increment: 5 },
  { label: '15+10', group: 'Rapid', initial: 900, increment: 10 },
  { label: '30+0', group: 'Classical', initial: 1800, increment: 0 },
  { label: '30+20', group: 'Classical', initial: 1800, increment: 20 },
  { label: '∞', group: 'No clock', initial: 0, increment: 0 },
];

export function formatTimeControl(tc: { initial: number; increment: number }) {
  if (!tc.initial) return 'No clock';
  const mins = tc.initial / 60;
  return `${Number.isInteger(mins) ? mins : mins.toFixed(1)}+${tc.increment}`;
}

export function speedOf(tc: { initial: number; increment: number }) {
  if (!tc.initial) return 'Unlimited';
  const est = tc.initial + 40 * tc.increment;
  if (est < 180) return 'Bullet';
  if (est < 480) return 'Blitz';
  if (est < 1500) return 'Rapid';
  return 'Classical';
}
