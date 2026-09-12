import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/Shell.js';
import { LoginPage } from './pages/LoginPage.js';
import { InvoicesPage } from './pages/InvoicesPage.js';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { FraudPage } from './pages/FraudPage.js';
import { OdometerPage } from './pages/OdometerPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { AccountPage } from './pages/AccountPage.js';
import { OrgPage } from './pages/OrgPage.js';
import { api, type SessionUser } from './api/client.js';
import { setUsdToInr } from './lib/format.js';

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem('session_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const handleLogin = useCallback(() => {
    try {
      const raw = localStorage.getItem('session_user');
      setUser(raw ? JSON.parse(raw) : null);
    } catch { setUser(null); }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('session_token');
    localStorage.removeItem('session_user');
    setUser(null);
  }, []);

  useEffect(() => {
    window.addEventListener('auth-logout', handleLogout);
    return () => window.removeEventListener('auth-logout', handleLogout);
  }, [handleLogout]);

  // Load the configured USD→INR rate once signed in; until then rupee figures use
  // the built-in fallback. Failure is non-fatal — the fallback still renders.
  useEffect(() => {
    if (!user) return;
    api.settings()
      .then((s) => setUsdToInr((s as { usdToInr?: number }).usdToInr))
      .catch(() => { /* keep fallback */ });
  }, [user]);

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <BrowserRouter>
      <Shell user={user} onLogout={handleLogout} onUserUpdate={setUser}>
        <Routes>
          <Route path="/" element={<Navigate to="/invoices" />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/fraud" element={<FraudPage />} />
          <Route path="/odometer" element={<OdometerPage />} />
          <Route path="/organization" element={<OrgPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/account" element={<AccountPage />} />
          {user.role === 'admin' && <Route path="/admin" element={<AdminPage />} />}
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
