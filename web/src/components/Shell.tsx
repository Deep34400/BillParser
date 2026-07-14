import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api, type SessionUser } from '../api/client.js';
import { T } from '../theme.js';
import { costFmt } from '../lib/format.js';
import { hasUnlimitedBalance, formatBalance, balanceNumber } from '../lib/balance.js';

const NAV = [
  { label: '▤ Invoices', to: '/invoices' },
  { label: '▦ Analytics', to: '/analytics' },
  { label: '▣ Fraud', to: '/fraud' },
  { label: '⚙ Settings', to: '/settings' },
  { label: '⊡ Account', to: '/account' },
];

const ADMIN_NAV = { label: '⊞ Admin', to: '/admin' };

interface Props {
  children: React.ReactNode;
  user: SessionUser;
  onLogout: () => void;
  onUserUpdate: (u: SessionUser) => void;
}

export function Shell({ children, user, onLogout, onUserUpdate }: Props) {
  const location = useLocation();
  const [liveUser, setLiveUser] = useState<SessionUser>(user);

  const refreshAccount = useCallback(async () => {
    try {
      const r = await api.account();
      setLiveUser(r.data);
      onUserUpdate(r.data);
      localStorage.setItem('session_user', JSON.stringify(r.data));
    } catch { /* ignore */ }
  }, [onUserUpdate]);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);
  useEffect(() => { void refreshAccount(); }, [location.pathname, refreshAccount]);

  const nav = liveUser.role === 'admin' ? [...NAV, ADMIN_NAV] : NAV;
  const isAdmin = liveUser.role === 'admin';
  const balance = balanceNumber(liveUser.role, liveUser.token_balance);
  const unlimited = hasUnlimitedBalance(liveUser.role, liveUser.token_balance);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.font }}>
      {/* Left sidebar — same as before */}
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
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Invoice OCR</div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 3 }}>Finance · self-hosted</div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {nav.map(({ label, to }) => {
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

        {/* User + logout at bottom */}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 2 }}>{liveUser.name}</div>
          <div style={{ fontSize: 11, color: T.faint, marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {liveUser.email}
          </div>
          <button onClick={onLogout} style={{
            width: '100%', padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: 6,
            background: 'transparent', color: T.muted, fontSize: 12, cursor: 'pointer', fontFamily: T.font,
          }}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column: balance top-right + page content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Top bar — balance only on the right */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '10px 24px', background: T.panel,
          borderBottom: `1px solid ${T.border}`, flexShrink: 0, gap: 12,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 14px', borderRadius: 8,
            background: unlimited ? '#e6f7ef' : (balance <= 0 ? '#fef2f2' : T.accentSoft),
            border: `1px solid ${unlimited ? '#b7e8cf' : (balance <= 0 ? '#fecaca' : T.border)}`,
          }}>
            <span style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: 'uppercase' }}>
              {isAdmin ? 'Balance' : 'Points'}
            </span>
            <span style={{
              fontSize: 15, fontWeight: 700,
              color: unlimited ? T.green : (balance <= 0 ? T.red : T.accent),
            }}>
              {formatBalance(liveUser.role, liveUser.token_balance)}
            </span>
            <span style={{ fontSize: 11, color: T.faint }}>
              · {liveUser.total_ocr_count} OCR · {costFmt(liveUser.total_cost_usd)} spent
            </span>
          </div>
        </div>

        {!isAdmin && balance <= 0 && (
          <div style={{
            padding: '8px 24px', background: '#fef2f2', borderBottom: `1px solid #fecaca`,
            fontSize: 12, color: T.red, fontWeight: 600, textAlign: 'center',
          }}>
            Insufficient balance — contact admin to add points before uploading
          </div>
        )}

        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
