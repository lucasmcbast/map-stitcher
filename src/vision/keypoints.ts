import type { Keypoint, Point } from '../types';
import type { Level } from './zncc';

/** Keypoints plus 8×8 zero-mean/unit-norm patch descriptors (64 floats per keypoint). */
export interface FeatureSet {
  keypoints: Keypoint[];
  descriptors: Float32Array;
}

const DESC = 64;
const MARGIN = 9;

/** Harris corner detection with grid-based non-maximum suppression for an even spatial distribution. */
export function detectFeatures(level: Level, maxKeypoints = 300, cell = 24): FeatureSet {
  const { image, mask } = level;
  const w = image.width;
  const h = image.height;
  const d = image.data;
  const n = w * h;
  const ixx = new Float32Array(n);
  const iyy = new Float32Array(n);
  const ixy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (d[i + 1] - d[i - 1]) * 0.5;
      const gy = (d[i + w] - d[i - w]) * 0.5;
      ixx[i] = gx * gx;
      iyy[i] = gy * gy;
      ixy[i] = gx * gy;
    }
  }
  boxBlur(ixx, w, h, 2);
  boxBlur(iyy, w, h, 2);
  boxBlur(ixy, w, h, 2);

  const cellsX = Math.ceil(w / cell);
  const cellsY = Math.ceil(h / cell);
  const best: Keypoint[] = [];
  let maxR = 0;
  const candidates: (Keypoint | null)[] = new Array(cellsX * cellsY).fill(null);
  for (let y = MARGIN; y < h - MARGIN; y++) {
    for (let x = MARGIN; x < w - MARGIN; x++) {
      const i = y * w + x;
      if (mask && mask.data[i] < 128) continue;
      const a = ixx[i];
      const b = iyy[i];
      const c = ixy[i];
      const r = a * b - c * c - 0.04 * (a + b) * (a + b);
      if (r <= 0) continue;
      if (r > maxR) maxR = r;
      const ci = Math.floor(y / cell) * cellsX + Math.floor(x / cell);
      const cur = candidates[ci];
      if (!cur || r > cur.score) candidates[ci] = { x, y, score: r };
    }
  }
  for (const c of candidates) if (c && c.score > maxR * 0.005) best.push(c);
  best.sort((a, b) => b.score - a.score);
  const keypoints = best.slice(0, maxKeypoints);
  const descriptors = new Float32Array(keypoints.length * DESC);
  keypoints.forEach((k, idx) => describe(level, k.x, k.y, descriptors, idx * DESC));
  return { keypoints, descriptors };
}

function boxBlur(a: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const o = y * w;
    for (let x = -r; x <= r; x++) acc += a[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc;
      acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = acc;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/** 16×16 patch averaged in 2×2 blocks → 8×8, normalised to zero mean and unit length. */
function describe(level: Level, cx: number, cy: number, out: Float32Array, o: number): void {
  const { image } = level;
  const w = image.width;
  const d = image.data;
  let k = 0;
  let sum = 0;
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      const x = cx - 8 + bx * 2;
      const y = cy - 8 + by * 2;
      const i = y * w + x;
      const v = d[i] + d[i + 1] + d[i + w] + d[i + w + 1];
      out[o + k++] = v;
      sum += v;
    }
  }
  const mean = sum / DESC;
  let norm = 0;
  for (let i = 0; i < DESC; i++) {
    out[o + i] -= mean;
    norm += out[o + i] * out[o + i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DESC; i++) out[o + i] /= norm;
}

export interface FeatureMatchResult {
  matches: { a: Point; b: Point; inlier: boolean }[];
  numberOfMatches: number;
  inliers: number;
  inlierRatio: number;
  /** Median translation of all matches (robust feature-only estimate) or null. */
  median: Point | null;
}

/**
 * Descriptor matching restricted to the overlap implied by the translation hypothesis (dx, dy)
 * (B(x) ≙ A(x + d)). Translation vectors d_i = a_i - b_i are compared to the hypothesis; matches within
 * `tol` px count as inliers. This is a RANSAC-like consensus check of a translation-only model.
 */
export function matchFeatures(
  fa: FeatureSet,
  fb: FeatureSet,
  dims: { wA: number; hA: number; wB: number; hB: number },
  dx: number,
  dy: number,
  tol = 2,
  slack = 12,
): FeatureMatchResult {
  const inA: number[] = [];
  const inB: number[] = [];
  fa.keypoints.forEach((k, i) => {
    const bx = k.x - dx;
    const by = k.y - dy;
    if (bx > -slack && by > -slack && bx < dims.wB + slack && by < dims.hB + slack) inA.push(i);
  });
  fb.keypoints.forEach((k, i) => {
    const ax = k.x + dx;
    const ay = k.y + dy;
    if (ax > -slack && ay > -slack && ax < dims.wA + slack && ay < dims.hA + slack) inB.push(i);
  });
  const matches: { a: Point; b: Point; inlier: boolean }[] = [];
  const vx: number[] = [];
  const vy: number[] = [];
  for (const ia of inA) {
    let best = -2;
    let second = -2;
    let bestJ = -1;
    const oa = ia * DESC;
    for (const ib of inB) {
      const ob = ib * DESC;
      let dot = 0;
      for (let k = 0; k < DESC; k++) dot += fa.descriptors[oa + k] * fb.descriptors[ob + k];
      if (dot > best) {
        second = best;
        best = dot;
        bestJ = ib;
      } else if (dot > second) second = dot;
    }
    if (bestJ < 0 || best < 0.75) continue;
    const d1 = Math.sqrt(Math.max(0, 2 - 2 * best));
    const d2 = Math.sqrt(Math.max(0, 2 - 2 * second));
    if (second > -2 && d1 > 0.85 * d2) continue;
    const a = fa.keypoints[ia];
    const b = fb.keypoints[bestJ];
    const tx = a.x - b.x;
    const ty = a.y - b.y;
    vx.push(tx);
    vy.push(ty);
    matches.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, inlier: Math.hypot(tx - dx, ty - dy) <= tol });
  }
  const inliers = matches.filter((m) => m.inlier).length;
  const median = matches.length ? { x: med(vx), y: med(vy) } : null;
  return {
    matches,
    numberOfMatches: matches.length,
    inliers,
    inlierRatio: matches.length ? inliers / matches.length : 0,
    median,
  };
}

/**
 * Hypothesis-free translation voting: matches all descriptors of A against all of B and clusters the
 * translation vectors. Used as fallback for images phase correlation could not place.
 */
export function voteTranslation(fa: FeatureSet, fb: FeatureSet, bin = 4): { dx: number; dy: number; votes: number }[] {
  const votes = new Map<string, { sx: number; sy: number; c: number; n: number }>();
  for (let ia = 0; ia < fa.keypoints.length; ia++) {
    let best = -2;
    let second = -2;
    let bestJ = -1;
    const oa = ia * DESC;
    for (let ib = 0; ib < fb.keypoints.length; ib++) {
      const ob = ib * DESC;
      let dot = 0;
      for (let k = 0; k < DESC; k++) dot += fa.descriptors[oa + k] * fb.descriptors[ob + k];
      if (dot > best) {
        second = best;
        best = dot;
        bestJ = ib;
      } else if (dot > second) second = dot;
    }
    if (bestJ < 0 || best < 0.8) continue;
    if (Math.sqrt(2 - 2 * best) > 0.9 * Math.sqrt(Math.max(0, 2 - 2 * second))) continue;
    const tx = fa.keypoints[ia].x - fb.keypoints[bestJ].x;
    const ty = fa.keypoints[ia].y - fb.keypoints[bestJ].y;
    // Vote into the bin and its neighbours so cluster borders do not split votes.
    const bx = Math.round(tx / bin);
    const by = Math.round(ty / bin);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const key = `${bx + ox},${by + oy}`;
        const v = votes.get(key) ?? { sx: 0, sy: 0, c: 0, n: 0 };
        if (ox === 0 && oy === 0) {
          v.sx += tx;
          v.sy += ty;
          v.c++;
        }
        v.n += ox === 0 && oy === 0 ? 1 : 0.5;
        votes.set(key, v);
      }
    }
  }
  return [...votes.entries()]
    .map(([key, v]) => {
      const [bx, by] = key.split(',').map(Number);
      return { dx: v.c ? v.sx / v.c : bx * bin, dy: v.c ? v.sy / v.c : by * bin, votes: v.n };
    })
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 5);
}

function med(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
