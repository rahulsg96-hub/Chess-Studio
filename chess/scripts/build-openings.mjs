// Builds src/lib/openings.json from the lichess chess-openings TSV files
// (public domain, https://github.com/lichess-org/chess-openings).
// Usage: node scripts/build-openings.mjs <dir containing a.tsv … e.tsv>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const dir = process.argv[2];
if (!dir) throw new Error('Pass the directory holding a.tsv … e.tsv');
const out = {};
for (const letter of 'abcde') {
  const rows = readFileSync(join(dir, `${letter}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    chess.loadPgn(pgn);
    // Key on placement, side to move and castling rights so transpositions match.
    const key = chess.fen().split(' ').slice(0, 3).join(' ');
    out[key] = [eco, name];
  }
}
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'openings.json');
writeFileSync(target, JSON.stringify(out));
console.log(`${Object.keys(out).length} openings written to ${target}`);
