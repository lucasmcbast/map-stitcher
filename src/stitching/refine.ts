import type { FeatureMatch, MatchImage, PairCandidate, PairMatch } from '../types';
import { matchFeatures, type FeatureSet } from '../vision/keypoints';
import { refineTranslation, type RefineResult } from '../vision/zncc';
import { MIN_OVERLAP } from './coarseMatch';

/** Pyramid level on which keypoints are detected. */
export function featureLevel(img: MatchImage): number {
  return Math.min(1, img.levels.length - 1);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Combines the individual quality signals of a match into one confidence value in [0, 1].
 * Screenshots of the same map are (almost) pixel identical in the overlap, so the ZNCC is the dominant
 * signal; small overlaps, flat areas, ambiguous alternatives and disagreeing feature matches reduce it.
 */
export function computeConfidence(p: {
  ncc: number;
  overlap: number;
  std: number;
  secondNcc: number;
  candidateNcc: number;
  numberOfMatches: number;
  inlierRatio: number;
}): number {
  const nccTerm = clamp01((p.ncc - 0.55) / 0.37);
  const overlapTerm = 0.4 + 0.6 * clamp01((p.overlap - 0.02) / 0.1);
  const textureTerm = 0.3 + 0.7 * clamp01((p.std - 2) / 10);
  const gap = p.secondNcc < 0 ? 1 : p.candidateNcc - p.secondNcc;
  const ambiguityTerm = 0.55 + 0.45 * clamp01(gap / 0.12);
  let featureTerm = 0.9;
  if (p.numberOfMatches >= 6) featureTerm = 0.55 + 0.45 * clamp01(p.inlierRatio / 0.6);
  return clamp01(nccTerm * overlapTerm * textureTerm * ambiguityTerm * featureTerm);
}

/**
 * Refines a translation from `fromLevel` down to level 0 (sub-pixel) and evaluates it.
 * d is pos(B) - pos(A) in pixels of `fromLevel`.
 */
export function refineDown(A: MatchImage, B: MatchImage, dx: number, dy: number, fromLevel: number, radius = 1): RefineResult {
  let r: RefineResult | null = null;
  let cx = dx;
  let cy = dy;
  for (let l = fromLevel; l >= 0; l--) {
    const stride = l === 0 ? 2 : 1;
    r = refineTranslation(A.levels[l], B.levels[l], cx, cy, l === fromLevel ? radius : 1, stride, MIN_OVERLAP.area);
    if (l > 0) {
      cx = r.dx * 2;
      cy = r.dy * 2;
    }
  }
  // Final sub-pixel estimate with all pixels.
  return refineTranslation(A.levels[0], B.levels[0], r!.dx, r!.dy, 0, 1, MIN_OVERLAP.area);
}

/** Turns a coarse candidate into a verified PairMatch in original crop pixels (or null if implausible). */
export function refineCandidate(
  A: MatchImage,
  B: MatchImage,
  cand: Pick<PairCandidate, 'dx' | 'dy' | 'level' | 'ncc' | 'secondNcc'>,
  featA: FeatureSet | null,
  featB: FeatureSet | null,
  radius = 1,
): PairMatch | null {
  const r = refineDown(A, B, cand.dx, cand.dy, cand.level, radius);
  if (r.overlapW < MIN_OVERLAP.side || r.overlapH < MIN_OVERLAP.side || r.ncc < 0.5) return null;
  const s0 = A.levels[0].scale;
  let numberOfMatches = 0;
  let inlierRatio = 0;
  let features: FeatureMatch[] | undefined;
  if (featA && featB) {
    const fl = featureLevel(A);
    const f = 2 ** fl;
    const LA = A.levels[fl].image;
    const LB = B.levels[fl].image;
    const fm = matchFeatures(featA, featB, { wA: LA.width, hA: LA.height, wB: LB.width, hB: LB.height }, r.dx / f, r.dy / f);
    numberOfMatches = fm.numberOfMatches;
    inlierRatio = fm.inlierRatio;
    const sf = A.levels[fl].scale;
    features = fm.matches.slice(0, 60).map((m) => ({
      a: { x: m.a.x / sf, y: m.a.y / sf },
      b: { x: m.b.x / sf, y: m.b.y / sf },
      inlier: m.inlier,
    }));
  }
  const confidence = computeConfidence({
    ncc: r.ncc,
    overlap: r.overlap,
    std: r.std,
    secondNcc: cand.secondNcc,
    candidateNcc: cand.ncc,
    numberOfMatches,
    inlierRatio,
  });
  return {
    imageA: A.id,
    imageB: B.id,
    dx: r.dx / s0,
    dy: r.dy / s0,
    confidence,
    ncc: r.ncc,
    numberOfMatches,
    inlierRatio,
    overlap: r.overlap,
    features,
  };
}
