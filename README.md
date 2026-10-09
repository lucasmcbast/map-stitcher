# MAP STITCHER

**Viele Screenshots. Eine Karte.**

Map Stitcher setzt viele überlappende Screenshots einer digitalen Karte automatisch zu einer einzigen großen, nahtlosen Karte zusammen – **vollständig lokal im Browser**. Die Bilder werden nirgendwohin hochgeladen, es gibt keinen Server, keine Datenbank, kein Login und keine Analytics.

Die Reihenfolge der Screenshots ist egal: Die App erkennt allein aus den Bildinhalten, welche Screenshots Nachbarn sind, wie sie zueinander liegen (links/rechts/oben/unten), wie groß die Überlappung ist und welche exakte X/Y-Verschiebung zwischen ihnen besteht.

## Funktionen

- Drag & Drop von PNG, JPEG, WebP (EXIF-Orientierung wird berücksichtigt), nummeriertes Thumbnail-Grid
- **Automatisches Stitching in beliebiger Upload-Reihenfolge** (translation-only, pixelgenau)
- **Crop-Bereich** per Rechteck für alle Screenshots + **„Fixe UI automatisch erkennen“** (Browserleisten, Suchfelder, Zoom-Buttons, Legenden, Copyright werden maskiert bzw. weggeschnitten)
- Echter Fortschritt in 5 Schritten („32 von 67 Bildern analysiert“), Analyse in Web Workern – die Oberfläche friert nicht ein
- Zoombare Ergebnisansicht (Zoom, Pan, Pinch, Fit to Screen, 100 %, Vollbild) mit Nachladen von Kacheln in Originalauflösung
- **Debug-Modus**: Bounding Boxes, Nummern, Nachbarschafts-Graph mit Confidence, dx/dy, Feature Matches (Inlier/Outlier), globale Positionen, verworfene Kanten mit Begründung
- **Layout bearbeiten**: Screenshots anklicken, verschieben (halbtransparentes Overlay), entfernen, **Einrasten** an Nachbarn
- **Nicht zuordenbare Screenshots** werden nie geraten platziert, sondern separat angezeigt: *Erneut versuchen*, *Manuell platzieren*, *Ignorieren*
- Übergänge: **Harter Schnitt (Best Match)** oder **Weiche Überblendung (Feather)**
- **Export** PNG / JPEG / WebP in Originalauflösung, 50 % oder 25 % – mit Schätzung von Pixelgröße, Dateigröße und RAM-Bedarf; sehr große Karten als **gestreamtes PNG** (ohne Canvas-Limit) oder als **ZIP mit Kacheln**
- Integrierte Aufnahme-Tipps und Beispieldatensatz (20 Screenshots) zum Ausprobieren

## Schnellstart

```bash
npm install
npm run dev        # http://localhost:5173
```

Production-Build:

```bash
npm run build      # Typecheck + Build nach dist/
npm run preview    # Build lokal ansehen
```

Voraussetzung: Node.js ≥ 20 (getestet mit Node 22).

## Tests

```bash
npm test                    # Unit- und Algorithmus-Tests (Vitest, Node)
npm run test:e2e            # End-to-End-Test des Builds in echtem Chromium (vorher npm run build)
npm run generate:testdata   # synthetischen Testdatensatz neu erzeugen (public/samples)
```

Die **Algorithmus-Tests** (`tests/stitching.test.ts`) erzeugen programmatisch eine Karte mit Straßen (mit Randlinien), regelmäßigem Straßenraster (bewusst repetitiv), Fluss, Bahnlinie, Parks, Wasser, Gebäuden, schraffierten/gepunkteten Flächen und Text-Labels (eigener Bitmap-Font). Daraus werden überlappende „Screenshots“ mit Hand-Verschiebungs-Jitter geschnitten und **zufällig gemischt**. Getestet wird:

| Szenario | Erwartung |
| --- | --- |
| **4 × 5 Raster, 30 % Überlappung, zufällige Reihenfolge** (Hauptkriterium) | alle 20 platziert, Positionsfehler ≤ 1 px, Raster 4 × 5 mit korrekter Zeile/Spalte je Bild, gerendertes Mosaik **100 % pixelidentisch** mit der Originalkarte |
| horizontale Reihe (1 × 6), vertikale Reihe (6 × 1) | exakt |
| 20 % und 40 % Überlappung | exakt |
| ein fehlendes Bild im Raster | übrige exakt, keine Fehlplatzierung |
| ein nicht zuordenbares Bild (andere Karte) | wird **nicht** platziert, Meldung „Zwischen Screenshot N und den übrigen Bildern …“ |
| fixe Browser-UI auf jedem Screenshot | Header wird erkannt und abgeschnitten, Layout exakt |
| 4 weitere Karten (Seeds), Kompressionsrauschen, 6 × 8 = 48 Bilder | exakt |
| Einrasten nach grober manueller Platzierung (±110 px) | exakte Position |
| mitgelieferter Datensatz `public/samples` (PNG-Dateien) | exakt, Raster 4 × 5 |

Dazu kommen Unit-Tests für FFT, Least Squares, PNG-Encoder (Round-Trip), ZIP-Writer und Compositor.

Der **E2E-Test** (`scripts/e2e.mjs`) startet den Production-Build in Chromium, lädt die 20 Beispiel-Screenshots, nutzt die automatische UI-Erkennung im Crop-Dialog, setzt die Karte zusammen (Web Worker + verschachtelter Matching-Worker-Pool), prüft „20 / 20 verwendet“ und „Raster 4 × 5“, öffnet den Debug-Modus, verschiebt einen Screenshot und prüft, dass „Einrasten“ ihn exakt zurücksetzt, und exportiert ein PNG. Screenshots der einzelnen Schritte landen in `test-results/`.

### Testdatensatz

`public/samples/` enthält 20 synthetische Screenshots (1280 × 800, 4 × 5 Raster, 30 % Überlappung, ±14 px Jitter, fixe Browser-UI, zufällige Reihenfolge) sowie `truth.json` mit den wahren Positionen. In der App: **„Beispieldaten laden“**.

## Deployment

Das Ergebnis von `npm run build` ist eine rein statische Seite in `dist/` (relative Pfade, `base: './'`) und läuft ohne Anpassung unter jedem Pfad.

- **Vercel**: Repository importieren – das Framework „Vite“ wird erkannt; `vercel.json` liegt bei (Build `npm run build`, Output `dist`, Security- und Cache-Header). Alternativ: `npx vercel --prod`.
- **Netlify**: Repository verbinden – `netlify.toml` ist enthalten. Alternativ `dist/` per Drag & Drop hochladen.
- **GitHub Pages**: Der Workflow `.github/workflows/pages.yml` baut bei jedem Push auf `main` und veröffentlicht `dist/` (in den Repo-Einstellungen *Pages → Source: GitHub Actions*).

Es werden keine speziellen Header (COOP/COEP) benötigt; die App verwendet keinen SharedArrayBuffer. `.github/workflows/ci.yml` führt Typecheck, Tests, Build und E2E-Test bei jedem Push aus.

## Architektur

```
src/
  types/        gemeinsame Typen (PairMatch, LayoutResult, …)
  vision/       Bildverarbeitung: FFT, Phasenkorrelation, ZNCC, Harris-Keypoints + Deskriptoren,
                Graustufen/Pyramide, Fixed-UI-Erkennung
  stitching/    Pipeline: Grob-Matching, Verfeinerung, Graph-Layout, Least Squares, Rastererkennung
  export/       Compositor (harter Schnitt / Feather), Streaming-PNG-Encoder, ZIP-Writer, Canvas-Limits
  workers/      engine.worker (Analyse), match.worker (Paar-Matching-Pool), render.worker (Vorschau,
                Kacheln, Export), RPC-Protokoll
  components/   React-UI (DropZone, ThumbnailGrid, CropDialog, ProgressPanel, MapViewer, ResultView,
                ExportDialog, CaptureGuide)
  utils/        Dekodierung (EXIF), LRU-Cache, Formatierung, verständliche Fehlermeldungen
tests/          Vitest-Tests + synthetischer Kartengenerator
scripts/        Testdaten-Generator, E2E-Test
public/samples  Beispieldatensatz
```

| Thread | Aufgabe |
| --- | --- |
| Main (React) | UI, Viewer (Canvas), Zustand, Bearbeitung |
| `engine.worker` | Dekodieren, Thumbnails, Arbeitskopien, Fixed-UI, Features, Verfeinerung, Layout, Feinausrichtung, Einrasten |
| `match.worker` × (Kerne − 1) | O(n²)-Paarsuche (verschachtelte Worker des Engine-Workers; Fallback: im Engine-Worker) |
| `render.worker` | Komposition aus den Originalbildern: Vorschau, Zoom-Kacheln, Export (PNG gestreamt, JPEG/WebP, ZIP) |

Die gesamte Pipeline (`StitchEngine` in `src/stitching/pipeline.ts`) ist reines TypeScript ohne DOM-Abhängigkeit – exakt derselbe Code läuft im Worker und in den Node-Tests.

## Stitching-Algorithmus

Da alle Bilder Ausschnitte **derselben flachen 2D-Karte bei identischem Zoom** sind, wird bewusst **kein** Panorama-Stitcher (Homographie, Warping, Bundle Adjustment, Blending) verwendet, sondern ein reines **Translations-Modell**: Gesucht ist pro Bildpaar nur `(dx, dy)`.

1. **Vorverarbeitung** – Dekodieren mit EXIF-Orientierung (`createImageBitmap(…, { imageOrientation: 'from-image' })`), Thumbnail, Graustufen-**Arbeitskopie** mit gemeinsamem Maßstab (lange Kante ≈ 1024 px, einstellbar 800–1400) und Pyramide (1024 → 512 → 256 → 128). Originale werden nie dauerhaft verkleinert; Export und Feinausrichtung nutzen die Originalpixel.
2. **Crop & fixe UI** – Der Crop gilt für alle Screenshots. Die Auto-Erkennung sucht Pixel, die in ≥ 75 % der Screenshots (fast) identisch sind, obwohl sich die Karte bewegt, und maskiert texturierte statische Strukturen (Buttons, Texte, Legenden). Statische Leisten am Rand werden als Crop vorgeschlagen bzw. ohne manuellen Crop automatisch abgeschnitten. Maskierte Pixel zählen beim Matching nicht und haben beim Rendern minimales Gewicht.
3. **Paarweises Grob-Matching (alle Paare, parallel)** – Für jedes Bild wird einmal das FFT-Spektrum der 128-px-Ebene berechnet (mittelwertfrei, Tukey-Fenster). Pro Paar liefert die **Phasenkorrelation** (normierte Kreuzleistung, zwei Paare pro inverser FFT) die sechs stärksten Translations-Peaks. Jeder Peak wird entfaltet (zyklische Mehrdeutigkeit → bis zu vier Kandidaten), per **maskierter ZNCC** auf der Überlappung bewertet, und die besten drei Hypothesen werden eine Ebene feiner verfeinert. So bleibt der O(n²)-Teil billig (≈ 1 ms pro Paar); teure Prüfungen gibt es nur für plausible Kandidaten. Wiederkehrende Muster erzeugen mehrere Peaks – deshalb wird nie nur ein einzelner Treffer verwendet, sondern der Abstand zur zweitbesten Hypothese als Mehrdeutigkeitsmaß gespeichert.
4. **Verfeinerung & Verifikation** – Coarse-to-fine-ZNCC-Suche bis zur Arbeitsauflösung mit Subpixel-Parabelfit. Zusätzlich **Harris-Keypoints mit Patch-Deskriptoren**: Deskriptor-Matching (Ratio-Test) im Überlappungsbereich, Translationsvektoren `dx_i = xA_i − xB_i`, Konsens-/Inlier-Prüfung gegen die Hypothese (RANSAC-artig für das 2-Parameter-Modell) → `numberOfMatches`, `inlierRatio`. Daraus und aus ZNCC, Überlappungsgröße, Textur und Eindeutigkeit entsteht die **Confidence** jeder Kante `{ imageA, imageB, dx, dy, confidence, numberOfMatches, inlierRatio }`.
5. **Nachbarschafts-Graph & globales Layout** – Knoten = Screenshots, Kanten = verifizierte Überlappungen.
   - *Verifiziertes Greedy-Merging* (Kruskal-artig, absteigende Confidence): Eine Kante, die zwei Komponenten verbindet, wird nur akzeptiert, wenn alle **anderen** Bildpaare, die sich danach überlappen würden, die implizierte Verschiebung per ZNCC bestätigen. So werden Fehlzuordnungen durch repetitive Kartenmuster verworfen. Kanten innerhalb einer Komponente müssen zum bisherigen Layout passen (Schleifenprüfung).
   - *Gewichtete Least Squares* über alle akzeptierten Kanten: minimiert `Σ w·|p_b − p_a − d_ab|²` (Cholesky auf dem Graph-Laplace).
   - *Loop Closure*: Überlappende Paare ohne gemessene Kante werden nahe ihrer implizierten Position nachgemessen und als zusätzliche Constraints aufgenommen; Kanten mit großem Restfehler werden entfernt und das System neu gelöst.
   - Die größte Komponente bildet die Karte. Alle übrigen Bilder gelten als **nicht sicher zugeordnet** und werden nicht platziert.
6. **Rastererkennung** – Positionen werden mit 30 % Toleranz in Zeilen und Spalten geclustert. Ergibt sich ein konsistentes Raster (max. ein Bild pro Zelle), wird es angezeigt (z. B. 4 × 5). Die Stabilisierung erfolgt über das Loop Closure, das alle Raster-Nachbarn (inklusive Diagonalen) als zusätzliche Constraints misst.
7. **Originalauflösung** – Die Verschiebungen werden von der Arbeitsauflösung zurückgerechnet (`dx_original = dx_matching / scale`), anschließend wird jede verwendete Kante auf den **Originalpixeln** mit ganzzahliger Präzision nachgemessen und das Layout erneut gelöst. Ergebnis: pixelgenaue Positionen.
8. **Komposition** – Canvas-Größe aus `minX/minY/maxX/maxY`, jedes Originalbild an seiner globalen Position. *Harter Schnitt*: Jedes Pixel stammt aus genau dem Screenshot, in dem es am weitesten vom Rand entfernt liegt (Nähte liegen mittig in der Überlappung, kein Ghosting von Texten). *Feather*: linear zum Rand abfallende Gewichte. Gerendert wird immer in Streifen bzw. Kacheln.

**Einrasten** (manuelle Korrektur) misst den verschobenen Screenshot coarse-to-fine (Start auf der 128-px-Ebene mit ±8 px, entspricht ca. ±80 Originalpixeln) gegen alle überlappenden Nachbarn und mittelt die übereinstimmenden Ergebnisse.

**Erneut versuchen** verwendet für nicht zugeordnete Bilder ein unabhängiges Verfahren: hypothesenfreies Deskriptor-Matching gegen jedes platzierte Bild mit Clustering der Translationsvektoren (Voting), danach Verifikation per ZNCC mit gelockerten Schwellen.

### Bewusste technische Entscheidungen

- **Eigene CV-Implementierung statt OpenCV.js**: Für das Translations-Modell genügen FFT, Phasenkorrelation, ZNCC und einfache Keypoints. OpenCV.js wäre ~8–10 MB groß, müsste von einem CDN geladen werden (Datenschutz, Offline-Fähigkeit) und ist in Workern und Node-Tests schwer zu handhaben. Die eigene Implementierung ist ca. 40 KB groß, läuft identisch in Workern und Tests und unterstützt Masken (fixe UI) überall.
- **Kein SIFT/AKAZE**: Ohne Rotation und Skalierung bringt Rotations-/Skaleninvarianz nichts, kostet aber viel Rechenzeit. Die Phasenkorrelation nutzt die **gesamte** Überlappung und ist dadurch robuster gegen wiederkehrende Muster als einzelne Feature-Matches; Features dienen als unabhängige Gegenprobe.
- **Streaming-PNG-Encoder** (`CompressionStream`): Das PNG wird in Zeilenstreifen geschrieben – die Ausgabegröße ist nicht durch die maximale Canvas-Größe begrenzt.

## Browser-Limits

| Limit | Wert / Verhalten |
| --- | --- |
| Canvas (Chrome/Edge) | max. 32 767 px Kante, ca. 268 MP Fläche |
| Canvas (Firefox) | max. 32 767 px Kante, ca. 472 MP Fläche |
| Canvas (Safari, iOS) | 16 384 px Kante bzw. ca. 16–67 MP Fläche (geräteabhängig) |
| Speicher pro Tab | typisch 2–4 GB (Desktop), deutlich weniger auf Mobilgeräten |

Die App **misst die tatsächlichen Canvas-Limits** des Browsers und erzeugt nie eine größere Canvas:

- Vorschau: max. 4096 px lange Kante; beim Hineinzoomen werden Kacheln in Originalauflösung nachgeladen.
- **PNG** wird gestreamt geschrieben → auch Karten jenseits des Canvas-Limits als **eine** Datei (bis ca. 2 GB Dateigröße).
- **JPEG/WebP** benötigen eine Canvas in Endgröße. Ist sie zu groß, informiert der Export-Dialog und bietet **ZIP mit Kacheln** (2048/4096/8192 px) oder eine kleinere Auflösung an.
- Der Export-Dialog zeigt vorab Pixelgröße, geschätzte Dateigröße und RAM-Bedarf.

Speicherbedarf der Analyse: ca. 0,7 MB pro Screenshot (Arbeitskopie) plus temporär Graustufen-Originale für die Feinausrichtung (LRU-Cache, max. ca. 320 MB). 50–150 Screenshots sind auf Desktop-Rechnern gut machbar; 48 Screenshots werden im Test in ca. 4 s analysiert (single-threaded, im Browser zusätzlich parallelisiert).

Benötigte Browser-Features: Module Worker (inkl. verschachtelter Worker), `OffscreenCanvas`, `createImageBitmap`, `CompressionStream` – vorhanden in aktuellen Versionen von Chrome, Edge, Firefox und Safari (≥ 16.4).

## Troubleshooting

| Problem | Lösung |
| --- | --- |
| „Zwischen Screenshot N und den übrigen Bildern wurde keine ausreichende Überlappung gefunden.“ | Mindestens 25 % Überlappung aufnehmen. Prüfen, ob dieser Screenshot mit anderer Zoomstufe oder Fenstergröße entstanden ist. „Erneut versuchen“ oder „Manuell platzieren“ (mit „Einrasten“). |
| Viele Bilder nicht zugeordnet | Crop prüfen: Ist der Kartenbereich korrekt? „Fixe UI automatisch erkennen“ nutzen. Große einfarbige Flächen (Meer, leere Gebiete) enthalten keine Information – dort mehr Überlappung wählen. |
| Warnung „Abweichende Größe“ | Screenshots stammen aus unterschiedlichen Fenstergrößen oder Zoomstufen. Der Maßstab muss identisch sein. |
| Ein Screenshot sitzt falsch | „Layout bearbeiten“ → Screenshot ungefähr an die richtige Stelle ziehen → „Einrasten“ richtet ihn pixelgenau aus. Im Debug-Modus sieht man Kanten, Confidence und verworfene Zuordnungen mit Begründung. |
| Kartenbeschriftungen ändern sich zwischen Screenshots | „Harter Schnitt“ verwenden (keine Doppelbilder). Die Zuordnung selbst ist dagegen robust. |
| Fixe UI-Elemente (z. B. Zoom-Buttons) am Kartenrand sichtbar | Im Inneren der Karte werden sie durch Nachbarbilder ersetzt; am äußeren Rand per „Crop einstellen“ wegschneiden. |
| Export bricht ab / Tab stürzt ab | Andere Tabs schließen, 50 % / 25 % wählen oder als Kacheln (ZIP) exportieren. |
| Analyse dauert lange | In den Einstellungen die Analyse-Auflösung auf 800 px stellen. |

## Datenschutz

Alle Bilder werden ausschließlich im Browser verarbeitet (Web Worker, Canvas). Es gibt keine Uploads, keine externen Requests für Bilddaten, keine Cookies und kein Tracking. Die App lädt keine Ressourcen von Drittanbietern (auch keine Schriftarten oder CDNs).
