/// <reference lib="webworker" />
import { composite, type CompositeSource } from '../export/compositor';
import { STRIP_HEIGHT, fitsCanvas, probeCanvasLimits } from '../export/limits';
import { PngStreamEncoder } from '../export/png';
import { ZipWriter } from '../export/zip';
import type { GrayImage, Rect, RgbaImage } from '../types';
import { ByteLru, context2d, decodeFile, drawToImageData } from '../utils/decode';
import { cropGray } from '../vision/gray';
import type { ExportArgs, ExportResult, RenderScene } from './protocol';
import { serve } from './rpc';

/**
 * Render worker: composites the final map from the ORIGINAL screenshots. Everything is rendered in
 * strips/tiles, so the output size is not limited by the browser's maximum canvas size (PNG export).
 */

let scene: RenderScene | null = null;
let sceneVersion = 0;
const sourceCache = new ByteLru<RgbaImage>(420e6);
const maskCache = new Map<string, GrayImage | null>();

function setScene(s: RenderScene) {
  // Sources are cached by file key + crop + scale, so position edits never invalidate them.
  if ((scene?.fixedMask?.data.length ?? 0) !== (s.fixedMask?.data.length ?? 0) || scene?.maskScale !== s.maskScale) maskCache.clear();
  scene = s;
  sceneVersion++;
  return sceneVersion;
}

async function source(idx: number, scale: number): Promise<RgbaImage> {
  const it = scene!.items[idx];
  const c = it.crop;
  const key = `${it.key}|${c.x},${c.y},${c.width},${c.height}|${scale}`;
  const hit = sourceCache.get(key);
  if (hit) return hit;
  const bmp = await decodeFile(it.file);
  const img = drawToImageData(bmp, c.x, c.y, c.width, c.height, Math.max(1, Math.round(c.width * scale)), Math.max(1, Math.round(c.height * scale)));
  bmp.close();
  const rgba: RgbaImage = { width: img.width, height: img.height, data: img.data };
  sourceCache.set(key, rgba, img.data.length);
  return rgba;
}

/** Fixed-UI mask cropped to an item's crop (in mask resolution). */
function maskFor(idx: number): GrayImage | null {
  const s = scene!;
  if (!s.fixedMask) return null;
  const it = s.items[idx];
  const mk = `${it.key}|${it.crop.x},${it.crop.y},${it.crop.width},${it.crop.height}`;
  if (maskCache.has(mk)) return maskCache.get(mk)!;
  const m = s.maskScale;
  const res = cropGray(s.fixedMask, { x: it.crop.x * m, y: it.crop.y * m, width: it.crop.width * m, height: it.crop.height * m });
  const valid = res.width > 0 && res.height > 0 ? res : null;
  maskCache.set(mk, valid);
  return valid;
}

/** Composites a region given in output pixels at `scale`. */
async function renderRegion(region: Rect, scale: number): Promise<RgbaImage> {
  const s = scene!;
  const sources: CompositeSource[] = [];
  for (let i = 0; i < s.items.length; i++) {
    const it = s.items[i];
    if (it.hidden) continue;
    const x = it.x * scale;
    const y = it.y * scale;
    const w = it.crop.width * scale;
    const h = it.crop.height * scale;
    if (x >= region.x + region.width || y >= region.y + region.height || x + w <= region.x || y + h <= region.y) continue;
    sources.push({ x, y, image: await source(i, scale), mask: maskFor(i) });
  }
  return composite(region, sources, s.mode);
}

function toImageData(img: RgbaImage): ImageData {
  return new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height);
}

/** Renders a downscaled overview into one canvas (strip by strip). */
async function renderToCanvas(scale: number, onProgress?: (f: number) => void): Promise<OffscreenCanvas> {
  const s = scene!;
  const W = Math.max(1, Math.round(s.width * scale));
  const H = Math.max(1, Math.round(s.height * scale));
  const canvas = new OffscreenCanvas(W, H);
  const ctx = context2d(canvas);
  for (let y = 0; y < H; y += STRIP_HEIGHT) {
    const h = Math.min(STRIP_HEIGHT, H - y);
    const img = await renderRegion({ x: 0, y, width: W, height: h }, scale);
    ctx.putImageData(toImageData(img), 0, y);
    onProgress?.((y + h) / H);
  }
  return canvas;
}

const FORMAT_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;

serve(
  {
    setScene: (s: RenderScene) => setScene(s),

    preview: async ({ maxSize }: { maxSize: number }, { progress, transfer }) => {
      const s = scene!;
      const limits = probeCanvasLimits();
      let scale = Math.min(1, maxSize / Math.max(s.width, s.height));
      while (!fitsCanvas(Math.round(s.width * scale), Math.round(s.height * scale), limits)) scale *= 0.8;
      const canvas = await renderToCanvas(scale, (f) => progress(f));
      const bitmap = canvas.transferToImageBitmap();
      transfer([bitmap]);
      return { bitmap, scale };
    },

    sourceBitmap: async ({ index, maxSize }: { index: number; maxSize: number }, { transfer }) => {
      const it = scene!.items[index];
      const scale = Math.min(1, maxSize / Math.max(it.crop.width, it.crop.height));
      const img = await source(index, scale);
      const bitmap = await createImageBitmap(toImageData(img));
      transfer([bitmap]);
      return { bitmap, scale };
    },

    tile: async ({ region, scale, version }: { region: Rect; scale: number; version: number }, { transfer }) => {
      if (!scene || version !== sceneVersion) return null;
      const img = await renderRegion(region, scale);
      if (version !== sceneVersion) return null;
      const bitmap = await createImageBitmap(toImageData(img));
      transfer([bitmap]);
      return bitmap;
    },

    export: async (args: ExportArgs, { progress }): Promise<ExportResult> => {
      const s = scene!;
      const { format, scale, quality, tiled, tileSize } = args;
      const W = Math.max(1, Math.round(s.width * scale));
      const H = Math.max(1, Math.round(s.height * scale));
      const base = `karte-${W}x${H}`;
      if (tiled) {
        const zip = new ZipWriter();
        const cols = Math.ceil(W / tileSize);
        const rows = Math.ceil(H / tileSize);
        const ext = format === 'jpeg' ? 'jpg' : format;
        const lines = [`Map Stitcher – ${W} × ${H} px in ${rows} × ${cols} Kacheln à ${tileSize} px`, ''];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const region = { x: c * tileSize, y: r * tileSize, width: Math.min(tileSize, W - c * tileSize), height: Math.min(tileSize, H - r * tileSize) };
            const img = await renderRegion(region, scale);
            const canvas = new OffscreenCanvas(region.width, region.height);
            context2d(canvas).putImageData(toImageData(img), 0, 0);
            const blob = await canvas.convertToBlob({ type: FORMAT_MIME[format], quality });
            const name = `kachel_r${String(r + 1).padStart(2, '0')}_c${String(c + 1).padStart(2, '0')}.${ext}`;
            await zip.add(name, blob);
            lines.push(`${name}: x=${region.x}, y=${region.y}, ${region.width} × ${region.height}`);
            progress((r * cols + c + 1) / (rows * cols));
          }
        }
        await zip.add('LIESMICH.txt', new TextEncoder().encode(lines.join('\n')));
        return { blob: zip.finish(), filename: `${base}-kacheln.zip` };
      }
      if (format === 'png') {
        const enc = new PngStreamEncoder(W, H);
        for (let y = 0; y < H; y += STRIP_HEIGHT) {
          const h = Math.min(STRIP_HEIGHT, H - y);
          const img = await renderRegion({ x: 0, y, width: W, height: h }, scale);
          await enc.writeRows(img.data, h);
          progress((y + h) / H);
        }
        return { blob: await enc.finish(), filename: `${base}.png` };
      }
      const limits = probeCanvasLimits();
      if (!fitsCanvas(W, H, limits)) {
        throw new Error('Das Bild ist für ein einzelnes JPEG/WebP in diesem Browser zu groß. Bitte PNG oder den Kachel-Export (ZIP) wählen.');
      }
      const canvas = await renderToCanvas(scale, (f) => progress(f * 0.9));
      const blob = await canvas.convertToBlob({ type: FORMAT_MIME[format], quality });
      progress(1);
      return { blob, filename: `${base}.${format === 'jpeg' ? 'jpg' : format}` };
    },
  },
  ['tile', 'sourceBitmap'],
);
