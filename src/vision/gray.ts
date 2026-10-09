import type { GrayImage, MatchImage, PyramidLevel, Rect, RgbaImage } from '../types';

export function createGray(width: number, height: number): GrayImage {
  return { width, height, data: new Uint8Array(width * height) };
}

/** ITU-R BT.601 luma. */
export function rgbaToGray(img: RgbaImage): GrayImage {
  const out = createGray(img.width, img.height);
  const s = img.data;
  const d = out.data;
  for (let i = 0, j = 0; i < d.length; i++, j += 4) {
    d[i] = (s[j] * 77 + s[j + 1] * 150 + s[j + 2] * 29) >> 8;
  }
  return out;
}

/** Area-averaging resize (good quality for downscaling, also used in tests where no canvas exists). */
export function resizeGray(src: GrayImage, width: number, height: number): GrayImage {
  const out = createGray(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  if (sx <= 1 && sy <= 1) {
    // Upscaling or identity: nearest neighbour is sufficient here.
    for (let y = 0; y < height; y++) {
      const yy = Math.min(src.height - 1, Math.floor((y + 0.5) * sy));
      for (let x = 0; x < width; x++) {
        const xx = Math.min(src.width - 1, Math.floor((x + 0.5) * sx));
        out.data[y * width + x] = src.data[yy * src.width + xx];
      }
    }
    return out;
  }
  // Separable box filter with fractional coverage.
  const tmp = new Float32Array(width * src.height);
  for (let y = 0; y < src.height; y++) {
    const row = y * src.width;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let acc = 0;
      for (let xi = Math.floor(x0); xi < Math.ceil(x1) && xi < src.width; xi++) {
        const w = Math.min(x1, xi + 1) - Math.max(x0, xi);
        acc += src.data[row + xi] * w;
      }
      tmp[y * width + x] = acc / sx;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const y0 = y * sy;
      const y1 = y0 + sy;
      let acc = 0;
      for (let yi = Math.floor(y0); yi < Math.ceil(y1) && yi < src.height; yi++) {
        const w = Math.min(y1, yi + 1) - Math.max(y0, yi);
        acc += tmp[yi * width + x] * w;
      }
      out.data[y * width + x] = Math.round(acc / sy);
    }
  }
  return out;
}

/** Exact 2× downsampling (2×2 mean). Odd trailing rows/cols are dropped. */
export function halve(src: GrayImage): GrayImage {
  const w = src.width >> 1;
  const h = src.height >> 1;
  const out = createGray(w, h);
  const s = src.data;
  const sw = src.width;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * sw;
    const r1 = r0 + sw;
    for (let x = 0; x < w; x++) {
      const c = 2 * x;
      out.data[y * w + x] = (s[r0 + c] + s[r0 + c + 1] + s[r1 + c] + s[r1 + c + 1] + 2) >> 2;
    }
  }
  return out;
}

/** 2× downsampling of a mask: a pixel stays valid only if all four source pixels are valid. */
export function halveMask(src: GrayImage): GrayImage {
  const w = src.width >> 1;
  const h = src.height >> 1;
  const out = createGray(w, h);
  const s = src.data;
  const sw = src.width;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * sw;
    const r1 = r0 + sw;
    for (let x = 0; x < w; x++) {
      const c = 2 * x;
      out.data[y * w + x] = Math.min(s[r0 + c], s[r0 + c + 1], s[r1 + c], s[r1 + c + 1]);
    }
  }
  return out;
}

export function cropGray(src: GrayImage, rect: Rect): GrayImage {
  const x0 = Math.max(0, Math.min(src.width, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(src.height, Math.round(rect.y)));
  const x1 = Math.max(x0, Math.min(src.width, Math.round(rect.x + rect.width)));
  const y1 = Math.max(y0, Math.min(src.height, Math.round(rect.y + rect.height)));
  const out = createGray(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) {
    out.data.set(src.data.subarray(y * src.width + x0, y * src.width + x1), (y - y0) * out.width);
  }
  return out;
}

/**
 * Builds the analysis pyramid for one cropped working image.
 * @param scale0 scale of `work` relative to the original crop.
 */
export function buildMatchImage(
  id: number,
  work: GrayImage,
  mask: GrayImage | null,
  scale0: number,
  minLongEdge = 96,
): MatchImage {
  const levels: PyramidLevel[] = [{ image: work, mask, scale: scale0 }];
  let cur = work;
  let curMask = mask;
  let scale = scale0;
  while (Math.max(cur.width, cur.height) / 2 >= minLongEdge && levels.length < 5) {
    cur = halve(cur);
    curMask = curMask ? halveMask(curMask) : null;
    scale /= 2;
    levels.push({ image: cur, mask: curMask, scale });
  }
  return { id, levels };
}

/** Mean and standard deviation of a gray image (optionally masked). */
export function stats(img: GrayImage, mask: GrayImage | null = null): { mean: number; std: number; count: number } {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let i = 0; i < img.data.length; i++) {
    if (mask && mask.data[i] < 128) continue;
    const v = img.data[i];
    s += v;
    s2 += v * v;
    n++;
  }
  if (!n) return { mean: 0, std: 0, count: 0 };
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), count: n };
}
