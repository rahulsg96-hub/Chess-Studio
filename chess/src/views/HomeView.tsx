import { useMemo, useState } from 'react';
import { Cpu, Play, Smartphone, Sparkles, Target, Users, Wifi } from 'lucide-react';
import { Segmented, timeAgo } from '../components/ui';
import { outcomeFor, resultText } from '../lib/chessutil';
import { LEVELS, TIME_PRESETS, formatTimeControl, getLevel } from '../lib/levels';
import { navigate } from '../lib/router';
import { savedMatch } from '../lib/net';
import { GameSession, discardSavedSession, savedSession } from '../lib/session';
import { remember, store, updateSettings, useSettings } from '../lib/settings';
import { setActiveSession, useActive, useGames } from '../lib/store';
import type { Color, GameRecord, TimeControl } from '../lib/types';
import { mistakeCount } from './TrainView';

type Opp = 'computer' | 'local' | 'online';

export function HomeView() {
  const settings = useSettings();
  const { session, match } = useActive();
  const onlineSaved = useMemo(() => (match?.session ? null : savedMatch()), [match]);
  const { games } = useGames();
  const [opp, setOpp] = useState<Opp>(() => remember('home.opp', 'computer'));
  const [color, setColor] = useState<Color | 'random'>(() => remember('home.color', 'white'));
  const [level, setLevel] = useState<number>(() => remember('home.level', 4));
  const [tc, setTc] = useState<TimeControl>(() => remember('home.tc', { initial: 600, increment: 0 }));
  const [whiteName, setWhiteName] = useState(() => remember('home.whiteName', settings.playerName));
  const [blackName, setBlackName] = useState(() => remember('home.blackName', 'Meghana'));
  const [custom, setCustom] = useState(false);
  const saved = useMemo(() => (session?.status === 'playing' ? null : savedSession()), [session]);

  const choose = <T,>(key: string, set: (v: T) => void) => (v: T) => {
    store(key, v);
    set(v);
  };

  const suggestion = useMemo(() => suggestLevel(games), [games]);
  const lvl = getLevel(level);
  const toTrain = useMemo(() => mistakeCount(games), [games]);

  const start = () => {
    if (opp === 'online') {
      navigate('online');
      return;
    }
    if (session && session.status === 'playing' && session.moves.length >= 2) {
      if (!confirm('You have a game in progress. Starting a new one will count it as resigned. Continue?')) return;
      if (session.mode === 'computer') session.resign(session.config.playerColor!);
      else session.abandon();
    }
    discardSavedSession();
    let s: GameSession;
    if (opp === 'computer') {
      const mine: Color = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
      const cpu = `Stockfish L${level}`;
      s = new GameSession({
        mode: 'computer',
        playerColor: mine,
        engineLevel: level,
        timeControl: tc,
        white: mine === 'white' ? settings.playerName : cpu,
        black: mine === 'black' ? settings.playerName : cpu,
      });
    } else {
      s = new GameSession({ mode: 'local', timeControl: tc, white: whiteName || 'White', black: blackName || 'Black' });
    }
    setActiveSession(s);
    navigate('play');
  };

  const resume = () => {
    if (session && session.status === 'playing') {
      navigate('play');
      return;
    }
    if (saved) {
      setActiveSession(GameSession.restore(saved));
      navigate('play');
    }
  };

  const inProgress = session?.status === 'playing' ? session : null;
  const recent = games.slice(0, 5);

  return (
    <div className="home">
      {(inProgress || saved) && (
        <div className="card resume-card">
          <div>
            <div className="card-kicker">Game in progress</div>
            <div className="card-title">
              {(inProgress?.config ?? saved!.config).white} vs {(inProgress?.config ?? saved!.config).black}
            </div>
            <div className="muted small">
              {inProgress ? `${inProgress.moves.length} moves played` : `${saved!.moves.length} moves played`}
            </div>
          </div>
          <div className="row-gap">
            <button className="primary" onClick={resume}>
              <Play size={16} /> Continue
            </button>
            {!inProgress && saved && (
              <button
                onClick={() => {
                  discardSavedSession();
                  setActiveSession(null);
                }}
              >
                Discard
              </button>
            )}
          </div>
        </div>
      )}

      {match?.session?.status === 'playing' && (
        <div className="card resume-card">
          <div>
            <div className="card-kicker">Online game in progress</div>
            <div className="card-title">vs {match.oppName}</div>
          </div>
          <button className="primary" onClick={() => navigate('online')}>
            <Play size={16} /> Back to game
          </button>
        </div>
      )}
      {onlineSaved && (
        <div className="card resume-card">
          <div>
            <div className="card-kicker">Interrupted online game</div>
            <div className="card-title">vs {onlineSaved.oppName}</div>
            <div className="muted small">{onlineSaved.moves.length} moves played</div>
          </div>
          <button className="primary" onClick={() => navigate('online')}>
            <Play size={16} /> Resume
          </button>
        </div>
      )}

      <div className="home-grid">
        <section className="card new-game">
          <h2>New game</h2>
          <Segmented<Opp>
            value={opp}
            onChange={choose('home.opp', setOpp)}
            ariaLabel="Opponent"
            options={[
              { value: 'computer', label: (<><Cpu size={16} /> Computer</>) },
              { value: 'online', label: (<><Wifi size={16} /> Friend online</>) },
              { value: 'local', label: (<><Smartphone size={16} /> Same device</>) },
            ]}
          />

          {opp === 'computer' && (
            <>
              <label className="field-label">Play as</label>
              <Segmented<Color | 'random'>
                value={color}
                onChange={choose('home.color', setColor)}
                ariaLabel="Your colour"
                options={[
                  { value: 'white', label: '♔ White' },
                  { value: 'random', label: '⚄ Random' },
                  { value: 'black', label: '♚ Black' },
                ]}
              />
              <label className="field-label" htmlFor="level">
                Strength: <strong>Level {lvl.level} — {lvl.name}</strong> <span className="muted">(≈{lvl.elo})</span>
              </label>
              <input
                id="level"
                type="range"
                min={1}
                max={LEVELS.length}
                value={level}
                onChange={(e) => choose('home.level', setLevel)(Number(e.target.value))}
              />
              {suggestion && suggestion.level !== level && (
                <button className="link-btn" onClick={() => choose('home.level', setLevel)(suggestion.level)}>
                  <Sparkles size={14} /> {suggestion.reason} Try level {suggestion.level}.
                </button>
              )}
            </>
          )}

          {opp === 'local' && (
            <div className="names">
              <label>
                <span className="field-label">White</span>
                <input value={whiteName} onChange={(e) => choose('home.whiteName', setWhiteName)(e.target.value)} />
              </label>
              <label>
                <span className="field-label">Black</span>
                <input value={blackName} onChange={(e) => choose('home.blackName', setBlackName)(e.target.value)} />
              </label>
            </div>
          )}

          {opp === 'online' ? (
            <p className="muted">
              Play from two devices — you share a short code, your friend types it in (or opens your link), and you're playing. Both of you need the
              app open.
            </p>
          ) : (
            <>
              <label className="field-label">
                Time control: <strong>{formatTimeControl(tc)}</strong>
              </label>
              <TimePicker value={tc} onChange={choose('home.tc', setTc)} custom={custom} setCustom={setCustom} />
            </>
          )}

          <button className="primary big" onClick={start}>
            {opp === 'online' ? <Users size={18} /> : <Play size={18} />}
            {opp === 'online' ? 'Set up online game' : 'Start game'}
          </button>
        </section>

        <section className="card">
          <h2>Your chess</h2>
          <QuickStats games={games} />
          {toTrain > 0 && (
            <button className="train-cta" onClick={() => navigate('train')}>
              <Target size={18} />
              <span>
                <strong>{toTrain} positions</strong> from your games are waiting — find the move you missed.
              </span>
            </button>
          )}
          <h3>Recent games</h3>
          {recent.length === 0 && <p className="muted">Your games will appear here.</p>}
          <ul className="recent">
            {recent.map((g) => (
              <li key={g.id}>
                <button onClick={() => navigate(`review/${g.id}`)}>
                  <ResultDot game={g} />
                  <span className="recent-names">
                    {g.white} – {g.black}
                  </span>
                  <span className="muted small">{timeAgo(g.date)}</span>
                </button>
              </li>
            ))}
          </ul>
          {games.length > 5 && (
            <button className="link-btn" onClick={() => navigate('history')}>
              All {games.length} games →
            </button>
          )}
        </section>
      </div>
      {!settings.playerName || settings.playerName === 'Me' ? (
        <NamePrompt onSave={(name) => updateSettings({ playerName: name })} />
      ) : null}
    </div>
  );
}

function NamePrompt({ onSave }: { onSave: (n: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form
      className="card name-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
    >
      <span>What should we call you?</span>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
      <button type="submit" className="primary" disabled={!name.trim()}>
        Save
      </button>
    </form>
  );
}

export function TimePicker({
  value,
  onChange,
  custom,
  setCustom,
}: {
  value: TimeControl;
  onChange: (tc: TimeControl) => void;
  custom: boolean;
  setCustom: (b: boolean) => void;
}) {
  return (
    <div className="time-picker">
      <div className="time-grid">
        {TIME_PRESETS.map((p) => {
          const on = !custom && p.initial === value.initial && p.increment === value.increment;
          return (
            <button key={p.label} className={on ? 'on' : ''} onClick={() => (setCustom(false), onChange({ initial: p.initial, increment: p.increment }))}>
              <span className="tc-label">{p.label}</span>
              <span className="tc-group">{p.group}</span>
            </button>
          );
        })}
        <button className={custom ? 'on' : ''} onClick={() => setCustom(true)}>
          <span className="tc-label">⋯</span>
          <span className="tc-group">Custom</span>
        </button>
      </div>
      {custom && (
        <div className="custom-tc">
          <label>
            Minutes
            <input
              type="number"
              min={0}
              max={180}
              step={0.5}
              value={value.initial / 60}
              onChange={(e) => onChange({ ...value, initial: Math.round(Math.max(0, Number(e.target.value)) * 60) })}
            />
          </label>
          <label>
            Increment (s)
            <input
              type="number"
              min={0}
              max={60}
              value={value.increment}
              onChange={(e) => onChange({ ...value, increment: Math.max(0, Math.round(Number(e.target.value))) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function ResultDot({ game }: { game: GameRecord }) {
  const o = outcomeFor(game, game.playerColor);
  const cls = o ?? (game.result === '1/2-1/2' ? 'draw' : 'neutral');
  const label = o === 'win' ? 'W' : o === 'loss' ? 'L' : game.result === '1/2-1/2' ? '½' : game.result === '1-0' ? '1-0' : game.result === '0-1' ? '0-1' : '–';
  return (
    <span className={`result-dot ${cls}`} title={resultText(game.result, game.termination)}>
      {label}
    </span>
  );
}

function QuickStats({ games }: { games: GameRecord[] }) {
  const mine = games.filter((g) => g.playerColor && g.result !== '*');
  const w = mine.filter((g) => outcomeFor(g, g.playerColor) === 'win').length;
  const d = mine.filter((g) => outcomeFor(g, g.playerColor) === 'draw').length;
  const l = mine.length - w - d;
  const analysed = games.filter((g) => g.analysis && g.playerColor).slice(0, 10);
  const avgAcc = analysed.length
    ? Math.round(analysed.reduce((s, g) => s + g.analysis!.accuracy[g.playerColor!], 0) / analysed.length)
    : null;
  return (
    <div className="quick-stats">
      <div className="qs">
        <span className="qs-num">{games.length}</span>
        <span className="qs-label">games</span>
      </div>
      <div className="qs win">
        <span className="qs-num">{w}</span>
        <span className="qs-label">wins</span>
      </div>
      <div className="qs draw">
        <span className="qs-num">{d}</span>
        <span className="qs-label">draws</span>
      </div>
      <div className="qs loss">
        <span className="qs-num">{l}</span>
        <span className="qs-label">losses</span>
      </div>
      <div className="qs">
        <span className="qs-num">{avgAcc ?? '–'}</span>
        <span className="qs-label">accuracy (last 10)</span>
      </div>
    </div>
  );
}

/** Nudge up after a run of wins, down after a run of losses. */
function suggestLevel(games: GameRecord[]): { level: number; reason: string } | null {
  const vsCpu = games.filter((g) => g.mode === 'computer' && g.engineLevel && g.result !== '*').slice(0, 5);
  if (vsCpu.length < 3) return null;
  const lvl = vsCpu[0].engineLevel!;
  const same = vsCpu.filter((g) => g.engineLevel === lvl);
  if (same.length < 3) return null;
  const score = same.reduce((s, g) => {
    const o = outcomeFor(g, g.playerColor);
    return s + (o === 'win' ? 1 : o === 'draw' ? 0.5 : 0);
  }, 0);
  const pct = score / same.length;
  if (pct >= 0.7 && lvl < LEVELS.length) return { level: lvl + 1, reason: `You're scoring ${Math.round(pct * 100)}% at level ${lvl}.` };
  if (pct <= 0.15 && lvl > 1) return { level: lvl - 1, reason: `Level ${lvl} is tough right now.` };
  return null;
}
