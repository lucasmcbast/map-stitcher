const TIPS: [string, string][] = [
  ['Zoomstufe nicht verändern', 'Alle Screenshots müssen exakt denselben Maßstab haben.'],
  ['Browserfenster nicht verändern', 'Gleiche Fenstergröße = gleiche Screenshot-Größe.'],
  ['25–40 % Überlappung', 'Ideal 25–40 %, ab ca. 10 % funktioniert es meist auch noch.'],
  ['Karte nur verschieben', 'Ziehen oder Pfeiltasten – nicht zoomen.'],
  ['Systematisch in Reihen', 'Links → rechts, eine Reihe nach unten, wieder links → rechts.'],
  ['Keine Rotation', 'Karte genordet lassen, nicht drehen oder kippen (3D aus).'],
  ['Gleiche Screenshot-Größe', 'Immer denselben Bereich aufnehmen, z. B. per Fenster-Screenshot.'],
];

export function CaptureGuide({ compact }: { compact?: boolean }) {
  return (
    <section className={`guide ${compact ? 'compact' : ''}`} aria-labelledby="guide-title">
      <h2 id="guide-title">So erstellst du gute Screenshots</h2>
      <ol>
        {TIPS.map(([t, d], i) => (
          <li key={t}>
            <span className="guide-num">{i + 1}</span>
            <div>
              <strong>{t}</strong>
              <span>{d}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="guide-note">
        Tipp: Browser-UI, Suchfelder oder Zoom-Buttons stören nicht – sie lassen sich mit „Crop einstellen“ ausschneiden oder automatisch erkennen.
      </p>
    </section>
  );
}
