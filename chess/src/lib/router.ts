import { useSyncExternalStore } from 'react';

/** Hash-based routes (#/history, #/review/<id>, …) so the app works from any folder. */
function current() {
  return window.location.hash.replace(/^#\/?/, '');
}

export function useRoute(): { path: string[]; query: URLSearchParams } {
  const hash = useSyncExternalStore(
    (fn) => {
      window.addEventListener('hashchange', fn);
      return () => window.removeEventListener('hashchange', fn);
    },
    current,
  );
  const [p, q = ''] = hash.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function navigate(to: string) {
  const target = `#/${to.replace(/^\/+/, '')}`;
  if (window.location.hash !== target) window.location.hash = target;
}
