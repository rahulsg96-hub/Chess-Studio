# Chess Studio

A chess app to get better at chess and to play friends from a distance. It runs on Windows (as an installed
app) and on Android phones from the same code.

## What it does

**Play**
- Against Stockfish at 12 levels, from about 400 to full engine strength. The home screen suggests moving up or
  down a level based on your recent results.
- Against a friend online, each on their own device. You share a 6-letter code or a link, and the game
  starts.
- Against someone on the same device (pass-and-play), with an optional auto-flip so the board faces whoever
  is to move.
- Chess clocks for both players, from bullet to classical, with increment or a custom time. Low-time warnings
  and the official time-out rules: if the other side can't checkmate, a time-out is a draw.
- Premoves, drag-and-drop or click-click moves, a promotion picker, takebacks, hints, draw offers and
  resigning. You can also abort a game in the first move.
- The opening name is shown live as you play (about 3,800 named lines).
- Online games have chat with quick replies, draw, takeback and rematch offers (colours swap each game), and
  a ping indicator. If a connection drops, it reconnects automatically. If either player closes the app
  mid-game, they can resume it.

**Remember and review**
- Every finished game is saved automatically with its moves, clock times, result and opening.
- History is searchable and filterable, with favourites, notes on any game, PGN export and PGN import (for
  example from lichess or chess.com).
- After each game, Stockfish analyses it in the background. Every move is labelled
  (best / excellent / good / inaccuracy / mistake / blunder) and you get an accuracy % for each side, an
  evaluation graph you can click, "key moments" to jump to, and the line the engine would have played.
- From any position you can open an analysis board (up to 5 engine lines) or continue the game against the
  computer.

**Improve**
- Train: every mistake and blunder you made in an analysed game becomes a puzzle — find the move you missed.
  Solved puzzles come back after 1, 3, 7, 21 and then 60 days so the lessons stick.
- Stats: score by colour, speed, opponent (for example your head-to-head against a friend) and computer level,
  an accuracy trend, blunders per game, your best openings, and streaks.
- An optional live evaluation bar and hints in games against the computer. Both are switched off in online
  games.

**Everything else**
- Works offline once loaded, including the engine. There is no account and nothing to sign up for.
- Light and dark themes, 6 board colours, sounds, and keyboard shortcuts: ← → to step through moves,
  ↑ ↓ to jump to the start or end, F to flip the board.
- You can download a backup of all your games and restore it, for example to move your history from your PC
  to your phone.

## Installing it

The app is a website that installs itself as an app (a "Progressive Web App"). Once installed it opens in
its own window, has its own Start-menu / home-screen icon and works offline.

- **Windows:** open the app's address in Microsoft Edge or Chrome, then click the "Install" icon at the right
  end of the address bar (or ⋯ → Apps → Install Chess Studio). Pin it to the taskbar if you like.
- **Android:** open the address in Chrome, then ⋮ → "Install app" (or "Add to Home screen").
- **iPhone/iPad** also works: open it in Safari, then Share → "Add to Home Screen".

To be installable on a phone and reachable by a friend, the app needs to be hosted at an `https://` address.
The workflow in `.github/workflows/chess.yml` publishes it to GitHub Pages for free when this folder lands
on `main`. This needs Settings → Pages → Source set to "GitHub Actions", and on GitHub's free plan the
repository must be public. Any static host works as well (Cloudflare Pages, Netlify, …): upload the `dist/`
folder that `npm run build` produces.

### Running it on just this PC

Double-click `start-windows.bat` (it needs [Node.js](https://nodejs.org) installed). It builds the app and
opens it at http://localhost:4173, where Edge can install it too.

## Playing your friend online

1. One of you opens **Online → Create game**, picks a time control and gets a code such as `K7QM2X`.
2. Send the code (or the "Copy link" link) to your friend. They open **Online → Join** and type it, or just
   open the link.
3. Play. Both of you need the app open. Moves, chat and offers go directly between the two devices.

## Things to know

- **Your games live on each device.** Games are stored in that browser's storage on that device, so your PC
  and your phone each have their own history. Use Settings → Download/Restore backup to move or combine them.
  Clearing the browser's site data for the app deletes them, so back up now and then.
- **Online play is peer-to-peer.** The free public PeerJS server only introduces the two devices to each
  other. It has no uptime guarantee; if it's ever down, you can run your own and enter it under Settings →
  Advanced. A small share of networks (strict office, hotel or mobile-carrier firewalls) block direct
  connections. Switching one device between Wi-Fi and mobile data usually fixes it.
- **Both players must have the app open.** There's no "make a move, come back tomorrow" mode, because that
  would need an always-on server and accounts.
- **Phones may pause the app in the background.** Android can suspend a backgrounded app, which drops an
  online connection. When you come back it reconnects; while you're away, your clock keeps running.
- **Computer levels are approximate.** The ratings next to each level are rough guides. Low engine levels
  play strong moves mixed with deliberate random ones, which isn't quite how a human beginner plays.
- **Analysis uses the "lite" Stockfish build** (about 7 MB) so the app loads fast and runs on phones. It is
  still far stronger than any human, but deep analysis on a phone is slower and uses battery.
- **Licences.** Stockfish and chessground are GPL-3.0, so if you publish the app, its source must stay
  available under the GPL as well. A public repository does that.

## For developers

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (rules, clocks, PGN, game sessions)
npm run build      # production build in dist/
npm run preview    # serve dist/ at http://localhost:4173
```

The stack is React and TypeScript built with Vite. It uses [chess.js](https://github.com/jhlywa/chess.js) for
rules, [chessground](https://github.com/lichess-org/chessground) for the board,
[stockfish.js](https://github.com/nmrugg/stockfish.js) as the engine (it runs in a Web Worker), IndexedDB
(via `idb`) for storage, [PeerJS](https://peerjs.com) for online play and `vite-plugin-pwa` for offline
support. Opening names come from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
(public domain); `scripts/build-openings.mjs` regenerates `src/lib/openings.json`.

```
src/lib/       game logic: session.ts (a game in progress), engine.ts (Stockfish), analysis.ts,
               net.ts (online play), db.ts (storage), clock.ts, chessutil.ts (PGN, rules helpers)
src/views/     screens: Home, Game, Online, History, Review, Train, Stats, Analysis, Settings
src/components shared pieces: Board, clocks/player bars, move list, eval bar and graph
```
