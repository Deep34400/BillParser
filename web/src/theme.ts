export const T = {
  bg: '#f7f5f1', panel: '#fff', rail: '#fbfaf7', border: '#e7e2d9',
  text: '#1c1a17', muted: '#8d877c', faint: '#a39d90',
  accent: '#4f46e5', accentHover: '#4338ca', accentSoft: '#ece9ff',
  green: '#1f9d63', red: '#d1453b', amber: '#b07d12',
  font: "'Hanken Grotesk', sans-serif", mono: "'Geist Mono', monospace",
};
export const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: '#b07d12' }, PROCESSING: { label: 'Processing', color: '#4f46e5' },
  COMPLETED: { label: 'Completed', color: '#1f9d63' }, FAILED: { label: 'Failed', color: '#d1453b' },
};
