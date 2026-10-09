import { describe, expect, it } from 'vitest';
import { composite } from '../src/export/compositor';
import { PngStreamEncoder } from '../src/export/png';
import { ZipWriter } from '../src/export/zip';
import { solveLayout } from '../src/stitching/lsq';
import { fft2d } from '../src/vision/fft';
import { decodePng } from './fixtures/png';

describe('export', () => {
  it('streams a valid PNG strip by strip', async () => {
    const w = 37;
    const h = 23;
    const img = new Uint8Array(w * h * 4);
    for (let i = 0; i < img.length; i++) img[i] = (i * 7919) % 251;
    const enc = new PngStreamEncoder(w, h);
    await enc.writeRows(img.subarray(0, w * 4 * 10), 10);
    await enc.writeRows(img.subarray(w * 4 * 10), 13);
    const blob = await enc.finish();
    const dec = decodePng(new Uint8Array(await blob.arrayBuffer()));
    expect(dec.width).toBe(w);
    expect(dec.height).toBe(h);
    expect(Buffer.from(dec.data).equals(Buffer.from(img))).toBe(true);
  });

  it('writes a readable ZIP archive', async () => {
    const zip = new ZipWriter();
    await zip.add('a.txt', new TextEncoder().encode('hallo'));
    await zip.add('tiles/b.bin', new Uint8Array([1, 2, 3]));
    const buf = new Uint8Array(await zip.finish().arrayBuffer());
    const v = new DataView(buf.buffer);
    const eocd = buf.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
    const cdOffset = v.getUint32(eocd + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(buf.subarray(30, 35))).toBe('a.txt');
    expect(new TextDecoder().decode(buf.subarray(35, 40))).toBe('hallo');
  });

  it('hard cut takes each pixel from exactly one screenshot, feather blends', () => {
    const mk = (w: number, h: number, v: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
    const sources = [
      { x: 0, y: 0, image: mk(10, 4, 100) },
      { x: 6, y: 0, image: mk(10, 4, 200) },
    ];
    const hard = composite({ x: 0, y: 0, width: 16, height: 4 }, sources, 'hard');
    const row = Array.from({ length: 16 }, (_, x) => hard.data[(1 * 16 + x) * 4]);
    expect(new Set(row)).toEqual(new Set([100, 200]));
    expect(row[0]).toBe(100);
    expect(row[15]).toBe(200);
    const feather = composite({ x: 0, y: 0, width: 16, height: 4 }, sources, 'feather');
    const mid = feather.data[(1 * 16 + 8) * 4];
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(200);
  });
});

describe('math', () => {
  it('2D FFT round trip', () => {
    const w = 16;
    const h = 8;
    const re = Float64Array.from({ length: w * h }, (_, i) => Math.sin(i));
    const im = new Float64Array(w * h);
    const orig = re.slice();
    fft2d(re, im, w, h);
    fft2d(re, im, w, h, true);
    for (let i = 0; i < re.length; i++) expect(re[i]).toBeCloseTo(orig[i], 9);
  });

  it('least squares distributes loop errors', () => {
    // Triangle with inconsistent measurements: 0→1 = 10, 1→2 = 10, 0→2 = 23 (error 3).
    const sol = solveLayout(
      [0, 1, 2],
      [
        { a: 0, b: 1, dx: 10, dy: 0, weight: 1 },
        { a: 1, b: 2, dx: 10, dy: 0, weight: 1 },
        { a: 0, b: 2, dx: 23, dy: 0, weight: 1 },
      ],
      0,
      { x: 0, y: 0 },
    );
    expect(sol.get(1)!.x).toBeCloseTo(11, 6);
    expect(sol.get(2)!.x).toBeCloseTo(22, 6);
  });
});
