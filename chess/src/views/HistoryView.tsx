import { useMemo, useRef, useState } from 'react';
import { Download, FileText, Search, Star, Upload } from 'lucide-react';
import { Modal, Segmented, downloadFile, timeAgo } from '../components/ui';
import { outcomeFor, parsePgn, splitPgn, toPgn, uid } from '../lib/chessutil';
import { importGames } from '../lib/db';
import { formatTimeControl, speedOf } from '../lib/levels';
import { detectOpening, loadOpenings } from '../lib/openings';
import { navigate } from '../lib/router';
import { useGames } from '../lib/store';
import type { GameRecord } from '../lib/types';
import { ResultDot } from './HomeView';

type ModeFilter = 'all' | 'computer' | 'online' | 'local';
type ResultFilter = 'all' | 'win' | 'loss' | 'draw';

export function HistoryView() {
  const { games, loading } = useGames();
  const [mode, setMode] = useState<ModeFilter>('all');
  const [res, setRes] = useState<ResultFilter>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [q, setQ] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return games.filter((g) => {
      if (mode !== 'all' && g.mode !== mode) return false;
      if (favOnly && !g.favorite) return false;
      if (res !== 'all' && outcomeFor(g, g.playerColor) !== res) return false;
      if (needle) {
        const hay = `${g.white} ${g.black} ${g.opening?.name ?? ''} ${g.opening?.eco ?? ''} ${g.notes ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [games, mode, res, favOnly, q]);

  const exportPgn = () => {
    downloadFile(`chess-studio-games-${new Date().toISOString().slice(0, 10)}.pgn`, filtered.map(toPgn).join('\n'));
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Game history</h1>
        <div className="row-gap">
          <button onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Import PGN
          </button>
          <button onClick={exportPgn} disabled={!filtered.length}>
            <Download size={16} /> Export {filtered.length !== games.length ? 'shown' : 'all'}
          </button>
        </div>
      </div>

      <div className="filters">
        <div className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players, openings, notes…" aria-label="Search games" />
        </div>
        <Segmented<ModeFilter>
          value={mode}
          onChange={setMode}
          ariaLabel="Opponent type"
          options={[
            { value: 'all', label: 'All' },
            { value: 'computer', label: 'Computer' },
            { value: 'online', label: 'Online' },
            { value: 'local', label: 'Same device' },
          ]}
        />
        <Segmented<ResultFilter>
          value={res}
          onChange={setRes}
          ariaLabel="Result"
          options={[
            { value: 'all', label: 'Any result' },
            { value: 'win', label: 'Wins' },
            { value: 'draw', label: 'Draws' },
            { value: 'loss', label: 'Losses' },
          ]}
        />
        <button className={`icon-btn ${favOnly ? 'fav' : ''}`} onClick={() => setFavOnly(!favOnly)} aria-label="Favourites only" title="Favourites only">
          <Star size={18} fill={favOnly ? 'currentColor' : 'none'} />
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">{games.length ? 'No games match these filters.' : 'No games yet — play one and it will be saved here automatically.'}</p>
      ) : (
        <div className="game-table" role="table">
          {filtered.map((g) => (
            <GameRow key={g.id} g={g} />
          ))}
        </div>
      )}

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function GameRow({ g }: { g: GameRecord }) {
  const me = g.playerColor;
  const acc = g.analysis && me ? g.analysis.accuracy[me] : null;
  return (
    <button className="game-row" role="row" onClick={() => navigate(`review/${g.id}`)}>
      <ResultDot game={g} />
      <span className="gr-main">
        <span className="gr-players">
          <span className={me === 'white' ? 'me' : ''}>{g.white}</span> – <span className={me === 'black' ? 'me' : ''}>{g.black}</span>
          {g.favorite && <Star size={13} className="fav" fill="currentColor" />}
        </span>
        <span className="gr-sub muted small">
          {g.opening ? `${g.opening.eco} ${g.opening.name}` : 'Unknown opening'} · {Math.ceil(g.moves.length / 2)} moves
        </span>
      </span>
      <span className="gr-meta small">
        <span>{speedOf(g.timeControl)} {formatTimeControl(g.timeControl) !== 'No clock' ? formatTimeControl(g.timeControl) : ''}</span>
        <span className="muted">{timeAgo(g.date)}</span>
      </span>
      <span className="gr-acc small" title="Your accuracy">
        {acc !== null ? `${Math.round(acc)}%` : g.analysis ? '' : '—'}
      </span>
    </button>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [myName, setMyName] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const run = async (pgnText: string) => {
    await loadOpenings();
    const chunks = splitPgn(pgnText);
    const parsed: GameRecord[] = [];
    let failed = 0;
    for (const c of chunks) {
      const g = parsePgn(c);
      if (!g) {
        failed++;
        continue;
      }
      const rec: GameRecord = { ...g, id: uid(), opening: detectOpening(g.moves) };
      const n = myName.trim().toLowerCase();
      if (n) {
        if (rec.white.toLowerCase() === n) rec.playerColor = 'white';
        else if (rec.black.toLowerCase() === n) rec.playerColor = 'black';
      }
      parsed.push(rec);
    }
    if (parsed.length) await importGames(parsed);
    setStatus(`Imported ${parsed.length} game${parsed.length === 1 ? '' : 's'}${failed ? `, ${failed} could not be read` : ''}.`);
  };

  return (
    <Modal title="Import games (PGN)" onClose={onClose} wide>
      <p className="muted small">
        Paste one or more games in PGN format — for example exported from lichess.org or chess.com — or pick a .pgn file. They'll be added to your
        history so you can analyse them and train on the mistakes.
      </p>
      <label className="field-label">
        Your name/username in these games (optional — marks which side is you)
        <input value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="e.g. your lichess username" />
      </label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 ...'} className="mono" />
      <input
        ref={file}
        type="file"
        accept=".pgn,text/plain"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await run(await f.text());
        }}
      />
      {status && <p className="ok">{status}</p>}
      <div className="modal-actions">
        <button onClick={() => file.current?.click()}>
          <FileText size={16} /> Choose file
        </button>
        <button className="primary" onClick={() => run(text)} disabled={!text.trim()}>
          Import
        </button>
      </div>
    </Modal>
  );
}
