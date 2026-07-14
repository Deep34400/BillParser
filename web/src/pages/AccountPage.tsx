import { useState, useEffect, useCallback } from 'react';
import { api, type ApiKeyInfo, type TokenTransaction } from '../api/client.js';
import { T } from '../theme.js';
import { costFmt } from '../lib/format.js';
import { formatBalance } from '../lib/balance.js';

const card: React.CSSProperties = {
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 10, padding: '18px 22px', marginBottom: 16,
};
const btn = (bg = T.accent, color = '#fff'): React.CSSProperties => ({
  padding: '7px 14px', border: 'none', borderRadius: 7, background: bg, color,
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
});
const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${T.border}`, borderRadius: 7,
  fontSize: 13, fontFamily: T.font, outline: 'none',
};

export function AccountPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [txs, setTxs] = useState<TokenTransaction[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');

  const flash = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  };

  const loadKeys = useCallback(async () => {
    try {
      const r = await api.listApiKeys();
      setKeys(r.data);
    } catch { /* ignore */ }
  }, []);

  const loadTxs = useCallback(async () => {
    try {
      const r = await api.accountTransactions(50);
      setTxs(r.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadKeys(); void loadTxs(); }, [loadKeys, loadTxs]);

  const handleGenerate = async () => {
    try {
      const r = await api.createApiKey(newKeyLabel.trim() || undefined);
      setNewKeyResult(r.data.api_key);
      setNewKeyLabel('');
      flash('API key created — copy it now, it will not be shown again.');
      void loadKeys();
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleDelete = async (keyId: string) => {
    if (!confirm('Revoke this API key? Any integration using it will stop working.')) return;
    try {
      await api.deleteApiKey(keyId);
      flash('API key revoked');
      void loadKeys();
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  let acct: { role: string; token_balance: number | null; total_ocr_count: number; total_cost_usd: number; name: string; email: string } | null = null;
  try {
    const raw = localStorage.getItem('session_user');
    if (raw) acct = JSON.parse(raw);
  } catch { /* ignore */ }

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text, maxWidth: 800 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>My Account</h1>

      {msg && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, fontSize: 13, marginBottom: 14,
          background: msgType === 'ok' ? '#e6f7ef' : '#fef2f2',
          color: msgType === 'ok' ? T.green : T.red,
          border: `1px solid ${msgType === 'ok' ? '#b7e8cf' : '#fecaca'}`,
        }}>{msg}</div>
      )}

      {/* Account summary */}
      {acct && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Balance', value: formatBalance(acct.role, acct.token_balance) },
              { label: 'OCR Count', value: String(acct.total_ocr_count) },
              { label: 'Total Spent', value: costFmt(acct.total_cost_usd) },
              { label: 'Role', value: acct.role.toUpperCase() },
            ].map((s) => (
              <div key={s.label} style={{ minWidth: 100 }}>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.accent, fontFamily: T.mono }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* API Keys */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>API Keys</div>
        <p style={{ fontSize: 12, color: T.muted, marginTop: 0, marginBottom: 14 }}>
          Generate API keys to use the OCR API directly (POST /api/ocr/sync or /api/ocr/async).
        </p>

        {/* Generate form */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <input
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            placeholder="Label (e.g. My App)"
            style={{ ...inputStyle, width: 200 }}
          />
          <button onClick={() => void handleGenerate()} style={btn()}>Generate Key</button>
        </div>

        {/* Newly created key highlight */}
        {newKeyResult && (
          <div style={{
            padding: '12px 14px', background: '#e6f7ef', border: '1px solid #b7e8cf',
            borderRadius: 8, marginBottom: 14, fontSize: 12,
          }}>
            <div style={{ fontWeight: 700, color: T.green, marginBottom: 6 }}>New API Key created</div>
            <div style={{
              fontFamily: T.mono, fontSize: 12, padding: '8px 10px',
              background: '#fff', border: `1px solid ${T.border}`, borderRadius: 6,
              wordBreak: 'break-all', marginBottom: 8,
            }}>
              {newKeyResult}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { void navigator.clipboard.writeText(newKeyResult); flash('Full API key copied!'); }} style={btn(T.green)}>Copy Full Key</button>
              <button onClick={() => setNewKeyResult(null)} style={btn('#666')}>Dismiss</button>
            </div>
          </div>
        )}

        {/* Existing keys table — full key always visible + copyable */}
        {keys.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${T.border}`, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Label</th>
                <th style={{ padding: '6px 8px' }}>API Key</th>
                <th style={{ padding: '6px 8px' }}>Created</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const full = k.api_key ?? null;
                return (
                  <tr key={k.key_id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '8px 8px', fontWeight: 600, verticalAlign: 'top' }}>{k.label}</td>
                    <td style={{ padding: '8px 8px', fontFamily: T.mono, fontSize: 11, maxWidth: 360 }}>
                      <div style={{ wordBreak: 'break-all', marginBottom: 6 }}>
                        {full ?? `${k.prefix}... (old key — revoke & generate new to copy full key)`}
                      </div>
                      {full && (
                        <button
                          onClick={() => { void navigator.clipboard.writeText(full); flash('Full API key copied!'); }}
                          style={{ ...btn(T.green), padding: '3px 10px', fontSize: 11 }}
                        >Copy</button>
                      )}
                    </td>
                    <td style={{ padding: '8px 8px', fontSize: 12, color: T.muted, verticalAlign: 'top' }}>{new Date(k.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', verticalAlign: 'top' }}>
                      <button onClick={() => void handleDelete(k.key_id)} style={{ ...btn(T.red), padding: '4px 10px', fontSize: 11 }}>Revoke</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: T.faint, padding: '10px 0' }}>No API keys yet. Generate one above.</div>
        )}
      </div>

      {/* Transaction history */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Usage History</div>
        {txs.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${T.border}`, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Type</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Balance</th>
                <th style={{ padding: '6px 8px' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((tx) => (
                <tr key={tx.tx_id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: '6px 8px', fontFamily: T.mono, fontSize: 11 }}>{new Date(tx.created_at).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{
                      padding: '1px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                      background: tx.type === 'credit' ? '#e6f7ef' : '#fef2f2',
                      color: tx.type === 'credit' ? T.green : T.red,
                    }}>{tx.type === 'credit' ? 'CREDIT' : 'DEBIT'}</span>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontFamily: T.mono, color: tx.type === 'credit' ? T.green : T.red }}>
                    {tx.type === 'credit' ? '+' : '-'}{costFmt(tx.amount)}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: T.mono }}>{costFmt(tx.balance_after)}</td>
                  <td style={{ padding: '6px 8px', color: T.muted }}>{tx.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: T.faint, padding: '10px 0' }}>No transactions yet.</div>
        )}
      </div>
    </div>
  );
}
