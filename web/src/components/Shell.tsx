import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { T } from '../theme.js';

const NAV = [
  { label: '▤ Invoices', to: '/invoices' },
  { label: '▦ Analytics', to: '/analytics' },
  { label: '⚙ Settings', to: '/settings' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'row', minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.font }}>
      <aside style={{
        width: 222,
        background: T.rail,
        borderRight: `1px solid ${T.border}`,
        padding: '22px 14px',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflow: 'auto',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Invoice OCR</div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 3 }}>Finance · self-hosted</div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ label, to }) => {
            const isActive = to === '/invoices'
              ? location.pathname.startsWith('/invoices')
              : location.pathname.startsWith(to);
            return (
              <NavLink
                key={to}
                to={to}
                style={{
                  display: 'block',
                  padding: '7px 10px',
                  borderRadius: 7,
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  background: isActive ? T.accentSoft : 'transparent',
                  color: isActive ? T.accent : T.muted,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {label}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  );
}
