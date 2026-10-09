import type { PairMatch, Point, Rect } from '../types';
import { solveLayout, type Constraint } from './lsq';

export interface ImageBox {
  width: number;
  height: number;
}

export interface VerifyResult {
  ncc: number;
  overlap: number;
  std: number;
}

export interface LayoutOptions {
  minConfidence: number;
  /** Consistency tolerance in original pixels. */
  tolerance: number;
  /** Checks an implied translation pos(b) - pos(a) between two images (ZNCC on the overlap). */
  verify: (a: number, b: number, dx: number, dy: number) => VerifyResult;
  /** Tries to measure a precise translation near an implied one (loop closure). */
  measure?: (a: number, b: number, dx: number, dy: number) => PairMatch | null;
}

export interface GraphLayout {
  positions: (Point | null)[];
  components: number[][];
  main: number[];
  edges: PairMatch[];
}

/** Overlap of two boxes (b at offset d relative to a) relative to the smaller box area. */
export function boxOverlap(A: ImageBox, B: ImageBox, dx: number, dy: number): number {
  const w = Math.min(A.width, B.width + dx) - Math.max(0, dx);
  const h = Math.min(A.height, B.height + dy) - Math.max(0, dy);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(A.width * A.height, B.width * B.height);
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Global layout from the neighbour graph.
 *
 * 1. Verified greedy merging (Kruskal-like): edges are processed by descending confidence. An edge that
 *    connects two components is only accepted if all other image pairs that would overlap after the merge
 *    agree with it (ZNCC check of the implied translation). This rejects false matches caused by repetitive
 *    map patterns. Edges inside a component must be consistent with the current layout (loop check).
 * 2. Weighted least squares over all accepted edges per component minimises the global error.
 * 3. Loop closure: overlapping pairs without a measured edge are measured near their implied offset and
 *    added as additional constraints; edges with large residuals are dropped and the system re-solved.
 */
export function computeLayout(boxes: ImageBox[], matches: PairMatch[], opts: LayoutOptions): GraphLayout {
  const n = boxes.length;
  const comp = Array.from({ length: n }, (_, i) => i);
  const members = new Map<number, number[]>(comp.map((c) => [c, [c]]));
  const pos: Point[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const edges = matches.map((m) => ({ ...m, status: undefined as PairMatch['status'], rejectReason: undefined as string | undefined }));
  const sorted = [...edges].sort((a, b) => b.confidence - a.confidence);
  const tol = opts.tolerance;

  for (const e of sorted) {
    if (e.confidence < opts.minConfidence) {
      e.status = 'rejected';
      e.rejectReason = 'Zu geringe Konfidenz';
      continue;
    }
    const a = e.imageA;
    const b = e.imageB;
    const ca = comp[a];
    const cb = comp[b];
    if (ca === cb) {
      const rx = pos[b].x - pos[a].x - e.dx;
      const ry = pos[b].y - pos[a].y - e.dy;
      if (Math.hypot(rx, ry) <= tol * 2) e.status = 'loop';
      else {
        e.status = 'rejected';
        e.rejectReason = 'Widerspricht dem übrigen Layout';
      }
      continue;
    }
    const sx = pos[a].x + e.dx - pos[b].x;
    const sy = pos[a].y + e.dy - pos[b].y;
    let conflicts = 0;
    let support = 0;
    for (const x of members.get(ca)!) {
      for (const y of members.get(cb)!) {
        if (x === a && y === b) continue;
        const idx = pos[y].x + sx - pos[x].x;
        const idy = pos[y].y + sy - pos[x].y;
        const ov = boxOverlap(boxes[x], boxes[y], idx, idy);
        if (ov < 0.08) continue;
        const v = opts.verify(x, y, idx, idy);
        if (v.std < 3) continue;
        if (v.ncc < 0.5) conflicts++;
        else if (v.ncc > 0.75) support++;
      }
    }
    if (conflicts > 0 && conflicts >= support) {
      e.status = 'rejected';
      e.rejectReason = 'Überlagert andere Screenshots inkonsistent (vermutlich Fehlzuordnung)';
      continue;
    }
    // Merge cb into ca.
    const mb = members.get(cb)!;
    for (const y of mb) {
      pos[y] = { x: pos[y].x + sx, y: pos[y].y + sy };
      comp[y] = ca;
    }
    members.get(ca)!.push(...mb);
    members.delete(cb);
    e.status = 'accepted';
  }

  const components = [...members.values()].sort((p, q) => q.length - p.length);
  const has = new Set(edges.filter((e) => e.status !== 'rejected').map((e) => edgeKey(e.imageA, e.imageB)));

  const solve = (nodes: number[]) => {
    if (nodes.length < 2) return;
    const set = new Set(nodes);
    const cons: Constraint[] = edges
      .filter((e) => (e.status === 'accepted' || e.status === 'loop') && set.has(e.imageA))
      .map((e) => ({ a: e.imageA, b: e.imageB, dx: e.dx, dy: e.dy, weight: 0.05 + e.confidence * e.confidence }));
    const anchor = nodes[0];
    const res = solveLayout(nodes, cons, anchor, pos[anchor]);
    for (const [id, p] of res) pos[id] = p;
  };

  for (const nodes of components) {
    solve(nodes);
    if (nodes.length < 2) continue;
    // Loop closure for overlapping pairs without a measured edge.
    if (opts.measure) {
      let added = 0;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const x = nodes[i];
          const y = nodes[j];
          if (has.has(edgeKey(x, y))) continue;
          const dx = pos[y].x - pos[x].x;
          const dy = pos[y].y - pos[x].y;
          if (boxOverlap(boxes[x], boxes[y], dx, dy) < 0.06) continue;
          const m = opts.measure(x, y, dx, dy);
          has.add(edgeKey(x, y));
          if (!m || m.confidence < opts.minConfidence) continue;
          if (Math.hypot(m.dx - dx, m.dy - dy) > tol * 3) continue;
          edges.push({ ...m, status: 'loop', rejectReason: undefined });
          added++;
        }
      }
      if (added) solve(nodes);
    }
    // Iteratively drop edges that disagree with the solution.
    for (let iter = 0; iter < 3; iter++) {
      let worst: (typeof edges)[number] | null = null;
      let worstRes = 0;
      const set = new Set(nodes);
      for (const e of edges) {
        if ((e.status !== 'accepted' && e.status !== 'loop') || !set.has(e.imageA)) continue;
        const r = Math.hypot(pos[e.imageB].x - pos[e.imageA].x - e.dx, pos[e.imageB].y - pos[e.imageA].y - e.dy);
        if (r > worstRes) {
          worstRes = r;
          worst = e;
        }
      }
      if (!worst || worstRes <= tol * 2 || worst.status === 'accepted') break;
      worst.status = 'rejected';
      worst.rejectReason = 'Großer Restfehler nach globaler Optimierung';
      solve(nodes);
    }
  }

  for (const e of edges) {
    if (e.status === 'accepted' || e.status === 'loop') {
      e.residual = Math.hypot(pos[e.imageB].x - pos[e.imageA].x - e.dx, pos[e.imageB].y - pos[e.imageA].y - e.dy);
    }
  }

  const main = components[0] ?? [];
  const positions: (Point | null)[] = Array.from({ length: n }, () => null);
  for (const id of main) positions[id] = pos[id];
  return { positions, components, main, edges };
}

/** Normalises positions so that the bounding box starts at (0, 0) and returns the bounds. */
export function normalisePositions(positions: (Point | null)[], boxes: ImageBox[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  positions.forEach((p, i) => {
    if (!p) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + boxes[i].width);
    maxY = Math.max(maxY, p.y + boxes[i].height);
  });
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  positions.forEach((p, i) => {
    if (p) positions[i] = { x: p.x - minX, y: p.y - minY };
  });
  return { x: 0, y: 0, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}
