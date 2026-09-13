import { useState, useEffect, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
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
import { ActivityPage } from './pages/ActivityPage.js';
import ApiDocsPage from './pages/ApiDocsPage.js';
import UserGuidePage from './pages/UserGuidePage.js';
import TutorialPage from './pages/TutorialPage.js';
import { api, type SessionUser } from './api/client.js';
import { setUsdToInr } from './lib/format.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

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
    if (!user || user.role !== 'admin') return;
    api.settings()
      .then((s) => setUsdToInr((s as { usdToInr?: number }).usdToInr))
      .catch(() => { /* keep fallback */ });
  }, [user]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {!user ? (
          <LoginPage onLogin={handleLogin} />
        ) : (
          <BrowserRouter>
            <Shell user={user} onLogout={handleLogout} onUserUpdate={setUser}>
              <Routes>
                <Route path="/" element={<Navigate to="/invoices" />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/fraud" element={<FraudPage />} />
                <Route path="/odometer" element={<OdometerPage />} />
                <Route path="/organization" element={<Navigate to="/invoices" replace />} />
                <Route path="/account" element={<AccountPage />} />
                <Route
                  path="/settings"
                  element={user.role === 'admin' ? <SettingsPage /> : <Navigate to="/invoices" replace />}
                />
                {user.role === 'admin' ? (
                  <Route path="/admin" element={<AdminPage />} />
                ) : (
                  <Route path="/activity" element={<ActivityPage />} />
                )}
                <Route path="/tutorial" element={<TutorialPage />} />
                <Route path="/docs" element={<UserGuidePage />} />
                <Route path="/api-docs" element={<ApiDocsPage />} />
                <Route path="*" element={<Navigate to="/invoices" replace />} />
              </Routes>
            </Shell>
          </BrowserRouter>
        )}
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
