import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  FileText, BarChart3, ShieldAlert, Gauge, Settings, User, Shield, LogOut, History, Menu,
} from 'lucide-react';
import { api, type SessionUser } from '../api/client.js';
import carrumLogo from '../assets/carrum-logo.svg';
import { costFmt } from '../lib/format.js';
import { formatBalance, balanceNumber, hasUnlimitedBalance } from '../lib/balance.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Separator } from '@/components/ui/separator.js';
import { Sheet, SheetContent } from '@/components/ui/sheet.js';

const PRIMARY_NAV = [
  { label: 'Invoices', to: '/invoices', icon: FileText },
  { label: 'Analytics', to: '/analytics', icon: BarChart3 },
  { label: 'Fraud', to: '/fraud', icon: ShieldAlert },
  { label: 'Odometer', to: '/odometer', icon: Gauge },
];

const SECONDARY_NAV = [
  { label: 'Settings', to: '/settings', icon: Settings },
  { label: 'Account', to: '/account', icon: User },
];

const ACTIVITY_NAV = { label: 'Activity', to: '/activity', icon: History };
const ADMIN_NAV = { label: 'Admin', to: '/admin', icon: Shield };

interface Props {
  children: React.ReactNode;
  user: SessionUser;
  onLogout: () => void;
  onUserUpdate: (u: SessionUser) => void;
}

function NavItem({ to, label, icon: Icon, active, onNavigate }: {
  to: string; label: string; icon: React.ElementType; active: boolean; onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-secondary text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}

function SidebarContent({
  liveUser, isAdmin, secondary, isActive, onLogout, onNavigate,
}: {
  liveUser: SessionUser;
  isAdmin: boolean;
  secondary: typeof SECONDARY_NAV;
  isActive: (to: string) => boolean;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="px-5 pt-5 pb-6">
        <img src={carrumLogo} alt="Carrum" className="block h-auto w-36" />
        <p className="mt-1.5 text-[11px] text-faint">Invoice OCR · Finance</p>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {PRIMARY_NAV.map(({ label, to, icon }) => (
          <NavItem key={to} to={to} label={label} icon={icon} active={isActive(to)} onNavigate={onNavigate} />
        ))}
        <Separator className="my-2" />
        {secondary.map(({ label, to, icon }) => (
          <NavItem key={to} to={to} label={label} icon={icon} active={isActive(to)} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="mt-auto border-t border-border p-4">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-xs font-semibold text-foreground truncate">{liveUser.name}</p>
          {isAdmin && (
            <span className="inline-flex items-center rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning border border-warning/20">
              Super Admin
            </span>
          )}
        </div>
        <p className="text-[11px] text-faint truncate">{liveUser.email}</p>
        <Button variant="outline" size="sm" className="mt-2.5 w-full gap-2" onClick={onLogout}>
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </>
  );
}

export function Shell({ children, user, onLogout, onUserUpdate }: Props) {
  const location = useLocation();
  const [liveUser, setLiveUser] = useState<SessionUser>(user);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  const isAdmin = liveUser.role === 'admin';
  const secondary = isAdmin
    ? [ADMIN_NAV, ...SECONDARY_NAV]
    : [ACTIVITY_NAV, ...SECONDARY_NAV];
  const balance = balanceNumber(liveUser.role, liveUser.token_balance);
  const unlimited = hasUnlimitedBalance(liveUser.role, liveUser.token_balance);
  const isHealthy = unlimited || balance > 0;

  const isActive = (to: string) =>
    to === '/invoices' ? location.pathname.startsWith('/invoices') : location.pathname.startsWith(to);

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      {/* Desktop sidebar */}
      <aside className="app-sidebar sticky top-0 hidden md:flex h-screen w-56 shrink-0 flex-col border-r border-border bg-card overflow-auto">
        <SidebarContent
          liveUser={liveUser}
          isAdmin={isAdmin}
          secondary={secondary}
          isActive={isActive}
          onLogout={onLogout}
        />
      </aside>

      {/* Mobile sheet nav */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="flex w-56 flex-col p-0">
          <SidebarContent
            liveUser={liveUser}
            isAdmin={isAdmin}
            secondary={secondary}
            isActive={isActive}
            onLogout={onLogout}
            onNavigate={closeMobileNav}
          />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex flex-1 min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5 shrink-0 md:justify-end md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className={cn(
            'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium border',
            isHealthy
              ? 'bg-success-soft text-success border-success/20'
              : 'bg-danger-soft text-danger border-danger/20',
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', isHealthy ? 'bg-success' : 'bg-danger')} />
            <span>
              {isAdmin ? 'Balance' : 'Points'} · {formatBalance(liveUser.role, liveUser.token_balance)}
              {' · '}{liveUser.total_ocr_count} OCR · {costFmt(liveUser.total_cost_usd)} spent
            </span>
          </div>
        </header>

        {!isAdmin && balance <= 0 && (
          <div className="bg-danger-soft border-b border-danger/20 px-6 py-2 text-center text-xs font-semibold text-danger">
            Insufficient balance — contact admin to add points before uploading
          </div>
        )}

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
