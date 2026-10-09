import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureGuide } from './components/CaptureGuide';
import { CropDialog } from './components/CropDialog';
import { DropZone, filterImages, useFilePicker, useWindowDrop } from './components/DropZone';
import { Icon } from './components/Icon';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultView, renderPreview, type Preview } from './components/ResultView';
import { ThumbnailGrid } from './components/ThumbnailGrid';
import { newKey, type FixedUiState, type Shot, type StitchState } from './state';
import { DEFAULT_SETTINGS, type LayoutResult, type ProgressInfo, type Rect, type SeamMode, type StitchSettings } from './types';
import { fmtInt, friendlyError } from './utils/format';
import { engineClient, resetEngineClient } from './workers/clients';
import type { FixedUiResult, StitchResult, ThumbResult, WorkItem } from './workers/protocol';

interface ErrorInfo {
  title: string;
  hint?: string;
}

const workItems = (shots: Shot[]): WorkItem[] => shots.map((s) => ({ key: s.key, file: s.file, width: s.width, height: s.height }));

export default function App() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [fixedUi, setFixedUi] = useState<FixedUiState>({ enabled: true, coverage: null, mask: null, workScale: 1 });
  const [settings, setSettings] = useState<StitchSettings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<SeamMode>('hard');
  const [showCrop, setShowCrop] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ st: StitchState; preview: Preview } | null>(null);
  const [view, setView] = useState<'select' | 'result'>('select');
  const runId = useRef(0);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  const loading = shots.some((s) => !s.width);

  const addFiles = useCallback(async (files: File[]) => {
    const { ok, rejected } = filterImages(files);
    if (rejected.length) setNotice(`${rejected.length} Datei(en) übersprungen – unterstützt werden PNG, JPEG und WebP.`);
    if (!ok.length) return;
    setError(null);
    const fresh: Shot[] = ok.map((f) => ({ key: newKey(), file: f, name: f.name, width: 0, height: 0, thumbUrl: '' }));
    setShots((s) => [...s, ...fresh]);
    const failed: string[] = [];
    await Promise.all(
      fresh.map(async (shot) => {
        try {
          const r = await engineClient().call<ThumbResult>('thumbnail', { file: shot.file });
          const thumbUrl = URL.createObjectURL(r.thumb);
          setShots((s) => s.map((x) => (x.key === shot.key ? { ...x, width: r.width, height: r.height, thumbUrl } : x)));
        } catch {
          failed.push(shot.name);
          setShots((s) => s.filter((x) => x.key !== shot.key));
        }
      }),
    );
    if (failed.length) setError({ title: `${failed.join(', ')} konnte nicht gelesen werden.`, hint: 'Unterstützt werden PNG-, JPEG- und WebP-Dateien.' });
  }, []);

  const removeShot = (key: string) => {
    setShots((s) => {
      const x = s.find((i) => i.key === key);
      if (x?.thumbUrl) URL.revokeObjectURL(x.thumbUrl);
      return s.filter((i) => i.key !== key);
    });
    void engineClient().call('forget', { keys: [key] });
  };

  const clearAll = () => {
    shots.forEach((s) => s.thumbUrl && URL.revokeObjectURL(s.thumbUrl));
    setShots([]);
    setCrop(null);
    setFixedUi({ enabled: true, coverage: null, mask: null, workScale: 1 });
    setResult(null);
    setError(null);
    void engineClient().call('forget', { keys: [], all: true });
  };

  const loadSample = async () => {
    setNotice('Beispieldaten werden geladen …');
    try {
      const manifest: { files: string[] } = await (await fetch('./samples/manifest.json')).json();
      const files = await Promise.all(
        manifest.files.map(async (name) => {
          const blob = await (await fetch(`./samples/${name}`)).blob();
          return new File([blob], name, { type: blob.type || 'image/png' });
        }),
      );
      setNotice(null);
      await addFiles(files);
    } catch {
      setNotice('Die Beispieldaten konnten nicht geladen werden.');
    }
  };

  // Size consistency check.
  const sizeWarning = (() => {
    const ready = shots.filter((s) => s.width);
    if (ready.length < 2) return null;
    const count = new Map<string, number>();
    ready.forEach((s) => count.set(`${s.width}×${s.height}`, (count.get(`${s.width}×${s.height}`) ?? 0) + 1));
    const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const odd = shots.map((s, i) => ({ s, i })).filter(({ s }) => s.width && `${s.width}×${s.height}` !== main);
    if (!odd.length) return null;
    const list = odd.slice(0, 5).map(({ s, i }) => `${i + 1} (${s.width} × ${s.height})`).join(', ');
    return { text: `Abweichende Größe bei Screenshot ${list}${odd.length > 5 ? ' …' : ''} – erwartet ${main.replace('×', ' × ')}. Die Zoomstufe muss identisch sein.`, keys: new Set(odd.map(({ s }) => s.key)) };
  })();

  const toState = (shotList: Shot[], res: StitchResult, layout: LayoutResult = res.layout): StitchState => ({
    shots: shotList,
    layout,
    positions: layout.positions.map((p) => (p ? { ...p } : null)),
    removed: new Set(),
    ignored: new Set(),
    crops: res.crops,
    workScale: res.workScale,
    fixedMask: res.fixedMask,
    mode,
  });

  const lastRes = useRef<StitchResult | null>(null);

  const stitch = async () => {
    const id = ++runId.current;
    const list = shotsRef.current.filter((s) => s.width);
    setError(null);
    setProgress({ step: 'prepare', fraction: 0, message: `0 von ${list.length} Bildern vorbereitet` });
    try {
      const res = await engineClient().call<StitchResult>(
        'stitch',
        { items: workItems(list), crop, useFixedUi: fixedUi.enabled, settings },
        (p: ProgressInfo) => id === runId.current && setProgress(p),
      );
      if (id !== runId.current) return;
      if (res.layout.placed.length < 2) {
        setProgress(null);
        setError({
          title: 'Zwischen den Screenshots wurde keine ausreichende Überlappung gefunden.',
          hint: 'Versuche mindestens 25 % Überlappung zwischen den Screenshots, gleiche Zoomstufe und gleiche Fenstergröße. Prüfe auch den Crop-Bereich.',
        });
        return;
      }
      lastRes.current = res;
      if (res.autoCrop) {
        const c = res.autoCrop;
        setNotice(`Statische Leisten erkannt – Kartenbereich automatisch auf ${Math.round(c.width)} × ${Math.round(c.height)} px zugeschnitten.`);
      }
      const st = toState(list, res);
      setProgress({ step: 'render', fraction: 0, message: 'Karte wird aus den Originalbildern gerendert …' });
      const preview = await renderPreview(st, (f) => id === runId.current && setProgress({ step: 'render', fraction: f, message: `Vorschau ${Math.round(f * 100)} %` }));
      if (id !== runId.current) return preview.bitmap.close();
      setResult((old) => {
        old?.preview.bitmap.close();
        return { st, preview };
      });
      setView('result');
    } catch (e) {
      if (id === runId.current) setError(friendlyError(e));
    } finally {
      if (id === runId.current) setProgress(null);
    }
  };

  const cancel = () => {
    runId.current++;
    resetEngineClient();
    setProgress(null);
    setNotice('Analyse abgebrochen.');
  };

  const retry = async () => {
    if (!result || !lastRes.current) return;
    try {
      const layout = await engineClient().call<LayoutResult>('retry');
      const before = result.st.layout.unmatched.length;
      setResult((r) => (r ? { ...r, st: { ...toState(r.st.shots, lastRes.current!, layout), mode: r.st.mode } } : r));
      const found = before - layout.unmatched.length;
      setNotice(found > 0 ? `${found} weitere(r) Screenshot(s) zugeordnet.` : 'Auch im zweiten Versuch wurde keine sichere Überlappung gefunden. Du kannst die Screenshots manuell platzieren.');
    } catch (e) {
      setNotice(friendlyError(e).title);
    }
  };

  const detectUi = (onProgress: (f: number) => void) =>
    engineClient().call<FixedUiResult>('detectFixedUi', { items: workItems(shots.filter((s) => s.width)), workingSize: settings.workingSize }, (p: ProgressInfo) => onProgress(p.fraction));

  const picker = useFilePicker(addFiles);
  const windowDrop = useWindowDrop(addFiles, shots.length > 0 && view === 'select' && !progress);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const header = (
    <header className="topbar">
      <button className="brand" onClick={() => setView(result && view === 'select' ? 'result' : 'select')} aria-label="Map Stitcher">
        <span className="brand-mark">
          <Icon name="map" size={18} />
        </span>
        MAP STITCHER
      </button>
      <div className="topbar-right">
        <span className="privacy" data-testid="privacy">
          <Icon name="lock" size={15} /> Deine Bilder verlassen deinen Browser nicht.
        </span>
        <button className="btn ghost small" onClick={() => setShowGuide(true)}>
          <Icon name="info" /> Aufnahme-Tipps
        </button>
      </div>
    </header>
  );

  return (
    <div className={`app ${view === 'result' && result ? 'is-result' : ''}`} {...windowDrop.handlers}>
      {header}
      {view === 'result' && result ? (
        <ResultView
          key={result.preview.version}
          st={result.st}
          setSt={(fn) => setResult((r) => (r ? { ...r, st: fn(r.st) } : r))}
          initialPreview={result.preview}
          onBack={() => setView('select')}
          onRetry={retry}
        />
      ) : shots.length === 0 ? (
        <main className="start">
          <section className="hero">
            <h1>MAP STITCHER</h1>
            <p className="tagline">Viele Screenshots. Eine Karte.</p>
            <DropZone onFiles={addFiles} />
            <div className="hero-meta">
              <span>
                <Icon name="lock" size={15} /> 100 % lokal – kein Upload, kein Server, kein Login.
              </span>
              <button className="link" onClick={loadSample} data-testid="load-sample">
                Beispieldaten laden (20 Screenshots)
              </button>
            </div>
          </section>
          <CaptureGuide />
          <section className="how">
            <div>
              <h3>Reihenfolge egal</h3>
              <p>Die App erkennt anhand der Bildinhalte selbst, welche Screenshots benachbart sind und wie sie überlappen.</p>
            </div>
            <div>
              <h3>Pixelgenau</h3>
              <p>Reine Verschiebung statt Panorama-Verzerrung – abgeglichen in Originalauflösung.</p>
            </div>
            <div>
              <h3>Riesige Karten</h3>
              <p>Export als PNG in voller Auflösung oder als Kacheln – auch jenseits der Canvas-Limits.</p>
            </div>
          </section>
        </main>
      ) : (
        <main className="workspace">
          <div className="ws-head">
            <div>
              <h2 data-testid="count">
                {fmtInt(shots.length)} Screenshot{shots.length === 1 ? '' : 's'} geladen
              </h2>
              <p className="muted">
                {loading
                  ? 'Vorschaubilder werden erstellt …'
                  : crop
                    ? `Kartenbereich: ${crop.width} × ${crop.height} px ab (${crop.x}, ${crop.y})`
                    : 'Ganzer Screenshot wird verwendet.'}
                {fixedUi.enabled ? ' · Fixe UI wird automatisch ausgeblendet.' : ''}
              </p>
            </div>
            <div className="ws-actions">
              {picker.input}
              <button className="btn ghost" onClick={picker.open} disabled={!!progress}>
                <Icon name="plus" /> Bilder hinzufügen
              </button>
              <button className="btn ghost" onClick={clearAll} disabled={!!progress}>
                <Icon name="trash" /> Alle entfernen
              </button>
              <button className="btn ghost" onClick={() => setShowCrop(true)} disabled={!!progress || loading || !shots.length} data-testid="crop-open">
                <Icon name="crop" /> Crop einstellen
              </button>
            </div>
          </div>

          {sizeWarning && (
            <p className="callout warn">
              <Icon name="warn" /> {sizeWarning.text}
            </p>
          )}

          <div className="ws-main">
            <div className="ws-grid">
              <ThumbnailGrid shots={shots} onRemove={removeShot} highlight={sizeWarning?.keys} />
            </div>
            <aside className="ws-side">
              {progress ? (
                <ProgressPanel progress={progress} onCancel={cancel} />
              ) : (
                <div className="cta-card">
                  <button className="btn hero-btn" onClick={stitch} disabled={shots.length < 2 || loading} data-testid="stitch">
                    KARTE ZUSAMMENSETZEN
                  </button>
                  {shots.length < 2 && <p className="muted small">Mindestens zwei Screenshots hinzufügen.</p>}
                  {result && (
                    <button className="btn ghost small full" onClick={() => setView('result')}>
                      Letztes Ergebnis anzeigen
                    </button>
                  )}
                  <details className="settings">
                    <summary>Einstellungen</summary>
                    <div className="field">
                      <span className="field-label">Übergänge</span>
                      <div className="segmented small">
                        <button className={mode === 'hard' ? 'on' : ''} onClick={() => setMode('hard')}>
                          Harter Schnitt
                        </button>
                        <button className={mode === 'feather' ? 'on' : ''} onClick={() => setMode('feather')}>
                          Weich
                        </button>
                      </div>
                    </div>
                    <label className="check">
                      <input type="checkbox" checked={fixedUi.enabled} onChange={(e) => setFixedUi({ ...fixedUi, enabled: e.target.checked })} />
                      Fixe UI automatisch ausblenden
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={settings.fullResRefine} onChange={(e) => setSettings({ ...settings, fullResRefine: e.target.checked })} />
                      Feinausrichtung in Originalauflösung
                    </label>
                    <div className="field">
                      <span className="field-label">Analyse-Auflösung</span>
                      <select className="select" value={settings.workingSize} onChange={(e) => setSettings({ ...settings, workingSize: +e.target.value })}>
                        <option value={800}>800 px (schnell)</option>
                        <option value={1024}>1024 px (Standard)</option>
                        <option value={1400}>1400 px (genau)</option>
                      </select>
                    </div>
                  </details>
                </div>
              )}
              {error && (
                <div className="callout error" role="alert" data-testid="error">
                  <strong>{error.title}</strong>
                  {error.hint && <span>{error.hint}</span>}
                </div>
              )}
              <CaptureGuide compact />
            </aside>
          </div>
          {windowDrop.active && <div className="drop-overlay">Screenshots hier ablegen</div>}
        </main>
      )}

      {showCrop && shots.length > 0 && (
        <CropDialog
          shots={shots.filter((s) => s.width)}
          crop={crop}
          fixedUi={fixedUi}
          onDetect={detectUi}
          onClose={() => setShowCrop(false)}
          onApply={(c, f) => {
            setCrop(c);
            setFixedUi(f);
            setShowCrop(false);
          }}
        />
      )}
      {showGuide && (
        <div className="modal-backdrop" onClick={() => setShowGuide(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <div />
              <button className="icon-btn" onClick={() => setShowGuide(false)} aria-label="Schließen">
                <Icon name="close" />
              </button>
            </header>
            <CaptureGuide />
          </div>
        </div>
      )}
      {notice && (
        <div className="toast global" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  );
}
