import { describe, expect, it } from 'vitest';
import { addFixedUi, cutTiles, generateMap, mapSizeFor, mulberry32, shuffle, type CutOptions, type Raster } from './fixtures/syntheticMap';
import { layoutError, stitchRasters } from './fixtures/harness';

const TILE = { tileWidth: 1280, tileHeight: 800 };

/** Independent per-pixel noise per screenshot (simulates lossy JPEG screenshots). */
function addNoise(im: Raster, amp: number, seed: number) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < im.data.length; i += 4) {
    const n = (rnd() * 2 - 1) * amp;
    im.data[i] += n;
    im.data[i + 1] += n;
    im.data[i + 2] += n;
  }
}

async function scenario(
  cut: CutOptions,
  opts: { seed?: number; drop?: number[]; foreign?: boolean; ui?: boolean; noise?: number; workingSize?: number } = {},
) {
  const size = mapSizeFor(cut);
  const map = generateMap({ ...size, seed: opts.seed ?? 7 });
  let tiles = cutTiles(map, cut);
  if (opts.drop) tiles = tiles.filter((_, i) => !opts.drop!.includes(i));
  const order = shuffle(
    tiles.map((_, i) => i),
    opts.seed ?? 99,
  );
  const shuffled = order.map((i) => tiles[i]);
  const images = shuffled.map((t) => t.image);
  if (opts.ui) images.forEach((im) => addFixedUi(im));
  if (opts.noise) images.forEach((im, k) => addNoise(im, opts.noise!, 1000 + k));
  let foreignIndex = -1;
  if (opts.foreign) {
    const other = generateMap({ width: cut.tileWidth, height: cut.tileHeight, seed: 4242 });
    if (opts.ui) addFixedUi(other);
    foreignIndex = images.length;
    images.push(other);
  }
  const t0 = performance.now();
  const res = await stitchRasters(images, {
    autoFixedUi: opts.ui,
    settings: opts.workingSize ? { workingSize: opts.workingSize } : undefined,
  });
  const ms = performance.now() - t0;
  const truth = shuffled.map((t) => ({ x: t.x + (res.crop?.x ?? 0), y: t.y + (res.crop?.y ?? 0) }));
  const ids = shuffled.map((_, i) => i);
  return { ...res, truth, ids, foreignIndex, ms, shuffled };
}

describe('translation-only stitching of synthetic map screenshots', () => {
  it('reconstructs a shuffled 4 × 5 grid with 30 % overlap (main success criterion)', async () => {
    const s = await scenario({ rows: 4, cols: 5, ...TILE, overlap: 0.3, jitter: 12, seed: 3 });
    expect(s.layout.placed.length).toBe(20);
    expect(s.layout.unmatched).toEqual([]);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
    expect(s.layout.grid?.rows).toBe(4);
    expect(s.layout.grid?.cols).toBe(5);
    // The grid must contain the tiles in their original row/column.
    for (const [i, t] of s.shuffled.entries()) {
      expect(s.layout.grid!.cells[t.row][t.col]).toBe(i);
    }
    expect(s.layout.confidence).toBeGreaterThan(0.8);
    console.log(`4×5 grid: ${s.ms.toFixed(0)} ms, confidence ${s.layout.confidence.toFixed(3)}`);
  });

  it('handles a single horizontal row', async () => {
    const s = await scenario({ rows: 1, cols: 6, ...TILE, overlap: 0.3, jitter: 6 }, { seed: 11 });
    expect(s.layout.placed.length).toBe(6);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it('handles a single vertical column', async () => {
    const s = await scenario({ rows: 6, cols: 1, ...TILE, overlap: 0.3, jitter: 6 }, { seed: 12 });
    expect(s.layout.placed.length).toBe(6);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it('works with only 20 % overlap', async () => {
    const s = await scenario({ rows: 3, cols: 4, ...TILE, overlap: 0.2, jitter: 8 }, { seed: 21 });
    expect(s.layout.placed.length).toBe(12);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it('works with 40 % overlap', async () => {
    const s = await scenario({ rows: 3, cols: 4, ...TILE, overlap: 0.4, jitter: 8 }, { seed: 22 });
    expect(s.layout.placed.length).toBe(12);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it('tolerates a missing screenshot inside the grid', async () => {
    const s = await scenario({ rows: 3, cols: 4, ...TILE, overlap: 0.3, jitter: 8 }, { seed: 31, drop: [5] });
    expect(s.layout.placed.length).toBe(11);
    expect(s.layout.unmatched).toEqual([]);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it('does not place a screenshot from a different map', async () => {
    const s = await scenario({ rows: 3, cols: 3, ...TILE, overlap: 0.3, jitter: 8 }, { seed: 41, foreign: true });
    expect(s.layout.unmatched).toEqual([s.foreignIndex]);
    expect(s.layout.positions[s.foreignIndex]).toBeNull();
    expect(s.layout.placed.length).toBe(9);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
    expect(s.layout.warnings[0]).toContain(`Screenshot ${s.foreignIndex + 1}`);
  });

  it('ignores fixed browser UI (auto detection + crop)', async () => {
    const s = await scenario({ rows: 3, cols: 4, ...TILE, overlap: 0.3, jitter: 8 }, { seed: 51, ui: true });
    expect(s.crop).not.toBeNull();
    expect(s.crop!.y).toBeGreaterThanOrEqual(50);
    expect(s.layout.placed.length).toBe(12);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it.each([101, 202, 303, 404])('reconstructs shuffled 4 × 5 grids for other maps (seed %i)', async (seed) => {
    const s = await scenario({ rows: 4, cols: 5, ...TILE, overlap: 0.3, jitter: 15, seed }, { seed });
    expect(s.layout.placed.length).toBe(20);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it('is robust against compression-like noise', async () => {
    const s = await scenario({ rows: 3, cols: 4, ...TILE, overlap: 0.25, jitter: 8 }, { seed: 61, noise: 8 });
    expect(s.layout.placed.length).toBe(12);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
  });

  it('scales to larger sets (6 × 8 = 48 screenshots)', async () => {
    const s = await scenario({ rows: 6, cols: 8, tileWidth: 960, tileHeight: 600, overlap: 0.3, jitter: 10 }, { seed: 71 });
    expect(s.layout.placed.length).toBe(48);
    expect(layoutError(s.layout, s.truth, s.ids)).toBeLessThanOrEqual(1);
    console.log(`6×8 grid: ${s.ms.toFixed(0)} ms`);
  });
});
