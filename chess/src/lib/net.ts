import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { GameSession } from './session';
import { opposite, uciToMove } from './chessutil';
import { play } from './sound';
import { remember, store } from './settings';
import type { Color, TimeControl } from './types';

/**
 * Online play between two devices.
 *
 * Moves travel directly between the two devices over WebRTC. The free public
 * PeerJS server is only used so the devices can find each other by room code.
 * The host is the source of truth if the two ever get out of step.
 */

const PREFIX = 'chess-studio-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface MatchSetup {
  gameId: string;
  timeControl: TimeControl;
  hostColor: Color;
  hostName: string;
  guestName: string;
}

type Msg =
  | { t: 'hello'; name: string; gameId?: string }
  | { t: 'setup'; setup: MatchSetup }
  | { t: 'move'; ply: number; uci: string; clock?: number }
  | { t: 'sync'; setup: MatchSetup; moves: string[]; clocks: { white: number; black: number } | null; over?: { result: string; termination: string } }
  | { t: 'chat'; text: string }
  | { t: 'resign' }
  | { t: 'flag'; color: Color }
  | { t: 'draw'; action: 'offer' | 'accept' | 'decline' }
  | { t: 'takeback'; action: 'offer' | 'accept' | 'decline'; plies?: number }
  | { t: 'rematch'; action: 'offer' | 'accept' | 'decline' }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'bye' };

export type MatchStatus = 'idle' | 'opening' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
export type Offer = 'none' | 'sent' | 'received';

export interface ChatLine {
  from: 'me' | 'them' | 'system';
  text: string;
  ts: number;
}

/** What we keep on disk so an online game survives the app being closed or reloaded. */
export interface SavedMatch {
  role: 'host' | 'guest';
  code: string;
  myName: string;
  oppName: string;
  setup: MatchSetup;
  moves: string[];
  clocks: { white: number; black: number } | null;
  savedAt: number;
}

export function savedMatch(): SavedMatch | null {
  const m = remember<SavedMatch | null>('online', null);
  // Only offer to resume games from the last few hours.
  return m && Date.now() - m.savedAt < 6 * 3600 * 1000 ? m : null;
}

export function forgetSavedMatch() {
  store('online', undefined);
}

export function newRoomCode() {
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function peerOptions(): PeerOptions {
  // Advanced: a self-hosted PeerJS server can be configured in Settings.
  const custom = remember<{ host: string; port: number; path: string; secure: boolean } | null>('peerServer', null);
  const opts: PeerOptions = { debug: 1 };
  if (custom?.host) Object.assign(opts, custom);
  return opts;
}

export class OnlineMatch {
  role: 'host' | 'guest';
  code = '';
  status: MatchStatus = 'idle';
  error = '';
  myName: string;
  oppName = '';
  setup: MatchSetup | null = null;
  session: GameSession | null = null;
  chat: ChatLine[] = [];
  unread = 0;
  draw: Offer = 'none';
  takeback: Offer = 'none';
  rematch: Offer = 'none';
  rtt: number | null = null;
  version = 0;
  /** Host's chosen settings before a guest connects. */
  private pending: { timeControl: TimeControl; hostColor: Color | 'random' } | null = null;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private listeners = new Set<() => void>();
  private pingTimer: number | undefined;
  private retryTimer: number | undefined;
  private closedByUser = false;
  /** Fires when a new game (first game or rematch) begins. */
  onSession?: (s: GameSession) => void;

  constructor(role: 'host' | 'guest', myName: string) {
    this.role = role;
    this.myName = myName;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.persist();
    this.listeners.forEach((fn) => fn());
  }

  private persist() {
    const s = this.session;
    if (!s || !this.setup) return;
    if (s.status !== 'playing' || this.closedByUser) {
      if (savedMatch()?.setup.gameId === this.setup.gameId) forgetSavedMatch();
      return;
    }
    const saved: SavedMatch = {
      role: this.role,
      code: this.code,
      myName: this.myName,
      oppName: this.oppName,
      setup: this.setup,
      moves: s.moves.map((m) => m.uci),
      clocks: s.clock ? { white: s.clock.time('white'), black: s.clock.time('black') } : null,
      savedAt: Date.now(),
    };
    store('online', saved);
  }

  /** Pick an interrupted online game back up (after the app was closed or reloaded). */
  static resume(saved: SavedMatch): OnlineMatch {
    const m = new OnlineMatch(saved.role, saved.myName);
    m.code = saved.code;
    m.oppName = saved.oppName;
    m.setup = saved.setup;
    m.session = m.buildSession(saved.setup, saved.moves);
    if (m.session.clock && saved.clocks) {
      m.session.clock.set('white', saved.clocks.white);
      m.session.clock.set('black', saved.clocks.black);
    }
    m.status = 'reconnecting';
    m.system(`Reconnecting to ${saved.oppName || 'your friend'}…`);
    if (saved.role === 'host') m.openPeer(PREFIX + saved.code);
    else m.openPeer();
    return m;
  }

  private buildSession(setup: MatchSetup, moves: string[]) {
    const hostWhite = setup.hostColor === 'white';
    const session = new GameSession({
      id: setup.gameId,
      mode: 'online',
      playerColor: this.role === 'host' ? setup.hostColor : opposite(setup.hostColor),
      timeControl: setup.timeControl,
      white: hostWhite ? setup.hostName : setup.guestName,
      black: hostWhite ? setup.guestName : setup.hostName,
    });
    for (const uci of moves) {
      const mv = session.chess.move(uciToMove(uci));
      session.moves.push({ san: mv.san, uci, fen: mv.after });
    }
    if (session.clock && moves.length) session.clock.start(session.turn);
    this.wire(session);
    return session;
  }

  get myColor(): Color | undefined {
    if (!this.setup) return undefined;
    return this.role === 'host' ? this.setup.hostColor : opposite(this.setup.hostColor);
  }

  get shareLink() {
    return `${location.origin}${location.pathname}#/join/${this.code}`;
  }

  // ---- Host ----

  host(timeControl: TimeControl, hostColor: Color | 'random') {
    this.pending = { timeControl, hostColor };
    this.code = newRoomCode();
    this.status = 'opening';
    this.emit();
    this.openPeer(PREFIX + this.code);
  }

  private openPeer(id?: string) {
    const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (this.role === 'host') {
        if (this.status === 'opening') this.status = 'waiting';
        this.emit();
      } else {
        this.connectToHost();
      }
    });
    peer.on('connection', (conn) => {
      if (this.role !== 'host') return;
      // Only one opponent at a time; a reconnecting guest replaces the old link.
      this.conn?.close();
      this.attach(conn);
    });
    peer.on('disconnected', () => {
      // Lost the matchmaking server; the direct link may still be fine. Try to get back.
      if (!this.closedByUser && !peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      const type = err.type ?? '';
      if (type === 'unavailable-id' && this.role === 'host') {
        peer.destroy();
        if (this.status === 'opening') {
          this.code = newRoomCode();
          this.openPeer(PREFIX + this.code);
        } else {
          // Resuming: the server still remembers our old connection for a little while. Keep trying.
          window.setTimeout(() => !this.closedByUser && this.openPeer(PREFIX + this.code), 3000);
        }
        return;
      }
      if (type === 'peer-unavailable') {
        if (this.status === 'connecting' && !this.setup) {
          this.fail(`No game found with code ${this.code}. Check the code, and make sure your friend's game is still open.`);
        } else {
          this.scheduleRetry();
        }
        return;
      }
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
        if (this.setup) {
          this.status = 'reconnecting';
          this.emit();
          this.scheduleRetry();
        } else {
          this.fail('Could not reach the matchmaking server. Check your internet connection and try again.');
        }
        return;
      }
      if (type === 'browser-incompatible') {
        this.fail('This browser does not support peer-to-peer connections.');
        return;
      }
      console.warn('PeerJS error', type, err);
    });
  }

  // ---- Guest ----

  join(code: string) {
    this.code = normalizeCode(code);
    this.status = 'connecting';
    this.emit();
    this.openPeer();
  }

  private connectToHost() {
    if (!this.peer || this.peer.destroyed) return;
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.attach(conn);
    // If the direct link can't be set up (strict firewalls), say so instead of spinning forever.
    window.setTimeout(() => {
      if (this.conn === conn && !conn.open && this.status === 'connecting') {
        this.fail(
          'Found the game but could not connect directly. One of the networks may be blocking peer-to-peer traffic — try another Wi-Fi or mobile data.',
        );
      }
    }, 25000);
  }

  // ---- Connection plumbing ----

  private attach(conn: DataConnection) {
    this.conn = conn;
    conn.on('open', () => {
      if (this.conn !== conn) return;
      this.status = 'connected';
      this.send({ t: 'hello', name: this.myName, gameId: this.setup?.gameId });
      this.startPing();
      this.emit();
    });
    conn.on('data', (data) => {
      if (this.conn !== conn) return;
      this.onMessage(data as Msg);
    });
    conn.on('close', () => {
      if (this.conn !== conn) return;
      this.onDrop();
    });
    conn.on('error', () => {
      if (this.conn !== conn) return;
      this.onDrop();
    });
  }

  private onDrop() {
    window.clearInterval(this.pingTimer);
    if (this.closedByUser || this.status === 'closed') return;
    if (!this.setup) {
      if (this.role === 'host') {
        this.status = 'waiting';
        this.emit();
      } else this.fail('The connection closed before the game started.');
      return;
    }
    this.status = 'reconnecting';
    this.system(`${this.oppName || 'Opponent'} disconnected — trying to reconnect…`);
    this.emit();
    if (this.role === 'guest') this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.closedByUser) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      if (this.closedByUser || this.status === 'connected') return;
      if (this.peer?.disconnected && !this.peer.destroyed) this.peer.reconnect();
      if (this.role === 'host' && this.peer?.destroyed) this.openPeer(PREFIX + this.code);
      if (this.role === 'guest') {
        if (this.peer?.open) this.connectToHost();
        else if (!this.peer || this.peer.destroyed) this.openPeer();
      }
      this.scheduleRetry();
    }, 3000);
  }

  private startPing() {
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 5000);
  }

  private send(msg: Msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  private fail(message: string) {
    this.status = 'error';
    this.error = message;
    this.emit();
  }

  private system(text: string) {
    this.chat.push({ from: 'system', text, ts: Date.now() });
  }

  private onMessage(msg: Msg) {
    switch (msg.t) {
      case 'hello': {
        const wasReconnect = !!this.setup;
        this.oppName = msg.name || 'Friend';
        if (this.role === 'host') {
          if (this.setup && this.session) {
            // Guest came back: bring it up to date.
            this.sendSync();
            this.system(`${this.oppName} reconnected.`);
          } else if (this.pending) {
            const hostColor =
              this.pending.hostColor === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : this.pending.hostColor;
            this.setup = {
              gameId: crypto.randomUUID(),
              timeControl: this.pending.timeControl,
              hostColor,
              hostName: this.myName,
              guestName: this.oppName,
            };
            this.send({ t: 'setup', setup: this.setup });
            this.startGame();
          }
        } else if (wasReconnect) {
          this.system(`Reconnected to ${this.oppName}.`);
        }
        this.emit();
        break;
      }
      case 'setup':
        if (this.role === 'guest') {
          this.setup = msg.setup;
          this.oppName = msg.setup.hostName;
          this.startGame();
        }
        break;
      case 'sync':
        if (this.role === 'guest') this.applySync(msg);
        break;
      case 'move': {
        const s = this.session;
        if (!s) break;
        if (msg.ply === s.moves.length) {
          if (!s.remoteMove(msg.uci, msg.clock)) this.requestResync();
          this.draw = this.draw === 'sent' ? 'none' : this.draw;
          this.takeback = 'none';
        } else if (msg.ply > s.moves.length) {
          this.requestResync();
        }
        this.emit();
        break;
      }
      case 'chat':
        this.chat.push({ from: 'them', text: String(msg.text).slice(0, 500), ts: Date.now() });
        this.unread++;
        play('notify');
        this.emit();
        break;
      case 'resign':
        if (this.session && this.myColor) {
          this.session.resign(opposite(this.myColor));
          this.system(`${this.oppName} resigned.`);
        }
        this.emit();
        break;
      case 'flag':
        this.session?.flag(msg.color);
        this.emit();
        break;
      case 'draw':
        if (msg.action === 'offer') {
          this.draw = 'received';
          this.system(`${this.oppName} offers a draw.`);
          play('notify');
        } else if (msg.action === 'accept') {
          this.session?.draw('agreement');
          this.draw = 'none';
        } else {
          this.draw = 'none';
          this.system(`${this.oppName} declined the draw.`);
        }
        this.emit();
        break;
      case 'takeback':
        if (msg.action === 'offer') {
          this.takeback = 'received';
          this.system(`${this.oppName} asks to take back a move.`);
          play('notify');
        } else if (msg.action === 'accept') {
          this.session?.undoPlies(msg.plies ?? 1);
          this.takeback = 'none';
        } else {
          this.takeback = 'none';
          this.system(`${this.oppName} declined the takeback.`);
        }
        this.emit();
        break;
      case 'rematch':
        if (msg.action === 'offer') {
          this.rematch = 'received';
          this.system(`${this.oppName} wants a rematch.`);
          play('notify');
        } else if (msg.action === 'accept') {
          this.rematch = 'none';
          if (this.role === 'host') this.startRematch();
        } else {
          this.rematch = 'none';
          this.system(`${this.oppName} declined the rematch.`);
        }
        this.emit();
        break;
      case 'ping':
        this.send({ t: 'pong', ts: msg.ts });
        break;
      case 'pong':
        this.rtt = Math.round(performance.now() - msg.ts);
        this.emit();
        break;
      case 'bye':
        this.system(`${this.oppName} left the game.`);
        this.status = 'closed';
        this.emit();
        break;
    }
  }

  private startGame() {
    const session = this.buildSession(this.setup!, []);
    this.session = session;
    this.draw = this.takeback = this.rematch = 'none';
    this.system(`Game on! You play ${this.myColor}.`);
    play('notify');
    this.onSession?.(session);
    this.emit();
  }

  private wire(session: GameSession) {
    session.onLocalMove = (m) => {
      this.send({ t: 'move', ply: session.moves.length - 1, uci: m.uci, clock: m.clock });
      if (this.draw === 'received') this.draw = 'none';
      this.emit();
    };
    const tick = session.tick.bind(session);
    session.tick = () => {
      const before = session.status;
      tick();
      if (before === 'playing' && session.status === 'over' && session.termination.startsWith('timeout')) {
        // Tell the other side so both agree on the flag.
        const flagged: Color = session.result === '1-0' ? 'black' : session.result === '0-1' ? 'white' : session.turn;
        this.send({ t: 'flag', color: flagged });
      }
    };
  }

  private sendSync() {
    const s = this.session;
    if (!s || !this.setup) return;
    this.send({
      t: 'sync',
      setup: this.setup,
      moves: s.moves.map((m) => m.uci),
      clocks: s.clock ? { white: s.clock.time('white'), black: s.clock.time('black') } : null,
      over: s.status === 'over' ? { result: s.result, termination: s.termination } : undefined,
    });
  }

  private requestResync() {
    // Guests ask by re-sending hello; the host answers with a sync.
    if (this.role === 'guest') this.send({ t: 'hello', name: this.myName, gameId: this.setup?.gameId });
    else this.sendSync();
  }

  private applySync(msg: Extract<Msg, { t: 'sync' }>) {
    const current = this.session;
    const same =
      current &&
      current.id === msg.setup.gameId &&
      current.moves.length === msg.moves.length &&
      current.moves.every((m, i) => m.uci === msg.moves[i]);
    if (!same) {
      this.setup = msg.setup;
      this.session = this.buildSession(msg.setup, msg.moves);
      this.onSession?.(this.session);
    }
    const s = this.session!;
    if (s.clock && msg.clocks) {
      s.clock.set('white', msg.clocks.white);
      s.clock.set('black', msg.clocks.black);
    }
    if (msg.over && s.status === 'playing') {
      if (msg.over.result === '1/2-1/2') s.draw(msg.over.termination as never);
      else if (msg.over.termination === 'resignation') s.resign(msg.over.result === '1-0' ? 'black' : 'white');
      else if (msg.over.termination.startsWith('timeout')) s.flag(msg.over.result === '1-0' ? 'black' : 'white');
    }
    this.emit();
  }

  // ---- Actions from the UI ----

  sendChat(text: string) {
    const t = text.trim();
    if (!t) return;
    this.chat.push({ from: 'me', text: t, ts: Date.now() });
    this.send({ t: 'chat', text: t });
    this.emit();
  }

  markRead() {
    if (this.unread) {
      this.unread = 0;
      this.emit();
    }
  }

  resign() {
    if (!this.session || !this.myColor) return;
    this.session.resign(this.myColor);
    this.send({ t: 'resign' });
    this.emit();
  }

  offerDraw() {
    if (this.draw === 'received') return this.answerDraw(true);
    this.draw = 'sent';
    this.send({ t: 'draw', action: 'offer' });
    this.system('You offered a draw.');
    this.emit();
  }

  answerDraw(accept: boolean) {
    this.send({ t: 'draw', action: accept ? 'accept' : 'decline' });
    if (accept) this.session?.draw('agreement');
    this.draw = 'none';
    this.emit();
  }

  /** Plies to undo so it's the requester's move again. */
  private takebackPlies(requester: Color) {
    const s = this.session!;
    return s.turn === requester ? 2 : 1;
  }

  requestTakeback() {
    if (!this.session || this.session.moves.length === 0) return;
    this.takeback = 'sent';
    this.send({ t: 'takeback', action: 'offer' });
    this.system('You asked to take back your last move.');
    this.emit();
  }

  answerTakeback(accept: boolean) {
    const s = this.session;
    if (!s || !this.myColor) return;
    if (accept) {
      const plies = Math.min(s.moves.length, this.takebackPlies(opposite(this.myColor)));
      s.undoPlies(plies);
      this.send({ t: 'takeback', action: 'accept', plies });
    } else {
      this.send({ t: 'takeback', action: 'decline' });
    }
    this.takeback = 'none';
    this.emit();
  }

  offerRematch() {
    if (this.rematch === 'received') return this.answerRematch(true);
    this.rematch = 'sent';
    this.send({ t: 'rematch', action: 'offer' });
    this.emit();
  }

  answerRematch(accept: boolean) {
    this.send({ t: 'rematch', action: accept ? 'accept' : 'decline' });
    this.rematch = 'none';
    if (accept && this.role === 'host') this.startRematch();
    this.emit();
  }

  private startRematch() {
    if (!this.setup) return;
    // Swap colours each game.
    this.setup = { ...this.setup, gameId: crypto.randomUUID(), hostColor: opposite(this.setup.hostColor) };
    this.send({ t: 'setup', setup: this.setup });
    this.startGame();
  }

  /** Stop waiting for a vanished opponent. */
  claimAbandoned(asWin: boolean) {
    if (!this.session || !this.myColor) return;
    this.session.abandon(asWin ? this.myColor : undefined);
    this.emit();
  }

  leave() {
    this.closedByUser = true;
    if (savedMatch()?.setup.gameId === this.setup?.gameId) forgetSavedMatch();
    this.send({ t: 'bye' });
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    setTimeout(() => {
      this.conn?.close();
      this.peer?.destroy();
    }, 200);
    this.status = 'closed';
    this.emit();
  }
}
