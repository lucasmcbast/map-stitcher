import type { GrayImage } from '../types';

export interface NccResult {
  /** Zero-normalised cross-correlation in [-1, 1]. */
  ncc: number;
  /** Number of compared pixels. */
  count: number;
  /** Overlap area relative to the smaller image (0..1). */
  overlap: number;
  /** Overlap width / height relative to image width / height. */
  overlapW: number;
  overlapH: number;
  /** Smaller of the two standard deviations inside the overlap (texture measure). */
  std: number;
}

export interface Level {
  image: GrayImage;
  mask: GrayImage | null;
}

const EMPTY: NccResult = { ncc: -1, count: 0, overlap: 0, overlapW: 0, overlapH: 0, std: 0 };

/**
 * ZNCC between A and B with B shifted by (dx, dy) relative to A, i.e. B(x, y) ≙ A(x + dx, y + dy).
 * Pixels masked out in either image are ignored. `stride` subsamples the overlap for speed.
 */
export function nccAt(A: Level, B: Level, dx: number, dy: number, stride = 1): NccResult {
  const a = A.image;
  const b = B.image;
  dx = Math.round(dx);
  dy = Math.round(dy);
  const x0 = Math.max(0, dx);
  const y0 = Math.max(0, dy);
  const x1 = Math.min(a.width, b.width + dx);
  const y1 = Math.min(a.height, b.height + dy);
  if (x1 - x0 < 2 || y1 - y0 < 2) return EMPTY;
  const ad = a.data;
  const bd = b.data;
  const am = A.mask?.data;
  const bm = B.mask?.data;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  let n = 0;
  for (let y = y0; y < y1; y += stride) {
    const ra = y * a.width;
    const rb = (y - dy) * b.width - dx;
    for (let x = x0; x < x1; x += stride) {
      const ia = ra + x;
      const ib = rb + x;
      if ((am && am[ia] < 128) || (bm && bm[ib] < 128)) continue;
      const va = ad[ia];
      const vb = bd[ib];
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
      n++;
    }
  }
  const area = (x1 - x0) * (y1 - y0);
  const overlap = area / Math.min(a.width * a.height, b.width * b.height);
  const overlapW = (x1 - x0) / Math.min(a.width, b.width);
  const overlapH = (y1 - y0) / Math.min(a.height, b.height);
  if (n < 16) return { ...EMPTY, overlap, overlapW, overlapH };
  const ma = sa / n;
  const mb = sb / n;
  const va = saa / n - ma * ma;
  const vb = sbb / n - mb * mb;
  const cov = sab / n - ma * mb;
  const std = Math.sqrt(Math.max(0, Math.min(va, vb)));
  // Two flat, identical areas are a perfect (if uninformative) match; std reports how informative it is.
  if (va < 1e-6 || vb < 1e-6) {
    return { ncc: va < 1e-6 && vb < 1e-6 && Math.abs(ma - mb) < 2 ? 1 : 0, count: n, overlap, overlapW, overlapH, std };
  }
  return { ncc: cov / Math.sqrt(va * vb), count: n, overlap, overlapW, overlapH, std };
}

export interface RefineResult extends NccResult {
  dx: number;
  dy: number;
}

/**
 * Searches the integer translation with the highest ZNCC around (dx0, dy0) (window search followed by
 * hill climbing) and refines it to sub-pixel precision with a parabolic fit.
 */
export function refineTranslation(
  A: Level,
  B: Level,
  dx0: number,
  dy0: number,
  radius = 2,
  stride = 1,
  minOverlap = 0.02,
): RefineResult {
  const cache = new Map<number, NccResult>();
  const key = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
  const evalAt = (x: number, y: number): NccResult => {
    const k = key(x, y);
    let r = cache.get(k);
    if (!r) {
      r = nccAt(A, B, x, y, stride);
      if (r.overlap < minOverlap) r = { ...r, ncc: -1 };
      cache.set(k, r);
    }
    return r;
  };
  const cx = Math.round(dx0);
  const cy = Math.round(dy0);
  let bx = cx;
  let by = cy;
  let best = evalAt(cx, cy);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const r = evalAt(x, y);
      if (r.ncc > best.ncc) {
        best = r;
        bx = x;
        by = y;
      }
    }
  }
  // Hill climbing in case the optimum lies outside the window.
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let y = by - 1; y <= by + 1; y++) {
      for (let x = bx - 1; x <= bx + 1; x++) {
        const r = evalAt(x, y);
        if (r.ncc > best.ncc + 1e-9) {
          best = r;
          bx = x;
          by = y;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  const fit = (m: number, c: number, p: number) => {
    const den = m - 2 * c + p;
    if (den >= 0) return 0;
    const off = (0.5 * (m - p)) / den;
    return Math.max(-0.5, Math.min(0.5, off));
  };
  const sx = fit(evalAt(bx - 1, by).ncc, best.ncc, evalAt(bx + 1, by).ncc);
  const sy = fit(evalAt(bx, by - 1).ncc, best.ncc, evalAt(bx, by + 1).ncc);
  return { ...best, dx: bx + sx, dy: by + sy };
}
