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
  /** No raw key: the server stores only a hash, so it is returned once at creation. */
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

// ─── Organization types ─────────────────────────────────────────────────────

export type OrgRole = 'owner' | 'admin' | 'reviewer' | 'viewer' | 'api_user';

export interface OrgInfo {
  org_id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  settings: Record<string, unknown> | null;
  invoice_limit: number;
  created_at: string;
  updated_at: string;
}

export interface OrgMemberInfo {
  org_id: string;
  user_id: string;
  org_role: OrgRole;
  joined_at: string;
  user_name?: string;
  user_email?: string;
}

export interface WebhookEndpointInfo {
  endpoint_id: string;
  org_id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  log_id: string;
  org_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

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
  submitForApproval: (id: string) => j<{ success: boolean }>(`/api/invoices/${id}/submit-approval`, { method: 'POST', body: '{}' }),
  approve: (id: string) => j<{ success: boolean }>(`/api/invoices/${id}/approve`, { method: 'POST', body: '{}' }),
  reject: (id: string, reason: string) => j<{ success: boolean }>(`/api/invoices/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
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

  // ─── Organization (multi-tenancy) ────────────────────────────────────────
  createOrg: (name: string, ownerUserId?: string) =>
    j<{ success: boolean; data: OrgInfo }>('/api/orgs', { method: 'POST', body: JSON.stringify({ name, ownerUserId }) }),
  getMyOrg: () =>
    j<{ success: boolean; data: (OrgInfo & { role: OrgRole }) | null; isSuperAdmin?: boolean }>('/api/orgs/me'),
  updateOrg: (updates: { name?: string; settings?: Record<string, unknown> }) =>
    j<{ success: boolean; data: OrgInfo }>('/api/orgs', { method: 'PATCH', body: JSON.stringify(updates) }),
  orgMembers: () =>
    j<{ success: boolean; data: OrgMemberInfo[] }>('/api/orgs/members'),
  orgUsage: () =>
    j<{ success: boolean; data: { currentMonth: number; limit: number; percentage: number; remaining: number } }>('/api/orgs/usage'),
  inviteMember: (userId: string, role: OrgRole = 'viewer') =>
    j<{ success: boolean; data: OrgMemberInfo }>('/api/orgs/members', { method: 'POST', body: JSON.stringify({ userId, role }) }),
  inviteMemberByEmail: (email: string, role: OrgRole = 'viewer') =>
    j<{ success: boolean; data: OrgMemberInfo }>('/api/orgs/members', { method: 'POST', body: JSON.stringify({ email, role }) }),
  createOrgMember: (name: string, email: string, password: string, role: OrgRole = 'viewer') =>
    j<{ success: boolean; data: { user: any; member: OrgMemberInfo } }>('/api/orgs/members/create', { method: 'POST', body: JSON.stringify({ name, email, password, role }) }),
  changeMemberRole: (userId: string, role: OrgRole) =>
    j<{ success: boolean }>(`/api/orgs/members/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (userId: string) =>
    j<{ success: boolean }>(`/api/orgs/members/${userId}`, { method: 'DELETE' }),

  // ─── Admin: Organization Management ─────────────────────────────────────
  adminListOrgs: () =>
    j<{ success: boolean; data: (OrgInfo & { member_count: number })[] }>('/api/admin/orgs'),
  adminGetOrg: (orgId: string) =>
    j<{ success: boolean; data: OrgInfo & { members: OrgMemberInfo[] } }>(`/api/admin/orgs/${orgId}`),
  adminUpdateOrg: (orgId: string, updates: { name?: string; plan?: string; status?: string }) =>
    j<{ success: boolean; data: OrgInfo }>(`/api/admin/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  adminOrgMembers: (orgId: string) =>
    j<{ success: boolean; data: OrgMemberInfo[] }>(`/api/admin/orgs/${orgId}/members`),

  // ─── Webhooks ───────────────────────────────────────────────────────────
  listWebhooks: () =>
    j<{ success: boolean; data: WebhookEndpointInfo[]; metadata: { availableEvents: string[] } }>('/api/webhooks'),
  createWebhook: (url: string, events: string[], description?: string) =>
    j<{ success: boolean; data: WebhookEndpointInfo }>('/api/webhooks', {
      method: 'POST', body: JSON.stringify({ url, events, description }),
    }),
  toggleWebhook: (id: string, active: boolean) =>
    j<{ success: boolean }>(`/api/webhooks/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteWebhook: (id: string) =>
    j<{ success: boolean }>(`/api/webhooks/${id}`, { method: 'DELETE' }),

  // ─── Audit Logs ─────────────────────────────────────────────────────────
  auditLogs: (params?: { action?: string; limit?: number; offset?: number }) => {
    const p = new URLSearchParams();
    if (params?.action) p.set('action', params.action);
    if (params?.limit) p.set('limit', String(params.limit));
    if (params?.offset) p.set('offset', String(params.offset));
    const qs = p.toString();
    return j<{ success: boolean; data: AuditLogEntry[]; metadata: { total: number } }>(`/api/audit/logs${qs ? '?' + qs : ''}`);
  },

  // ─── Email Intake Config ─────────────────────────────────────────────────
  updateEmailIntake: (body: {
    enabled?: boolean;
    user?: string;
    password?: string;
    pollIntervalSec?: number;
    allowedSenders?: string[];
  }) =>
    j<{
      ok: boolean;
      emailIntake: {
        enabled: boolean;
        running?: boolean;
        address?: string | null;
        hasPassword?: boolean;
        passwordHint?: string | null;
        pollIntervalSec?: number;
        allowedSenders: string[];
      };
    }>('/api/config/email-intake', { method: 'PUT', body: JSON.stringify(body) }),

  // ─── Odometer OCR ──────────────────────────────────────────────────────
  odometerExtract: (imageUrl: string, crossVerify?: boolean) =>
    j<{ success: boolean; data: { odometer_km: number | null; source: string; pipelineMode: string; providers: { extraction: string; structuring: string }; needsReview: boolean; reviewReason: string; primary: any; secondary: any | null } }>(
      '/api/odometer/extract',
      { method: 'POST', body: JSON.stringify({ imageUrl, crossVerify: crossVerify ?? false }) },
    ),
  odometerExtractFile: (file: File, crossVerify?: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    if (crossVerify) fd.append('crossVerify', 'true');
    const t = localStorage.getItem('session_token');
    const headers: Record<string, string> = {};
    if (t) headers['authorization'] = `Bearer ${t}`;
    return fetch('/api/odometer/extract', { method: 'POST', headers, body: fd })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? r.statusText); return d; });
  },
  odometerBatch: (images: Array<{ url: string; id?: string }>, crossVerify?: boolean) =>
    j<{ success: boolean; data: Array<{ id: string; url: string; odometer_km: number | null; confidence?: number; success: boolean; error?: string }> }>(
      '/api/odometer/batch',
      { method: 'POST', body: JSON.stringify({ images, crossVerify: crossVerify ?? false }) },
    ),
};
