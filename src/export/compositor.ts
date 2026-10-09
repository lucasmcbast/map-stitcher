import type { GrayImage, Rect, RgbaImage, SeamMode } from '../types';

/** One screenshot prepared for compositing at the output scale. */
export interface CompositeSource {
  /** Top-left position in output pixels (already multiplied by the output scale). */
  x: number;
  y: number;
  /** Cropped screenshot resampled to the output scale. */
  image: RgbaImage;
  /** Optional fixed-UI mask (any resolution, covers the crop). 0 = UI. */
  mask?: GrayImage | null;
}

/**
 * Composites all sources that intersect `region` (output pixels).
 *
 * - `hard`: every output pixel comes from exactly one screenshot – the one in which the pixel lies
 *   furthest from the border (seams end up in the middle of overlaps, no ghosting of labels).
 * - `feather`: weighted average with weights rising linearly from the border (smooth transitions).
 *
 * Pixels covered by detected fixed UI get a tiny weight so that any other screenshot covering the same
 * spot wins.
 */
export function composite(region: Rect, sources: CompositeSource[], mode: SeamMode, out?: RgbaImage): RgbaImage {
  const W = region.width;
  const H = region.height;
  const result = out ?? { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const dst = result.data;
  dst.fill(0);
  const best = new Float32Array(W * H);
  const acc = mode === 'feather' ? new Float32Array(W * H * 4) : null;

  for (const s of sources) {
    const ox = Math.round(s.x) - region.x;
    const oy = Math.round(s.y) - region.y;
    const sw = s.image.width;
    const sh = s.image.height;
    const x0 = Math.max(0, ox);
    const y0 = Math.max(0, oy);
    const x1 = Math.min(W, ox + sw);
    const y1 = Math.min(H, oy + sh);
    if (x1 <= x0 || y1 <= y0) continue;
    const src = s.image.data;
    const mask = s.mask;
    const mx = mask ? mask.width / sw : 0;
    const my = mask ? mask.height / sh : 0;
    for (let y = y0; y < y1; y++) {
      const v = y - oy;
      const dy = Math.min(v + 0.5, sh - v - 0.5);
      const mrow = mask ? Math.min(mask.height - 1, Math.floor(v * my)) * mask.width : 0;
      for (let x = x0; x < x1; x++) {
        const u = x - ox;
        let w = Math.min(u + 0.5, sw - u - 0.5, dy);
        if (mask && mask.data[mrow + Math.min(mask.width - 1, Math.floor(u * mx))] < 128) w *= 0.01;
        const si = (v * sw + u) * 4;
        const di = y * W + x;
        if (src[si + 3] === 0) continue;
        if (acc) {
          acc[di * 4] += src[si] * w;
          acc[di * 4 + 1] += src[si + 1] * w;
          acc[di * 4 + 2] += src[si + 2] * w;
          acc[di * 4 + 3] += src[si + 3] * w;
          best[di] += w;
        } else if (w > best[di]) {
          best[di] = w;
          dst[di * 4] = src[si];
          dst[di * 4 + 1] = src[si + 1];
          dst[di * 4 + 2] = src[si + 2];
          dst[di * 4 + 3] = src[si + 3];
        }
      }
    }
  }
  if (acc) {
    for (let i = 0; i < W * H; i++) {
      const w = best[i];
      if (w <= 0) continue;
      dst[i * 4] = acc[i * 4] / w;
      dst[i * 4 + 1] = acc[i * 4 + 1] / w;
      dst[i * 4 + 2] = acc[i * 4 + 2] / w;
      dst[i * 4 + 3] = acc[i * 4 + 3] / w;
    }
  }
  return result;
}
