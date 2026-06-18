import { T } from '../theme.js';
import { confColor, confLabel } from '../format.js';

export function ConfidenceBar({ value, verified }: { value?: number | null; verified?: boolean }) {
  if (verified) {
    return (
      <span style={{ color: T.green, fontWeight: 600, fontSize: 12 }}>✓ Verified</span>
    );
  }

  if (typeof value === 'number') {
    const color = confColor(value);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-block', width: 62, height: 6, background: '#ece8df', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
          <span style={{ display: 'block', width: `${value * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
        </span>
        <span style={{ color, fontSize: 12, fontWeight: 500 }}>{confLabel(value)}</span>
      </span>
    );
  }

  return <span style={{ color: T.faint }}>—</span>;
}
