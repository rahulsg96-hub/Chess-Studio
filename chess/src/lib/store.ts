import { useEffect, useState, useSyncExternalStore } from 'react';
import { allGames, onGamesChanged, saveGame } from './db';
import { queueAnalysis } from './analysisQueue';
import { getSettings } from './settings';
import type { OnlineMatch } from './net';
import type { GameSession } from './session';
import type { GameRecord } from './types';

/** App-wide holders for the active offline game and online match, so they survive navigation. */

let activeSession: GameSession | null = null;
let activeMatch: OnlineMatch | null = null;
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((fn) => fn());
};

export function useActive() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return { session: activeSession, match: activeMatch };
}

export function setActiveSession(s: GameSession | null) {
  if (s === activeSession) return;
  activeSession?.suspend();
  activeSession = s;
  if (s) s.onEnd = finishGame;
  emit();
}

export function getActiveSession() {
  return activeSession;
}

export function getActiveMatch() {
  return activeMatch;
}

export function setActiveMatch(m: OnlineMatch | null) {
  if (activeMatch && activeMatch !== m) activeMatch.leave();
  activeMatch = m;
  if (m) {
    const wire = (s: GameSession) => {
      s.onEnd = finishGame;
    };
    m.onSession = wire;
    if (m.session) wire(m.session);
  }
  emit();
}

/** Save a finished game and (optionally) analyse it in the background. */
export function finishGame(s: GameSession) {
  // Nothing played: don't clutter the history.
  if (s.moves.length < 2 && s.termination !== 'checkmate') return;
  const rec = s.toRecord();
  void saveGame(rec).then(() => {
    if (getSettings().autoAnalyze) queueAnalysis(rec, getSettings().analysisDepth);
  });
}

/** All saved games, kept fresh when the database changes. */
export function useGames(): { games: GameRecord[]; loading: boolean } {
  const [state, setState] = useState<{ games: GameRecord[]; loading: boolean }>({ games: [], loading: true });
  useEffect(() => {
    let alive = true;
    const load = () =>
      allGames()
        .then((games) => alive && setState({ games, loading: false }))
        .catch(() => alive && setState({ games: [], loading: false }));
    load();
    const off = onGamesChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
