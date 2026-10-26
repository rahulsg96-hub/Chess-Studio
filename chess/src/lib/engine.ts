import type { Score } from './types';

export interface EngineLine {
  multipv: number;
  depth: number;
  /** White's point of view. */
  score: Score;
  /** UCI moves. */
  pv: string[];
}

export interface SearchResult {
  bestmove: string | null;
  lines: EngineLine[];
  depth: number;
}

export interface SearchOptions {
  depth?: number;
  movetime?: number;
  nodes?: number;
  multiPv?: number;
  /** Stockfish "Skill Level" 0–20. */
  skill?: number;
  /** Limit strength to this Elo (Stockfish accepts 1320–3190). */
  elo?: number | null;
}

type Job = {
  fen: string;
  tag: string;
  opts: SearchOptions;
  onUpdate?: (lines: EngineLine[], depth: number) => void;
  resolve: (r: SearchResult) => void;
  reject: (e: unknown) => void;
  cancelled: boolean;
};

const engineUrl = () => `${import.meta.env.BASE_URL}engine/stockfish.js`;

/**
 * A thin UCI wrapper around the Stockfish WebAssembly worker.
 * Searches run one at a time; `search` queues behind the current one,
 * and `cancelAll` stops the running search and drops queued ones.
 */
export class Engine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private waiters: { match: (line: string) => boolean; resolve: (line: string) => void }[] = [];
  private queue: Job[] = [];
  private current: Job | null = null;
  private lines = new Map<number, EngineLine>();
  private lastDepth = 0;
  private options: Record<string, string> = {};
  failed = false;

  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      try {
        this.worker = new Worker(engineUrl());
      } catch (e) {
        this.failed = true;
        reject(e);
        return;
      }
      this.worker.onmessage = (e: MessageEvent) => this.onLine(String(e.data));
      this.worker.onerror = (e) => {
        this.failed = true;
        reject(e);
      };
      this.send('uci');
      this.waitFor((l) => l === 'uciok')
        .then(() => {
          this.send('setoption name Hash value 32');
          return this.isReady();
        })
        .then(() => resolve(), reject);
    });
    return this.ready;
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private waitFor(match: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  private isReady(): Promise<string> {
    this.send('isready');
    return this.waitFor((l) => l === 'readyok');
  }

  private onLine(line: string) {
    for (let i = 0; i < this.waiters.length; i++) {
      if (this.waiters[i].match(line)) {
        const [w] = this.waiters.splice(i, 1);
        w.resolve(line);
        break;
      }
    }
    const job = this.current;
    if (!job) return;
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const parsed = parseInfo(line, job.fen);
      if (!parsed) return;
      this.lines.set(parsed.multipv, parsed);
      if (parsed.multipv === 1) this.lastDepth = parsed.depth;
      if (!job.cancelled && job.onUpdate) job.onUpdate(this.sortedLines(), this.lastDepth);
    } else if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      const result: SearchResult = {
        bestmove: best && best !== '(none)' ? best : null,
        lines: this.sortedLines(),
        depth: this.lastDepth,
      };
      this.current = null;
      job.resolve(result);
      this.pump();
    }
  }

  private sortedLines() {
    return [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
  }

  private async setOption(name: string, value: string) {
    if (this.options[name] === value) return;
    this.options[name] = value;
    this.send(`setoption name ${name} value ${value}`);
  }

  private async pump() {
    if (this.current || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    if (job.cancelled) {
      job.resolve({ bestmove: null, lines: [], depth: 0 });
      this.pump();
      return;
    }
    this.current = job;
    this.lines.clear();
    this.lastDepth = 0;
    try {
      await this.start();
      const { opts } = job;
      await this.setOption('MultiPV', String(opts.multiPv ?? 1));
      await this.setOption('Skill Level', String(opts.skill ?? 20));
      if (opts.elo) {
        await this.setOption('UCI_LimitStrength', 'true');
        await this.setOption('UCI_Elo', String(Math.max(1320, Math.min(3190, opts.elo))));
      } else {
        await this.setOption('UCI_LimitStrength', 'false');
      }
      await this.isReady();
      if (job.cancelled) {
        this.current = null;
        job.resolve({ bestmove: null, lines: [], depth: 0 });
        this.pump();
        return;
      }
      this.send(`position fen ${job.fen}`);
      const go = ['go'];
      if (opts.depth) go.push('depth', String(opts.depth));
      if (opts.movetime) go.push('movetime', String(opts.movetime));
      if (opts.nodes) go.push('nodes', String(opts.nodes));
      if (go.length === 1) go.push('depth', '18');
      this.send(go.join(' '));
      // A cancel that raced the setup above would otherwise be lost.
      if (job.cancelled) this.send('stop');
    } catch (e) {
      this.current = null;
      job.reject(e);
      this.pump();
    }
  }

  /** Queue a search. `tag` lets callers cancel only their own searches. */
  search(fen: string, opts: SearchOptions = {}, onUpdate?: Job['onUpdate'], tag = 'default'): Promise<SearchResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, tag, opts, onUpdate, resolve, reject, cancelled: false });
      this.pump();
    });
  }

  /**
   * Stop the running search (it resolves with what it has so far) and drop queued ones.
   * With a tag, only searches started with that tag are affected.
   */
  cancelAll(tag?: string) {
    for (const job of this.queue) if (!tag || job.tag === tag) job.cancelled = true;
    if (this.current && (!tag || this.current.tag === tag)) {
      this.current.cancelled = true;
      this.send('stop');
    }
  }

  newGame() {
    if (this.worker) this.send('ucinewgame');
  }

  terminate() {
    this.cancelAll();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.options = {};
  }
}

function parseInfo(line: string, fen: string): EngineLine | null {
  const t = line.split(' ');
  let depth = 0;
  let multipv = 1;
  let cp: number | null = null;
  let mate: number | null = null;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'multipv':
        multipv = Number(t[++i]);
        break;
      case 'score':
        if (t[i + 1] === 'cp') cp = Number(t[i + 2]);
        else if (t[i + 1] === 'mate') mate = Number(t[i + 2]);
        i += 2;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') return null;
        break;
      case 'pv':
        pv = t.slice(i + 1);
        i = t.length;
        break;
    }
  }
  if (cp === null && mate === null) return null;
  // UCI scores are from the side to move; convert to White's view.
  const sign = fen.split(' ')[1] === 'b' ? -1 : 1;
  return {
    multipv,
    depth,
    score: { cp: cp === null ? null : cp * sign, mate: mate === null ? null : mate * sign },
    pv,
  };
}

let playEngine: Engine | null = null;
let analysisEngine: Engine | null = null;
let reviewEngine: Engine | null = null;

/** Engine that plays against you. */
export function getPlayEngine() {
  return (playEngine ??= new Engine());
}

/** Interactive analysis: hints, the eval bar, the analysis board and training checks. */
export function getAnalysisEngine() {
  return (analysisEngine ??= new Engine());
}

/** Background game review, kept separate so long reviews never delay the interactive engines. */
export function getReviewEngine() {
  return (reviewEngine ??= new Engine());
}
