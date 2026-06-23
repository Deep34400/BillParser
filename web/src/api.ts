import type { Invoice, AppConfig, SettingsData, Analytics, ExtractionRun, Batch } from './types.js';
const BASE = '';
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, { headers: { 'content-type': 'application/json' }, ...init });
  if (!res.ok) throw new Error((await res.json().catch(() => ({} as any))).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
export const api = {
  config: () => j<AppConfig>('/api/config'),
  list: (qs: string) => j<{ invoices: Invoice[] }>(`/api/invoices${qs}`),
  get: (id: string) => j<Invoice>(`/api/invoices/${id}`),
  reextract: (id: string, provider?: string) => j(`/api/invoices/${id}/reextract`, { method: 'POST', body: JSON.stringify({ provider }) }),
  // Send an empty JSON body: the shared fetch helper sets content-type application/json,
  // and Fastify rejects that header with no body (400). Matches the reextract call.
  cancel: (id: string) => j(`/api/invoices/${id}/cancel`, { method: 'POST', body: '{}' }),
  bakeoff: (id: string) => j<{ runs: ExtractionRun[] }>(`/api/invoices/${id}/bakeoff`, { method: 'POST' }),
  applyRun: (id: string, runId: string) => j(`/api/invoices/${id}/apply-run`, { method: 'POST', body: JSON.stringify({ runId }) }),
  patch: (id: string, body: unknown) => j<Invoice>(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (id: string) => j(`/api/invoices/${id}`, { method: 'DELETE' }),
  bulk: (action: string, ids: string[]) => j('/api/invoices/bulk', { method: 'POST', body: JSON.stringify({ action, ids }) }),
  analytics: () => j<Analytics>('/api/analytics'),
  batches: () => j<{ batches: Batch[] }>('/api/batches'),
  settings: () => j<SettingsData>('/api/settings'),
  revealCreds: () => j<{ credentials: Record<string, Record<string, string>> }>('/api/settings/reveal'),
  saveSettings: (b: unknown) => j('/api/settings', { method: 'PUT', body: JSON.stringify(b) }),
  saveCreds: (provider: string, b: unknown) => j(`/api/settings/providers/${provider}`, { method: 'PUT', body: JSON.stringify(b) }),
  clearCreds: (provider: string) => j(`/api/settings/providers/${provider}`, { method: 'DELETE' }),
  upload: async (files: File[], batchName?: string) => {
    const fd = new FormData();
    if (batchName) fd.append('batchName', batchName);
    files.forEach((f) => fd.append('files', f));
    const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    return res.json();
  },
};
