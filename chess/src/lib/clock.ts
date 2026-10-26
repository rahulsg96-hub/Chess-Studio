import type { Color } from './types';

/** Two-sided chess clock. Times are in milliseconds. */
export class ChessClock {
  white: number;
  black: number;
  running: Color | null = null;
  private since = 0;
  private turnStart = 0;

  constructor(
    initialMs: number,
    public incrementMs: number,
  ) {
    this.white = initialMs;
    this.black = initialMs;
  }

  time(color: Color): number {
    const base = this[color];
    if (this.running === color) return Math.max(0, base - (performance.now() - this.since));
    return base;
  }

  start(color: Color) {
    this.running = color;
    this.since = performance.now();
    this.turnStart = this.since;
  }

  /** The side that just moved hits the clock. Returns time spent and remaining (after increment). */
  press(mover: Color): { spent: number; remaining: number } {
    const now = performance.now();
    const spent = this.running === mover ? now - this.turnStart : 0;
    if (this.running === mover) this[mover] = Math.max(0, this[mover] - (now - this.since));
    this[mover] += this.incrementMs;
    const next: Color = mover === 'white' ? 'black' : 'white';
    this.running = next;
    this.since = now;
    this.turnStart = now;
    return { spent, remaining: this[mover] };
  }

  /** Overwrite a side's time (e.g. the authoritative value from an online opponent). */
  set(color: Color, ms: number) {
    if (this.running === color) this.since = performance.now();
    this[color] = ms;
  }

  stop() {
    if (this.running) {
      this[this.running] = this.time(this.running);
      this.running = null;
    }
  }

  pause() {
    this.stop();
  }

  resume(color: Color) {
    this.running = color;
    this.since = performance.now();
  }
}

export function formatClock(ms: number): string {
  // Under 10 seconds, show tenths so the last moments are readable.
  if (ms < 10000) return `0:${(Math.max(0, Math.floor(ms / 100)) / 10).toFixed(1).padStart(4, '0')}`;
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
