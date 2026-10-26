import type { MoveRecord } from './types';

type Table = Record<string, [string, string]>;
let table: Table | null = null;
let loading: Promise<Table> | null = null;

/** Loads the opening table (kept in its own chunk so the first paint stays fast). */
export function loadOpenings(): Promise<Table> {
  if (table) return Promise.resolve(table);
  loading ??= import('./openings.json').then((m) => (table = m.default as unknown as Table));
  return loading;
}

const key = (fen: string) => fen.split(' ').slice(0, 3).join(' ');

export function openingAt(fen: string): { eco: string; name: string } | null {
  const hit = table?.[key(fen)];
  return hit ? { eco: hit[0], name: hit[1] } : null;
}

export function isBook(fen: string): boolean {
  return !!table?.[key(fen)];
}

/** Deepest named opening reached in a game. */
export function detectOpening(moves: MoveRecord[]): { eco: string; name: string } | undefined {
  let found: { eco: string; name: string } | undefined;
  for (const m of moves.slice(0, 40)) {
    const o = openingAt(m.fen);
    if (o) found = o;
  }
  return found;
}
