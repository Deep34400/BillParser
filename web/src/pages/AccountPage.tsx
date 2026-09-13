import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, Copy, CheckCircle } from 'lucide-react';
import { api, type ApiKeyInfo, type TokenTransaction } from '../api/client.js';
import { costFmt } from '../lib/format.js';
import { formatBalance } from '../lib/balance.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Badge } from '@/components/ui/badge.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';
import { WebhooksPanel } from '../components/WebhooksPanel.js';

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

  const loadKeys = useCallback(async () => { try { const r = await api.listApiKeys(); setKeys(r.data); } catch { /* ignore */ } }, []);
  const loadTxs = useCallback(async () => { try { const r = await api.accountTransactions(50); setTxs(r.data); } catch { /* ignore */ } }, []);
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
    try { await api.deleteApiKey(keyId); flash('API key revoked'); void loadKeys(); } catch (e) { flash((e as Error).message, 'err'); }
  };

  let acct: { role: string; token_balance: number | null; total_ocr_count: number; total_cost_usd: number; name: string; email: string } | null = null;
  try { const raw = localStorage.getItem('session_user'); if (raw) acct = JSON.parse(raw); } catch { /* ignore */ }

  return (
    <div className="max-w-4xl px-7 py-6 font-sans">
      <h1 className="font-heading text-xl font-bold mb-5">My Account</h1>

      {msg && (
        <div className={cn('mb-4 rounded-lg border px-4 py-2.5 text-sm', msgType === 'ok' ? 'bg-success-soft text-success border-success/20' : 'bg-danger-soft text-danger border-danger/20')}>
          {msg}
        </div>
      )}

      {/* Account summary cards */}
      {acct && (
        <Card className="mb-4">
          <CardContent className="pt-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Balance', value: formatBalance(acct.role, acct.token_balance) },
                { label: 'OCR Count', value: String(acct.total_ocr_count) },
                { label: 'Total Spent', value: costFmt(acct.total_cost_usd) },
                { label: 'Role', value: acct.role.toUpperCase() },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">{s.label}</p>
                  <p className="text-lg font-bold text-primary font-mono">{s.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* API Keys */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key className="h-4 w-4" /> API Keys</CardTitle>
          <CardDescription>Generate API keys to use the OCR API directly (POST /api/ocr/sync or /api/ocr/async).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Input value={newKeyLabel} onChange={(e) => setNewKeyLabel(e.target.value)} placeholder="Label (e.g. My App)" className="w-48" />
            <Button onClick={() => void handleGenerate()}><Plus className="h-4 w-4" /> Generate Key</Button>
          </div>

          {newKeyResult && (
            <div className="mb-4 rounded-lg border border-success/20 bg-success-soft p-4">
              <p className="text-sm font-bold text-success mb-2"><CheckCircle className="inline h-4 w-4 mr-1" /> New API Key created</p>
              <div className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs break-all mb-3">{newKeyResult}</div>
              <div className="flex gap-2">
                <Button variant="success" size="sm" onClick={() => { void navigator.clipboard.writeText(newKeyResult); flash('Full API key copied!'); }}>
                  <Copy className="h-3.5 w-3.5" /> Copy Full Key
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setNewKeyResult(null)}>Dismiss</Button>
              </div>
            </div>
          )}

          {keys.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Label</TableHead><TableHead>API Key</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.key_id}>
                    <TableCell className="font-semibold">{k.label}</TableCell>
                    <TableCell>
                      <span className="font-mono text-[11px] text-muted-foreground">{k.prefix}<span className="tracking-widest">••••••••</span></span>
                      <p className="text-[10px] text-faint mt-1">Shown once at creation. Lost it? Revoke and generate a new one.</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(k.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="destructive" size="sm" onClick={() => void handleDelete(k.key_id)}>
                        <Trash2 className="h-3.5 w-3.5" /> Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-faint py-2">No API keys yet. Generate one above.</p>
          )}
        </CardContent>
      </Card>

      <WebhooksPanel onFlash={flash} />

      {/* Transaction history */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Usage History</CardTitle>
        </CardHeader>
        <CardContent>
          {txs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txs.map((tx) => (
                  <TableRow key={tx.tx_id}>
                    <TableCell className="font-mono text-[11px]">{new Date(tx.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={tx.type === 'credit' ? 'success' : 'danger'} className="text-[10px]">
                        {tx.type === 'credit' ? 'CREDIT' : 'DEBIT'}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn('text-right font-bold font-mono', tx.type === 'credit' ? 'text-success' : 'text-danger')}>
                      {tx.type === 'credit' ? '+' : '-'}{costFmt(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{costFmt(tx.balance_after)}</TableCell>
                    <TableCell className="text-muted-foreground">{tx.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-faint py-2">No transactions yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
