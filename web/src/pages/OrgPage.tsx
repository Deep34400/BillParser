import { useState, useEffect, useCallback } from 'react';
import {
  Building2, Users, UserPlus, Crown, Shield, Eye, Bot, Trash2,
  Plus, Power, PowerOff, ShieldCheck,
} from 'lucide-react';
import {
  api, type OrgInfo, type OrgMemberInfo, type OrgRole,
  type AuditLogEntry, type WebhookEndpointInfo,
} from '../api/client.js';
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

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const ROLE_META: Record<string, { label: string; icon: React.ElementType; variant: 'default' | 'success' | 'warning' | 'info' | 'muted' }> = {
  owner:    { label: 'Owner',    icon: Crown,  variant: 'warning' },
  admin:    { label: 'Admin',    icon: Shield, variant: 'info' },
  reviewer: { label: 'Reviewer', icon: Eye,    variant: 'success' },
  viewer:   { label: 'Viewer',   icon: Eye,    variant: 'muted' },
  api_user: { label: 'API User', icon: Bot,    variant: 'default' },
};

const PLAN_META: Record<string, { label: string; variant: 'muted' | 'info' | 'success' | 'warning' }> = {
  free:       { label: 'Free',       variant: 'muted' },
  starter:    { label: 'Starter',    variant: 'info' },
  business:   { label: 'Business',   variant: 'success' },
  enterprise: { label: 'Enterprise', variant: 'warning' },
};

const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'reviewer', 'viewer', 'api_user'];

function getSessionRole(): string {
  try {
    const raw = localStorage.getItem('session_user');
    if (raw) { const u = JSON.parse(raw); return u.role ?? 'user'; }
  } catch { /* ignore */ }
  return 'user';
}

function FlashMsg({ msg, type }: { msg: string; type: 'ok' | 'err' }) {
  if (!msg) return null;
  return (
    <div className={cn(
      'mb-4 rounded-lg border px-4 py-2.5 text-sm',
      type === 'ok' ? 'bg-success-soft text-success border-success/20' : 'bg-danger-soft text-danger border-danger/20',
    )}>{msg}</div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * SUPER ADMIN DASHBOARD — sees all orgs, create orgs, manage platform
 * ══════════════════════════════════════════════════════════════════════════ */

function SuperAdminRedirect() {
  return (
    <div className="max-w-lg mx-auto px-7 py-16 text-center">
      <ShieldCheck className="h-12 w-12 text-primary mx-auto mb-4" />
      <h2 className="font-heading text-xl font-bold mb-2">Super Admin</h2>
      <p className="text-sm text-muted-foreground mb-6">
        As a platform admin, manage all users, organizations, and settings from the Admin panel.
      </p>
      <a href="/admin">
        <Button><Shield className="h-4 w-4 mr-1" /> Go to Admin Dashboard</Button>
      </a>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * REGULAR USER VIEW — sees their own org or create form
 * ══════════════════════════════════════════════════════════════════════════ */

function RegularUserOrgView() {
  const [org, setOrg] = useState<(OrgInfo & { role?: OrgRole }) | null>(null);
  const [members, setMembers] = useState<OrgMemberInfo[]>([]);
  const [usage, setUsage] = useState<{ currentMonth: number; limit: number; percentage: number; remaining: number } | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookEndpointInfo[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const [newOrgName, setNewOrgName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

  // Invite by email / create new member
  const [showInvite, setShowInvite] = useState(false);
  const [inviteMode, setInviteMode] = useState<'invite' | 'create'>('invite');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('viewer');
  const [inviting, setInviting] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<OrgRole>('viewer');

  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [whUrl, setWhUrl] = useState('');
  const [whDesc, setWhDesc] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>([]);

  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const flash = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(text); setMsgType(type); setTimeout(() => setMsg(''), 4000);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.getMyOrg(),
      api.orgMembers(),
      api.orgUsage(),
      api.listWebhooks(),
      api.auditLogs({ limit: 20 }),
    ]);
    if (results[0].status === 'fulfilled') { setOrg(results[0].value.data); setHasOrg(!!results[0].value.data); }
    else { setOrg(null); setHasOrg(false); }
    if (results[1].status === 'fulfilled') setMembers(results[1].value.data ?? []);
    if (results[2].status === 'fulfilled') setUsage(results[2].value.data);
    if (results[3].status === 'fulfilled') {
      setWebhooks(results[3].value.data ?? []);
      if ((results[3].value as any).metadata?.availableEvents) setAvailableEvents((results[3].value as any).metadata.availableEvents);
    }
    if (results[4].status === 'fulfilled') setAuditLogs(results[4].value.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return flash('Enter an organization name', 'err');
    setCreating(true);
    try { await api.createOrg(newOrgName.trim()); flash('Organization created!'); setNewOrgName(''); await loadAll(); }
    catch (e) { flash((e as Error).message, 'err'); }
    finally { setCreating(false); }
  };

  const handleUpdateName = async () => {
    if (!draftName.trim()) return;
    try { await api.updateOrg({ name: draftName.trim() }); flash('Name updated'); setEditingName(false); await loadAll(); }
    catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleInviteByEmail = async () => {
    if (!inviteEmail.trim()) return flash('Enter an email address', 'err');
    setInviting(true);
    try {
      await api.inviteMemberByEmail(inviteEmail.trim(), inviteRole);
      flash('Member invited!');
      setShowInvite(false); setInviteEmail(''); setInviteRole('viewer');
      await loadAll();
    } catch (e) { flash((e as Error).message, 'err'); }
    finally { setInviting(false); }
  };

  const handleCreateMember = async () => {
    if (!createName.trim() || !createEmail.trim() || !createPassword) return flash('Fill all fields', 'err');
    if (createPassword.length < 6) return flash('Password must be at least 6 characters', 'err');
    setInviting(true);
    try {
      await api.createOrgMember(createName.trim(), createEmail.trim(), createPassword, createRole);
      flash('Account created & added to org!');
      setShowInvite(false); setCreateName(''); setCreateEmail(''); setCreatePassword(''); setCreateRole('viewer');
      await loadAll();
    } catch (e) { flash((e as Error).message, 'err'); }
    finally { setInviting(false); }
  };

  const handleChangeRole = async (userId: string, newRole: OrgRole) => {
    try { await api.changeMemberRole(userId, newRole); flash('Role updated'); await loadAll(); }
    catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this member?')) return;
    try { await api.removeMember(userId); flash('Member removed'); await loadAll(); }
    catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleAddWebhook = async () => {
    if (!whUrl.trim()) return flash('Enter a URL', 'err');
    if (whEvents.length === 0) return flash('Select events', 'err');
    try { await api.createWebhook(whUrl.trim(), whEvents, whDesc.trim() || undefined); flash('Webhook created!'); setShowAddWebhook(false); setWhUrl(''); setWhDesc(''); setWhEvents([]); await loadAll(); }
    catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleToggleWebhook = async (id: string, active: boolean) => {
    try { await api.toggleWebhook(id, active); flash(active ? 'Enabled' : 'Disabled'); await loadAll(); }
    catch (e) { flash((e as Error).message, 'err'); }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Delete this webhook?')) return;
    try { await api.deleteWebhook(id); flash('Deleted'); await loadAll(); }
    catch (e) { flash((e as Error).message, 'err'); }
  };

  const myRole = org?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const planInfo = PLAN_META[org?.plan ?? 'free'] ?? PLAN_META.free;

  if (loading) {
    return (
      <div className="max-w-4xl px-7 py-6">
        <p className="text-sm text-muted-foreground py-16 text-center">Loading…</p>
      </div>
    );
  }

  /* No org → create form */
  if (!hasOrg) {
    return (
      <div className="max-w-lg mx-auto px-7 py-16">
        <div className="flex flex-col items-center justify-center py-8 text-center mb-4">
          <Building2 className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="font-heading text-lg font-semibold">No Organization Yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create an organization to enable team management.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Create Organization</CardTitle>
            <CardDescription>You will become the owner.</CardDescription>
          </CardHeader>
          <CardContent>
            <FlashMsg msg={msg} type={msgType} />
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input id="org-name" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder="Acme Fleet" onKeyDown={(e) => e.key === 'Enter' && void handleCreateOrg()} />
              </div>
              <Button onClick={() => void handleCreateOrg()} disabled={creating}>
                <Building2 className="h-4 w-4 mr-1" />{creating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* Has org → dashboard */
  return (
    <div className="max-w-4xl px-7 py-6 font-sans">
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-xl font-bold">Organization</h1>
        {myRole && (
          <Badge variant={ROLE_META[myRole]?.variant ?? 'muted'}>
            {ROLE_META[myRole]?.label ?? myRole}
          </Badge>
        )}
      </div>

      <FlashMsg msg={msg} type={msgType} />

      {/* Org overview */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {editingName ? (
              <div className="flex items-center gap-2 flex-1">
                <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="h-8 w-64" onKeyDown={(e) => e.key === 'Enter' && void handleUpdateName()} autoFocus />
                <Button size="sm" onClick={() => void handleUpdateName()}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
              </div>
            ) : (
              <span>
                {org?.name}
                {canManage && (
                  <Button variant="ghost" size="sm" className="ml-2 text-xs" onClick={() => { setDraftName(org?.name ?? ''); setEditingName(true); }}>
                    Edit
                  </Button>
                )}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">Plan</p>
              <Badge variant={planInfo.variant}>{planInfo.label}</Badge>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">Status</p>
              <Badge variant={org?.status === 'active' ? 'success' : 'danger'}>{org?.status}</Badge>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">Invoice Limit</p>
              <p className="text-lg font-bold text-primary font-mono">{org?.invoice_limit?.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">Members</p>
              <p className="text-lg font-bold text-primary font-mono">{members.length}</p>
            </div>
          </div>

          {/* Usage */}
          {usage && (
            <div className="mt-5 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monthly Usage</span>
                <span className="text-sm font-bold font-mono">{usage.currentMonth} / {usage.limit?.toLocaleString()}</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', usage.percentage >= 90 ? 'bg-danger' : usage.percentage >= 70 ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.min(100, usage.percentage)}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{usage.remaining?.toLocaleString()} remaining</p>
            </div>
          )}

          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span>Slug: <code className="font-mono text-foreground">{org?.slug}</code></span>
            <span>Created: {org?.created_at ? new Date(org.created_at).toLocaleDateString() : '—'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Members — uses user_name/user_email from API (no admin user list needed) */}
      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Members ({members.length})</CardTitle>
              <CardDescription>Manage team access and roles.</CardDescription>
            </div>
            {canManage && (
              <Button onClick={() => setShowInvite(true)}><UserPlus className="h-4 w-4 mr-1" /> Invite Member</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {members.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Joined</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const roleMeta = ROLE_META[m.org_role] ?? ROLE_META.viewer;
                  const isOwner = m.org_role === 'owner';
                  const RoleIcon = roleMeta.icon;
                  return (
                    <TableRow key={m.user_id}>
                      <TableCell>
                        <div className="font-semibold">{m.user_name ?? m.user_id}</div>
                        {m.user_email && <div className="text-[11px] text-muted-foreground">{m.user_email}</div>}
                      </TableCell>
                      <TableCell>
                        {canManage && !isOwner ? (
                          <Select value={m.org_role} onValueChange={(val) => void handleChangeRole(m.user_id, val as OrgRole)}>
                            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{ASSIGNABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_META[r]?.label ?? r}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={roleMeta.variant} className="gap-1"><RoleIcon className="h-3 w-3" />{roleMeta.label}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(m.joined_at).toLocaleDateString()}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          {!isOwner && <Button variant="destructive" size="sm" onClick={() => void handleRemove(m.user_id)}><Trash2 className="h-3.5 w-3.5 mr-1" /> Remove</Button>}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">No members yet. Invite your team.</p>
          )}
        </CardContent>
      </Card>

      {/* Webhooks */}
      {canManage && (
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Webhooks ({webhooks.length})</CardTitle>
                <CardDescription>Get notified on invoice events.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowAddWebhook(!showAddWebhook)}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
          </CardHeader>
          <CardContent>
            {showAddWebhook && (
              <div className="mb-4 p-4 rounded-lg border border-border bg-background space-y-3">
                <div><Label>URL (HTTPS)</Label><Input value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://example.com/webhooks" /></div>
                <div><Label>Description</Label><Input value={whDesc} onChange={(e) => setWhDesc(e.target.value)} placeholder="Slack notification" /></div>
                <div>
                  <Label>Events</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {availableEvents.map((ev) => (
                      <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="checkbox" checked={whEvents.includes(ev)} onChange={(e) => setWhEvents(e.target.checked ? [...whEvents, ev] : whEvents.filter((x) => x !== ev))} />{ev}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2"><Button size="sm" onClick={() => void handleAddWebhook()}>Create</Button><Button size="sm" variant="ghost" onClick={() => setShowAddWebhook(false)}>Cancel</Button></div>
              </div>
            )}
            {webhooks.length > 0 ? (
              <Table>
                <TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Events</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {webhooks.map((wh) => (
                    <TableRow key={wh.endpoint_id}>
                      <TableCell><div className="font-mono text-xs truncate max-w-[250px]">{wh.url}</div>{wh.description && <div className="text-[11px] text-muted-foreground mt-0.5">{wh.description}</div>}</TableCell>
                      <TableCell><div className="flex flex-wrap gap-1">{wh.events.map((ev) => <Badge key={ev} variant="muted" className="text-[9px]">{ev}</Badge>)}</div></TableCell>
                      <TableCell><Badge variant={wh.active ? 'success' : 'muted'}>{wh.active ? 'Active' : 'Disabled'}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="outline" size="sm" onClick={() => void handleToggleWebhook(wh.endpoint_id, !wh.active)}>{wh.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}</Button>
                          <Button variant="destructive" size="sm" onClick={() => void handleDeleteWebhook(wh.endpoint_id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : !showAddWebhook ? <p className="text-xs text-muted-foreground py-4 text-center">No webhooks yet.</p> : null}
          </CardContent>
        </Card>
      )}

      {/* Audit */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Audit Log</CardTitle></CardHeader>
        <CardContent>
          {auditLogs.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Resource</TableHead></TableRow></TableHeader>
              <TableBody>
                {auditLogs.map((log) => (
                  <TableRow key={log.log_id}>
                    <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{log.user_id ?? '—'}</TableCell>
                    <TableCell><Badge variant="muted" className="text-[11px]">{log.action}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{log.resource_type && log.resource_id ? `${log.resource_type}:${String(log.resource_id).slice(0, 8)}…` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-xs text-muted-foreground py-4 text-center">No audit log entries yet.</p>}
        </CardContent>
      </Card>

      {/* Invite / Create member dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>Invite an existing user or create a new account.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 border-b border-border pb-3">
            <Button variant={inviteMode === 'invite' ? 'default' : 'outline'} size="sm" onClick={() => setInviteMode('invite')}>Invite Existing</Button>
            <Button variant={inviteMode === 'create' ? 'default' : 'outline'} size="sm" onClick={() => setInviteMode('create')}>Create New</Button>
          </div>
          {inviteMode === 'invite' ? (
            <div className="space-y-4 pt-2">
              <div>
                <Label>Email Address</Label>
                <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@company.com" onKeyDown={(e) => e.key === 'Enter' && void handleInviteByEmail()} />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_META[r]?.label ?? r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {inviteRole === 'admin' && 'Full org access except billing'}
                  {inviteRole === 'reviewer' && 'Can upload, edit, approve invoices'}
                  {inviteRole === 'viewer' && 'Read-only access to invoices'}
                  {inviteRole === 'api_user' && 'API-only access for integrations'}
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
                <Button onClick={() => void handleInviteByEmail()} disabled={inviting}>
                  <UserPlus className="h-4 w-4 mr-1" />{inviting ? 'Inviting…' : 'Invite'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div>
                <Label>Full Name</Label>
                <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="jane@company.com" />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="Min 6 characters" />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={createRole} onValueChange={(v) => setCreateRole(v as OrgRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_META[r]?.label ?? r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
                <Button onClick={() => void handleCreateMember()} disabled={inviting}>
                  <UserPlus className="h-4 w-4 mr-1" />{inviting ? 'Creating…' : 'Create Account'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * EXPORTED COMPONENT — renders correct view based on system role
 * ══════════════════════════════════════════════════════════════════════════ */

export function OrgPage() {
  const role = getSessionRole();
  return role === 'admin' ? <SuperAdminRedirect /> : <RegularUserOrgView />;
}
