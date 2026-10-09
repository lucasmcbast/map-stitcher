import type { GrayImage, Rect } from '../types';
import { createGray, resizeGray } from './gray';

export interface FixedUiResult {
  /** Weight mask in working resolution of the full (uncropped) screenshot: 0 = fixed UI. */
  mask: GrayImage;
  /** Suggested crop rectangle in working-resolution pixels (removes static bars at the borders). */
  suggestedCrop: Rect;
  /** Fraction of masked pixels. */
  coverage: number;
}

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = src[y * w + k];
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = tmp[k * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Detects UI elements that do not move with the map (toolbars, zoom buttons, legends, copyright notes):
 * pixels that are (nearly) identical in most screenshots while the map underneath moves.
 * Only textured static structures and their immediate surroundings are masked, so uniform map areas
 * are not mistaken for UI.
 */
export function detectFixedUi(images: GrayImage[], analysisSize = 256): FixedUiResult | null {
  if (images.length < 4) return null;
  const ref = images[0];
  const same = images.filter((im) => im.width === ref.width && im.height === ref.height);
  if (same.length < 4) return null;
  const scale = Math.min(1, analysisSize / Math.max(ref.width, ref.height));
  const w = Math.max(8, Math.round(ref.width * scale));
  const h = Math.max(8, Math.round(ref.height * scale));
  const small = same.map((im) => resizeGray(im, w, h).data);
  const n = small.length;
  const isStatic = new Uint8Array(w * h);
  const med = new Uint8Array(w * h);
  const vals = new Uint8Array(n);
  for (let i = 0; i < w * h; i++) {
    for (let k = 0; k < n; k++) vals[k] = small[k][i];
    vals.sort();
    const m = vals[n >> 1];
    med[i] = m;
    let close = 0;
    for (let k = 0; k < n; k++) if (Math.abs(vals[k] - m) <= 3) close++;
    if (close / n >= 0.75) isStatic[i] = 1;
  }
  const textured = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!isStatic[i]) continue;
      const g = Math.abs(med[i + 1] - med[i - 1]) + Math.abs(med[i + w] - med[i - w]);
      if (g > 12) textured[i] = 1;
    }
  }
  const grown = dilate(textured, w, h, 3);
  const staticNear = dilate(isStatic, w, h, 1);
  const small_mask = new Uint8Array(w * h);
  let masked = 0;
  for (let i = 0; i < w * h; i++) {
    if (grown[i] && staticNear[i]) {
      small_mask[i] = 1;
      masked++;
    }
  }

  // Static bands along the borders → crop suggestion.
  const rowStatic = (y: number) => {
    let c = 0;
    for (let x = 0; x < w; x++) c += isStatic[y * w + x];
    return c / w;
  };
  const colStatic = (x: number) => {
    let c = 0;
    for (let y = 0; y < h; y++) c += isStatic[y * w + x];
    return c / h;
  };
  let top = 0;
  while (top < h / 3 && rowStatic(top) > 0.85) top++;
  let bottom = h;
  while (bottom > (2 * h) / 3 && rowStatic(bottom - 1) > 0.85) bottom--;
  let left = 0;
  while (left < w / 3 && colStatic(left) > 0.85) left++;
  let right = w;
  while (right > (2 * w) / 3 && colStatic(right - 1) > 0.85) right--;

  const mask = createGray(ref.width, ref.height);
  const sx = w / ref.width;
  const sy = h / ref.height;
  for (let y = 0; y < ref.height; y++) {
    const yy = Math.min(h - 1, Math.floor(y * sy));
    for (let x = 0; x < ref.width; x++) {
      const xx = Math.min(w - 1, Math.floor(x * sx));
      mask.data[y * ref.width + x] = small_mask[yy * w + xx] ? 0 : 255;
    }
  }
  const pad = (v: number, s: number) => v / s;
  const suggestedCrop: Rect = {
    x: Math.round(pad(left, sx)),
    y: Math.round(pad(top, sy)),
    width: Math.round(pad(right - left, sx)),
    height: Math.round(pad(bottom - top, sy)),
  };
  return { mask, suggestedCrop, coverage: masked / (w * h) };
}
