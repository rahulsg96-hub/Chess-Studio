// Copies the Stockfish WebAssembly engine from node_modules into public/engine
// so Vite serves it as a static file. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'engine');
mkdirSync(dest, { recursive: true });
for (const ext of ['js', 'wasm']) {
  copyFileSync(join(src, `stockfish-18-lite-single.${ext}`), join(dest, `stockfish.${ext}`));
}
console.log('Stockfish engine copied to public/engine');
