/**
 * Procedural "digital map" generator for tests and the bundled sample data set.
 * Produces streets with casings, a street grid (repetitive pattern), rivers, parks, water, building blocks,
 * hatched/dotted areas and text labels rendered with a tiny bitmap font. Fully deterministic per seed.
 */
import type { RgbaImage } from '../../src/types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = [number, number, number];

export class Raster implements RgbaImage {
  data: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
    bg: RGB = [242, 239, 233],
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 4] = bg[0];
      this.data[i * 4 + 1] = bg[1];
      this.data[i * 4 + 2] = bg[2];
      this.data[i * 4 + 3] = 255;
    }
  }

  set(x: number, y: number, c: RGB, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    if (alpha >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
    } else {
      this.data[i] = this.data[i] * (1 - alpha) + c[0] * alpha;
      this.data[i + 1] = this.data[i + 1] * (1 - alpha) + c[1] * alpha;
      this.data[i + 2] = this.data[i + 2] * (1 - alpha) + c[2] * alpha;
    }
  }

  fillRect(x0: number, y0: number, w: number, h: number, c: RGB) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.height, y0 + h); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.width, x0 + w); x++) this.set(x, y, c);
  }

  /** Scanline polygon fill with an optional per-pixel pattern predicate. */
  fillPolygon(pts: [number, number][], c: RGB, pattern?: (x: number, y: number) => boolean) {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(this.width, Math.round(xs[k + 1])); x++) {
          if (!pattern || pattern(x, y)) this.set(x, y, c);
        }
      }
    }
  }

  /** Thick anti-aliased-free line (capsule). */
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB) {
    const r = width / 2;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + r));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + r));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let t = ((x - x0) * dx + (y - y0) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = x0 + t * dx - x;
        const py = y0 + t * dy - y;
        if (px * px + py * py <= r * r) this.set(x, y, c);
      }
    }
  }

  polyline(pts: [number, number][], width: number, c: RGB) {
    for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], width, c);
  }

  circle(cx: number, cy: number, r: number, c: RGB) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c);
  }

  text(str: string, x: number, y: number, scale: number, c: RGB, halo?: RGB) {
    const draw = (ox: number, oy: number, col: RGB) => {
      let cx = x + ox;
      for (const ch of str.toUpperCase()) {
        const g = FONT[ch];
        if (g) {
          for (let row = 0; row < 7; row++)
            for (let col2 = 0; col2 < 5; col2++)
              if (g[row] & (1 << (4 - col2))) this.fillRect(cx + col2 * scale, y + oy + row * scale, scale, scale, col);
        }
        cx += 6 * scale;
      }
    };
    if (halo) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) draw(ox * scale, oy * scale, halo);
    draw(0, 0, c);
  }

  crop(x: number, y: number, w: number, h: number): Raster {
    const out = new Raster(w, h);
    for (let row = 0; row < h; row++) {
      const sy = y + row;
      if (sy < 0 || sy >= this.height) continue;
      const sx0 = Math.max(0, x);
      const sx1 = Math.min(this.width, x + w);
      if (sx1 <= sx0) continue;
      out.data.set(this.data.subarray((sy * this.width + sx0) * 4, (sy * this.width + sx1) * 4), (row * w + (sx0 - x)) * 4);
    }
    return out;
  }
}

// 5×7 bitmap font (rows as 5-bit masks).
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], '+': [0, 4, 4, 31, 4, 4, 0],
};

const NAMES = [
  'HAUPTSTRASSE', 'BAHNHOF', 'MARKTPLATZ', 'RHEINUFER', 'PARKALLEE', 'LINDENWEG', 'KIRCHPLATZ', 'AM HAFEN',
  'NORDRING', 'SCHILLERSTR', 'GOETHEPARK', 'MUEHLENWEG', 'ALTSTADT', 'BERGSTRASSE', 'SEEWEG', 'RATHAUS',
  'MUSEUM', 'BIBLIOTHEK', 'STADION', 'KLINIKUM', 'OSTPARK', 'WESTEND', 'FELDWEG', 'GARTENSTR',
];

export interface MapOptions {
  width: number;
  height: number;
  seed: number;
}

/** Generates a synthetic map raster. */
export function generateMap({ width, height, seed }: MapOptions): Raster {
  const rnd = mulberry32(seed);
  const R = (a: number, b: number) => a + rnd() * (b - a);
  const m = new Raster(width, height);
  const area = (width * height) / 1e6;

  // Land-use areas (parks, forests, industrial zones) as random convex-ish polygons.
  const blob = (cx: number, cy: number, r: number): [number, number][] => {
    const k = 7 + Math.floor(rnd() * 6);
    return Array.from({ length: k }, (_, i) => {
      const a = (i / k) * Math.PI * 2;
      const rr = r * R(0.6, 1.2);
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as [number, number];
    });
  };
  for (let i = 0; i < 14 * area; i++) m.fillPolygon(blob(R(0, width), R(0, height), R(60, 260)), [200, 230, 190]);
  for (let i = 0; i < 4 * area; i++) m.fillPolygon(blob(R(0, width), R(0, height), R(80, 220)), [170, 210, 240]);
  for (let i = 0; i < 6 * area; i++)
    m.fillPolygon(blob(R(0, width), R(0, height), R(50, 160)), [175, 205, 165], (x, y) => (x + y) % 9 < 2);
  for (let i = 0; i < 5 * area; i++)
    m.fillPolygon(blob(R(0, width), R(0, height), R(50, 140)), [215, 205, 225], (x, y) => x % 7 < 2 && y % 7 < 2);

  // Building blocks.
  for (let i = 0; i < 260 * area; i++) {
    const w = R(10, 46);
    const h = R(10, 40);
    m.fillRect(R(0, width), R(0, height), w, h, rnd() < 0.5 ? [222, 214, 204] : [212, 204, 196]);
  }

  // River.
  const river: [number, number][] = [];
  let ry = R(0.2, 0.8) * height;
  for (let x = -50; x < width + 100; x += 60) {
    ry += R(-35, 35);
    river.push([x, ry]);
  }
  m.polyline(river, 34, [160, 200, 235]);

  // Regular street grid in one district (repetitive structure on purpose).
  const gx0 = R(0.1, 0.4) * width;
  const gy0 = R(0.1, 0.4) * height;
  const gw = R(0.3, 0.5) * width;
  const gh = R(0.3, 0.5) * height;
  for (let x = gx0; x < gx0 + gw; x += 90) m.line(x, gy0, x, gy0 + gh, 9, [255, 255, 255]);
  for (let y = gy0; y < gy0 + gh; y += 90) m.line(gx0, y, gx0 + gw, y, 9, [255, 255, 255]);

  // Minor roads.
  for (let i = 0; i < 60 * area; i++) {
    const pts: [number, number][] = [];
    let x = R(0, width);
    let y = R(0, height);
    let a = R(0, Math.PI * 2);
    for (let k = 0; k < 8; k++) {
      pts.push([x, y]);
      a += R(-0.5, 0.5);
      x += Math.cos(a) * R(40, 120);
      y += Math.sin(a) * R(40, 120);
    }
    m.polyline(pts, 11, [190, 185, 180]);
    m.polyline(pts, 7, [255, 255, 255]);
  }
  // Major roads with casing.
  for (let i = 0; i < 6 * area; i++) {
    const pts: [number, number][] = [];
    const horizontal = rnd() < 0.5;
    let p = horizontal ? R(0, height) : R(0, width);
    for (let t = -100; t < (horizontal ? width : height) + 100; t += 120) {
      p += R(-40, 40);
      pts.push(horizontal ? [t, p] : [p, t]);
    }
    m.polyline(pts, 17, [200, 150, 60]);
    m.polyline(pts, 12, [252, 214, 112]);
  }
  // Railway with sleepers.
  const rail: [number, number][] = [];
  let rx = R(0.2, 0.8) * width;
  for (let y = -50; y < height + 100; y += 80) {
    rx += R(-25, 25);
    rail.push([rx, y]);
  }
  m.polyline(rail, 5, [120, 120, 120]);
  for (let i = 0; i + 1 < rail.length; i++) {
    for (let t = 0; t < 1; t += 0.2) {
      const x = rail[i][0] + (rail[i + 1][0] - rail[i][0]) * t;
      const y = rail[i][1] + (rail[i + 1][1] - rail[i][1]) * t;
      m.line(x - 6, y, x + 6, y, 2, [120, 120, 120]);
    }
  }
  // POIs and labels.
  for (let i = 0; i < 40 * area; i++) m.circle(R(0, width), R(0, height), R(4, 8), [214, 92, 80]);
  for (let i = 0; i < 70 * area; i++) {
    const name = NAMES[Math.floor(rnd() * NAMES.length)] + (rnd() < 0.3 ? ' ' + Math.floor(rnd() * 99) : '');
    m.text(name, Math.round(R(0, width - 100)), Math.round(R(0, height - 20)), rnd() < 0.2 ? 3 : 2, [70, 70, 80], [250, 250, 250]);
  }
  return m;
}

export interface Tile {
  image: Raster;
  /** True top-left position in the map. */
  x: number;
  y: number;
  row: number;
  col: number;
}

export interface CutOptions {
  rows: number;
  cols: number;
  tileWidth: number;
  tileHeight: number;
  overlap: number;
  /** Max random deviation (px) of every tile from the ideal raster (hand panning). */
  jitter?: number;
  seed?: number;
}

/** Map size needed for a raster of screenshots with the given overlap (+ jitter margin). */
export function mapSizeFor(o: CutOptions): { width: number; height: number } {
  const sx = Math.round(o.tileWidth * (1 - o.overlap));
  const sy = Math.round(o.tileHeight * (1 - o.overlap));
  const j = (o.jitter ?? 0) * 2 + 2;
  return { width: o.tileWidth + (o.cols - 1) * sx + j, height: o.tileHeight + (o.rows - 1) * sy + j };
}

/** Cuts overlapping "screenshots" from the map in a row-by-row raster. */
export function cutTiles(map: Raster, o: CutOptions): Tile[] {
  const rnd = mulberry32(o.seed ?? 1);
  const sx = Math.round(o.tileWidth * (1 - o.overlap));
  const sy = Math.round(o.tileHeight * (1 - o.overlap));
  const j = o.jitter ?? 0;
  const tiles: Tile[] = [];
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      const x = j + c * sx + Math.round((rnd() * 2 - 1) * j);
      const y = j + r * sy + Math.round((rnd() * 2 - 1) * j);
      tiles.push({ image: map.crop(x, y, o.tileWidth, o.tileHeight), x, y, row: r, col: c });
    }
  }
  return tiles;
}

/** Draws browser-like fixed UI (header bar, search field, zoom buttons, legend, copyright) on a screenshot. */
export function addFixedUi(t: Raster): void {
  t.fillRect(0, 0, t.width, 56, [250, 250, 252]);
  t.fillRect(0, 55, t.width, 1, [200, 200, 205]);
  t.fillRect(16, 12, 260, 32, [236, 238, 242]);
  t.text('SUCHE ...', 28, 21, 2, [120, 120, 130]);
  t.text('KARTENDIENST', t.width - 200, 21, 2, [40, 40, 60]);
  for (let k = 0; k < 2; k++) {
    t.fillRect(t.width - 56, t.height - 140 + k * 48, 40, 40, [255, 255, 255]);
    t.text(k ? '-' : '+', t.width - 44, t.height - 128 + k * 48, 3, [60, 60, 60]);
  }
  t.fillRect(8, t.height - 22, 230, 16, [255, 255, 255]);
  t.text('KARTENDATEN 2026', 12, t.height - 19, 2, [90, 90, 90]);
}

/** Random permutation (Fisher–Yates). */
export function shuffle<T>(items: T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}
