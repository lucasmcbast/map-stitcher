import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isVisible, sceneBounds, type StitchState } from '../state';
import type { PairMatch, Point, Rect } from '../types';
import { fmtInt, fmtPercent, fmtSize, friendlyError } from '../utils/format';
import { engineClient, renderClient } from '../workers/clients';
import type { ExportArgs, ExportResult, RenderScene } from '../workers/protocol';
import { ExportDialog } from './ExportDialog';
import { Icon } from './Icon';
import { MapViewer, type MapViewerHandle, type PointerHooks, type ViewTransform } from './MapViewer';

export const PREVIEW_SIZE = 4096;

export interface Preview {
  bitmap: ImageBitmap;
  scale: number;
  version: number;
}

/** Builds the render worker scene (positions relative to the scene bounds). */
export function buildScene(st: StitchState): { scene: RenderScene; bounds: Rect } {
  const bounds = sceneBounds(st);
  const scene: RenderScene = {
    items: st.shots.map((s, i) => {
      const p = st.positions[i];
      return {
        key: s.key,
        file: s.file,
        x: p ? p.x - bounds.x : 0,
        y: p ? p.y - bounds.y : 0,
        crop: st.crops[i],
        hidden: !isVisible(st, i),
      };
    }),
    width: bounds.width,
    height: bounds.height,
    mode: st.mode,
    fixedMask: st.fixedMask,
    maskScale: st.workScale,
  };
  return { scene, bounds };
}

/** Sends the scene to the render worker and renders the overview bitmap. */
export async function renderPreview(st: StitchState, onProgress?: (f: number) => void): Promise<Preview> {
  const rc = renderClient();
  const { scene } = buildScene(st);
  const version = await rc.call<number>('setScene', scene);
  const res = await rc.call<{ bitmap: ImageBitmap; scale: number }>('preview', { maxSize: PREVIEW_SIZE }, onProgress);
  return { ...res, version };
}

const confColor = (c: number, alpha = 1) =>
  c >= 0.8 ? `rgba(16,185,129,${alpha})` : c >= 0.5 ? `rgba(245,158,11,${alpha})` : `rgba(239,68,68,${alpha})`;

type DebugLayers = { boxes: boolean; graph: boolean; rejected: boolean; features: boolean };

export function ResultView(props: {
  st: StitchState;
  setSt: (fn: (s: StitchState) => StitchState) => void;
  initialPreview: Preview;
  onBack: () => void;
  onRetry: () => Promise<void>;
}) {
  const { st, setSt } = props;
  const viewer = useRef<MapViewerHandle>(null);
  const [preview, setPreview] = useState<Preview>(props.initialPreview);
  const [updating, setUpdating] = useState(false);
  const [debug, setDebug] = useState(false);
  const [layers, setLayers] = useState<DebugLayers>({ boxes: true, graph: true, rejected: false, features: true });
  const [edit, setEdit] = useState(false);
  const [snap, setSnap] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const drag = useRef<{ id: number; start: Point; startPos: Point; pos: Point } | null>(null);
  const dragBitmap = useRef<{ id: number; bitmap: ImageBitmap; scale: number } | null>(null);
  const bounds = useMemo(() => sceneBounds(st), [st]);
  const prevBounds = useRef(bounds);
  const firstRender = useRef(true);

  // Keep the viewport stable when the scene origin moves after an edit.
  useEffect(() => {
    const dx = prevBounds.current.x - bounds.x;
    const dy = prevBounds.current.y - bounds.y;
    prevBounds.current = bounds;
    if ((dx || dy) && viewer.current) {
      const v = viewer.current.getView();
      Object.assign(v, { ox: v.ox + dx, oy: v.oy + dy });
      viewer.current.redraw();
    }
  }, [bounds]);

  // Re-render the preview after edits (debounced).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setUpdating(true);
    const t = setTimeout(async () => {
      try {
        const p = await renderPreview(st);
        if (cancelled) return p.bitmap.close();
        setPreview((old) => {
          old.bitmap.close();
          return p;
        });
      } catch (e) {
        setNotice(friendlyError(e).title);
      } finally {
        if (!cancelled) setUpdating(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [st.positions, st.removed, st.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = st.shots.map((_, i) => i).filter((i) => isVisible(st, i));
  const unmatched = st.shots.map((_, i) => i).filter((i) => !st.positions[i] && !st.removed.has(i) && !st.ignored.has(i));

  const edgesOf = (id: number) => st.layout.edges.filter((e) => e.imageA === id || e.imageB === id);

  // Drag overlay bitmap for the selected image (edit mode).
  useEffect(() => {
    if (!edit || selected === null) return;
    if (dragBitmap.current?.id === selected) return;
    let cancelled = false;
    renderClient()
      .call<{ bitmap: ImageBitmap; scale: number }>('sourceBitmap', { index: selected, maxSize: 1600 })
      .then((r) => {
        if (cancelled) return r.bitmap.close();
        dragBitmap.current?.bitmap.close();
        dragBitmap.current = { id: selected, ...r };
        viewer.current?.redraw();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [edit, selected, preview.version]);

  const posOf = (i: number): Point | null => (drag.current?.id === i ? drag.current.pos : st.positions[i]);

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
      const S = (p: Point) => ({ x: (p.x - bounds.x - t.ox) * t.scale, y: (p.y - bounds.y - t.oy) * t.scale });
      const showBoxes = (debug && layers.boxes) || edit;
      ctx.save();
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      // Dragged image as semi-transparent overlay for alignment.
      const d = drag.current;
      if (edit && selected !== null) {
        const p = posOf(selected);
        const bm = dragBitmap.current;
        if (p && bm && bm.id === selected && d) {
          const a = S(p);
          ctx.globalAlpha = 0.6;
          ctx.drawImage(bm.bitmap, a.x, a.y, st.crops[selected].width * t.scale, st.crops[selected].height * t.scale);
          ctx.globalAlpha = 1;
        }
      }

      if (debug && layers.graph) {
        for (const e of st.layout.edges) {
          const rejected = e.status === 'rejected';
          if (rejected && !layers.rejected) continue;
          const pa = posOf(e.imageA);
          const pb = posOf(e.imageB);
          if (!pa || !pb || !isVisible(st, e.imageA) || !isVisible(st, e.imageB)) continue;
          const ca = S({ x: pa.x + st.crops[e.imageA].width / 2, y: pa.y + st.crops[e.imageA].height / 2 });
          const cb = S({ x: pb.x + st.crops[e.imageB].width / 2, y: pb.y + st.crops[e.imageB].height / 2 });
          const hl = selected !== null && (e.imageA === selected || e.imageB === selected);
          ctx.setLineDash(rejected ? [6, 6] : e.status === 'loop' ? [2, 4] : []);
          ctx.strokeStyle = rejected ? 'rgba(120,120,130,0.8)' : confColor(e.confidence, hl ? 1 : 0.75);
          ctx.lineWidth = hl ? 3 : 2;
          ctx.beginPath();
          ctx.moveTo(ca.x, ca.y);
          ctx.lineTo(cb.x, cb.y);
          ctx.stroke();
          if (hl || t.scale * Math.min(st.crops[e.imageA].width, 1000) > 260) {
            const mx = (ca.x + cb.x) / 2;
            const my = (ca.y + cb.y) / 2;
            const label = `${Math.round(e.confidence * 100)}%`;
            ctx.fillStyle = 'rgba(15,23,42,0.85)';
            ctx.fillRect(mx - 20, my - 9, 40, 18);
            ctx.fillStyle = '#fff';
            ctx.fillText(label, mx, my);
          }
        }
        ctx.setLineDash([]);
      }

      if (debug && layers.features && selected !== null) {
        for (const e of edgesOf(selected)) {
          if (!e.features || e.status === 'rejected') continue;
          const pa = posOf(e.imageA);
          const pb = posOf(e.imageB);
          if (!pa || !pb) continue;
          for (const f of e.features) {
            const a = S({ x: pa.x + f.a.x, y: pa.y + f.a.y });
            const b = S({ x: pb.x + f.b.x, y: pb.y + f.b.y });
            ctx.strokeStyle = f.inlier ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(a.x, a.y, 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(b.x - 4, b.y - 4);
            ctx.lineTo(b.x + 4, b.y + 4);
            ctx.moveTo(b.x + 4, b.y - 4);
            ctx.lineTo(b.x - 4, b.y + 4);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      if (showBoxes) {
        for (let i = 0; i < st.shots.length; i++) {
          const p = posOf(i);
          if (!p || !isVisible(st, i)) continue;
          const a = S(p);
          const w = st.crops[i].width * t.scale;
          const h = st.crops[i].height * t.scale;
          const sel = i === selected;
          ctx.strokeStyle = sel ? '#2563eb' : 'rgba(37,99,235,0.55)';
          ctx.lineWidth = sel ? 3 : 1.25;
          ctx.strokeRect(a.x, a.y, w, h);
          const r = 13;
          ctx.fillStyle = sel ? '#2563eb' : 'rgba(15,23,42,0.8)';
          ctx.beginPath();
          ctx.arc(a.x + r + 6, a.y + r + 6, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(String(i + 1), a.x + r + 6, a.y + r + 6.5);
        }
      }
      ctx.restore();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st, bounds, debug, layers, edit, selected],
  );

  const hitTest = (p: Point): number | null => {
    const gp = { x: p.x + bounds.x, y: p.y + bounds.y };
    const order = selected !== null ? [selected, ...visible.filter((i) => i !== selected).reverse()] : visible.slice().reverse();
    for (const i of order) {
      const q = st.positions[i];
      if (!q || !isVisible(st, i)) continue;
      if (gp.x >= q.x && gp.y >= q.y && gp.x < q.x + st.crops[i].width && gp.y < q.y + st.crops[i].height) return i;
    }
    return null;
  };

  const hooks: PointerHooks = {
    onDown: (p) => {
      const id = hitTest(p);
      if (debug && !edit) {
        setSelected(id);
        return false;
      }
      if (!edit) return false;
      setSelected(id);
      if (id === null) return false;
      const start = st.positions[id]!;
      drag.current = { id, start: p, startPos: start, pos: start };
      return true;
    },
    onMove: (p) => {
      const d = drag.current;
      if (!d) return;
      d.pos = { x: Math.round(d.startPos.x + p.x - d.start.x), y: Math.round(d.startPos.y + p.y - d.start.y) };
      viewer.current?.redraw();
    },
    onUp: async () => {
      const d = drag.current;
      if (!d) return;
      let pos = d.pos;
      const moved = pos.x !== d.startPos.x || pos.y !== d.startPos.y;
      if (moved && snap) {
        const snapped = await engineClient()
          .call<Point | null>('snap', { id: d.id, pos, positions: st.positions.map((q, i) => (i === d.id || !isVisible(st, i) ? null : q)) })
          .catch(() => null);
        if (snapped) pos = snapped;
        setNotice(snapped ? `Screenshot ${d.id + 1} an Nachbarn ausgerichtet.` : `Screenshot ${d.id + 1}: keine passende Überlappung zum Einrasten gefunden.`);
      }
      drag.current = null;
      if (moved) setSt((s) => ({ ...s, positions: s.positions.map((q, i) => (i === d.id ? pos : q)) }));
      else viewer.current?.redraw();
    },
    onHover: (p) => (edit ? (hitTest(p) !== null ? 'move' : 'grab') : debug ? (hitTest(p) !== null ? 'pointer' : 'grab') : null),
  };

  const placeManually = (id: number) => {
    const c = viewer.current?.center() ?? { x: bounds.width / 2, y: bounds.height / 2 };
    const pos = { x: Math.round(c.x + bounds.x - st.crops[id].width / 2), y: Math.round(c.y + bounds.y - st.crops[id].height / 2) };
    setEdit(true);
    setSelected(id);
    setSt((s) => ({ ...s, positions: s.positions.map((q, i) => (i === id ? pos : q)) }));
    setNotice(`Screenshot ${id + 1} wurde in die Mitte gesetzt – ziehe ihn an die passende Stelle. Mit „Einrasten“ richtet er sich automatisch aus.`);
  };

  const removeSelected = () => {
    if (selected === null) return;
    const id = selected;
    setSelected(null);
    setSt((s) => ({ ...s, removed: new Set([...s.removed, id]) }));
  };

  const retry = async () => {
    setRetrying(true);
    try {
      await props.onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const doExport = async (args: ExportArgs, onProgress: (f: number) => void) => {
    const rc = renderClient();
    await rc.call('setScene', buildScene(st).scene);
    return rc.call<ExportResult>('export', args, onProgress);
  };

  const fullscreen = () => {
    const el = document.querySelector('.viewer-shell') as HTMLElement | null;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const selEdges = selected !== null ? edgesOf(selected).sort((a, b) => b.confidence - a.confidence) : [];
  const other = (e: PairMatch, id: number) => (e.imageA === id ? e.imageB : e.imageA);
  const total = st.shots.length;

  return (
    <div className="result">
      <div className="result-bar">
        <button className="btn ghost small" onClick={props.onBack}>
          <Icon name="back" /> Screenshots
        </button>
        <dl className="stats" data-testid="stats">
          <div>
            <dt>Screenshots</dt>
            <dd data-testid="stat-used">
              {visible.length} / {total} verwendet
            </dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd data-testid="stat-size">{fmtSize(bounds.width, bounds.height)}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd data-testid="stat-conf">{fmtPercent(st.layout.confidence)}</dd>
          </div>
          {st.layout.grid && (
            <div>
              <dt>Raster</dt>
              <dd data-testid="stat-grid">
                {st.layout.grid.rows} × {st.layout.grid.cols}
              </dd>
            </div>
          )}
        </dl>
        <div className="result-actions">
          <div className="segmented small" title="Übergänge zwischen Screenshots">
            <button className={st.mode === 'hard' ? 'on' : ''} onClick={() => setSt((s) => ({ ...s, mode: 'hard' }))}>
              Harter Schnitt
            </button>
            <button className={st.mode === 'feather' ? 'on' : ''} onClick={() => setSt((s) => ({ ...s, mode: 'feather' }))}>
              Weich
            </button>
          </div>
          <button className={`btn small ${debug ? 'secondary on' : 'ghost'}`} onClick={() => setDebug(!debug)} data-testid="debug-toggle">
            <Icon name="bug" /> Debug
          </button>
          <button
            className={`btn small ${edit ? 'secondary on' : 'ghost'}`}
            onClick={() => {
              setEdit(!edit);
              if (edit) setSelected(null);
            }}
          >
            <Icon name="edit" /> {edit ? 'Bearbeiten beenden' : 'Layout bearbeiten'}
          </button>
          <button className="btn primary small" onClick={() => setShowExport(true)} data-testid="export-open">
            <Icon name="download" /> Exportieren
          </button>
        </div>
      </div>

      {(unmatched.length > 0 || st.layout.warnings.length > 0) && (
        <div className="unmatched" data-testid="unmatched">
          <div className="unmatched-head">
            <Icon name="warn" />
            <div>
              <strong>
                {unmatched.length === 1 ? '1 Screenshot konnte' : `${unmatched.length} Screenshots konnten`} nicht sicher zugeordnet werden.
              </strong>
              <span> Versuche mindestens 25 % Überlappung zwischen den Screenshots.</span>
            </div>
            <button className="btn secondary small" onClick={retry} disabled={retrying}>
              <Icon name="refresh" /> {retrying ? 'Suche …' : 'Erneut versuchen'}
            </button>
          </div>
          <ul className="unmatched-list">
            {unmatched.map((id) => (
              <li key={id}>
                <img src={st.shots[id].thumbUrl} alt="" />
                <div>
                  <strong>Screenshot {id + 1}</strong>
                  <span>Keine ausreichende Überlappung gefunden</span>
                  <div className="row">
                    <button className="btn ghost tiny" onClick={() => placeManually(id)}>
                      Manuell platzieren
                    </button>
                    <button className="btn ghost tiny" onClick={() => setSt((s) => ({ ...s, ignored: new Set([...s.ignored, id]) }))}>
                      Ignorieren
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="viewer-area">
        <div className="viewer-shell">
          <MapViewer
            ref={viewer}
            width={bounds.width}
            height={bounds.height}
            preview={preview}
            version={preview.version}
            requestTile={(region, scale, version) => renderClient().call<ImageBitmap | null>('tile', { region, scale, version })}
            drawOverlay={drawOverlay}
            hooks={hooks}
            onViewChange={(t) => setZoom(t.scale)}
          />
          <div className="viewer-tools">
            <button className="icon-btn" onClick={() => viewer.current?.zoomBy(1.5)} aria-label="Hineinzoomen">
              <Icon name="zoomIn" />
            </button>
            <button className="icon-btn" onClick={() => viewer.current?.zoomBy(1 / 1.5)} aria-label="Herauszoomen">
              <Icon name="zoomOut" />
            </button>
            <button className="icon-btn text" onClick={() => viewer.current?.fit()} title="Ganze Karte anzeigen">
              <Icon name="fit" />
            </button>
            <button className="icon-btn text" onClick={() => viewer.current?.zoomTo(1)} title="Originalgröße (100 %)">
              100%
            </button>
            <button className="icon-btn" onClick={fullscreen} aria-label="Vollbild">
              <Icon name="full" />
            </button>
            <span className="zoom-label">{zoom >= 0.1 ? `${Math.round(zoom * 100)} %` : `${(zoom * 100).toFixed(1)} %`}</span>
          </div>
          {updating && <div className="viewer-badge">Vorschau wird aktualisiert …</div>}
          {edit && (
            <div className="edit-bar">
              <span>
                <Icon name="hand" /> Screenshot anklicken und ziehen
              </span>
              <label className="check">
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> <Icon name="magnet" /> Einrasten
              </label>
              <button className="btn ghost tiny" disabled={selected === null} onClick={removeSelected}>
                <Icon name="trash" /> {selected !== null ? `Screenshot ${selected + 1} entfernen` : 'Entfernen'}
              </button>
              {st.removed.size > 0 && (
                <button className="btn ghost tiny" onClick={() => setSt((s) => ({ ...s, removed: new Set() }))}>
                  {st.removed.size} entfernte wiederherstellen
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="toast" onClick={() => setNotice(null)}>
              {notice}
            </div>
          )}
        </div>

        {debug && (
          <aside className="debug-panel" data-testid="debug-panel">
            <h3>Debug</h3>
            <div className="debug-layers">
              {(
                [
                  ['boxes', 'Bounding Boxes'],
                  ['graph', 'Nachbarschafts-Graph'],
                  ['rejected', 'Verworfene Kanten'],
                  ['features', 'Feature Matches'],
                ] as [keyof DebugLayers, string][]
              ).map(([k, label]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {label}
                </label>
              ))}
            </div>
            <div className="legend">
              <span className="sw" style={{ background: confColor(0.9) }} /> ≥ 80 %
              <span className="sw" style={{ background: confColor(0.6) }} /> 50–80 %
              <span className="sw" style={{ background: confColor(0.2) }} /> &lt; 50 %
            </div>
            <p className="muted small">
              {st.layout.edges.filter((e) => e.status !== 'rejected').length} Kanten verwendet ·{' '}
              {st.layout.edges.filter((e) => e.status === 'rejected').length} verworfen
            </p>
            {selected === null ? (
              <p className="muted">Klicke auf einen Screenshot, um Nachbarn, Verschiebungen und Feature Matches zu sehen.</p>
            ) : (
              <div className="debug-sel">
                <h4>Screenshot {selected + 1}</h4>
                <p className="mono small">
                  Position: x = {fmtInt(st.positions[selected]?.x ?? 0)}, y = {fmtInt(st.positions[selected]?.y ?? 0)}
                  <br />
                  Ausschnitt: {st.crops[selected].width} × {st.crops[selected].height}
                </p>
                <table className="edge-table">
                  <thead>
                    <tr>
                      <th>Nachbar</th>
                      <th>dx</th>
                      <th>dy</th>
                      <th>Conf.</th>
                      <th>Matches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selEdges.map((e, k) => {
                      const sign = e.imageA === selected ? 1 : -1;
                      return (
                        <tr key={k} className={e.status === 'rejected' ? 'rejected' : ''} title={e.rejectReason ?? (e.status === 'loop' ? 'Zusätzliche Kante (Schleife)' : 'Kante im Layout')}>
                          <td>#{other(e, selected) + 1}</td>
                          <td>{fmtInt(sign * e.dx)}</td>
                          <td>{fmtInt(sign * e.dy)}</td>
                          <td style={{ color: e.status === 'rejected' ? undefined : confColor(e.confidence) }}>{Math.round(e.confidence * 100)}%</td>
                          <td>
                            {e.numberOfMatches} ({Math.round(e.inlierRatio * 100)}%)
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {selEdges.some((e) => e.status === 'rejected') && <p className="muted small">Graue Zeilen: verworfene Kanten (Tooltip zeigt den Grund).</p>}
              </div>
            )}
          </aside>
        )}
      </div>

      {showExport && <ExportDialog width={bounds.width} height={bounds.height} onExport={doExport} onClose={() => setShowExport(false)} />}
    </div>
  );
}
