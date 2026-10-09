import type { Shot } from '../state';
import { Icon } from './Icon';

export function ThumbnailGrid({ shots, onRemove, highlight }: { shots: Shot[]; onRemove: (key: string) => void; highlight?: Set<string> }) {
  return (
    <ul className="thumbs" data-testid="thumbs">
      {shots.map((s, i) => (
        <li key={s.key} className={`thumb ${s.error ? 'error' : ''} ${highlight?.has(s.key) ? 'warn' : ''}`} title={s.name}>
          <div className="thumb-img">
            {s.thumbUrl ? <img src={s.thumbUrl} alt={`Screenshot ${i + 1}`} loading="lazy" /> : <div className="thumb-loading" />}
            <span className="thumb-num">{i + 1}</span>
            <button className="thumb-remove" aria-label={`Screenshot ${i + 1} entfernen`} onClick={() => onRemove(s.key)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="thumb-meta">{s.error ? s.error : s.width ? `${s.width} × ${s.height}` : 'wird geladen …'}</div>
        </li>
      ))}
    </ul>
  );
}
