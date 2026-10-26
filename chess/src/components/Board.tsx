import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { Color } from '../lib/types';
import { useSettings } from '../lib/settings';

export interface BoardProps {
  fen: string;
  orientation: Color;
  turnColor?: Color;
  movableColor?: Color | 'both';
  dests?: Map<Key, Key[]>;
  lastMove?: [Key, Key];
  check?: boolean;
  viewOnly?: boolean;
  premoves?: boolean;
  shapes?: DrawShape[];
  onMove?: (from: Key, to: Key) => void;
  onReady?: (api: Api) => void;
}

/** React wrapper around chessground, the lichess board. */
export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMove = useRef(props.onMove);
  onMove.current = props.onMove;
  const settings = useSettings();

  const config = (): Config => ({
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turnColor,
    lastMove: props.lastMove,
    check: props.check ?? false,
    viewOnly: props.viewOnly ?? false,
    coordinates: settings.showCoords,
    animation: { enabled: settings.animation, duration: 180 },
    highlight: { lastMove: true, check: true },
    movable: {
      free: false,
      color: props.viewOnly ? undefined : props.movableColor,
      dests: props.dests ?? new Map(),
      showDests: settings.showLegalMoves,
      events: { after: (from, to) => onMove.current?.(from, to) },
    },
    premovable: { enabled: (props.premoves ?? false) && settings.premoves },
    draggable: { showGhost: true },
    drawable: {
      enabled: true,
      visible: true,
      autoShapes: props.shapes ?? [],
    },
  });

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, config());
    props.onReady?.(api.current);
    return () => {
      api.current?.destroy();
      api.current = null;
    };
    // Created once; later prop changes go through `set` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only push changes to the board when something it shows actually changed, so
  // unrelated re-renders don't wipe arrows the user has drawn.
  const signature = JSON.stringify([
    props.fen,
    props.orientation,
    props.turnColor,
    props.lastMove,
    props.check,
    props.viewOnly,
    props.movableColor,
    props.premoves,
    props.shapes,
    settings.showCoords,
    settings.animation,
    settings.showLegalMoves,
    settings.premoves,
  ]);
  const lastSig = useRef('');
  useEffect(() => {
    if (!api.current || signature === lastSig.current) return;
    const fenChanged = JSON.parse(lastSig.current || '[]')[0] !== props.fen;
    lastSig.current = signature;
    const cfg = config();
    if (!fenChanged) {
      // Keep user-drawn shapes when only the overlays changed.
      delete cfg.fen;
    }
    api.current.set(cfg);
  });

  return <div ref={el} className="cg-wrap board" />;
}
