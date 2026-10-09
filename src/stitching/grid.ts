import type { GridInfo, Point } from '../types';
import type { ImageBox } from './layout';

/** Groups 1D values into clusters separated by gaps larger than `gap`. Returns cluster index per value. */
function cluster1d(values: number[], gap: number): { assign: number[]; centers: number[] } {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const assign = new Array<number>(values.length).fill(0);
  const centers: number[] = [];
  let cur: number[] = [];
  let c = 0;
  order.forEach(([v, i], k) => {
    if (k > 0 && v - order[k - 1][0] > gap) {
      centers.push(cur.reduce((s, x) => s + x, 0) / cur.length);
      cur = [];
      c++;
    }
    cur.push(v);
    assign[i] = c;
  });
  if (cur.length) centers.push(cur.reduce((s, x) => s + x, 0) / cur.length);
  return { assign, centers };
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * Detects a row/column capture raster in the placed screenshots. Small deviations (hand panned maps)
 * are tolerated: positions are clustered with a gap of 30 % of the screenshot size.
 * Returns null when the layout is not grid-like (e.g. several images per cell).
 */
export function detectGrid(ids: number[], positions: (Point | null)[], boxes: ImageBox[]): GridInfo | null {
  const placed = ids.filter((i) => positions[i]);
  if (placed.length < 2) return null;
  const w = median(placed.map((i) => boxes[i].width));
  const h = median(placed.map((i) => boxes[i].height));
  const ys = cluster1d(placed.map((i) => positions[i]!.y), h * 0.3);
  const xs = cluster1d(placed.map((i) => positions[i]!.x), w * 0.3);
  const rows = ys.centers.length;
  const cols = xs.centers.length;
  const cells = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  for (let k = 0; k < placed.length; k++) {
    const r = ys.assign[k];
    const c = xs.assign[k];
    if (cells[r][c] !== -1) return null;
    cells[r][c] = placed[k];
  }
  if (placed.length < rows * cols * 0.6) return null;
  const stepX = cols > 1 ? median(xs.centers.slice(1).map((v, i) => v - xs.centers[i])) : 0;
  const stepY = rows > 1 ? median(ys.centers.slice(1).map((v, i) => v - ys.centers[i])) : 0;
  return { rows, cols, cells, stepX, stepY };
}

/** Grid neighbour pairs (right and down) of a detected grid. */
export function gridNeighbours(grid: GridInfo): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const id = grid.cells[r][c];
      if (id < 0) continue;
      if (c + 1 < grid.cols && grid.cells[r][c + 1] >= 0) out.push([id, grid.cells[r][c + 1]]);
      if (r + 1 < grid.rows && grid.cells[r + 1][c] >= 0) out.push([id, grid.cells[r + 1][c]]);
    }
  }
  return out;
}
