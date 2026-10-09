import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export function filterImages(files: Iterable<File>): { ok: File[]; rejected: File[] } {
  const ok: File[] = [];
  const rejected: File[] = [];
  for (const f of files) {
    if (ACCEPTED.includes(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name)) ok.push(f);
    else rejected.push(f);
  }
  return { ok, rejected };
}

/** Hidden file input + helper to open it. */
export function useFilePicker(onFiles: (files: File[]) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      multiple
      hidden
      data-testid="file-input"
      onChange={(e) => {
        if (e.target.files?.length) onFiles([...e.target.files]);
        e.target.value = '';
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

export function DropZone({ onFiles, compact, children }: { onFiles: (files: File[]) => void; compact?: boolean; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  const { input, open } = useFilePicker(onFiles);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      {input}
      <div className="dropzone-icon">
        <Icon name="upload" size={compact ? 22 : 34} />
      </div>
      <div className="dropzone-title">Screenshots hier hineinziehen</div>
      <div className="dropzone-sub">oder klicken und auswählen · PNG, JPEG, WebP</div>
      {children}
    </div>
  );
}

/** Window-wide drop target so files can be dropped anywhere once screenshots are loaded. */
export function useWindowDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [active, setActive] = useState(false);
  const handlers = enabled
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setActive(true);
          }
        },
        onDragLeave: (e: React.DragEvent) => {
          if (e.currentTarget === e.target) setActive(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setActive(false);
          if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
        },
      }
    : {};
  return { active, handlers };
}
