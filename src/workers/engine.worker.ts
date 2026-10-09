/// <reference lib="webworker" />
import { coarseLevelOf } from '../stitching/coarseMatch';
import { StitchEngine, cropFor, defaultPairMatcher, type PairMatcher, type SourceImage } from '../stitching/pipeline';
import type { GrayImage, MatchImage, PairCandidate, ProgressInfo } from '../types';
import { ByteLru, decodeFile, drawToImageData } from '../utils/decode';
import { detectFixedUi } from '../vision/fixedUi';
import { rgbaToGray } from '../vision/gray';
import type { FixedUiResult, SnapArgs, StitchArgs, StitchResult, ThumbResult, WorkItem } from './protocol';
import { RpcClient, serve } from './rpc';

/**
 * Engine worker: decodes screenshots, owns the working copies and runs the stitching pipeline.
 * The O(n²) pair matching is distributed over a pool of nested match workers.
 */

const workCache = new ByteLru<GrayImage>(256e6);
let engine: StitchEngine | null = null;

const THUMB = 320;

async function thumbnail({ file }: { file: File }): Promise<ThumbResult> {
  const bmp = await decodeFile(file);
  try {
    const { width, height } = bmp;
    const s = Math.min(1, THUMB / Math.max(width, height));
    const c = new OffscreenCanvas(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const thumb = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return { width, height, thumb };
  } finally {
    bmp.close();
  }
}

function workScaleFor(items: WorkItem[], workingSize: number): number {
  const maxEdge = Math.max(...items.map((i) => Math.max(i.width, i.height)));
  return Math.min(1, workingSize / Math.max(1, maxEdge));
}

async function workingCopies(items: WorkItem[], scale: number, progress: (p: ProgressInfo) => void): Promise<SourceImage[]> {
  const out: SourceImage[] = [];
  for (let i = 0; i < items.length; i++) {
    const { key, file } = items[i];
    const ck = `${key}@${scale}`;
    let work = workCache.get(ck);
    let d = { width: items[i].width, height: items[i].height };
    if (!work) {
      const bmp = await decodeFile(file);
      d = { width: bmp.width, height: bmp.height };
      const img = drawToImageData(bmp, 0, 0, bmp.width, bmp.height, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
      bmp.close();
      work = rgbaToGray(img);
      workCache.set(ck, work, work.data.length);
    }
    out.push({ width: d.width, height: d.height, work });
    progress({ step: 'prepare', fraction: (i + 1) / items.length, message: `${i + 1} von ${items.length} Bildern vorbereitet`, done: i + 1, total: items.length });
  }
  return out;
}

/** Spreads coarse pair matching over several nested workers (falls back to in-process matching). */
const poolMatcher: PairMatcher = async (images, pairs, onDone) => {
  const k = Math.max(1, Math.min(6, (self.navigator?.hardwareConcurrency || 4) - 1));
  if (typeof Worker === 'undefined' || k < 2 || pairs.length < 120) return defaultPairMatcher(images, pairs, onDone);
  const offset = Math.max(0, coarseLevelOf(images) - 1);
  const slim: MatchImage[] = images.map((m) => ({ id: m.id, levels: m.levels.slice(offset) }));
  let clients: RpcClient[] = [];
  try {
    clients = Array.from({ length: k }, () => new RpcClient(new Worker(new URL('./match.worker.ts', import.meta.url), { type: 'module' })));
    await Promise.all(clients.map((c) => c.call('init', { images: slim })));
  } catch {
    clients.forEach((c) => c.terminate());
    return defaultPairMatcher(images, pairs, onDone);
  }
  const chunk = 96;
  let next = 0;
  let done = 0;
  const results: PairCandidate[] = [];
  try {
    await Promise.all(
      clients.map(async (c) => {
        while (next < pairs.length) {
          const slice = pairs.slice(next, next + chunk);
          next += chunk;
          const res = await c.call<PairCandidate[]>('match', { pairs: slice });
          for (const r of res) results.push({ ...r, level: r.level + offset });
          done += slice.length;
          onDone(done);
        }
      }),
    );
  } finally {
    clients.forEach((c) => c.terminate());
  }
  return results;
};

/** Full-resolution gray crops for the final alignment (LRU, decoded on demand). */
function fullResProvider(items: WorkItem[], crops: { x: number; y: number; width: number; height: number }[]) {
  const cache = new ByteLru<GrayImage>(320e6);
  return {
    async get(id: number): Promise<GrayImage> {
      const key = items[id].key;
      const hit = cache.get(key);
      if (hit) return hit;
      const bmp = await decodeFile(items[id].file);
      const c = crops[id];
      const img = drawToImageData(bmp, c.x, c.y, c.width, c.height, c.width, c.height);
      bmp.close();
      const g = rgbaToGray(img);
      cache.set(key, g, g.data.length);
      return g;
    },
  };
}

serve({
  thumbnail,

  forget: ({ keys, all }: { keys: string[]; all?: boolean }) => {
    if (all) workCache.clear();
    else for (const k of keys) workCache.deleteWhere((ck) => ck.startsWith(`${k}@`));
    return true;
  },

  detectFixedUi: async ({ items, workingSize }: { items: WorkItem[]; workingSize: number }, { progress }): Promise<FixedUiResult> => {
    const scale = workScaleFor(items, workingSize);
    const sources = await workingCopies(items, scale, progress);
    const res = detectFixedUi(sources.map((s) => s.work));
    if (!res) return { suggestedCrop: null, coverage: 0, mask: null, workScale: scale };
    const c = res.suggestedCrop;
    return {
      suggestedCrop: { x: c.x / scale, y: c.y / scale, width: c.width / scale, height: c.height / scale },
      coverage: res.coverage,
      mask: res.mask,
      workScale: scale,
    };
  },

  stitch: async (args: StitchArgs, { progress }): Promise<StitchResult> => {
    const { items, settings } = args;
    let crop = args.crop;
    if (items.length < 2) throw new Error('Bitte mindestens zwei Screenshots hinzufügen.');
    const scale = workScaleFor(items, settings.workingSize);
    const sources = await workingCopies(items, scale, progress);
    let fixedMask: GrayImage | null = null;
    let autoCrop = false;
    if (args.useFixedUi) {
      const fx = detectFixedUi(sources.map((s) => s.work));
      fixedMask = fx?.mask ?? null;
      // Without a manual crop, static bars along the borders (headers, toolbars) are cut off automatically.
      const c = fx?.suggestedCrop;
      const ref = sources[0].work;
      if (!crop && c && (c.width < ref.width - 2 || c.height < ref.height - 2)) {
        crop = { x: c.x / scale, y: c.y / scale, width: c.width / scale, height: c.height / scale };
        autoCrop = true;
      }
    }
    const crops = sources.map((s) => cropFor(s.width, s.height, crop));
    engine = new StitchEngine(sources, {
      workScale: scale,
      crop,
      fixedMask,
      settings,
      onProgress: progress,
      matchPairs: poolMatcher,
      fullRes: fullResProvider(items, crops),
    });
    const layout = await engine.run();
    return { layout, crops, workScale: scale, fixedMask, autoCrop: autoCrop ? crop : null };
  },

  retry: async () => {
    if (!engine) throw new Error('Es gibt kein Ergebnis, das erneut versucht werden kann.');
    return engine.retryUnmatched();
  },

  snap: ({ id, pos, positions }: SnapArgs) => {
    if (!engine) return null;
    return engine.snap(id, pos, positions);
  },
});
