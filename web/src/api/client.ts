import type { Invoice, AppConfig, SettingsData, Analytics, AnalyticsKpis, VehicleSpend, CostPerKm, OcrCostSummary, ExtractionRun, Batch, FraudScanResult } from '../types/index.js';
const BASE = '';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('session_token');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  return headers;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, { headers: getAuthHeaders(), ...init });
  if (res.status === 401) {
    localStorage.removeItem('session_token');
    localStorage.removeItem('session_user');
    window.dispatchEvent(new Event('auth-logout'));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message ?? (body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth types ─────────────────────────────────────────────────────────────

export interface SessionUser {
  user_id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  token_balance: number | null;
  total_tokens_used: number;
  total_ocr_count: number;
  total_cost_usd: number;
}

export interface ApiKeyInfo {
  key_id: string;
  prefix: string;
  api_key?: string | null;
  label: string;
  created_at: string;
  last_used_at?: string | null;
}

export interface TokenTransaction {
  tx_id: string;
  user_id: string;
  type: 'credit' | 'debit';
  amount: number;
  balance_after: number;
  description: string;
  reference_id?: string | null;
  created_at: string;
}

export interface UserInfo extends SessionUser {
  api_key_prefix: string;
  created_at: string;
  updated_at: string;
  /** Email this user may send invoices FROM (whitelist for email intake) */
  intake_email?: string;
}

// Keep backward compat alias
export type AccountInfo = SessionUser;

export const api = {
  config: () => j<AppConfig>('/api/config'),
  list: (qs: string) => j<{ invoices: Invoice[]; total: number; page: number; pageSize: number; totalPages: number }>(`/api/invoices${qs}`),
  counts: () => j<{ counts: Record<string, number> }>('/api/invoices/counts'),
  get: (id: string) => j<Invoice>(`/api/invoices/${id}`),
  fileUrl: (id: string) => {
    const token = localStorage.getItem('session_token');
    const base = `/api/invoices/${id}/file`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  reextract: (id: string, provider?: string) => j(`/api/invoices/${id}/reextract`, { method: 'POST', body: JSON.stringify({ provider }) }),
  cancel: (id: string) => j(`/api/invoices/${id}/cancel`, { method: 'POST', body: '{}' }),
  processOcr: (id: string) => j<{ ok: boolean }>(`/api/invoices/${id}/process-ocr`, { method: 'POST', body: '{}' }),
  bakeoff: (id: string) => j<{ runs: ExtractionRun[] }>(`/api/invoices/${id}/bakeoff`, { method: 'POST' }),
  applyRun: (id: string, runId: string) => j(`/api/invoices/${id}/apply-run`, { method: 'POST', body: JSON.stringify({ runId }) }),
  patch: (id: string, body: unknown) => j<Invoice>(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (id: string) => fetch(BASE + `/api/invoices/${id}`, { method: 'DELETE', headers: (() => { const h: Record<string, string> = {}; const t = localStorage.getItem('session_token'); if (t) h['authorization'] = `Bearer ${t}`; return h; })() }).then(async (res) => { if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).message ?? (b as any).error ?? `HTTP ${res.status}`); } return res.json(); }),
  bulk: (action: string, ids: string[]) => j('/api/invoices/bulk', { method: 'POST', body: JSON.stringify({ action, ids }) }),
  analytics: () => j<Analytics>('/api/analytics'),
  analyticsKpis: () => j<AnalyticsKpis>('/api/analytics/kpis'),
  analyticsVehicles: (q?: string, limit = 20, offset = 0) => j<{ vehicles: VehicleSpend[]; total: number }>(`/api/analytics/vehicles?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  analyticsWorkshops: (q?: string, limit = 20, offset = 0) => j<{ workshops: { name: string; amount: number }[]; total: number }>(`/api/analytics/workshops?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  analyticsMonths: (limit = 50, offset = 0) => j<{ months: { label: string; amount: number }[]; total: number }>(`/api/analytics/months?limit=${limit}&offset=${offset}`),
  analyticsCostkm: (q?: string, limit = 20, offset = 0) => j<{ costPerKm: CostPerKm[]; total: number }>(`/api/analytics/costkm?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  analyticsCosts: () => j<OcrCostSummary>('/api/analytics/costs'),
  fraudSummary: () => j<{ total: number; by_type: Record<string, number>; by_severity: Record<string, number> }>('/api/fraud/summary'),
  fraudScan: (limit = 20, offset = 0) => j<FraudScanResult>(`/api/fraud/scan?limit=${limit}&offset=${offset}`),
  fraudDuplicates: (limit = 20, offset = 0) => j<FraudScanResult>(`/api/fraud/duplicates?limit=${limit}&offset=${offset}`),
  fraudGst: (limit = 20, offset = 0) => j<FraudScanResult>(`/api/fraud/gst-anomalies?limit=${limit}&offset=${offset}`),
  fraudPrices: (limit = 20, offset = 0) => j<FraudScanResult>(`/api/fraud/price-anomalies?limit=${limit}&offset=${offset}`),
  fraudOdometer: (limit = 20, offset = 0) => j<FraudScanResult>(`/api/fraud/odometer?limit=${limit}&offset=${offset}`),
  batches: () => j<{ batches: Batch[] }>('/api/batches'),
  settings: () => j<SettingsData>('/api/settings'),
  revealCreds: () => j<{ credentials: Record<string, Record<string, string>> }>('/api/settings/reveal'),
  saveSettings: (b: unknown) => j('/api/settings', { method: 'PUT', body: JSON.stringify(b) }),
  saveCreds: (provider: string, b: unknown) => j(`/api/settings/providers/${provider}`, { method: 'PUT', body: JSON.stringify(b) }),
  clearCreds: (provider: string) => fetch(BASE + `/api/settings/providers/${provider}`, { method: 'DELETE', headers: (() => { const h: Record<string, string> = {}; const t = localStorage.getItem('session_token'); if (t) h['authorization'] = `Bearer ${t}`; return h; })() }).then(async (res) => { if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).message ?? (b as any).error ?? `HTTP ${res.status}`); } return res.json(); }),
  upload: async (files: File[], batchName?: string) => {
    const fd = new FormData();
    if (batchName) fd.append('batchName', batchName);
    files.forEach((f) => fd.append('files', f));
    const token = localStorage.getItem('session_token');
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).message ?? `Upload failed: HTTP ${res.status}`);
    }
    return res.json();
  },
  importSources: async (sources: string[], batchName?: string) => {
    const res = await fetch('/api/invoices/import', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ sources, batchName }),
    });
    if (!res.ok) throw new Error(`Import failed: HTTP ${res.status}`);
    return res.json();
  },

  // ─── Auth ───────────────────────────────────────────────────────────────
  login: (email: string, password: string) =>
    j<{ success: boolean; data: { token: string; user: SessionUser } }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),

  // ─── Account ────────────────────────────────────────────────────────────
  account: () => j<{ success: boolean; data: SessionUser }>('/api/account'),
  accountTransactions: (limit = 50) => j<{ success: boolean; data: TokenTransaction[] }>(`/api/account/transactions?limit=${limit}`),

  // ─── API Keys ───────────────────────────────────────────────────────────
  createApiKey: (label?: string) =>
    j<{ success: boolean; data: { key_id: string; api_key: string; label: string; prefix: string; created_at: string }; message: string }>(
      '/api/auth/api-keys', { method: 'POST', body: JSON.stringify({ label }) },
    ),
  listApiKeys: () => j<{ success: boolean; data: ApiKeyInfo[] }>('/api/auth/api-keys'),
  deleteApiKey: (keyId: string) => j('/api/auth/api-keys/' + keyId, { method: 'DELETE', body: '{}' }),

  // ─── Admin ──────────────────────────────────────────────────────────────
  adminUsers: () => j<{ success: boolean; data: UserInfo[] }>('/api/admin/users'),
  adminCreateUser: (email: string, name: string, password: string, role = 'user', initial_balance?: number, intake_email?: string) =>
    j<{ success: boolean; data: UserInfo; message: string }>('/api/admin/users', {
      method: 'POST', body: JSON.stringify({ email, name, password, role, initial_balance, intake_email }),
    }),
  adminGetUser: (id: string) => j<{ success: boolean; data: UserInfo }>(`/api/admin/users/${id}`),
  adminBlockUser: (id: string) => j(`/api/admin/users/${id}/block`, { method: 'PATCH', body: '{}' }),
  adminUnblockUser: (id: string) => j(`/api/admin/users/${id}/unblock`, { method: 'PATCH', body: '{}' }),
  adminAddTokens: (id: string, amount: number, description?: string) =>
    j<{ success: boolean; data: TokenTransaction }>(`/api/admin/users/${id}/tokens`, { method: 'POST', body: JSON.stringify({ amount, description }) }),
  adminUserTransactions: (id: string) => j<{ success: boolean; data: TokenTransaction[] }>(`/api/admin/users/${id}/transactions`),
  adminResetPassword: (id: string, password: string) =>
    j(`/api/admin/users/${id}/reset-password`, { method: 'PATCH', body: JSON.stringify({ password }) }),
  adminSetIntakeEmail: (id: string, intake_email: string) =>
    j<{ success: boolean; data: UserInfo }>(`/api/admin/users/${id}/intake-email`, {
      method: 'PATCH', body: JSON.stringify({ intake_email }),
    }),

  // ─── Email Intake Config ─────────────────────────────────────────────────
  updateEmailIntake: (body: { enabled?: boolean; allowedSenders?: string[] }) =>
    j<{ ok: boolean; emailIntake: { enabled: boolean; running?: boolean; allowedSenders: string[] } }>('/api/config/email-intake', { method: 'PUT', body: JSON.stringify(body) }),
};
