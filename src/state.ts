import type { GrayImage, LayoutResult, Point, Rect, SeamMode } from './types';

/** One uploaded screenshot in the UI. */
export interface Shot {
  key: string;
  file: File;
  name: string;
  width: number;
  height: number;
  thumbUrl: string;
  error?: string;
}

export interface FixedUiState {
  enabled: boolean;
  /** Fraction of masked pixels (detection result) or null if not detected yet. */
  coverage: number | null;
  mask: GrayImage | null;
  workScale: number;
}

/** Result of a stitch run plus the user's manual edits. */
export interface StitchState {
  shots: Shot[];
  layout: LayoutResult;
  /** Editable positions (original px) per stitched screenshot; null = not placed. */
  positions: (Point | null)[];
  removed: Set<number>;
  ignored: Set<number>;
  crops: Rect[];
  workScale: number;
  fixedMask: GrayImage | null;
  mode: SeamMode;
}

let counter = 0;
export const newKey = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Bounding box of all visible screenshots. */
export function sceneBounds(st: Pick<StitchState, 'positions' | 'removed' | 'crops'>): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  st.positions.forEach((p, i) => {
    if (!p || st.removed.has(i)) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + st.crops[i].width);
    maxY = Math.max(maxY, p.y + st.crops[i].height);
  });
  if (!isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

export const isVisible = (st: Pick<StitchState, 'positions' | 'removed'>, i: number) => !!st.positions[i] && !st.removed.has(i);
