import type { ProgressInfo, ProgressStep } from '../types';
import { Icon } from './Icon';

export const STEPS: { id: ProgressStep; label: string }[] = [
  { id: 'prepare', label: 'Bilder vorbereiten' },
  { id: 'features', label: 'Features erkennen' },
  { id: 'matching', label: 'Überlappungen suchen' },
  { id: 'layout', label: 'Kartenlayout berechnen' },
  { id: 'render', label: 'Karte rendern' },
];

export function ProgressPanel({ progress, onCancel }: { progress: ProgressInfo; onCancel: () => void }) {
  const idx = STEPS.findIndex((s) => s.id === progress.step);
  const total = (idx + Math.min(1, progress.fraction)) / STEPS.length;
  return (
    <div className="progress-card" role="status" aria-live="polite" data-testid="progress">
      <div className="progress-head">
        <div>
          <div className="progress-step">
            {idx + 1}/{STEPS.length} {STEPS[idx]?.label}
          </div>
          <div className="progress-msg">{progress.message}</div>
        </div>
        <button className="btn ghost small" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${(total * 100).toFixed(1)}%` }} />
      </div>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < idx ? 'done' : i === idx ? 'active' : ''}>
            <span className="step-dot">{i < idx ? <Icon name="check" size={12} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
