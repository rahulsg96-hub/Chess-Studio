import { useRef, useState } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { Modal, Segmented, Toggle, downloadFile } from '../components/ui';
import { allDrills, allGames, clearAll, importGames, saveDrill, type DrillState } from '../lib/db';
import { BOARD_THEMES, remember, store, updateSettings, useSettings } from '../lib/settings';
import type { GameRecord, Settings } from '../lib/types';

export function SettingsView() {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const [msg, setMsg] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [peer, setPeer] = useState(() => remember<{ host: string; port: number; path: string; secure: boolean } | null>('peerServer', null));

  const backup = async () => {
    const data = { app: 'chess-studio', version: 1, exported: Date.now(), settings: s, games: await allGames(), drills: await allDrills() };
    downloadFile(`chess-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
  };

  const restore = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as { app?: string; games?: GameRecord[]; drills?: DrillState[]; settings?: Settings };
      if (data.app !== 'chess-studio' || !Array.isArray(data.games)) throw new Error('not a backup');
      await importGames(data.games);
      for (const d of data.drills ?? []) await saveDrill(d);
      if (data.settings) updateSettings(data.settings);
      setMsg(`Restored ${data.games.length} games.`);
    } catch {
      setMsg("That file isn't a Chess Studio backup.");
    }
  };

  return (
    <div className="page narrow">
      <h1>Settings</h1>

      <section className="card">
        <h2>You</h2>
        <label className="field-label">
          Your name
          <input value={s.playerName} onChange={(e) => set({ playerName: e.target.value })} />
        </label>
      </section>

      <section className="card">
        <h2>Look</h2>
        <label className="field-label">App theme</label>
        <Segmented
          value={s.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: 'system', label: 'Auto' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <label className="field-label">Board</label>
        <div className="theme-swatches">
          {Object.entries(BOARD_THEMES).map(([key, t]) => (
            <button
              key={key}
              className={`swatch ${s.boardTheme === key ? 'on' : ''}`}
              onClick={() => set({ boardTheme: key })}
              aria-label={t.label}
              title={t.label}
            >
              <span style={{ background: `conic-gradient(${t.dark} 0 25%, ${t.light} 0 50%, ${t.dark} 0 75%, ${t.light} 0)` }} />
              <small>{t.label}</small>
            </button>
          ))}
        </div>
        <Toggle checked={s.showCoords} onChange={(v) => set({ showCoords: v })} label="Show coordinates" />
        <Toggle checked={s.animation} onChange={(v) => set({ animation: v })} label="Animate moves" />
      </section>

      <section className="card">
        <h2>Playing</h2>
        <Toggle checked={s.showLegalMoves} onChange={(v) => set({ showLegalMoves: v })} label="Show legal moves and engine arrows" />
        <Toggle checked={s.premoves} onChange={(v) => set({ premoves: v })} label="Premoves" hint="Queue your next move while the opponent thinks" />
        <Toggle checked={s.autoQueen} onChange={(v) => set({ autoQueen: v })} label="Always promote to queen" />
        <Toggle checked={s.confirmResign} onChange={(v) => set({ confirmResign: v })} label="Ask before resigning" />
        <Toggle checked={s.sound} onChange={(v) => set({ sound: v })} label="Sounds" />
      </section>

      <section className="card">
        <h2>Analysis</h2>
        <Toggle
          checked={s.autoAnalyze}
          onChange={(v) => set({ autoAnalyze: v })}
          label="Analyse games automatically"
          hint="Runs Stockfish over each finished game in the background"
        />
        <label className="field-label">
          Analysis depth: <strong>{s.analysisDepth}</strong> <span className="muted">({s.analysisDepth <= 12 ? 'fast' : s.analysisDepth <= 16 ? 'balanced' : 'thorough, slower'})</span>
          <input type="range" min={10} max={20} value={s.analysisDepth} onChange={(e) => set({ analysisDepth: Number(e.target.value) })} />
        </label>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="muted small">
          Games are stored on this device only. Make a backup now and then — and use it to move your history to another device (for example from
          your PC to your phone).
        </p>
        <div className="row-gap wrap">
          <button onClick={backup}>
            <Download size={16} /> Download backup
          </button>
          <button onClick={() => file.current?.click()}>
            <Upload size={16} /> Restore backup
          </button>
          <button className="danger" onClick={() => setConfirmClear(true)}>
            <Trash2 size={16} /> Delete all games
          </button>
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        {msg && <p className="ok">{msg}</p>}
      </section>

      <section className="card">
        <details>
          <summary>
            <strong>Advanced: online matchmaking server</strong>
          </summary>
          <p className="muted small">
            Online games use the free public PeerJS server to introduce the two devices. If it's ever unavailable you can run your own PeerJS
            server and enter it here (both players must use the same one). Leave empty for the default.
          </p>
          <div className="peer-fields">
            <label>
              Host
              <input
                value={peer?.host ?? ''}
                onChange={(e) => setPeer({ host: e.target.value, port: peer?.port ?? 443, path: peer?.path ?? '/', secure: peer?.secure ?? true })}
                placeholder="0.peerjs.com"
              />
            </label>
            <label>
              Port
              <input
                type="number"
                value={peer?.port ?? 443}
                onChange={(e) => setPeer({ host: peer?.host ?? '', port: Number(e.target.value), path: peer?.path ?? '/', secure: peer?.secure ?? true })}
              />
            </label>
            <label>
              Path
              <input
                value={peer?.path ?? '/'}
                onChange={(e) => setPeer({ host: peer?.host ?? '', port: peer?.port ?? 443, path: e.target.value, secure: peer?.secure ?? true })}
              />
            </label>
            <label className="toggle-inline">
              <input
                type="checkbox"
                checked={peer?.secure ?? true}
                onChange={(e) => setPeer({ host: peer?.host ?? '', port: peer?.port ?? 443, path: peer?.path ?? '/', secure: e.target.checked })}
              />{' '}
              HTTPS
            </label>
          </div>
          <div className="row-gap">
            <button onClick={() => (store('peerServer', peer?.host ? peer : undefined), setMsg('Server setting saved.'))}>Save</button>
            <button onClick={() => (store('peerServer', undefined), setPeer(null), setMsg('Using the default server.'))}>Use default</button>
          </div>
        </details>
      </section>

      <section className="card about">
        <h2>About</h2>
        <p className="small">
          Chess Studio — built for practising and playing with friends. Engine: <a href="https://stockfishchess.org" target="_blank" rel="noreferrer">Stockfish 18</a>{' '}
          (GPLv3) via <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noreferrer">stockfish.js</a>. Board:{' '}
          <a href="https://github.com/lichess-org/chessground" target="_blank" rel="noreferrer">chessground</a> (GPLv3) with the cburnett pieces.
          Rules: chess.js. Opening names: lichess chess-openings (public domain). Online play: PeerJS.
        </p>
      </section>

      {confirmClear && (
        <Modal title="Delete all games?" onClose={() => setConfirmClear(false)}>
          <p>This removes every saved game and training position from this device. Download a backup first if you might want them back.</p>
          <div className="modal-actions">
            <button onClick={() => setConfirmClear(false)}>Cancel</button>
            <button
              className="danger"
              onClick={async () => {
                await clearAll();
                setConfirmClear(false);
                setMsg('All games deleted.');
              }}
            >
              Delete everything
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
