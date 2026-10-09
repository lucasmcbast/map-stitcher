import { StitchEngine, cropFor, type FullResProvider, type SourceImage } from '../../src/stitching/pipeline';
import { DEFAULT_SETTINGS, type GrayImage, type LayoutResult, type Rect, type StitchSettings } from '../../src/types';
import { cropGray, resizeGray, rgbaToGray } from '../../src/vision/gray';
import { detectFixedUi } from '../../src/vision/fixedUi';
import type { Raster } from './syntheticMap';

export interface RunOptions {
  settings?: Partial<StitchSettings>;
  crop?: Rect | null;
  autoFixedUi?: boolean;
}

/** Runs the complete stitching engine in-process on raw RGBA screenshots (same code path as the worker). */
export async function stitchRasters(images: Raster[], o: RunOptions = {}): Promise<{ layout: LayoutResult; engine: StitchEngine; crop: Rect | null }> {
  const settings = { ...DEFAULT_SETTINGS, ...o.settings };
  const maxEdge = Math.max(...images.map((i) => Math.max(i.width, i.height)));
  const workScale = Math.min(1, settings.workingSize / maxEdge);
  const grays = images.map((i) => rgbaToGray(i));
  const sources: SourceImage[] = grays.map((g) => ({
    width: g.width,
    height: g.height,
    work: resizeGray(g, Math.round(g.width * workScale), Math.round(g.height * workScale)),
  }));
  let crop = o.crop ?? null;
  let fixedMask: GrayImage | null = null;
  if (o.autoFixedUi) {
    const fx = detectFixedUi(sources.map((s) => s.work));
    if (fx) {
      fixedMask = fx.mask;
      crop = {
        x: fx.suggestedCrop.x / workScale,
        y: fx.suggestedCrop.y / workScale,
        width: fx.suggestedCrop.width / workScale,
        height: fx.suggestedCrop.height / workScale,
      };
    }
  }
  const fullRes: FullResProvider = {
    get: async (id) => cropGray(grays[id], cropFor(grays[id].width, grays[id].height, crop)),
  };
  const engine = new StitchEngine(sources, { workScale, crop, fixedMask, settings, fullRes });
  const layout = await engine.run();
  return { layout, engine, crop };
}

/**
 * Compares a reconstructed layout with ground truth (positions of the crop origins) up to a global offset.
 * Returns the maximum position error in px over all placed images.
 */
export function layoutError(layout: LayoutResult, truth: { x: number; y: number }[], ids: number[]): number {
  const placed = ids.filter((i) => layout.positions[i]);
  if (!placed.length) return Infinity;
  const ref = placed[0];
  const ox = truth[ref].x - layout.positions[ref]!.x;
  const oy = truth[ref].y - layout.positions[ref]!.y;
  let max = 0;
  for (const i of placed) {
    const p = layout.positions[i]!;
    max = Math.max(max, Math.hypot(p.x + ox - truth[i].x, p.y + oy - truth[i].y));
  }
  return max;
}
