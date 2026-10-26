import { useMemo } from 'react';
import { outcomeFor } from '../lib/chessutil';
import { LEVELS, speedOf } from '../lib/levels';
import { navigate } from '../lib/router';
import { useGames } from '../lib/store';
import type { Color, GameRecord } from '../lib/types';

interface Tally {
  w: number;
  d: number;
  l: number;
}
const empty = (): Tally => ({ w: 0, d: 0, l: 0 });
const add = (t: Tally, g: GameRecord) => {
  const o = outcomeFor(g, g.playerColor);
  if (o === 'win') t.w++;
  else if (o === 'draw') t.d++;
  else if (o === 'loss') t.l++;
};
const pct = (t: Tally) => {
  const n = t.w + t.d + t.l;
  return n ? Math.round(((t.w + t.d / 2) / n) * 100) : 0;
};

export function StatsView() {
  const { games, loading } = useGames();
  const mine = useMemo(() => games.filter((g) => g.playerColor && g.result !== '*'), [games]);

  const s = useMemo(() => {
    const total = empty();
    const byColor: Record<Color, Tally> = { white: empty(), black: empty() };
    const byOpp = new Map<string, Tally>();
    const byLevel = new Map<number, Tally>();
    const bySpeed = new Map<string, Tally>();
    const openings = new Map<string, { name: string; eco: string; t: Tally; color: Color }>();
    for (const g of mine) {
      add(total, g);
      add(byColor[g.playerColor!], g);
      const opp = g.mode === 'computer' ? 'Computer' : g.playerColor === 'white' ? g.black : g.white;
      if (!byOpp.has(opp)) byOpp.set(opp, empty());
      add(byOpp.get(opp)!, g);
      if (g.mode === 'computer' && g.engineLevel) {
        if (!byLevel.has(g.engineLevel)) byLevel.set(g.engineLevel, empty());
        add(byLevel.get(g.engineLevel)!, g);
      }
      const sp = speedOf(g.timeControl);
      if (!bySpeed.has(sp)) bySpeed.set(sp, empty());
      add(bySpeed.get(sp)!, g);
      if (g.opening) {
        // Group by opening family (the part before the colon) and colour.
        const fam = g.opening.name.split(':')[0];
        const key = `${fam}|${g.playerColor}`;
        if (!openings.has(key)) openings.set(key, { name: fam, eco: g.opening.eco, t: empty(), color: g.playerColor! });
        add(openings.get(key)!.t, g);
      }
    }
    // Streaks, newest first.
    let streak = 0;
    let streakKind: 'win' | 'loss' | 'draw' | null = null;
    for (const g of mine) {
      const o = outcomeFor(g, g.playerColor);
      if (streakKind === null) streakKind = o;
      if (o === streakKind) streak++;
      else break;
    }
    const bestWin = mine
      .filter((g) => g.mode === 'computer' && outcomeFor(g, g.playerColor) === 'win' && !g.takebacks && !g.hintsUsed)
      .reduce((m, g) => Math.max(m, g.engineLevel ?? 0), 0);
    const analysed = mine.filter((g) => g.analysis).slice(0, 40).reverse();
    const accuracy = analysed.map((g) => ({ id: g.id, acc: g.analysis!.accuracy[g.playerColor!], date: g.date }));
    const errors = analysed.reduce(
      (t, g) => {
        const c = g.analysis!.counts[g.playerColor!];
        t.inaccuracy += c.inaccuracy;
        t.mistake += c.mistake;
        t.blunder += c.blunder;
        return t;
      },
      { inaccuracy: 0, mistake: 0, blunder: 0 },
    );
    const avgLen = mine.length ? Math.round(mine.reduce((n, g) => n + g.moves.length, 0) / mine.length / 2) : 0;
    const terminations = new Map<string, number>();
    for (const g of mine) terminations.set(g.termination, (terminations.get(g.termination) ?? 0) + 1);
    return { total, byColor, byOpp, byLevel, bySpeed, openings, streak, streakKind, bestWin, accuracy, errors, analysedCount: analysed.length, avgLen, terminations };
  }, [mine]);

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!mine.length)
    return (
      <div className="page narrow">
        <h1>Statistics</h1>
        <p className="muted">Play a few games and your statistics will build up here.</p>
        <button className="primary" onClick={() => navigate('')}>
          Play a game
        </button>
      </div>
    );

  const n = mine.length;
  const openingRows = [...s.openings.values()].sort((a, b) => b.t.w + b.t.d + b.t.l - (a.t.w + a.t.d + a.t.l)).slice(0, 10);

  return (
    <div className="page">
      <h1>Statistics</h1>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-num">{n}</div>
          <div className="stat-label">games played</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{pct(s.total)}%</div>
          <div className="stat-label">score</div>
          <WDL t={s.total} />
        </div>
        <div className="stat-card">
          <div className="stat-num">
            {s.streak} {s.streakKind === 'win' ? '🔥' : ''}
          </div>
          <div className="stat-label">current {s.streakKind ?? ''} streak</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{s.bestWin ? `L${s.bestWin}` : '–'}</div>
          <div className="stat-label">
            best clean win vs computer{s.bestWin ? ` (≈${LEVELS[s.bestWin - 1].elo})` : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{s.avgLen}</div>
          <div className="stat-label">average moves per game</div>
        </div>
      </div>

      <div className="stats-grid">
        <section className="card">
          <h2>Accuracy over time</h2>
          {s.accuracy.length >= 2 ? (
            <Sparkline points={s.accuracy.map((a) => a.acc)} onPick={(i) => navigate(`review/${s.accuracy[i].id}`)} />
          ) : (
            <p className="muted">Needs at least two analysed games.</p>
          )}
          {s.analysedCount > 0 && (
            <p className="small">
              Over your last {s.analysedCount} analysed games: <strong>{(s.errors.blunder / s.analysedCount).toFixed(1)}</strong> blunders,{' '}
              <strong>{(s.errors.mistake / s.analysedCount).toFixed(1)}</strong> mistakes and{' '}
              <strong>{(s.errors.inaccuracy / s.analysedCount).toFixed(1)}</strong> inaccuracies per game.
            </p>
          )}
        </section>

        <section className="card">
          <h2>By colour</h2>
          <TallyTable rows={[['As White', s.byColor.white], ['As Black', s.byColor.black]]} />
          <h2>By speed</h2>
          <TallyTable rows={[...s.bySpeed.entries()]} />
        </section>

        <section className="card">
          <h2>Opponents</h2>
          <TallyTable rows={[...s.byOpp.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))} />
          {s.byLevel.size > 0 && (
            <>
              <h2>Vs computer levels</h2>
              <TallyTable
                rows={[...s.byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([lvl, t]) => [`Level ${lvl} (≈${LEVELS[lvl - 1]?.elo})`, t] as [string, Tally])}
              />
            </>
          )}
        </section>

        <section className="card">
          <h2>Openings</h2>
          {openingRows.length ? (
            <TallyTable rows={openingRows.map((o) => [`${o.color === 'white' ? '♔' : '♚'} ${o.name}`, o.t] as [string, Tally])} />
          ) : (
            <p className="muted">No named openings yet.</p>
          )}
        </section>

        <section className="card">
          <h2>How games end</h2>
          <ul className="plain">
            {[...s.terminations.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([t, c]) => (
                <li key={t}>
                  <span className="cap">{t.replace('-', ' ')}</span> <span className="muted">— {c}</span>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const sum = (t: Tally) => t.w + t.d + t.l;

function WDL({ t }: { t: Tally }) {
  const n = sum(t) || 1;
  return (
    <div className="wdl" aria-label={`${t.w} wins, ${t.d} draws, ${t.l} losses`}>
      <span className="win" style={{ width: `${(t.w / n) * 100}%` }} />
      <span className="draw" style={{ width: `${(t.d / n) * 100}%` }} />
      <span className="loss" style={{ width: `${(t.l / n) * 100}%` }} />
    </div>
  );
}

function TallyTable({ rows }: { rows: [string, Tally][] }) {
  return (
    <table className="tally">
      <thead>
        <tr>
          <th />
          <th>Games</th>
          <th>W</th>
          <th>D</th>
          <th>L</th>
          <th>Score</th>
          <th className="wdl-col" />
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, t]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{sum(t)}</td>
            <td>{t.w}</td>
            <td>{t.d}</td>
            <td>{t.l}</td>
            <td>{pct(t)}%</td>
            <td className="wdl-col">
              <WDL t={t} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sparkline({ points, onPick }: { points: number[]; onPick: (i: number) => void }) {
  const W = 400;
  const H = 120;
  const n = points.length - 1;
  const x = (i: number) => (i / n) * (W - 16) + 8;
  const y = (v: number) => H - 8 - (v / 100) * (H - 16);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  // Moving average to show the trend.
  const avg = points.map((_, i) => {
    const w = points.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const da = avg.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accuracy trend">
      {[25, 50, 75].map((v) => (
        <g key={v}>
          <line x1="0" x2={W} y1={y(v)} y2={y(v)} className="grid" />
          <text x="2" y={y(v) - 2} className="grid-label">
            {v}%
          </text>
        </g>
      ))}
      <path d={d} className="spark-raw" />
      <path d={da} className="spark-avg" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p)} r="4" className="spark-dot" onClick={() => onPick(i)}>
          <title>{p.toFixed(0)}%</title>
        </circle>
      ))}
    </svg>
  );
}
