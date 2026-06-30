import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/Shell.js';
import { InvoicesPage } from './pages/InvoicesPage.js';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
export default function App() {
  return (<BrowserRouter><Shell><Routes>
    <Route path="/" element={<Navigate to="/invoices" />} />
    <Route path="/invoices" element={<InvoicesPage />} />
    <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
    <Route path="/analytics" element={<AnalyticsPage />} />
    <Route path="/settings" element={<SettingsPage />} />
  </Routes></Shell></BrowserRouter>);
}
