import { useMemo, useState } from 'react';
import { estimateExport, probeCanvasLimits, type ExportFormat } from '../export/limits';
import { downloadBlob, fmtBytes, fmtSize, friendlyError } from '../utils/format';
import type { ExportArgs, ExportResult } from '../workers/protocol';
import { Icon } from './Icon';

const SCALES = [
  { v: 1, label: 'Originalauflösung' },
  { v: 0.5, label: '50 %' },
  { v: 0.25, label: '25 %' },
];

export function ExportDialog(props: {
  width: number;
  height: number;
  onExport: (args: ExportArgs, onProgress: (f: number) => void) => Promise<ExportResult>;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(0.9);
  const [tiledChoice, setTiled] = useState<boolean | null>(null);
  const [tileSize, setTileSize] = useState(4096);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const limits = useMemo(() => probeCanvasLimits(), []);
  const W = Math.max(1, Math.round(props.width * scale));
  const H = Math.max(1, Math.round(props.height * scale));
  const est = estimateExport(W, H, format, limits);
  const tiled = tiledChoice ?? !est.singleFile;
  const memWarn = est.memory > 2.5e9;

  const run = async () => {
    setBusy(0);
    setError(null);
    setDone(null);
    try {
      const res = await props.onExport({ format, scale, quality, tiled, tileSize }, (f) => setBusy(f));
      downloadBlob(res.blob, res.filename);
      setDone(`${res.filename} (${fmtBytes(res.blob.size)}) wurde heruntergeladen.`);
    } catch (e) {
      const f = friendlyError(e);
      setError(f.hint ? `${f.title} ${f.hint}` : f.title);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal">
        <header className="modal-head">
          <div>
            <h2 id="export-title">Karte exportieren</h2>
            <p>Der Export wird direkt aus den Originalbildern berechnet – lokal in deinem Browser.</p>
          </div>
          <button className="icon-btn" onClick={props.onClose} aria-label="Schließen" disabled={busy !== null}>
            <Icon name="close" />
          </button>
        </header>
        <div className="form">
          <div className="field">
            <span className="field-label">Format</span>
            <div className="segmented">
              {(['png', 'jpeg', 'webp'] as ExportFormat[]).map((f) => (
                <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Auflösung</span>
            <div className="segmented">
              {SCALES.map((s) => (
                <button key={s.v} className={scale === s.v ? 'on' : ''} onClick={() => setScale(s.v)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {format !== 'png' && (
            <div className="field">
              <span className="field-label">Qualität {Math.round(quality * 100)} %</span>
              <input type="range" min={0.5} max={1} step={0.01} value={quality} onChange={(e) => setQuality(+e.target.value)} />
            </div>
          )}
          <div className="field">
            <label className="check">
              <input type="checkbox" checked={tiled} onChange={(e) => setTiled(e.target.checked)} />
              Als mehrere Kacheln exportieren (ZIP)
            </label>
            {tiled && (
              <select value={tileSize} onChange={(e) => setTileSize(+e.target.value)} className="select">
                {[2048, 4096, 8192].map((t) => (
                  <option key={t} value={t}>
                    Kacheln à {t} px
                  </option>
                ))}
              </select>
            )}
          </div>
          <dl className="estimate">
            <div>
              <dt>Pixelgröße</dt>
              <dd>{fmtSize(W, H)}</dd>
            </div>
            <div>
              <dt>Dateigröße (geschätzt)</dt>
              <dd>≈ {fmtBytes(est.fileSize)}</dd>
            </div>
            <div>
              <dt>RAM-Verbrauch (geschätzt)</dt>
              <dd className={memWarn ? 'warn-text' : ''}>≈ {fmtBytes(est.memory)}</dd>
            </div>
          </dl>
          {!est.singleFile && (
            <p className="callout warn">
              <Icon name="warn" /> {est.reason} Exportiere als Kacheln (ZIP) oder in geringerer Auflösung.
            </p>
          )}
          {memWarn && <p className="callout">Sehr großer Export – schließe andere Tabs oder wähle 50 % bzw. Kacheln, falls der Browser abbricht.</p>}
          {error && <p className="callout error">{error}</p>}
          {done && (
            <p className="callout ok">
              <Icon name="check" /> {done}
            </p>
          )}
        </div>
        <footer className="modal-foot">
          {busy !== null && (
            <div className="bar inline">
              <div className="bar-fill" style={{ width: `${busy * 100}%` }} />
            </div>
          )}
          <button className="btn ghost" onClick={props.onClose} disabled={busy !== null}>
            Schließen
          </button>
          <button className="btn primary" onClick={run} disabled={busy !== null || (!tiled && !est.singleFile)} data-testid="export-run">
            <Icon name="download" />
            {busy !== null ? `Exportiere … ${Math.round(busy * 100)} %` : 'Exportieren'}
          </button>
        </footer>
      </div>
    </div>
  );
}
