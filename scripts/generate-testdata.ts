/**
 * Generates the synthetic sample data set: a procedural map cut into 4 × 5 overlapping "screenshots"
 * (30 % overlap, hand-panning jitter, fixed browser UI), saved in random order as PNGs.
 *
 *   npm run generate:testdata
 *
 * Output: public/samples/*.png, manifest.json (file list for the app) and truth.json (ground truth).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PngStreamEncoder } from '../src/export/png';
import { addFixedUi, cutTiles, generateMap, mapSizeFor, shuffle } from '../tests/fixtures/syntheticMap';

const OUT = join(process.cwd(), 'public', 'samples');
const cut = { rows: 4, cols: 5, tileWidth: 1280, tileHeight: 800, overlap: 0.3, jitter: 14, seed: 2026 };

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const size = mapSizeFor(cut);
  const map = generateMap({ ...size, seed: 2026 });
  const tiles = cutTiles(map, cut);
  const order = shuffle(
    tiles.map((_, i) => i),
    77,
  );
  const files: string[] = [];
  const truth: { file: string; x: number; y: number; row: number; col: number }[] = [];
  for (let k = 0; k < order.length; k++) {
    const t = tiles[order[k]];
    addFixedUi(t.image);
    const enc = new PngStreamEncoder(t.image.width, t.image.height);
    await enc.writeRows(t.image.data, t.image.height);
    const blob = await enc.finish();
    const name = `screenshot-${String(k + 1).padStart(2, '0')}.png`;
    writeFileSync(join(OUT, name), Buffer.from(await blob.arrayBuffer()));
    files.push(name);
    truth.push({ file: name, x: t.x, y: t.y, row: t.row, col: t.col });
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ files }, null, 2));
  writeFileSync(
    join(OUT, 'truth.json'),
    JSON.stringify({ description: 'Ground truth: top-left position of every screenshot in the source map', map: size, ...cut, tiles: truth }, null, 2),
  );
  console.log(`${files.length} Screenshots (${cut.tileWidth} × ${cut.tileHeight}) in ${OUT}`);
}

void main();
