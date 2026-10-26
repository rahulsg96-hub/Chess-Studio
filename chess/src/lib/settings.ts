import { useSyncExternalStore } from 'react';
import type { Settings } from './types';

const KEY = 'chess-studio:settings';

export const DEFAULT_SETTINGS: Settings = {
  playerName: 'Me',
  boardTheme: 'wood',
  showCoords: true,
  showLegalMoves: true,
  animation: true,
  sound: true,
  premoves: true,
  autoQueen: false,
  confirmResign: true,
  autoAnalyze: true,
  analysisDepth: 14,
  lowTimeWarning: true,
  theme: 'system',
};

export const BOARD_THEMES: Record<string, { light: string; dark: string; label: string }> = {
  wood: { label: 'Wood', light: '#f0d9b5', dark: '#b58863' },
  green: { label: 'Tournament', light: '#eeeed2', dark: '#769656' },
  blue: { label: 'Ocean', light: '#dee3e6', dark: '#8ca2ad' },
  purple: { label: 'Lavender', light: '#e8e0f0', dark: '#9b84b8' },
  slate: { label: 'Slate', light: '#c9ced6', dark: '#6b7686' },
  coral: { label: 'Coral', light: '#f2e1d8', dark: '#c98a74' },
};

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SETTINGS;
}

let current = read();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** Small key/value helper for remembered UI choices. */
export function remember<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`chess-studio:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function store(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(`chess-studio:${key}`);
    else localStorage.setItem(`chess-studio:${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
