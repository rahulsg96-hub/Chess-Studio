import type { DetailedHTMLProps, HTMLAttributes } from 'react';

// chessground's piece images are styled on a <piece> element.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      piece: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
