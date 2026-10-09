import type { Point } from '../types';

export interface Constraint {
  a: number;
  b: number;
  /** Measured pos(b) - pos(a). */
  dx: number;
  dy: number;
  weight: number;
}

/**
 * Weighted least squares for translation-only layouts:
 *   minimise Σ w_e · |p_b − p_a − d_e|²
 * Node `anchor` is fixed at `anchorPos`. Nodes must form a connected graph through the constraints.
 * The normal equations (a weighted graph Laplacian) are solved with a dense Cholesky factorisation,
 * which is plenty fast for the ≤ a few hundred screenshots this app targets.
 */
export function solveLayout(nodes: number[], constraints: Constraint[], anchor: number, anchorPos: Point): Map<number, Point> {
  const index = new Map<number, number>();
  const free = nodes.filter((n) => n !== anchor);
  free.forEach((n, i) => index.set(n, i));
  const k = free.length;
  const result = new Map<number, Point>([[anchor, { ...anchorPos }]]);
  if (k === 0) return result;
  const L = new Float64Array(k * k);
  const bx = new Float64Array(k);
  const by = new Float64Array(k);
  for (const c of constraints) {
    const ia = c.a === anchor ? -1 : (index.get(c.a) ?? -2);
    const ib = c.b === anchor ? -1 : (index.get(c.b) ?? -2);
    if (ia === -2 || ib === -2) continue;
    const w = c.weight;
    // residual r = p_b - p_a - d  →  gradient contributions
    if (ia >= 0) {
      L[ia * k + ia] += w;
      bx[ia] -= w * c.dx;
      by[ia] -= w * c.dy;
    } else {
      // p_a fixed
      bx[ib] += w * anchorPos.x;
      by[ib] += w * anchorPos.y;
    }
    if (ib >= 0) {
      L[ib * k + ib] += w;
      bx[ib] += w * c.dx;
      by[ib] += w * c.dy;
    } else {
      bx[ia] += w * anchorPos.x;
      by[ia] += w * anchorPos.y;
    }
    if (ia >= 0 && ib >= 0) {
      L[ia * k + ib] -= w;
      L[ib * k + ia] -= w;
    }
  }
  // Tiny regularisation keeps the system positive definite even for weakly connected nodes.
  for (let i = 0; i < k; i++) L[i * k + i] += 1e-9;
  cholesky(L, k);
  const x = choleskySolve(L, k, bx);
  const y = choleskySolve(L, k, by);
  free.forEach((n, i) => result.set(n, { x: x[i], y: y[i] }));
  return result;
}

function cholesky(A: Float64Array, n: number): void {
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= A[j * n + k] * A[j * n + k];
    const d = Math.sqrt(Math.max(s, 1e-12));
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = A[i * n + j];
      for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = t / d;
    }
  }
}

function choleskySolve(Lf: Float64Array, n: number, b: Float64Array): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= Lf[i * n + k] * y[k];
    y[i] = s / Lf[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= Lf[k * n + i] * x[k];
    x[i] = s / Lf[i * n + i];
  }
  return x;
}
