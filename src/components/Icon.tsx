const PATHS: Record<string, string> = {
  upload: 'M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2',
  crop: 'M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14',
  lock: 'M6 11V8a6 6 0 1112 0v3M5 11h14v10H5z',
  zoomIn: 'M11 8v6M8 11h6M21 21l-4.35-4.35M19 11a8 8 0 11-16 0 8 8 0 0116 0z',
  zoomOut: 'M8 11h6M21 21l-4.35-4.35M19 11a8 8 0 11-16 0 8 8 0 0116 0z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  full: 'M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M8 8h8v8H8z',
  bug: 'M8 8V6a4 4 0 118 0v2M6 12H2m20 0h-4M6 18l-3 2m15-2l3 2M6 7L3 5m15 2l3-2M7 8h10v7a5 5 0 01-10 0z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  download: 'M12 4v12m0 0l-4-4m4 4l4-4M4 18v2h16v-2',
  back: 'M15 18l-6-6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  info: 'M12 16v-5m0-3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  refresh: 'M4 4v6h6M20 20v-6h-6M5.5 15a7 7 0 0011.9 2.5L20 14M4 10l2.6-3.5A7 7 0 0118.5 9',
  wand: 'M15 4V2m0 14v-2M8 9h2m10 0h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M3 21l9-9',
  check: 'M5 13l4 4L19 7',
  warn: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  hand: 'M8 13V5a1.5 1.5 0 013 0v6m0-1V4a1.5 1.5 0 013 0v6m0-1V5.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-5-2.7L3.6 14.5a1.5 1.5 0 012.4-1.8L8 15',
  magnet: 'M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3H6zM6 7h4m4 0h4',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
