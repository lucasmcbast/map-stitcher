import { useEffect, useMemo, useRef, useState } from 'react';
import type { FixedUiState, Shot } from '../state';
import type { Rect } from '../types';
import type { FixedUiResult } from '../workers/protocol';
import { fmtPercent } from '../utils/format';
import { Icon } from './Icon';

type Drag = { mode: 'new' | 'move' | 'resize'; edges: string; start: { x: number; y: number }; rect: Rect };

const clampRect = (r: Rect, w: number, h: number): Rect => {
  const x = Math.max(0, Math.min(w - 1, Math.round(r.x)));
  const y = Math.max(0, Math.min(h - 1, Math.round(r.y)));
  return { x, y, width: Math.max(1, Math.min(w - x, Math.round(r.width))), height: Math.max(1, Math.min(h - y, Math.round(r.height))) };
};

export function CropDialog(props: {
  shots: Shot[];
  crop: Rect | null;
  fixedUi: FixedUiState;
  onApply: (crop: Rect | null, fixedUi: FixedUiState) => void;
  onClose: () => void;
  onDetect: (onProgress: (f: number) => void) => Promise<FixedUiResult>;
}) {
  const { shots } = props;
  const [index, setIndex] = useState(0);
  const shot = shots[Math.min(index, shots.length - 1)];
  const W = shot.width;
  const H = shot.height;
  const [rect, setRect] = useState<Rect>(props.crop ? clampRect(props.crop, W, H) : { x: 0, y: 0, width: W, height: H });
  const [fixedUi, setFixedUi] = useState<FixedUiState>(props.fixedUi);
  const [detecting, setDetecting] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const url = useMemo(() => URL.createObjectURL(shot.file), [shot.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const c = maskRef.current;
    const m = fixedUi.mask;
    if (!c) return;
    if (!m || !fixedUi.enabled) {
      c.width = 1;
      c.height = 1;
      return;
    }
    c.width = m.width;
    c.height = m.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(m.width, m.height);
    for (let i = 0; i < m.data.length; i++) {
      if (m.data[i] < 128) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = 60;
        img.data[i * 4 + 2] = 90;
        img.data[i * 4 + 3] = 150;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [fixedUi]);

  const toImg = (e: React.PointerEvent) => {
    const b = imgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H, sx: b.width / W };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toImg(e);
    const tol = 12 / p.sx;
    let edges = '';
    if (Math.abs(p.y - rect.y) < tol) edges += 'n';
    if (Math.abs(p.y - (rect.y + rect.height)) < tol) edges += 's';
    if (Math.abs(p.x - rect.x) < tol) edges += 'w';
    if (Math.abs(p.x - (rect.x + rect.width)) < tol) edges += 'e';
    const inside = p.x > rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y < rect.y + rect.height;
    const full = rect.width >= W - 1 && rect.height >= H - 1;
    const mode = edges && !full ? 'resize' : inside && !full ? 'move' : 'new';
    drag.current = { mode, edges, start: p, rect };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toImg(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    let r: Rect;
    if (d.mode === 'new') {
      r = { x: Math.min(p.x, d.start.x), y: Math.min(p.y, d.start.y), width: Math.abs(dx), height: Math.abs(dy) };
    } else if (d.mode === 'move') {
      r = {
        ...d.rect,
        x: Math.max(0, Math.min(W - d.rect.width, d.rect.x + dx)),
        y: Math.max(0, Math.min(H - d.rect.height, d.rect.y + dy)),
      };
    } else {
      let { x, y } = d.rect;
      let x2 = x + d.rect.width;
      let y2 = y + d.rect.height;
      if (d.edges.includes('n')) y += dy;
      if (d.edges.includes('s')) y2 += dy;
      if (d.edges.includes('w')) x += dx;
      if (d.edges.includes('e')) x2 += dx;
      r = { x: Math.min(x, x2), y: Math.min(y, y2), width: Math.abs(x2 - x), height: Math.abs(y2 - y) };
    }
    setRect(clampRect(r, W, H));
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'new' && (rect.width < 32 || rect.height < 32)) setRect(d.rect);
  };

  const detect = async () => {
    setDetecting(0);
    setNote(null);
    try {
      const res = await props.onDetect((f) => setDetecting(f));
      if (!res.mask) {
        setNote('Für die automatische Erkennung werden mindestens 4 gleich große Screenshots benötigt.');
        return;
      }
      setFixedUi({ enabled: true, coverage: res.coverage, mask: res.mask, workScale: res.workScale });
      if (res.suggestedCrop) setRect(clampRect(res.suggestedCrop, W, H));
      setNote(
        res.coverage > 0.001 || (res.suggestedCrop && (res.suggestedCrop.width < W - 2 || res.suggestedCrop.height < H - 2))
          ? `Fixe Elemente erkannt (${fmtPercent(res.coverage)} der Fläche) – sie werden beim Matching ignoriert. Statische Ränder wurden weggeschnitten.`
          : 'Keine fixen UI-Elemente gefunden.',
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(null);
    }
  };

  const pct = (v: number, t: number) => `${(v / t) * 100}%`;
  const full = rect.x === 0 && rect.y === 0 && rect.width === W && rect.height === H;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="modal wide">
        <header className="modal-head">
          <div>
            <h2 id="crop-title">Kartenbereich festlegen</h2>
            <p>Ziehe ein Rechteck über den eigentlichen Kartenbereich. Der Ausschnitt gilt für alle Screenshots.</p>
          </div>
          <button className="icon-btn" onClick={props.onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>
        <div className="crop-stage">
          <div className="crop-wrap" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <img ref={imgRef} src={url} alt="" draggable={false} />
            <canvas ref={maskRef} className="crop-mask" />
            <div
              className="crop-rect"
              style={{ left: pct(rect.x, W), top: pct(rect.y, H), width: pct(rect.width, W), height: pct(rect.height, H) }}
            >
              <span className="crop-label">
                {rect.width} × {rect.height}
              </span>
            </div>
          </div>
        </div>
        <div className="crop-tools">
          <div className="crop-nav">
            <button className="btn ghost small" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              ←
            </button>
            <span>
              Screenshot {index + 1} / {shots.length}
            </span>
            <button className="btn ghost small" disabled={index >= shots.length - 1} onClick={() => setIndex(index + 1)}>
              →
            </button>
          </div>
          <button className="btn secondary small" onClick={detect} disabled={detecting !== null || shots.length < 4} data-testid="detect-ui">
            <Icon name="wand" />
            {detecting !== null ? `Analysiere … ${Math.round(detecting * 100)} %` : 'Fixe UI automatisch erkennen'}
          </button>
          <label className="check">
            <input type="checkbox" checked={fixedUi.enabled} onChange={(e) => setFixedUi({ ...fixedUi, enabled: e.target.checked })} />
            Fixe UI beim Matching ausblenden
          </label>
          <button className="btn ghost small" onClick={() => setRect({ x: 0, y: 0, width: W, height: H })} disabled={full}>
            Ganzes Bild verwenden
          </button>
        </div>
        {note && <p className="crop-note">{note}</p>}
        <footer className="modal-foot">
          <button className="btn ghost" onClick={props.onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={() => props.onApply(full ? null : rect, fixedUi)} data-testid="crop-apply">
            Übernehmen
          </button>
        </footer>
      </div>
    </div>
  );
}
