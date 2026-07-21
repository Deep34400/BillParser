/** Design tokens — Invoice OCR dashboard */
export const T = {
  paper: '#F7F6F1',
  surface: '#FFFFFF',
  ink: '#1B1D19',
  inkSoft: '#67665D',
  inkFaint: '#A7A594',
  border: '#E4E1D3',
  accent: '#2E5C8A',
  accentHover: '#254A6E',
  accentSoft: '#E8EEF4',
  box: '#C77A1F',
  boxSoft: '#FBF0DD',
  success: '#1F7A54',
  successSoft: '#E5F3EC',
  warn: '#B45309',
  warnSoft: '#FBF0E1',
  danger: '#B3261E',
  dangerSoft: '#FAE9E8',

  font: "'Inter', system-ui, sans-serif",
  heading: "'Space Grotesk', sans-serif",
  mono: "'IBM Plex Mono', monospace",

  /* Backward-compatible aliases used by existing pages */
  bg: '#F7F6F1',
  panel: '#FFFFFF',
  rail: '#F7F6F1',
  text: '#1B1D19',
  muted: '#67665D',
  faint: '#A7A594',
  green: '#1F7A54',
  red: '#B3261E',
  amber: '#B45309',
};

export const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: '#B45309' },
  PROCESSING: { label: 'Processing', color: '#2E5C8A' },
  COMPLETED: { label: 'Completed', color: '#1F7A54' },
  FAILED: { label: 'Failed', color: '#B3261E' },
  NEEDS_REVIEW: { label: 'Needs review', color: '#B45309' },
};
