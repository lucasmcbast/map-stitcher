/** Shared types of the stitching pipeline. All coordinates are in pixels. */

/** 8-bit single-channel image. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Optional per-pixel weight mask: 0 = ignore (fixed UI), 255 = full weight. */
export type Mask = GrayImage;

/** RGBA image (compatible with ImageData). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** One level of the analysis pyramid of a (cropped) screenshot. */
export interface PyramidLevel {
  image: GrayImage;
  /** Weight mask (same size) or null if every pixel counts. */
  mask: GrayImage | null;
  /** Scale of this level relative to the original crop. */
  scale: number;
}

/**
 * Analysis data of one cropped screenshot.
 * levels[0] = working resolution (≈1024 px long edge), each further level halves the size.
 */
export interface MatchImage {
  id: number;
  levels: PyramidLevel[];
}

export interface Keypoint {
  x: number;
  y: number;
  score: number;
}

export interface FeatureMatch {
  /** Keypoint in A (crop coordinates of the original image). */
  a: Point;
  /** Keypoint in B (crop coordinates of the original image). */
  b: Point;
  inlier: boolean;
}

/** Candidate translation of a pair coming from the coarse matching stage. */
export interface PairCandidate {
  a: number;
  b: number;
  /** pos(B) - pos(A) at pyramid level `level`. */
  dx: number;
  dy: number;
  level: number;
  ncc: number;
  /** NCC of the second best, different hypothesis (ambiguity measure). */
  secondNcc: number;
}

/** Verified pairwise translation (pos(B) - pos(A)) in original-resolution crop pixels. */
export interface PairMatch {
  imageA: number;
  imageB: number;
  dx: number;
  dy: number;
  confidence: number;
  ncc: number;
  numberOfMatches: number;
  inlierRatio: number;
  overlap: number;
  /** A few matched keypoints for the debug view. */
  features?: FeatureMatch[];
  /** Edge status after the global layout. */
  status?: 'accepted' | 'loop' | 'rejected';
  rejectReason?: string;
  /** Residual against the global layout (px, original resolution). */
  residual?: number;
}

export interface GridInfo {
  rows: number;
  cols: number;
  /** cells[row][col] = image id or -1. */
  cells: number[][];
  stepX: number;
  stepY: number;
}

export interface LayoutResult {
  /** Global position of each placed image's crop origin (original px). Index = image id. */
  positions: (Point | null)[];
  placed: number[];
  unmatched: number[];
  edges: PairMatch[];
  confidence: number;
  grid: GridInfo | null;
  bounds: Rect;
  warnings: string[];
}

export type SeamMode = 'hard' | 'feather';

export interface StitchSettings {
  /** Long edge of the working copy in px (level 0). */
  workingSize: number;
  /** Minimum confidence of an edge to be used. */
  minConfidence: number;
  /** Refine translations at original resolution. */
  fullResRefine: boolean;
}

export const DEFAULT_SETTINGS: StitchSettings = {
  workingSize: 1024,
  minConfidence: 0.3,
  fullResRefine: true,
};

export type ProgressStep = 'prepare' | 'features' | 'matching' | 'layout' | 'render';

export interface ProgressInfo {
  step: ProgressStep;
  /** 0..1 within the step. */
  fraction: number;
  message: string;
  done?: number;
  total?: number;
}

export type ProgressFn = (p: ProgressInfo) => void;
