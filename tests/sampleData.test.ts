import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutError, stitchRasters } from './fixtures/harness';
import { decodePng } from './fixtures/png';
import { Raster } from './fixtures/syntheticMap';

const DIR = join(__dirname, '..', 'public', 'samples');

describe('bundled sample data set (public/samples)', () => {
  it('reconstructs the 20 shuffled PNG screenshots exactly', async () => {
    const truth = JSON.parse(readFileSync(join(DIR, 'truth.json'), 'utf8'));
    const { files } = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { files: string[] };
    expect(files.length).toBe(20);
    const images = files.map((f) => {
      const png = decodePng(new Uint8Array(readFileSync(join(DIR, f))));
      const r = new Raster(png.width, png.height);
      r.data.set(png.data);
      return r;
    });
    const res = await stitchRasters(images, { autoFixedUi: true });
    expect(res.crop?.y).toBeGreaterThanOrEqual(50); // header bar detected and cropped
    expect(res.layout.placed.length).toBe(20);
    const pos = files.map((f) => truth.tiles.find((t: { file: string }) => t.file === f));
    expect(layoutError(res.layout, pos, files.map((_, i) => i))).toBeLessThanOrEqual(1);
    expect(res.layout.grid?.rows).toBe(4);
    expect(res.layout.grid?.cols).toBe(5);
    for (const [i, t] of pos.entries()) expect(res.layout.grid!.cells[t.row][t.col]).toBe(i);
  });
});
