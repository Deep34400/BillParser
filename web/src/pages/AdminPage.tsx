import { useState, useEffect, useCallback } from 'react';
import { api, type UserInfo, type TokenTransaction } from '../api/client.js';
import { T } from '../theme.js';
import { costFmt } from '../lib/format.js';
import { hasUnlimitedBalance, formatBalance } from '../lib/balance.js';

const card: React.CSSProperties = {
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 12, padding: '20px 24px', marginBottom: 18,
};
const btn = (bg = T.accent, color = '#fff'): React.CSSProperties => ({
  padding: '7px 16px', border: 'none', borderRadius: 7, background: bg, color,
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
  transition: 'opacity 0.15s',
});
const inputStyle: React.CSSProperties = {
  padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8,
  fontSize: 13, fontFamily: T.font, outline: 'none',
};

export function AdminPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [txs, setTxs] = useState<TokenTransaction[]>([]);
  const [tab, setTab] = useState<'users' | 'create'>('users');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');

  // Create form
  const [cEmail, setCEmail] = useState('');
  const [cName, setCName] = useState('');
  const [cPass, setCPass] = useState('');
  const [cRole, setCRole] = useState<'user' | 'admin'>('user');
  const [cBalance, setCBalance] = useState('');

  // Token form
  const [addAmt, setAddAmt] = useState('');
  const [addDesc, setAddDesc] = useState('');

  const flash = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  };

  const load = useCallback(async () => {
    try {
      const r = await api.adminUsers();
      setUsers(r.data);
    } catch (e) { flash((e as Error).message, 'err'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectUser = async (id: string) => {
    setSelected(id);
    try {
      const r = await api.adminUserTransactions(id);
      setTxs(r.data);
    } catch { setTxs([]); }
  };

  const handleCreate = async () => {
    if (!cEmail || !cName || !cPass) return flash('Fill all required fields', 'err');
    if (cPass.length < 6) return flash('Password must be at least 6 characters', 'err');
    try {
      await api.adminCreateUser(cEmail, cName, cPass, cRole, cBalance ? Number(cBalance) : undefined);
      setCEmail(''); setCName(''); setCPass(''); setCBalance('');
      flash('User created successfully');
      setTab('users');
      void load();
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleBlock = async (id: string) => { await api.adminBlockUser(id); void load(); };
  const handleUnblock = async (id: string) => { await api.adminUnblockUser(id); void load(); };

  const handleAddTokens = async () => {
    if (!selected || !addAmt) return;
    try {
      await api.adminAddTokens(selected, Number(addAmt), addDesc || undefined);
      setAddAmt(''); setAddDesc('');
      flash('Balance added');
      void load(); void selectUser(selected);
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleResetPassword = async (id: string) => {
    const pw = prompt('Enter new password (min 6 chars):');
    if (!pw || pw.length < 6) return flash('Password must be at least 6 characters', 'err');
    try {
      await api.adminResetPassword(id, pw);
      flash('Password reset');
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  const selUser = users.find((u) => u.user_id === selected);

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Admin Panel</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('users')} style={{ ...btn(tab === 'users' ? T.accent : '#e5e5e5', tab === 'users' ? '#fff' : T.text) }}>Users</button>
          <button onClick={() => setTab('create')} style={{ ...btn(tab === 'create' ? T.accent : '#e5e5e5', tab === 'create' ? '#fff' : T.text) }}>+ Create User</button>
        </div>
      </div>

      {msg && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, fontSize: 13, marginBottom: 14,
          background: msgType === 'ok' ? '#e6f7ef' : '#fef2f2',
          color: msgType === 'ok' ? T.green : T.red,
          border: `1px solid ${msgType === 'ok' ? '#b7e8cf' : '#fecaca'}`,
        }}>{msg}</div>
      )}

      {/* Create User Form */}
      {tab === 'create' && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Create New User</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 4 }}>Email *</label>
              <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="user@company.com" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 4 }}>Name *</label>
              <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="John Doe" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 4 }}>Password *</label>
              <input type="password" value={cPass} onChange={(e) => setCPass(e.target.value)} placeholder="Min 6 characters" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 4 }}>Role</label>
              <select value={cRole} onChange={(e) => setCRole(e.target.value as 'user' | 'admin')} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 4 }}>Initial Balance (₹)</label>
              <input type="number" step="0.01" value={cBalance} onChange={(e) => setCBalance(e.target.value)} placeholder="0.00" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>
          <button onClick={() => void handleCreate()} style={btn()}>Create User</button>
        </div>
      )}

      {/* User Table */}
      {tab === 'users' && (
        <>
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Users ({users.length})</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${T.border}`, textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>User</th>
                    <th style={{ padding: '8px 10px' }}>Role</th>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Balance (₹)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>OCRs</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Cost</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSel = selected === u.user_id;
                    return (
                      <tr key={u.user_id} onClick={() => void selectUser(u.user_id)}
                        style={{ borderBottom: `1px solid ${T.border}`, cursor: 'pointer', background: isSel ? T.accentSoft : 'transparent', transition: 'background 0.1s' }}>
                        <td style={{ padding: '10px 10px' }}>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: T.faint }}>{u.email}</div>
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          <span style={{
                            padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                            background: u.role === 'admin' ? T.accentSoft : '#f0f0f0',
                            color: u.role === 'admin' ? T.accent : T.muted,
                          }}>{u.role}</span>
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 12, fontWeight: 600,
                            color: u.status === 'active' ? T.green : T.red,
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: u.status === 'active' ? T.green : T.red }} />
                            {u.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, fontFamily: T.mono, fontSize: 12 }}>
                          {formatBalance(u.role, u.token_balance)}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: T.mono, fontSize: 12 }}>{u.total_ocr_count}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: T.mono, fontSize: 12 }}>{costFmt(u.total_cost_usd)}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {u.status === 'active'
                              ? <button onClick={(e) => { e.stopPropagation(); void handleBlock(u.user_id); }} style={{ ...btn(T.red), padding: '4px 10px', fontSize: 11 }}>Block</button>
                              : <button onClick={(e) => { e.stopPropagation(); void handleUnblock(u.user_id); }} style={{ ...btn(T.green), padding: '4px 10px', fontSize: 11 }}>Unblock</button>
                            }
                            <button onClick={(e) => { e.stopPropagation(); void handleResetPassword(u.user_id); }} style={{ ...btn('#666'), padding: '4px 10px', fontSize: 11 }}>Reset Pass</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected User Detail */}
          {selUser && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selUser.name}</div>
                  <div style={{ fontSize: 12, color: T.faint }}>{selUser.email} · Joined {new Date(selUser.created_at).toLocaleDateString()}</div>
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
                {[
                  { label: 'Balance', value: formatBalance(selUser.role, selUser.token_balance), color: T.accent },
                  { label: 'Total OCRs', value: String(selUser.total_ocr_count), color: T.text },
                  { label: 'Total Spent', value: costFmt(selUser.total_cost_usd), color: T.amber },
                  { label: 'Tokens Used', value: costFmt(selUser.total_tokens_used), color: T.red },
                ].map((s) => (
                  <div key={s.label} style={{ padding: '10px 14px', background: T.bg, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: T.mono }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Add balance form */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 18, alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 4 }}>Amount (₹)</label>
                  <input type="number" step="0.01" value={addAmt} onChange={(e) => setAddAmt(e.target.value)} placeholder="1.00" style={{ ...inputStyle, width: 100 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 4 }}>Description</label>
                  <input value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder="Top-up note (optional)" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                </div>
                <button onClick={() => void handleAddTokens()} style={btn(T.green)}>Add Balance</button>
              </div>

              {/* Transaction history */}
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Transaction History</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${T.border}`, textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Date</th>
                    <th style={{ padding: '6px 8px' }}>Type</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Balance After</th>
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
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: tx.type === 'credit' ? T.green : T.red, fontFamily: T.mono }}>
                        {tx.type === 'credit' ? '+' : '-'}{costFmt(tx.amount)}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: T.mono }}>{costFmt(tx.balance_after)}</td>
                      <td style={{ padding: '6px 8px', color: T.muted }}>{tx.description}</td>
                    </tr>
                  ))}
                  {txs.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '16px 8px', textAlign: 'center', color: T.faint }}>No transactions yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
