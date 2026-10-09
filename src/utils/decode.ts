/** Image decoding helpers for workers (EXIF orientation aware). */

export async function decodeFile(file: Blob): Promise<ImageBitmap> {
  try {
    // 'from-image' applies the EXIF orientation (default in current browsers, explicit for older ones).
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error('Das Bild konnte nicht gelesen werden. Unterstützt werden PNG, JPEG und WebP.');
    }
  }
}

export function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D wird von diesem Browser nicht unterstützt.');
  return ctx;
}

/** Draws a region of a bitmap scaled into an RGBA buffer. */
export function drawToImageData(
  bmp: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): ImageData {
  const c = new OffscreenCanvas(Math.max(1, dw), Math.max(1, dh));
  const ctx = context2d(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Simple LRU cache with a byte budget. */
export class ByteLru<V> {
  private readonly map = new Map<string, { value: V; bytes: number }>();
  private total = 0;
  constructor(private readonly budget: number) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V, bytes: number): void {
    const old = this.map.get(key);
    if (old) {
      this.total -= old.bytes;
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes });
    this.total += bytes;
    for (const [k, e] of this.map) {
      if (this.total <= this.budget || this.map.size <= 1) break;
      this.map.delete(k);
      this.total -= e.bytes;
    }
  }

  deleteWhere(pred: (key: string) => boolean): void {
    for (const [k, e] of this.map) {
      if (!pred(k)) continue;
      this.map.delete(k);
      this.total -= e.bytes;
    }
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}
