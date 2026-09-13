import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Mail, Plus, UserPlus, Crown, History,
  ShieldCheck, CircleSlash, Lock, Power, PowerOff,
} from 'lucide-react';
import {
  api, type UserInfo, type TokenTransaction,
} from '../api/client.js';
import { costFmt, usdToInrRate } from '../lib/format.js';
import { formatBalance } from '../lib/balance.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Badge } from '@/components/ui/badge.js';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table.js';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select.js';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog.js';
import { Separator } from '@/components/ui/separator.js';
import { AuditLogPanel } from '../components/AuditLogPanel.js';
import { PromptDialog } from '../components/PromptDialog.js';
import { Skeleton } from '@/components/ui/skeleton.js';

type AdminTab = 'users' | 'email-intake' | 'activity';

function FlashMsg({ msg, type }: { msg: string; type: 'ok' | 'err' }) {
  if (!msg) return null;
  return (
    <div className={cn(
      'mb-4 rounded-lg border px-4 py-2.5 text-sm',
      type === 'ok' ? 'bg-success-soft text-success border-success/20' : 'bg-danger-soft text-danger border-danger/20',
    )}>{msg}</div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users');

  // ─── Data ──────────────────────────────────────────────────────────────
  const {
    data: users = [],
    isLoading: usersLoading,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const r = await api.adminUsers();
      return r.data;
    },
  });

  // ─── User management ──────────────────────────────────────────────────
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [txs, setTxs] = useState<TokenTransaction[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [cEmail, setCEmail] = useState('');
  const [cName, setCName] = useState('');
  const [cPass, setCPass] = useState('');
  const [cRole, setCRole] = useState<'user' | 'admin'>('user');
  const [cBalance, setCBalance] = useState('');
  const [cIntakeEmail, setCIntakeEmail] = useState('');
  const [addAmt, setAddAmt] = useState('');
  const [addDesc, setAddDesc] = useState('');

  // ─── Email intake ─────────────────────────────────────────────────────
  const [intakeEnabled, setIntakeEnabled] = useState(false);
  const [intakeAddress, setIntakeAddress] = useState<string | null>(null);
  const [intakeRunning, setIntakeRunning] = useState(false);
  const [intakeHasPassword, setIntakeHasPassword] = useState(false);
  const [intakePasswordHint, setIntakePasswordHint] = useState<string | null>(null);
  const [mailboxUser, setMailboxUser] = useState('');
  const [mailboxPassword, setMailboxPassword] = useState('');
  const [pollIntervalSec, setPollIntervalSec] = useState('90');
  const [savingMailbox, setSavingMailbox] = useState(false);
  const [intakeDrafts, setIntakeDrafts] = useState<Record<string, string>>({});

  // ─── Feedback ─────────────────────────────────────────────────────────
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const flash = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(text); setMsgType(type); setTimeout(() => setMsg(''), 4000);
  };

  // ─── Loaders ──────────────────────────────────────────────────────────

  useEffect(() => {
    const drafts: Record<string, string> = {};
    for (const u of users) drafts[u.user_id] = u.intake_email ?? '';
    setIntakeDrafts(drafts);
  }, [users]);

  const loadIntakeConfig = useCallback(async () => {
    try {
      const cfg = await api.config();
      if (cfg.emailIntake) {
        setIntakeEnabled(cfg.emailIntake.enabled);
        setIntakeAddress(cfg.emailIntake.address ?? null);
        setIntakeRunning(!!cfg.emailIntake.running);
        setIntakeHasPassword(!!cfg.emailIntake.hasPassword);
        setIntakePasswordHint(cfg.emailIntake.passwordHint ?? null);
        setMailboxUser(cfg.emailIntake.address ?? '');
        setPollIntervalSec(String(cfg.emailIntake.pollIntervalSec ?? 90));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadIntakeConfig(); }, [loadIntakeConfig]);

  // ─── User actions ─────────────────────────────────────────────────────

  const selectUser = async (id: string) => {
    setSelectedUser(selectedUser === id ? null : id);
    if (selectedUser !== id) {
      try { const r = await api.adminUserTransactions(id); setTxs(r.data); } catch { setTxs([]); }
    }
  };

  const handleCreateUser = async () => {
    if (!cEmail || !cName || !cPass) return flash('Fill all required fields', 'err');
    if (cPass.length < 6) return flash('Password min 6 characters', 'err');
    try {
      await api.adminCreateUser(cEmail, cName, cPass, cRole, cBalance ? Number(cBalance) / usdToInrRate() : undefined, cIntakeEmail || undefined);
      setCEmail(''); setCName(''); setCPass(''); setCBalance(''); setCIntakeEmail('');
      flash('User created!'); setShowCreateUser(false);
      await refetchUsers();
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleBlock = async (id: string) => { await api.adminBlockUser(id); flash('User blocked'); await refetchUsers(); };
  const handleUnblock = async (id: string) => { await api.adminUnblockUser(id); flash('User unblocked'); await refetchUsers(); };
  const handleResetPassword = async (id: string, pw: string) => {
    if (!pw || pw.length < 6) return flash('Password must be at least 6 characters', 'err');
    try { await api.adminResetPassword(id, pw); flash('Password reset'); } catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleAddTokens = async () => {
    if (!selectedUser) return;
    if (!addAmt || Number(addAmt) <= 0) return flash('Enter an amount greater than 0', 'err');
    try {
      const usd = Number(addAmt) / usdToInrRate();
      await api.adminAddTokens(selectedUser, usd, addDesc || undefined);
      setAddAmt(''); setAddDesc(''); flash('Balance added');
      await refetchUsers(); const r = await api.adminUserTransactions(selectedUser); setTxs(r.data);
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  // ─── Email intake actions ─────────────────────────────────────────────

  const handleToggleIntake = async () => {
    try {
      const res = await api.updateEmailIntake({ enabled: !intakeEnabled });
      setIntakeEnabled(res.emailIntake.enabled);
      setIntakeRunning(!!res.emailIntake.running);
      flash(res.emailIntake.enabled ? 'Email intake ENABLED' : 'Email intake DISABLED');
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleSaveMailbox = async () => {
    const user = mailboxUser.trim().toLowerCase();
    if (!user || !user.includes('@')) return flash('Enter a valid mailbox email', 'err');
    if (!mailboxPassword.trim() && !intakeHasPassword) return flash('Enter the app password', 'err');
    const poll = Number(pollIntervalSec);
    if (!Number.isFinite(poll) || poll < 10) return flash('Poll interval must be ≥ 10s', 'err');
    setSavingMailbox(true);
    try {
      const body: { user: string; password?: string; pollIntervalSec: number } = { user, pollIntervalSec: Math.round(poll) };
      if (mailboxPassword.trim()) body.password = mailboxPassword;
      const res = await api.updateEmailIntake(body);
      setIntakeAddress(res.emailIntake.address ?? user);
      setIntakeHasPassword(!!res.emailIntake.hasPassword);
      setIntakePasswordHint(res.emailIntake.passwordHint ?? null);
      setIntakeRunning(!!res.emailIntake.running);
      setMailboxPassword('');
      flash('Mailbox credentials saved');
    } catch (e) { flash((e as Error).message, 'err'); }
    finally { setSavingMailbox(false); }
  };

  const handleSaveIntakeEmail = async (userId: string) => {
    const value = (intakeDrafts[userId] ?? '').trim().toLowerCase();
    try {
      const res = await api.adminSetIntakeEmail(userId, value);
      await refetchUsers();
      setIntakeDrafts((prev) => ({ ...prev, [userId]: res.data.intake_email ?? '' }));
      flash(value ? 'Allowed sender saved' : 'Allowed sender cleared');
    } catch (e) { flash((e as Error).message, 'err'); }
  };

  // ─── Derived ──────────────────────────────────────────────────────────

  const selUser = users.find((u) => u.user_id === selectedUser);
  const activeUsers = users.filter((u) => u.status === 'active');
  const blockedUsers = users.filter((u) => u.status === 'blocked');
  // ─── Tab button ───────────────────────────────────────────────────────

  const TabBtn = ({ id, icon: Icon, label, count }: { id: AdminTab; icon: React.ElementType; label: string; count?: number }) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        tab === id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count !== undefined && <span className="ml-1 rounded-full bg-background/20 px-1.5 text-[10px] font-bold">{count}</span>}
    </button>
  );

  return (
    <div className="max-w-6xl px-7 py-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-heading text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Platform Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage users, billing, and platform settings.</p>
        </div>
        <Badge variant="warning" className="gap-1"><Crown className="h-3 w-3" /> Super Admin</Badge>
      </div>

      <FlashMsg msg={msg} type={msgType} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
        {[
          { label: 'Users', value: users.length, icon: Users },
          { label: 'Active', value: activeUsers.length, icon: ShieldCheck },
          { label: 'Blocked', value: blockedUsers.length, icon: CircleSlash },
          { label: 'Email Intake', value: intakeEnabled ? 'ON' : 'OFF', icon: Mail },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-muted p-2"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">{label}</p>
                  <p className="text-lg font-bold text-primary font-mono">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-5">
        <TabBtn id="users" icon={Users} label="Users" count={users.length} />
        <TabBtn id="email-intake" icon={Mail} label="Email Intake" />
        <TabBtn id="activity" icon={History} label="Activity" />
      </div>

      <Separator className="mb-5" />

      {/* ═══════════════════════════════════════════════════════════════════
       * TAB: USERS
       * ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'users' && (
        <>
          <Card className="mb-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> All Users ({users.length})</CardTitle>
                  <CardDescription>Create accounts, manage balance, block/unblock. Click a row to see details.</CardDescription>
                </div>
                <Button onClick={() => setShowCreateUser(true)}><Plus className="h-4 w-4 mr-1" /> Create User</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance (₹)</TableHead>
                    <TableHead className="text-right">OCRs</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading && users.length === 0 && Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))}
                  {!usersLoading && users.map((u) => {
                    const isSel = selectedUser === u.user_id;
                    return (
                      <React.Fragment key={u.user_id}>
                        <TableRow className={cn('cursor-pointer', isSel && 'bg-secondary')} onClick={() => void selectUser(u.user_id)}>
                          <TableCell>
                            <div className="font-semibold">{u.name}</div>
                            <div className="text-[11px] text-muted-foreground">{u.email}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.role === 'admin' ? 'info' : 'muted'}>{u.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-bold">{formatBalance(u.role, u.token_balance)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{u.total_ocr_count}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{costFmt(u.total_cost_usd)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                              {u.status === 'active'
                                ? <Button variant="destructive" size="sm" onClick={() => void handleBlock(u.user_id)}>Block</Button>
                                : <Button variant="outline" size="sm" onClick={() => void handleUnblock(u.user_id)}>Unblock</Button>}
                              <Button variant="outline" size="sm" onClick={() => setResetPasswordUserId(u.user_id)}>
                                <Lock className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded user detail */}
                        {isSel && selUser && (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-muted/50 p-5">
                              <div className="grid grid-cols-4 gap-3 mb-4">
                                {[
                                  { label: 'Balance', value: formatBalance(selUser.role, selUser.token_balance) },
                                  { label: 'Total OCRs', value: String(selUser.total_ocr_count) },
                                  { label: 'Total Spent', value: costFmt(selUser.total_cost_usd) },
                                  { label: 'Tokens Used', value: costFmt(selUser.total_tokens_used) },
                                ].map((s) => (
                                  <div key={s.label} className="rounded-lg bg-card border border-border p-3 text-center">
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">{s.label}</p>
                                    <p className="text-lg font-bold font-mono text-primary">{s.value}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Add balance */}
                              <div className="flex items-end gap-3 mb-4">
                                <div>
                                  <Label className="text-xs">Amount (₹)</Label>
                                  <Input type="number" step="1" value={addAmt} onChange={(e) => setAddAmt(e.target.value)} placeholder="1000" className="w-28" />
                                </div>
                                <div className="flex-1">
                                  <Label className="text-xs">Description</Label>
                                  <Input value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder="Top-up note (optional)" />
                                </div>
                                <Button onClick={() => void handleAddTokens()} className="bg-success hover:bg-success/90">Add Balance</Button>
                              </div>

                              {/* Transactions */}
                              <p className="text-xs font-semibold mb-2">Transaction History</p>
                              {txs.length > 0 ? (
                                <Table>
                                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Description</TableHead></TableRow></TableHeader>
                                  <TableBody>
                                    {txs.slice(0, 10).map((tx) => (
                                      <TableRow key={tx.tx_id}>
                                        <TableCell className="text-xs font-mono text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</TableCell>
                                        <TableCell><Badge variant={tx.type === 'credit' ? 'success' : 'danger'} className="text-[10px]">{tx.type.toUpperCase()}</Badge></TableCell>
                                        <TableCell className={cn('text-right font-mono font-bold', tx.type === 'credit' ? 'text-success' : 'text-danger')}>
                                          {tx.type === 'credit' ? '+' : '-'}{costFmt(tx.amount)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">{costFmt(tx.balance_after)}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{tx.description}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              ) : <p className="text-xs text-muted-foreground">No transactions yet.</p>}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
       * TAB: EMAIL INTAKE
       * ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'email-intake' && (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email Intake Service</CardTitle>
              <CardDescription>Configure IMAP mailbox for automatic invoice ingestion.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-5">
                <span className="text-sm font-semibold">Service Status:</span>
                <Button size="sm" variant={intakeEnabled ? 'destructive' : 'default'} onClick={() => void handleToggleIntake()}>
                  {intakeEnabled ? <><PowerOff className="h-3.5 w-3.5 mr-1" /> Disable</> : <><Power className="h-3.5 w-3.5 mr-1" /> Enable</>}
                </Button>
                <Badge variant={intakeEnabled ? 'success' : 'danger'}>
                  {intakeEnabled ? (intakeRunning ? 'ACTIVE (polling)' : 'ENABLED') : 'DISABLED'}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div>
                  <Label>Intake Mailbox Email</Label>
                  <Input type="email" value={mailboxUser} onChange={(e) => setMailboxUser(e.target.value)} placeholder="techcarrum@gmail.com" />
                </div>
                <div>
                  <Label>App Password {intakeHasPassword ? `(saved ${intakePasswordHint ?? '••••'})` : ''}</Label>
                  <Input type="password" value={mailboxPassword} onChange={(e) => setMailboxPassword(e.target.value)} placeholder={intakeHasPassword ? 'Leave blank to keep' : 'xxxx xxxx xxxx xxxx'} autoComplete="new-password" />
                </div>
                <div>
                  <Label>Poll Interval (seconds)</Label>
                  <Input type="number" min={10} max={3600} value={pollIntervalSec} onChange={(e) => setPollIntervalSec(e.target.value)} />
                </div>
              </div>
              <Button onClick={() => void handleSaveMailbox()} disabled={savingMailbox}>
                {savingMailbox ? 'Saving…' : 'Save Mailbox Credentials'}
              </Button>
              {intakeAddress && (
                <p className="text-xs text-muted-foreground mt-3">
                  Active: <code className="font-mono text-foreground">{intakeAddress}</code> · imap.gmail.com:993 · poll every {pollIntervalSec}s
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Allowed Senders by User</CardTitle>
              <CardDescription>Assign which email each user may send invoices from.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Allowed Sender Email</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const draft = intakeDrafts[u.user_id] ?? '';
                    const saved = u.intake_email ?? '';
                    const dirty = draft.trim().toLowerCase() !== saved.trim().toLowerCase();
                    return (
                      <TableRow key={u.user_id}>
                        <TableCell>
                          <div className="font-semibold">{u.name}</div>
                          <div className="text-[11px] text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell><Badge variant={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge></TableCell>
                        <TableCell>
                          <Input
                            type="email"
                            value={draft}
                            onChange={(e) => setIntakeDrafts((prev) => ({ ...prev, [u.user_id]: e.target.value }))}
                            placeholder="sender@company.com"
                            className="max-w-xs"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => void handleSaveIntakeEmail(u.user_id)} disabled={!dirty}>Save</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'activity' && (
        <AuditLogPanel
          title="Platform activity"
          description="All users — uploads, OCR results, approvals, token credits, and webhook changes."
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════
       * CREATE USER DIALOG
       * ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>Create an account. They can sign in with email and password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email *</Label><Input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="user@company.com" /></div>
              <div><Label>Name *</Label><Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="John Doe" /></div>
              <div><Label>Password *</Label><Input type="password" value={cPass} onChange={(e) => setCPass(e.target.value)} placeholder="Min 6 characters" /></div>
              <div>
                <Label>System Role</Label>
                <Select value={cRole} onValueChange={(v) => setCRole(v as 'user' | 'admin')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User (regular)</SelectItem>
                    <SelectItem value="admin">Admin (super admin)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Initial Balance (₹)</Label><Input type="number" step="1" value={cBalance} onChange={(e) => setCBalance(e.target.value)} placeholder="1000" /></div>
              <div>
                <Label>Allowed Sender Email</Label>
                <Input type="email" value={cIntakeEmail} onChange={(e) => setCIntakeEmail(e.target.value)} placeholder="user@fleet.com" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreateUser(false)}>Cancel</Button>
              <Button onClick={() => void handleCreateUser()}><UserPlus className="h-4 w-4 mr-1" /> Create User</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PromptDialog
        open={resetPasswordUserId !== null}
        onOpenChange={(open) => { if (!open) setResetPasswordUserId(null); }}
        title="Reset password"
        description="Enter a new password for this user (minimum 6 characters)."
        inputLabel="New password"
        inputType="password"
        onSubmit={(pw) => { if (resetPasswordUserId) void handleResetPassword(resetPasswordUserId, pw); setResetPasswordUserId(null); }}
      />
    </div>
  );
}
