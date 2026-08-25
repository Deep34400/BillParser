import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api, type SessionUser } from '../api/client.js';
import { T } from '../theme.js';
import carrumLogo from '../assets/carrum-logo.svg';
import { costFmt } from '../lib/format.js';
import { hasUnlimitedBalance, formatBalance, balanceNumber } from '../lib/balance.js';

const PRIMARY_NAV = [
  { label: 'Invoices', to: '/invoices' },
  { label: 'Analytics', to: '/analytics' },
  { label: 'Fraud', to: '/fraud' },
  { label: 'Odometer', to: '/odometer' },
];

const SECONDARY_NAV = [
  { label: 'Settings', to: '/settings' },
  { label: 'Account', to: '/account' },
];

const ADMIN_NAV = { label: 'Admin', to: '/admin' };

interface Props {
  children: React.ReactNode;
  user: SessionUser;
  onLogout: () => void;
  onUserUpdate: (u: SessionUser) => void;
}


function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <NavLink
      to={to}
      style={{
        display: 'block',
        padding: '8px 12px',
        borderRadius: 8,
        textDecoration: 'none',
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        fontFamily: T.font,
        background: active ? T.accentSoft : 'transparent',
        color: active ? T.accent : T.inkSoft,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {label}
    </NavLink>
  );
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

  const secondary = liveUser.role === 'admin' ? [...SECONDARY_NAV, ADMIN_NAV] : SECONDARY_NAV;
  const isAdmin = liveUser.role === 'admin';
  const balance = balanceNumber(liveUser.role, liveUser.token_balance);
  const unlimited = hasUnlimitedBalance(liveUser.role, liveUser.token_balance);

  const isActive = (to: string) =>
    to === '/invoices' ? location.pathname.startsWith('/invoices') : location.pathname.startsWith(to);

  return (
    <div style={{
      display: 'flex', flexDirection: 'row', minHeight: '100vh',
      background: T.paper, color: T.ink, fontFamily: T.font,
    }}>
      <aside className="app-sidebar" style={{
        width: 220, background: T.surface, borderRight: `1px solid ${T.border}`,
        padding: '20px 14px', position: 'sticky', top: 0, height: '100vh',
        overflow: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ marginBottom: 28, padding: '0 4px' }}>
          <img
            src={carrumLogo}
            alt="Carrum"
            style={{ width: 150, maxWidth: '100%', height: 'auto', display: 'block' }}
          />
          <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 6 }}>Invoice OCR · Finance</div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {PRIMARY_NAV.map(({ label, to }) => (
            <NavItem key={to} to={to} label={label} active={isActive(to)} />
          ))}
          <div style={{ height: 1, background: T.border, margin: '10px 8px' }} />
          {secondary.map(({ label, to }) => (
            <NavItem key={to} to={to} label={label} active={isActive(to)} />
          ))}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.ink, marginBottom: 2 }}>{liveUser.name}</div>
          <div style={{
            fontSize: 11, color: T.inkFaint, marginBottom: 10,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {liveUser.email}
          </div>
          <button onClick={onLogout} style={{
            width: '100%', padding: '7px 10px', border: `1px solid ${T.border}`, borderRadius: 7,
            background: 'transparent', color: T.inkSoft, fontSize: 12, cursor: 'pointer', fontFamily: T.font,
          }}>
            Sign out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '10px 24px', background: T.surface,
          borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 999,
            background: unlimited || balance > 0 ? T.successSoft : T.dangerSoft,
            border: `1px solid ${unlimited || balance > 0 ? '#C5E5D4' : '#F0C9C7'}`,
            fontSize: 12, color: unlimited || balance > 0 ? T.success : T.danger, fontWeight: 500,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: unlimited || balance > 0 ? T.success : T.danger,
            }} />
            <span>
              {isAdmin ? 'Balance' : 'Points'} · {formatBalance(liveUser.role, liveUser.token_balance)}
              {' · '}{liveUser.total_ocr_count} OCR · {costFmt(liveUser.total_cost_usd)} spent
            </span>
          </div>
        </div>

        {!isAdmin && balance <= 0 && (
          <div style={{
            padding: '8px 24px', background: T.dangerSoft, borderBottom: `1px solid #F0C9C7`,
            fontSize: 12, color: T.danger, fontWeight: 600, textAlign: 'center',
          }}>
            Insufficient balance — contact admin to add points before uploading
          </div>
        )}

        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
