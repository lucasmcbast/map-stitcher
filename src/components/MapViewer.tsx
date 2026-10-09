import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { Point, Rect } from '../types';

/** screen = (map - o) * scale  (CSS pixels) */
export interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
}

export interface MapViewerHandle {
  fit(): void;
  zoomTo(scale: number): void;
  zoomBy(factor: number): void;
  getView(): ViewTransform;
  /** Map coordinate at the centre of the viewport. */
  center(): Point;
  redraw(): void;
  element(): HTMLDivElement | null;
}

export interface PointerHooks {
  /** Return true to take over the gesture (no panning). */
  onDown?: (p: Point, e: React.PointerEvent) => boolean;
  onMove?: (p: Point, e: React.PointerEvent) => void;
  onUp?: (p: Point, e: React.PointerEvent) => void;
  onHover?: (p: Point) => string | null;
}

interface Props {
  width: number;
  height: number;
  preview: { bitmap: ImageBitmap; scale: number } | null;
  version: number;
  requestTile: (region: Rect, scale: number, version: number) => Promise<ImageBitmap | null>;
  drawOverlay?: (ctx: CanvasRenderingContext2D, t: ViewTransform) => void;
  hooks?: PointerHooks;
  onViewChange?: (t: ViewTransform) => void;
}

const TILE = 512;
const MAX_TILES = 140;
const MAX_ZOOM = 8;

export const MapViewer = forwardRef<MapViewerHandle, Props>(function MapViewer(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<ViewTransform>({ scale: 1, ox: 0, oy: 0 });
  const tiles = useRef(new Map<string, ImageBitmap>());
  const pending = useRef(new Set<string>());
  const raf = useRef(0);
  const fitted = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  const size = () => {
    const el = wrapRef.current;
    return { w: el?.clientWidth || 1, h: el?.clientHeight || 1 };
  };

  const draw = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = propsRef.current;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = view.current;
    const x0 = -t.ox * t.scale;
    const y0 = -t.oy * t.scale;
    ctx.imageSmoothingEnabled = t.scale < 2;
    ctx.imageSmoothingQuality = 'high';
    if (p.preview) ctx.drawImage(p.preview.bitmap, x0, y0, p.width * t.scale, p.height * t.scale);

    // Full-resolution tiles when zoomed in beyond the preview resolution.
    const need = t.scale * dpr;
    if (p.preview && need > p.preview.scale * 1.15) {
      const ts = Math.min(1, 2 ** Math.ceil(Math.log2(need)));
      const span = TILE / ts;
      const vx0 = Math.max(0, t.ox);
      const vy0 = Math.max(0, t.oy);
      const vx1 = Math.min(p.width, t.ox + w / t.scale);
      const vy1 = Math.min(p.height, t.oy + h / t.scale);
      for (let ty = Math.floor(vy0 / span); ty * span < vy1; ty++) {
        for (let tx = Math.floor(vx0 / span); tx * span < vx1; tx++) {
          const key = `${p.version}|${ts}|${tx}|${ty}`;
          const bmp = tiles.current.get(key);
          const mx = tx * span;
          const my = ty * span;
          if (bmp) {
            tiles.current.delete(key);
            tiles.current.set(key, bmp);
            ctx.drawImage(bmp, x0 + mx * t.scale, y0 + my * t.scale, (bmp.width / ts) * t.scale, (bmp.height / ts) * t.scale);
          } else if (!pending.current.has(key) && pending.current.size < 6) {
            pending.current.add(key);
            const region = {
              x: tx * TILE,
              y: ty * TILE,
              width: Math.min(TILE, Math.round(p.width * ts) - tx * TILE),
              height: Math.min(TILE, Math.round(p.height * ts) - ty * TILE),
            };
            if (region.width <= 0 || region.height <= 0) continue;
            p.requestTile(region, ts, p.version)
              .then((b) => {
                pending.current.delete(key);
                if (!b) return;
                if (!key.startsWith(`${propsRef.current.version}|`)) {
                  b.close();
                  return;
                }
                tiles.current.set(key, b);
                while (tiles.current.size > MAX_TILES) {
                  const [k, old] = tiles.current.entries().next().value!;
                  old.close();
                  tiles.current.delete(k);
                }
                schedule();
              })
              .catch(() => pending.current.delete(key));
          }
        }
      }
    }
    p.drawOverlay?.(ctx, t);
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  const setView = useCallback(
    (t: ViewTransform) => {
      view.current = t;
      propsRef.current.onViewChange?.(t);
      schedule();
    },
    [schedule],
  );

  const fit = useCallback(() => {
    const { w, h } = size();
    const p = propsRef.current;
    const s = Math.min((w - 40) / p.width, (h - 40) / p.height);
    const scale = Math.max(1e-4, Math.min(MAX_ZOOM, s));
    setView({ scale, ox: p.width / 2 - w / 2 / scale, oy: p.height / 2 - h / 2 / scale });
  }, [setView]);

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      const t = view.current;
      const scale = Math.max(1e-4, Math.min(MAX_ZOOM, t.scale * factor));
      const mx = t.ox + sx / t.scale;
      const my = t.oy + sy / t.scale;
      setView({ scale, ox: mx - sx / scale, oy: my - sy / scale });
    },
    [setView],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoomTo: (s) => {
        const { w, h } = size();
        zoomAt(s / view.current.scale, w / 2, h / 2);
      },
      zoomBy: (f) => {
        const { w, h } = size();
        zoomAt(f, w / 2, h / 2);
      },
      getView: () => view.current,
      center: () => {
        const { w, h } = size();
        const t = view.current;
        return { x: t.ox + w / 2 / t.scale, y: t.oy + h / 2 / t.scale };
      },
      redraw: schedule,
      element: () => wrapRef.current,
    }),
    [fit, zoomAt, schedule],
  );

  // Resize handling + initial fit.
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      if (!fitted.current) {
        fitted.current = true;
        fit();
      } else schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, schedule]);

  // Redraw on prop changes; drop stale tiles when the scene changed.
  useEffect(() => {
    for (const [k, b] of tiles.current) {
      if (!k.startsWith(`${props.version}|`)) {
        b.close();
        tiles.current.delete(k);
      }
    }
    schedule();
  }, [props.version, props.preview, props.drawOverlay, props.width, props.height, schedule]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      for (const b of tiles.current.values()) b.close();
      tiles.current.clear();
    },
    [],
  );

  // Wheel zoom (also trackpad pinch, which arrives as ctrl+wheel).
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(factor, e.clientX - b.left, e.clientY - b.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'hook' | 'pinch'; last: { x: number; y: number }; dist?: number } | null>(null);

  const local = (e: React.PointerEvent) => {
    const b = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const toMap = (s: { x: number; y: number }): Point => {
    const t = view.current;
    return { x: t.ox + s.x / t.scale, y: t.oy + s.y / t.scale };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    wrapRef.current!.setPointerCapture(e.pointerId);
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', last: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const taken = props.hooks?.onDown?.(toMap(s), e);
    gesture.current = { kind: taken ? 'hook' : 'pan', last: s };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s);
    const g = gesture.current;
    if (!g) {
      const cursor = props.hooks?.onHover?.(toMap(s));
      wrapRef.current!.style.cursor = cursor ?? 'grab';
      return;
    }
    if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const t = view.current;
      setView({ ...t, ox: t.ox - (mid.x - g.last.x) / t.scale, oy: t.oy - (mid.y - g.last.y) / t.scale });
      zoomAt(dist / (g.dist || dist), mid.x, mid.y);
      g.last = mid;
      g.dist = dist;
    } else if (g.kind === 'pan') {
      const t = view.current;
      wrapRef.current!.style.cursor = 'grabbing';
      setView({ ...t, ox: t.ox - (s.x - g.last.x) / t.scale, oy: t.oy - (s.y - g.last.y) / t.scale });
      g.last = s;
    } else if (g.kind === 'hook') {
      props.hooks?.onMove?.(toMap(s), e);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'hook') props.hooks?.onUp?.(toMap(local(e)), e);
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === 'pinch') gesture.current = { kind: 'pan', last: [...pointers.current.values()][0] };
  };

  return (
    <div
      ref={wrapRef}
      className="viewer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        const b = wrapRef.current!.getBoundingClientRect();
        zoomAt(2, e.clientX - b.left, e.clientY - b.top);
      }}
      data-testid="viewer"
    >
      <canvas ref={canvasRef} />
    </div>
  );
});
