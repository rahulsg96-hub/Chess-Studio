import { useEffect, useState, useSyncExternalStore } from 'react';
import { Copy, Link, LogOut, Share2, Users, Wifi } from 'lucide-react';
import { Segmented, copyText } from '../components/ui';
import { OnlineMatch, forgetSavedMatch, normalizeCode, savedMatch } from '../lib/net';
import { navigate } from '../lib/router';
import { getSettings, remember, store, updateSettings, useSettings } from '../lib/settings';
import { getActiveMatch, setActiveMatch, useActive } from '../lib/store';
import type { Color, TimeControl } from '../lib/types';
import { formatTimeControl } from '../lib/levels';
import { GameView } from './GameView';
import { TimePicker } from './HomeView';

export function OnlineView({ joinCode }: { joinCode?: string }) {
  const { match } = useActive();
  useSyncExternalStore(
    (fn) => (match ? match.subscribe(fn) : () => {}),
    () => (match ? match.getVersion() : 0),
  );

  // Opening a join link starts joining straight away.
  useEffect(() => {
    if (!joinCode) return;
    const code = normalizeCode(joinCode);
    const existing = getActiveMatch();
    if (existing && existing.code === code && existing.status !== 'error' && existing.status !== 'closed') {
      navigate('online');
      return;
    }
    const m = new OnlineMatch('guest', getName());
    setActiveMatch(m);
    m.join(code);
    navigate('online');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinCode]);

  if (match?.session) {
    return (
      <div className="online-wrap">
        <OnlineHeader />
        <GameView key={match.session.id} session={match.session} match={match} />
      </div>
    );
  }
  if (match && match.status !== 'idle' && match.status !== 'closed') return <Waiting match={match} />;
  return <Lobby />;
}

function getName() {
  const n = getSettings().playerName;
  return n && n !== 'Me' ? n : 'Player';
}

function OnlineHeader() {
  const { match } = useActive();
  if (!match) return null;
  const dot = match.status === 'connected' ? 'ok' : match.status === 'reconnecting' || match.status === 'connecting' ? 'warn' : 'bad';
  return (
    <div className="online-header">
      <span className={`dot ${dot}`} />
      <span>
        {match.status === 'connected' ? `Connected to ${match.oppName}` : match.status === 'reconnecting' ? 'Reconnecting…' : match.status}
        {match.rtt !== null && match.status === 'connected' && <span className="muted"> · {match.rtt} ms</span>}
      </span>
      <span className="muted small">Room {match.code}</span>
      <button
        className="link-btn"
        onClick={() => {
          if (match.session?.status === 'playing' && !confirm('Leave the game? It will be counted as abandoned.')) return;
          if (match.session?.status === 'playing') match.claimAbandoned(false);
          setActiveMatch(null);
          navigate('online');
        }}
      >
        <LogOut size={14} /> Leave
      </button>
    </div>
  );
}

function Lobby() {
  const settings = useSettings();
  const [name, setName] = useState(settings.playerName === 'Me' ? '' : settings.playerName);
  const [tc, setTc] = useState<TimeControl>(() => remember('online.tc', { initial: 600, increment: 5 }));
  const [color, setColor] = useState<Color | 'random'>(() => remember('online.color', 'random'));
  const [custom, setCustom] = useState(false);
  const [code, setCode] = useState('');
  const { match } = useActive();
  const [saved, setSaved] = useState(() => savedMatch());

  const ensureName = () => {
    const n = name.trim() || 'Player';
    if (n !== settings.playerName) updateSettings({ playerName: n });
    return n;
  };

  const host = () => {
    store('online.tc', tc);
    store('online.color', color);
    const m = new OnlineMatch('host', ensureName());
    setActiveMatch(m);
    m.host(tc, color);
  };

  const join = () => {
    const m = new OnlineMatch('guest', ensureName());
    setActiveMatch(m);
    m.join(code);
  };

  return (
    <div className="page">
      <h1>
        <Wifi size={22} /> Play a friend online
      </h1>
      {match?.status === 'closed' && <p className="muted">The last online game has ended.</p>}
      {saved && (
        <div className="card resume-card">
          <div>
            <div className="card-kicker">Interrupted online game</div>
            <div className="card-title">
              {saved.setup.hostColor === 'white' ? saved.setup.hostName : saved.setup.guestName} vs{' '}
              {saved.setup.hostColor === 'white' ? saved.setup.guestName : saved.setup.hostName}
            </div>
            <div className="muted small">
              Room {saved.code} · {saved.moves.length} moves played · your friend needs to have the app open too
            </div>
          </div>
          <div className="row-gap">
            <button className="primary" onClick={() => setActiveMatch(OnlineMatch.resume(saved))}>
              Resume
            </button>
            <button
              onClick={() => {
                forgetSavedMatch();
                setSaved(null);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
      <label className="field-label narrow-field">
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="So your friend knows it's you" />
      </label>
      <div className="home-grid">
        <section className="card">
          <h2>Create a game</h2>
          <p className="muted small">You'll get a short code to send your friend.</p>
          <label className="field-label">You play</label>
          <Segmented<Color | 'random'>
            value={color}
            onChange={setColor}
            options={[
              { value: 'white', label: '♔ White' },
              { value: 'random', label: '⚄ Random' },
              { value: 'black', label: '♚ Black' },
            ]}
          />
          <label className="field-label">
            Time control: <strong>{formatTimeControl(tc)}</strong>
          </label>
          <TimePicker value={tc} onChange={setTc} custom={custom} setCustom={setCustom} />
          <button className="primary big" onClick={host}>
            <Users size={18} /> Create game
          </button>
        </section>
        <section className="card">
          <h2>Join a game</h2>
          <p className="muted small">Type the code your friend sent you (or just open the link they shared).</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (normalizeCode(code).length === 6) join();
            }}
          >
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, 6))}
              placeholder="ABC123"
              aria-label="Game code"
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button type="submit" className="primary big" disabled={normalizeCode(code).length !== 6}>
              <Link size={18} /> Join
            </button>
          </form>
          <details className="how">
            <summary>How does this work?</summary>
            <p className="small">
              The two devices connect directly to each other (peer-to-peer). A free public matchmaking server is only used to introduce them by
              code — your moves don't go through it, and there's no account or sign-up. Both of you need the app open; if the connection drops,
              it reconnects automatically and the game picks up where it left off.
            </p>
            <p className="small">
              Rarely, very strict networks (some offices, hotels or mobile carriers) block direct connections. If joining fails, try switching one
              device between Wi-Fi and mobile data.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}

function Waiting({ match }: { match: OnlineMatch }) {
  const [copied, setCopied] = useState('');
  const flash = (s: string) => {
    setCopied(s);
    setTimeout(() => setCopied(''), 2000);
  };
  const cancel = () => {
    setActiveMatch(null);
    navigate('online');
  };

  if (match.status === 'error') {
    return (
      <div className="page narrow">
        <h1>Couldn't connect</h1>
        <p>{match.error}</p>
        <button className="primary" onClick={cancel}>
          Back
        </button>
      </div>
    );
  }

  if (match.role === 'guest') {
    return (
      <div className="page narrow center">
        <div className="spinner" />
        <h2>Joining game {match.code}…</h2>
        <p className="muted">Connecting to your friend's device.</p>
        <button onClick={cancel}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="page narrow center">
      <h2>{match.status === 'opening' ? 'Creating game…' : 'Waiting for your friend to join'}</h2>
      {match.status === 'waiting' && (
        <>
          <p className="muted">Send them this code:</p>
          <div className="big-code" aria-label="Game code">
            {match.code}
          </div>
          <div className="row-gap center">
            <button onClick={async () => flash((await copyText(match.code)) ? 'Code copied' : '')}>
              <Copy size={16} /> Copy code
            </button>
            <button onClick={async () => flash((await copyText(match.shareLink)) ? 'Link copied' : '')}>
              <Link size={16} /> Copy link
            </button>
            {'share' in navigator && (
              <button
                onClick={() =>
                  navigator.share({ title: 'Chess game', text: `Join my chess game — code ${match.code}`, url: match.shareLink }).catch(() => {})
                }
              >
                <Share2 size={16} /> Share
              </button>
            )}
          </div>
          {copied && <p className="ok">{copied}</p>}
          <div className="spinner" />
          <p className="muted small">Keep this screen open. The game starts as soon as they join.</p>
        </>
      )}
      {match.status === 'opening' && <div className="spinner" />}
      <button onClick={cancel}>Cancel</button>
    </div>
  );
}
