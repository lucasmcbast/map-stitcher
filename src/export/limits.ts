/** Browser canvas limits and export size estimates. */

export interface CanvasLimits {
  maxSide: number;
  maxArea: number;
}

/** Conservative defaults (Safari/iOS are the strictest; Chrome allows 16384² / 268 MP). */
export const SAFE_LIMITS: CanvasLimits = { maxSide: 16384, maxArea: 16384 * 8192 };

let probed: CanvasLimits | null = null;

function canvasWorks(w: number, h: number): boolean {
  try {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#f00';
    ctx.fillRect(w - 1, h - 1, 1, 1);
    const ok = ctx.getImageData(w - 1, h - 1, 1, 1).data[0] === 255;
    c.width = 1;
    c.height = 1;
    return ok;
  } catch {
    return false;
  }
}

/** Probes the real limits of this browser once (cheap: only a few test canvases). */
export function probeCanvasLimits(): CanvasLimits {
  if (probed) return probed;
  if (typeof OffscreenCanvas === 'undefined') return (probed = SAFE_LIMITS);
  const sides = [32767, 16384, 8192];
  const maxSide = sides.find((s) => canvasWorks(s, 1)) ?? 4096;
  const areas = [16384 * 16384, 16384 * 8192, 8192 * 8192];
  const maxArea =
    areas.find((a) => {
      const w = Math.min(maxSide, Math.ceil(Math.sqrt(a)));
      return canvasWorks(w, Math.floor(a / w));
    }) ?? 4096 * 4096;
  probed = { maxSide, maxArea };
  return probed;
}

export function fitsCanvas(width: number, height: number, limits: CanvasLimits): boolean {
  return width <= limits.maxSide && height <= limits.maxSide && width * height <= limits.maxArea;
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportEstimate {
  width: number;
  height: number;
  /** Estimated file size in bytes. */
  fileSize: number;
  /** Estimated peak RAM during export in bytes. */
  memory: number;
  /** Whether a single file can be produced. */
  singleFile: boolean;
  /** Why a single file is not possible (if so). */
  reason?: string;
}

const BYTES_PER_PIXEL: Record<ExportFormat, number> = { png: 1.1, jpeg: 0.28, webp: 0.2 };

export const STRIP_HEIGHT = 512;

export function estimateExport(width: number, height: number, format: ExportFormat, limits: CanvasLimits): ExportEstimate {
  const px = width * height;
  const fileSize = px * BYTES_PER_PIXEL[format];
  if (format === 'png') {
    // Streaming encoder: strip buffers + source cache + resulting file.
    const memory = width * STRIP_HEIGHT * 4 * 3 + 300e6 + fileSize;
    const singleFile = fileSize < 2e9 && width <= 0x7fffffff;
    return {
      width,
      height,
      fileSize,
      memory,
      singleFile,
      reason: singleFile ? undefined : 'Die PNG-Datei wäre größer als 2 GB.',
    };
  }
  const singleFile = fitsCanvas(width, height, limits);
  return {
    width,
    height,
    fileSize,
    memory: px * 4 * 2 + 300e6 + fileSize,
    singleFile,
    reason: singleFile
      ? undefined
      : `Für ${format.toUpperCase()} ist das Bild größer als die maximale Canvas-Größe dieses Browsers (${limits.maxSide.toLocaleString('de-DE')} px Kantenlänge / ${(limits.maxArea / 1e6).toFixed(0)} MP).`,
  };
}
