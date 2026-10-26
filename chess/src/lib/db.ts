import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameRecord } from './types';

export interface DrillState {
  /** `${gameId}:${ply}` */
  id: string;
  attempts: number;
  solved: number;
  lastSeen: number;
  /** Spaced repetition: don't show again before this time. */
  due: number;
}

interface ChessDB extends DBSchema {
  games: { key: string; value: GameRecord; indexes: { date: number } };
  drills: { key: string; value: DrillState };
}

let dbp: Promise<IDBPDatabase<ChessDB>> | null = null;
const listeners = new Set<() => void>();

function db() {
  dbp ??= openDB<ChessDB>('chess-studio', 1, {
    upgrade(d) {
      const games = d.createObjectStore('games', { keyPath: 'id' });
      games.createIndex('date', 'date');
      d.createObjectStore('drills', { keyPath: 'id' });
    },
  });
  return dbp;
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}

export function onGamesChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

export async function saveGame(g: GameRecord) {
  await (await db()).put('games', g);
  emit();
}

export async function getGame(id: string) {
  return (await db()).get('games', id);
}

export async function allGames(): Promise<GameRecord[]> {
  const list = await (await db()).getAllFromIndex('games', 'date');
  return list.reverse();
}

export async function deleteGame(id: string) {
  await (await db()).delete('games', id);
  emit();
}

export async function importGames(games: GameRecord[]) {
  const d = await db();
  const tx = d.transaction('games', 'readwrite');
  for (const g of games) await tx.store.put(g);
  await tx.done;
  emit();
}

export async function allDrills(): Promise<DrillState[]> {
  return (await db()).getAll('drills');
}

export async function saveDrill(s: DrillState) {
  await (await db()).put('drills', s);
}

export async function clearAll() {
  const d = await db();
  await d.clear('games');
  await d.clear('drills');
  emit();
}
