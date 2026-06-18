import { STATUS } from '../theme.js';

let styleInjected = false;

function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `@keyframes ioc-pulse{0%,100%{opacity:1}50%{opacity:.3}}`;
  document.head.appendChild(style);
}

export function StatusDot({ status }: { status: string }) {
  if (typeof document !== 'undefined') injectStyle();

  const info = STATUS[status] ?? { label: status, color: '#9e9e9e' };
  const shouldPulse = status === 'PENDING' || status === 'PROCESSING';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: info.color,
          animation: shouldPulse ? 'ioc-pulse 1.3s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }}
      />
      <span style={{ color: info.color, fontWeight: 600, fontSize: 12 }}>{info.label}</span>
    </span>
  );
}
