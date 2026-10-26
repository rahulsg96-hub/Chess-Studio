import { useSyncExternalStore } from 'react';
import { analyzeGame } from './analysis';
import { getGame, saveGame } from './db';
import type { GameRecord } from './types';

/** Background game analysis, one game at a time, results saved with the game. */

interface Progress {
  done: number;
  total: number;
}

const progress = new Map<string, Progress>();
const queue: { game: GameRecord; depth: number }[] = [];
const listeners = new Set<() => void>();
let running: string | null = null;
const cancelled = new Set<string>();
let snapshot = new Map(progress);

function emit() {
  snapshot = new Map(progress);
  listeners.forEach((fn) => fn());
}

export function queueAnalysis(game: GameRecord, depth: number) {
  if (game.moves.length === 0) return;
  if (running === game.id || queue.some((q) => q.game.id === game.id)) return;
  cancelled.delete(game.id);
  queue.push({ game, depth });
  progress.set(game.id, { done: 0, total: game.moves.length + 1 });
  emit();
  void pump();
}

export function cancelAnalysis(id: string) {
  cancelled.add(id);
  const i = queue.findIndex((q) => q.game.id === id);
  if (i >= 0) queue.splice(i, 1);
  progress.delete(id);
  emit();
}

async function pump() {
  if (running || queue.length === 0) return;
  const { game, depth } = queue.shift()!;
  running = game.id;
  try {
    const analysis = await analyzeGame(
      game,
      depth,
      (done, total) => {
        progress.set(game.id, { done, total });
        emit();
      },
      () => cancelled.has(game.id),
    );
    if (analysis) {
      // Re-read in case notes/favourite changed while we were busy.
      const latest = (await getGame(game.id)) ?? game;
      await saveGame({ ...latest, analysis });
    }
  } catch (e) {
    console.error('Analysis failed', e);
  } finally {
    progress.delete(game.id);
    running = null;
    emit();
    void pump();
  }
}

export function useAnalysisProgress(id: string | undefined): Progress | undefined {
  const map = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
  return id ? map.get(id) : undefined;
}
