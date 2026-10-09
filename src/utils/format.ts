const nf = new Intl.NumberFormat('de-DE');

export const fmtInt = (n: number) => nf.format(Math.round(n));

export function fmtBytes(b: number): string {
  if (b < 1024) return `${fmtInt(b)} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toLocaleString('de-DE', { maximumFractionDigits: 0 })} MB`;
  return `${(b / 1024 ** 3).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
}

export const fmtSize = (w: number, h: number) => `${fmtInt(w)} × ${fmtInt(h)} px`;

export const fmtPercent = (v: number) => `${Math.round(v * 100)} %`;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Turns technical error messages into understandable ones with a hint what to do. */
export function friendlyError(e: unknown): { title: string; hint?: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (/memory|allocation|Array buffer|out of memory/i.test(msg)) {
    return {
      title: 'Dem Browser ist der Arbeitsspeicher ausgegangen.',
      hint: 'Schließe andere Tabs, verwende weniger Screenshots pro Durchgang oder exportiere in geringerer Auflösung bzw. als Kacheln.',
    };
  }
  if (/decode|lesen|read/i.test(msg)) {
    return { title: msg, hint: 'Unterstützt werden PNG-, JPEG- und WebP-Dateien.' };
  }
  return { title: msg };
}
