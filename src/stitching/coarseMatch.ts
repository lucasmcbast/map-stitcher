import type { MatchImage, PairCandidate } from '../types';
import { nextPowerOfTwo } from '../vision/fft';
import { computeSpectrum, findPeaks, phaseCorrelate2, unwrapPeak, type Spectrum } from '../vision/phaseCorrelation';
import { nccAt, refineTranslation } from '../vision/zncc';

/** Minimum overlap a translation hypothesis must produce to be considered at all. */
export const MIN_OVERLAP = { area: 0.03, side: 0.06 };

export interface CoarseContext {
  images: MatchImage[];
  spectra: Spectrum[];
  /** Pyramid level used for phase correlation (coarsest common level). */
  level: number;
}

export function coarseLevelOf(images: MatchImage[]): number {
  return Math.min(...images.map((m) => m.levels.length)) - 1;
}

/** Precomputes the Fourier spectra of all images at the coarsest common pyramid level. */
export function prepareCoarse(images: MatchImage[]): CoarseContext {
  const level = coarseLevelOf(images);
  const fw = nextPowerOfTwo(Math.max(...images.map((m) => m.levels[level].image.width)));
  const fh = nextPowerOfTwo(Math.max(...images.map((m) => m.levels[level].image.height)));
  const spectra = images.map((m) => computeSpectrum(m.levels[level], fw, fh));
  return { images, spectra, level };
}

interface Hypothesis {
  dx: number;
  dy: number;
  ncc: number;
}

/**
 * Coarse matching of image pairs: phase correlation yields a handful of translation peaks, every peak is
 * unwrapped (circular ambiguity), verified by masked ZNCC and the two best hypotheses are refined one
 * pyramid level finer. Pairs without a plausible overlap return nothing.
 */
export function matchPairsCoarse(
  ctx: CoarseContext,
  pairs: [number, number][],
  onPair?: (done: number) => void,
): PairCandidate[] {
  const out: PairCandidate[] = [];
  for (let p = 0; p < pairs.length; p += 2) {
    const p1 = pairs[p];
    const p2 = p + 1 < pairs.length ? pairs[p + 1] : null;
    const [s1, s2] = phaseCorrelate2(
      [ctx.spectra[p1[0]], ctx.spectra[p1[1]]],
      p2 ? [ctx.spectra[p2[0]], ctx.spectra[p2[1]]] : null,
    );
    const c1 = evaluateSurface(ctx, p1[0], p1[1], s1);
    if (c1) out.push(c1);
    if (p2 && s2) {
      const c2 = evaluateSurface(ctx, p2[0], p2[1], s2);
      if (c2) out.push(c2);
    }
    onPair?.(Math.min(pairs.length, p + 2));
  }
  return out;
}

function evaluateSurface(ctx: CoarseContext, a: number, b: number, surface: Float64Array): PairCandidate | null {
  const sA = ctx.spectra[a];
  const sB = ctx.spectra[b];
  const LA = ctx.images[a].levels[ctx.level];
  const LB = ctx.images[b].levels[ctx.level];
  const peaks = findPeaks(surface, sA.fw, sA.fh, 6);
  const hyps: Hypothesis[] = [];
  for (const peak of peaks) {
    for (const { dx, dy } of unwrapPeak(peak, sA, sB)) {
      const r = nccAt(LA, LB, dx, dy);
      if (r.overlap < MIN_OVERLAP.area || r.overlapW < MIN_OVERLAP.side || r.overlapH < MIN_OVERLAP.side) continue;
      if (r.std < 1.5) continue;
      hyps.push({ dx, dy, ncc: r.ncc });
    }
  }
  hyps.sort((x, y) => y.ncc - x.ncc);
  const distinct: Hypothesis[] = [];
  for (const h of hyps) {
    if (h.ncc < 0.2) break;
    if (distinct.some((d) => Math.abs(d.dx - h.dx) <= 2 && Math.abs(d.dy - h.dy) <= 2)) continue;
    distinct.push(h);
    if (distinct.length === 3) break;
  }
  if (!distinct.length) return null;

  // Refine the best hypotheses one level finer, where the ZNCC is far more discriminative.
  const fine = Math.max(0, ctx.level - 1);
  const factor = 2 ** (ctx.level - fine);
  const FA = ctx.images[a].levels[fine];
  const FB = ctx.images[b].levels[fine];
  const refined = distinct
    .map((h) => refineTranslation(FA, FB, h.dx * factor, h.dy * factor, 2, 1, MIN_OVERLAP.area))
    .filter((r) => r.overlapW >= MIN_OVERLAP.side && r.overlapH >= MIN_OVERLAP.side)
    .sort((x, y) => y.ncc - x.ncc);
  if (!refined.length || refined[0].ncc < 0.45) return null;
  const best = refined[0];
  const second = refined.find((r) => Math.abs(r.dx - best.dx) > 3 || Math.abs(r.dy - best.dy) > 3);
  return {
    a,
    b,
    dx: best.dx,
    dy: best.dy,
    level: fine,
    ncc: best.ncc,
    secondNcc: second ? second.ncc : -1,
  };
}

/** All unordered pairs (i < j), ordered by i so that progress can be reported per image. */
export function allPairs(n: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  return pairs;
}
