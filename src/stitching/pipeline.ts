import type {
  GrayImage,
  LayoutResult,
  MatchImage,
  PairCandidate,
  PairMatch,
  Point,
  ProgressFn,
  Rect,
  StitchSettings,
} from '../types';
import { buildMatchImage, cropGray } from '../vision/gray';
import { detectFeatures, voteTranslation, type FeatureSet } from '../vision/keypoints';
import { nccAt, type Level } from '../vision/zncc';
import { allPairs, matchPairsCoarse, prepareCoarse } from './coarseMatch';
import { detectGrid } from './grid';
import { boxOverlap, computeLayout, normalisePositions, type ImageBox } from './layout';
import { solveLayout } from './lsq';
import { featureLevel, refineCandidate } from './refine';

/** One uploaded screenshot as seen by the pipeline. */
export interface SourceImage {
  /** Original pixel size (after EXIF orientation). */
  width: number;
  height: number;
  /** Full (uncropped) gray working copy at the common working scale. */
  work: GrayImage;
}

/** Supplies full-resolution gray crops for the final sub-pixel-free alignment. */
export interface FullResProvider {
  get(id: number): Promise<GrayImage>;
}

export type PairMatcher = (images: MatchImage[], pairs: [number, number][], onDone: (done: number) => void) => Promise<PairCandidate[]>;

export interface PipelineOptions {
  /** Scale of the working copies relative to the originals (same for all images). */
  workScale: number;
  /** Crop in original pixels applied to every screenshot (null = full image). */
  crop: Rect | null;
  /** Fixed-UI weight mask in working resolution of the full image (null = none). */
  fixedMask: GrayImage | null;
  settings: StitchSettings;
  onProgress?: ProgressFn;
  /** Pair matcher (e.g. a Web Worker pool). Defaults to in-process matching. */
  matchPairs?: PairMatcher;
  fullRes?: FullResProvider;
}

const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

/** Crop rectangle of one image in original pixels (clamped to the image). */
export function cropFor(width: number, height: number, crop: Rect | null): Rect {
  if (!crop) return { x: 0, y: 0, width, height };
  const x = Math.max(0, Math.min(width - 1, Math.round(crop.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(crop.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(crop.width))),
    height: Math.max(1, Math.min(height - y, Math.round(crop.height))),
  };
}

export const defaultPairMatcher: PairMatcher = async (images, pairs, onDone) => {
  const ctx = prepareCoarse(images);
  const out: PairCandidate[] = [];
  const chunk = 64;
  for (let i = 0; i < pairs.length; i += chunk) {
    out.push(...matchPairsCoarse(ctx, pairs.slice(i, i + chunk)));
    onDone(Math.min(pairs.length, i + chunk));
    await yieldToEventLoop();
  }
  return out;
};

/**
 * The complete stitching engine (pure TypeScript, runs in a worker or in Node tests):
 * preprocessing → features → pairwise matching → neighbour graph → global layout → grid detection →
 * optional full-resolution alignment. Keeps its state for retries and manual snapping.
 */
export class StitchEngine {
  readonly images: MatchImage[] = [];
  readonly features: (FeatureSet | null)[] = [];
  readonly boxes: ImageBox[] = [];
  readonly crops: Rect[] = [];
  matches: PairMatch[] = [];
  layout: LayoutResult | null = null;
  private extraMatches: PairMatch[] = [];

  constructor(
    private readonly sources: SourceImage[],
    private readonly opts: PipelineOptions,
  ) {}

  private progress(step: Parameters<ProgressFn>[0]) {
    this.opts.onProgress?.(step);
  }

  get scale0(): number {
    return this.opts.workScale;
  }

  /** Consistency tolerance in original pixels (≈ 2 working pixels). */
  get tolerance(): number {
    return Math.max(2, 2 / this.opts.workScale);
  }

  async prepare(): Promise<void> {
    const { workScale, crop, fixedMask } = this.opts;
    const n = this.sources.length;
    for (let i = 0; i < n; i++) {
      const src = this.sources[i];
      const c = cropFor(src.width, src.height, crop);
      this.crops.push(c);
      this.boxes.push({ width: c.width, height: c.height });
      const wc: Rect = {
        x: c.x * workScale,
        y: c.y * workScale,
        width: c.width * workScale,
        height: c.height * workScale,
      };
      const work = cropGray(src.work, wc);
      let mask: GrayImage | null = null;
      if (fixedMask && fixedMask.width === src.work.width && fixedMask.height === src.work.height) {
        mask = cropGray(fixedMask, wc);
      }
      const mi = buildMatchImage(i, work, mask, workScale);
      this.images.push(mi);
      const fl = featureLevel(mi);
      this.features.push(detectFeatures(mi.levels[fl], 300));
      this.progress({
        step: 'features',
        fraction: (i + 1) / n,
        message: `${i + 1} von ${n} Bildern analysiert`,
        done: i + 1,
        total: n,
      });
      if (i % 4 === 3) await yieldToEventLoop();
    }
  }

  async matchAll(): Promise<void> {
    const n = this.images.length;
    const pairs = allPairs(n);
    // Pairs are ordered by first image: image i is complete once all pairs up to its last one are done.
    const rowEnd: number[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += n - 1 - i;
      rowEnd.push(acc);
    }
    const matcher = this.opts.matchPairs ?? defaultPairMatcher;
    const candidates = await matcher(this.images, pairs, (done) => {
      let imagesDone = 0;
      while (imagesDone < n && rowEnd[imagesDone] <= done) imagesDone++;
      this.progress({
        step: 'matching',
        fraction: pairs.length ? done / pairs.length : 1,
        message: `${imagesDone} von ${n} Bildern analysiert`,
        done: imagesDone,
        total: n,
      });
    });
    this.matches = [];
    for (let k = 0; k < candidates.length; k++) {
      const c = candidates[k];
      const m = refineCandidate(this.images[c.a], this.images[c.b], c, this.features[c.a], this.features[c.b]);
      if (m) this.matches.push(m);
      if (k % 8 === 7) {
        this.progress({
          step: 'layout',
          fraction: (0.5 * (k + 1)) / candidates.length,
          message: `${k + 1} von ${candidates.length} Überlappungen verifiziert`,
        });
        await yieldToEventLoop();
      }
    }
  }

  private levelOf(i: number, l: number): Level {
    const lv = this.images[i].levels;
    return lv[Math.min(l, lv.length - 1)];
  }

  /** ZNCC of an implied translation (original px) on pyramid level 1. */
  verify(a: number, b: number, dx: number, dy: number) {
    const l = Math.min(1, this.images[a].levels.length - 1);
    const s = this.images[a].levels[l].scale;
    const r = nccAt(this.levelOf(a, l), this.levelOf(b, l), dx * s, dy * s, 1);
    return { ncc: r.ncc, overlap: r.overlap, std: r.std };
  }

  /** Precise measurement near an implied translation (original px), used for loop closure and snapping. */
  measure(a: number, b: number, dx: number, dy: number, radius = 2): PairMatch | null {
    const l = Math.min(1, this.images[a].levels.length - 1);
    const s = this.images[a].levels[l].scale;
    return refineCandidate(
      this.images[a],
      this.images[b],
      { dx: dx * s, dy: dy * s, level: l, ncc: 1, secondNcc: -1 },
      this.features[a],
      this.features[b],
      radius,
    );
  }

  async solve(): Promise<LayoutResult> {
    const settings = this.opts.settings;
    const all = [...this.matches, ...this.extraMatches];
    const g = computeLayout(this.boxes, all, {
      minConfidence: settings.minConfidence,
      tolerance: this.tolerance,
      verify: (a, b, dx, dy) => this.verify(a, b, dx, dy),
      measure: (a, b, dx, dy) => this.measure(a, b, dx, dy),
    });
    let positions = g.positions;
    if (settings.fullResRefine && this.opts.fullRes && this.opts.workScale < 0.95 && g.main.length > 1) {
      positions = await this.refineFullRes(g.main, g.edges, positions);
    }
    positions = positions.map((p) => (p ? { x: Math.round(p.x), y: Math.round(p.y) } : null));
    const bounds = normalisePositions(positions, this.boxes);
    const placed = g.main.slice().sort((a, b) => a - b);
    const placedSet = new Set(placed);
    const unmatched = this.images.map((m) => m.id).filter((id) => !placedSet.has(id));
    const used = g.edges.filter((e) => (e.status === 'accepted' || e.status === 'loop') && placedSet.has(e.imageA));
    let wsum = 0;
    let csum = 0;
    for (const e of used) {
      const w = e.status === 'accepted' ? 1 : 0.5;
      wsum += w;
      csum += w * e.confidence;
    }
    const confidence = placed.length < 2 ? 0 : (csum / Math.max(wsum, 1e-9)) * (placed.length / this.images.length) ** 0.25;
    const warnings: string[] = [];
    for (const id of unmatched) {
      warnings.push(
        `Zwischen Screenshot ${id + 1} und den übrigen Bildern wurde keine ausreichende Überlappung gefunden.`,
      );
    }
    const grid = detectGrid(placed, positions, this.boxes);
    this.layout = { positions, placed, unmatched, edges: g.edges, confidence, grid, bounds, warnings };
    return this.layout;
  }

  /**
   * Final alignment on the original pixels: every used edge is re-measured with integer precision on
   * full-resolution gray crops, then the layout is solved again. Removes the rounding error introduced by
   * matching on downscaled copies.
   */
  private async refineFullRes(main: number[], edges: PairMatch[], positions: (Point | null)[]): Promise<(Point | null)[]> {
    const provider = this.opts.fullRes!;
    const set = new Set(main);
    const used = edges
      .filter((e) => (e.status === 'accepted' || e.status === 'loop') && set.has(e.imageA))
      .sort((p, q) => Math.min(p.imageA, p.imageB) - Math.min(q.imageA, q.imageB));
    const maxShift = Math.max(3, 1.5 / this.opts.workScale);
    for (let k = 0; k < used.length; k++) {
      const e = used[k];
      const A = { image: await provider.get(e.imageA), mask: null };
      const B = { image: await provider.get(e.imageB), mask: null };
      let bx = Math.round(e.dx);
      let by = Math.round(e.dy);
      let best = nccAt(A, B, bx, by, 2).ncc;
      for (let iter = 0; iter < 8; iter++) {
        let moved = false;
        const cx = bx;
        const cy = by;
        for (let y = cy - 1; y <= cy + 1; y++) {
          for (let x = cx - 1; x <= cx + 1; x++) {
            if (x === cx && y === cy) continue;
            const v = nccAt(A, B, x, y, 2).ncc;
            if (v > best + 1e-9) {
              best = v;
              bx = x;
              by = y;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      if (Math.hypot(bx - e.dx, by - e.dy) <= maxShift && best >= e.ncc - 0.05) {
        e.dx = bx;
        e.dy = by;
      }
      this.progress({
        step: 'layout',
        fraction: 0.6 + (0.4 * (k + 1)) / used.length,
        message: `Feinausrichtung in Originalauflösung: ${k + 1} von ${used.length}`,
      });
      if (k % 4 === 3) await yieldToEventLoop();
    }
    const anchor = main[0];
    const sol = solveLayout(
      main,
      used.map((e) => ({ a: e.imageA, b: e.imageB, dx: e.dx, dy: e.dy, weight: 0.05 + e.confidence * e.confidence })),
      anchor,
      positions[anchor]!,
    );
    const out = positions.slice();
    for (const [id, p] of sol) out[id] = p;
    for (const e of used) {
      e.residual = Math.hypot(out[e.imageB]!.x - out[e.imageA]!.x - e.dx, out[e.imageB]!.y - out[e.imageA]!.y - e.dy);
    }
    return out;
  }

  /** Runs the whole pipeline. */
  async run(): Promise<LayoutResult> {
    await this.prepare();
    await this.matchAll();
    return this.solve();
  }

  /**
   * Second attempt for unmatched screenshots with an independent method: hypothesis-free feature voting
   * against every placed image plus grid-guided search in empty raster cells, with relaxed thresholds.
   */
  async retryUnmatched(): Promise<LayoutResult> {
    const layout = this.layout ?? (await this.solve());
    const placed = layout.placed;
    for (const u of layout.unmatched) {
      const fu = this.features[u];
      for (const p of placed) {
        const fp = this.features[p];
        if (!fu || !fp) continue;
        const l = featureLevel(this.images[p]);
        const s = this.images[p].levels[l].scale;
        for (const v of voteTranslation(fp, fu).slice(0, 3)) {
          if (v.votes < 3) break;
          const m = this.measure(p, u, v.dx / s, v.dy / s, 3);
          if (m && m.confidence >= this.opts.settings.minConfidence * 0.7) {
            this.extraMatches.push({ ...m, confidence: Math.max(m.confidence, this.opts.settings.minConfidence) });
            break;
          }
        }
      }
      await yieldToEventLoop();
    }
    return this.solve();
  }

  /**
   * Snaps a manually placed image to its best fitting position near `pos` (original px, in the
   * coordinate system of `positions`). Returns null if no reliable alignment was found.
   */
  snap(id: number, pos: Point, positions: (Point | null)[]): Point | null {
    const results: { p: Point; w: number }[] = [];
    positions.forEach((q, other) => {
      if (!q || other === id) return;
      const dx = pos.x - q.x;
      const dy = pos.y - q.y;
      if (boxOverlap(this.boxes[other], this.boxes[id], dx, dy) < 0.03) return;
      const m = this.measure(other, id, dx, dy, 6);
      if (!m || m.ncc < 0.7) return;
      results.push({ p: { x: q.x + m.dx, y: q.y + m.dy }, w: m.ncc * m.ncc * m.overlap });
    });
    if (!results.length) return null;
    const best = results.sort((a, b) => b.w - a.w)[0];
    const agree = results.filter((r) => Math.hypot(r.p.x - best.p.x, r.p.y - best.p.y) < this.tolerance * 2);
    const w = agree.reduce((s, r) => s + r.w, 0);
    return {
      x: Math.round(agree.reduce((s, r) => s + r.p.x * r.w, 0) / w),
      y: Math.round(agree.reduce((s, r) => s + r.p.y * r.w, 0) / w),
    };
  }
}
