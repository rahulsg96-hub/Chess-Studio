import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ChartLine, History, House, Microscope, Settings as SettingsIcon, Swords, Target, Wifi } from 'lucide-react';
import { BOARD_THEMES, useSettings } from './lib/settings';
import { navigate, useRoute } from './lib/router';
import { getActiveSession, setActiveSession, useActive } from './lib/store';
import { GameSession, savedSession } from './lib/session';
import { HomeView } from './views/HomeView';
import { GameView } from './views/GameView';
import { OnlineView } from './views/OnlineView';
import { HistoryView } from './views/HistoryView';
import { ReviewView } from './views/ReviewView';
import { TrainView } from './views/TrainView';
import { StatsView } from './views/StatsView';
import { SettingsView } from './views/SettingsView';
import { AnalysisView } from './views/AnalysisView';
import { requestPersistence } from './lib/db';

const NAV = [
  { to: '', label: 'Home', icon: House },
  { to: 'play', label: 'Board', icon: Swords },
  { to: 'online', label: 'Online', icon: Wifi },
  { to: 'history', label: 'History', icon: History },
  { to: 'train', label: 'Train', icon: Target },
  { to: 'stats', label: 'Stats', icon: ChartLine },
  { to: 'analysis', label: 'Analysis', icon: Microscope },
  { to: 'settings', label: 'Settings', icon: SettingsIcon },
];

function usePrefersDark() {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

export function App() {
  const { path } = useRoute();
  const settings = useSettings();
  const { session, match } = useActive();
  const prefersDark = usePrefersDark();
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);

  useEffect(() => {
    void requestPersistence();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    const t = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.wood;
    root.style.setProperty('--sq-light', t.light);
    root.style.setProperty('--sq-dark', t.dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1d21' : '#f4f1ea');
  }, [dark, settings.boardTheme]);

  const [page, ...rest] = path;
  const active = page ?? '';
  let view;
  switch (page) {
    case undefined:
      view = <HomeView />;
      break;
    case 'play':
      view = session ? <GameView key={session.id} session={session} /> : <ResumeOrNoGame />;
      break;
    case 'online':
      view = <OnlineView />;
      break;
    case 'join':
      view = <OnlineView joinCode={rest[0]} />;
      break;
    case 'history':
      view = <HistoryView />;
      break;
    case 'review':
      view = <ReviewView key={rest[0]} id={rest[0]} />;
      break;
    case 'train':
      view = <TrainView />;
      break;
    case 'stats':
      view = <StatsView />;
      break;
    case 'analysis':
      view = <AnalysisView />;
      break;
    case 'settings':
      view = <SettingsView />;
      break;
    default:
      view = <HomeView />;
  }

  const playing = session?.status === 'playing';
  const onlineLive = !!match?.session && match.session.status === 'playing';

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('')}>
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
          <span>Chess Studio</span>
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${active === to || (to === 'online' && active === 'join') ? 'on' : ''}`}
              onClick={() => navigate(to)}
              aria-current={active === to ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {to === 'play' && playing && <span className="badge-dot" title="Game in progress" />}
              {to === 'online' && onlineLive && <span className="badge-dot" title="Online game in progress" />}
              {to === 'online' && (match?.unread ?? 0) > 0 && <span className="badge-count">{match!.unread}</span>}
            </button>
          ))}
        </nav>
      </header>
      <main className="main">{view}</main>
    </div>
  );
}

/** Reloading the app on the board screen picks the saved game straight back up. */
function ResumeOrNoGame() {
  const saved = useMemo(() => savedSession(), []);
  useEffect(() => {
    // Guard against StrictMode's double effect creating two sessions.
    if (saved && !getActiveSession()) setActiveSession(GameSession.restore(saved));
  }, [saved]);
  if (saved) return null;
  return (
    <div className="page narrow center">
      <h2>No game on the board</h2>
      <p className="muted">Start a new game from the home screen.</p>
      <button className="primary" onClick={() => navigate('')}>
        New game
      </button>
    </div>
  );
}
