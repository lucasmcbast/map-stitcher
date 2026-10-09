import type { GrayImage, LayoutResult, Point, Rect, SeamMode, StitchSettings } from '../types';
import type { ExportFormat } from '../export/limits';

export interface WorkItem {
  key: string;
  file: File;
  /** Original size (known from the thumbnail step). */
  width: number;
  height: number;
}

export interface ThumbResult {
  width: number;
  height: number;
  thumb: Blob;
}

export interface StitchArgs {
  items: WorkItem[];
  crop: Rect | null;
  useFixedUi: boolean;
  settings: StitchSettings;
}

export interface StitchResult {
  layout: LayoutResult;
  /** Crop rectangle of each image in original pixels. */
  crops: Rect[];
  workScale: number;
  /** Fixed-UI mask in working resolution of the full screenshot (null if not used / not found). */
  fixedMask: GrayImage | null;
  /** Crop that was detected and applied automatically (original px), if any. */
  autoCrop: Rect | null;
}

export interface FixedUiResult {
  /** Suggested crop in original pixels of the reference screenshot. */
  suggestedCrop: Rect | null;
  coverage: number;
  /** Mask of the reference screenshot (working resolution, 0 = UI). */
  mask: GrayImage | null;
  workScale: number;
}

export interface SnapArgs {
  id: number;
  pos: Point;
  positions: (Point | null)[];
}

/** Scene description for the render worker. */
export interface RenderScene {
  /** All screenshots of the stitch run; hidden ones (unplaced / removed) are not rendered. */
  items: { key: string; file: File; x: number; y: number; crop: Rect; hidden: boolean }[];
  width: number;
  height: number;
  mode: SeamMode;
  fixedMask: GrayImage | null;
  /** Scale of fixedMask relative to the original screenshot. */
  maskScale: number;
}

export interface ExportArgs {
  format: ExportFormat;
  scale: number;
  quality: number;
  /** Export as ZIP of tiles instead of a single file. */
  tiled: boolean;
  tileSize: number;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
}
