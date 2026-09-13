import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, CheckCircle2, XCircle, Clock, Loader2, RefreshCw,
  AlertTriangle, Globe, Zap, FileText, ChevronDown, ChevronRight, User,
} from 'lucide-react';
import {
  api,
  type QueueStats,
  type QueueJobInfo,
  type WebhookStats,
  type WebhookDeliveryInfo,
  type WebhookEndpointSummary,
} from '../api/client.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';
import { Skeleton } from '@/components/ui/skeleton.js';
import { Separator } from '@/components/ui/separator.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string | number; sub?: string; icon: typeof Activity; color: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4 px-5">
        <div className={`rounded-lg p-2 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function PayloadBlock({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

function hostOf(url?: string) {
  if (!url) return '—';
  try { return new URL(url).hostname; } catch { return url; }
}

function jobStateBadge(state: string) {
  if (state === 'completed' || state === 'active') return 'success';
  if (state === 'failed' || state === 'expired' || state === 'cancelled') return 'danger';
  if (state === 'retry' || state === 'created') return 'warning';
  return 'secondary';
}

/* ─── 1. OCR Queue ───────────────────────────────────────────────────────── */

function QueueSection() {
  const [openJob, setOpenJob] = useState<string | null>(null);
  const { data, isLoading } = useQuery<QueueStats>({
    queryKey: ['queue-stats'],
    queryFn: async () => (await api.queueStats()).data,
    refetchInterval: 5_000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[88px]" />)}
      </div>
    );
  }

  const jobs = data.jobs ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">OCR Job Queue</CardTitle>
          <Badge variant={data.initialized ? 'success' : 'danger'} className="text-[10px]">
            {data.initialized ? 'Running' : 'Stopped'}
          </Badge>
          <span className="text-[11px] text-muted-foreground ml-auto">
            Workers: {data.concurrency} · Auto-refresh 5s
          </span>
        </div>
        <CardDescription>
          Pending and active jobs are running now. Open a row to see the payload sent to the worker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Pending" value={data.pending} icon={Clock} color="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" />
          <StatCard label="Active now" value={data.active} icon={Loader2} color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" />
          <StatCard label="Completed" value={data.completed} sub="Last 24h" icon={CheckCircle2} color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" />
          <StatCard label="Failed" value={data.failed} sub="Last 24h" icon={XCircle} color="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" />
          <StatCard label="Expired" value={data.expired} sub="Last 24h" icon={AlertTriangle} color="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" />
        </div>

        {jobs.length > 0 ? (
          <div className="rounded-md border overflow-auto max-h-[360px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>File</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="w-24">State</TableHead>
                  <TableHead className="w-16 text-center">Try</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job: QueueJobInfo) => {
                  const open = openJob === job.id;
                  return (
                    <JobRow key={job.id} job={job} open={open} onToggle={() => setOpenJob(open ? null : job.id)} />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">No recent OCR jobs</p>
        )}
      </CardContent>
    </Card>
  );
}

function JobRow({ job, open, onToggle }: { job: QueueJobInfo; open: boolean; onToggle: () => void }) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="w-8">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </TableCell>
        <TableCell className="text-[11px]">
          <div className="flex items-center gap-1">
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-40">{job.fileName ?? job.billId ?? job.id.slice(0, 8)}</span>
          </div>
        </TableCell>
        <TableCell className="text-[11px] text-muted-foreground">
          {job.userName || job.userEmail || job.userId?.slice(0, 8) || '—'}
        </TableCell>
        <TableCell>
          <Badge variant={jobStateBadge(job.state) as 'success' | 'danger' | 'warning' | 'secondary'} className="text-[10px]">
            {job.state}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-center">{job.retryCount}/{job.retryLimit}</TableCell>
        <TableCell className="text-[11px] text-muted-foreground truncate max-w-48" title={job.error ?? undefined}>
          {job.error ?? '—'}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Job payload</p>
            <PayloadBlock value={job.payload} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ─── 2. Webhook Endpoints ───────────────────────────────────────────────── */

function EndpointsList({ endpoints }: { endpoints: WebhookEndpointSummary[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (ep: WebhookEndpointSummary) => {
    setBusy(ep.id);
    try {
      await api.adminToggleWebhook(ep.id, !ep.active);
      await qc.invalidateQueries({ queryKey: ['webhook-stats'] });
      await qc.invalidateQueries({ queryKey: ['admin-webhook-deliveries'] });
    } finally {
      setBusy(null);
    }
  };

  if (endpoints.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No webhook endpoints registered
      </p>
    );
  }

  return (
    <div className="rounded-md border overflow-auto max-h-[280px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Endpoint</TableHead>
            <TableHead>Events</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-16 text-center">Failed</TableHead>
            <TableHead className="w-24 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map((ep) => (
            <TableRow key={ep.id}>
              <TableCell className="text-[11px]">
                <div className="flex items-center gap-1.5">
                  <User className="h-3 w-3 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium">{ep.user_name || 'User'}</p>
                    <p className="text-muted-foreground">{ep.user_email || ep.user_id.slice(0, 8)}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <p className="font-mono text-[11px] break-all">{ep.url}</p>
                {ep.last_error && !ep.active && (
                  <p className="text-[10px] text-destructive mt-0.5 truncate" title={ep.last_error}>{ep.last_error}</p>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {ep.events.map((e) => (
                    <Badge key={e} variant="secondary" className="text-[9px]">{e.replace('invoice.', '')}</Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                {ep.active ? (
                  <Badge variant="success" className="text-[10px]">Active</Badge>
                ) : ep.auto_paused ? (
                  <Badge variant="danger" className="text-[10px]">Auto-paused</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">Paused</Badge>
                )}
              </TableCell>
              <TableCell className="text-center text-xs">
                {(ep.failed_pending ?? 0) > 0
                  ? <span className="text-destructive font-medium">{ep.failed_pending}</span>
                  : '0'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant={ep.active ? 'outline' : 'default'}
                  className="h-7 px-2 text-xs"
                  disabled={busy === ep.id}
                  onClick={() => void toggle(ep)}
                >
                  {ep.active ? 'Pause' : 'Enable'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WebhookOverview() {
  const { data, isLoading } = useQuery<WebhookStats>({
    queryKey: ['webhook-stats'],
    queryFn: async () => (await api.adminWebhookStats()).data,
    refetchInterval: 15_000,
  });

  if (isLoading || !data) {
    return <Skeleton className="h-72 w-full" />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Webhook Endpoints</CardTitle>
          <div className="flex gap-2 ml-auto">
            <Badge variant="outline" className="text-[10px]">
              {data.activeEndpoints} active / {data.totalEndpoints} total
            </Badge>
            <Badge variant={data.successRate >= 95 ? 'success' : data.successRate >= 80 ? 'warning' : 'danger'} className="text-[10px]">
              {data.successRate}% delivery rate
            </Badge>
          </div>
        </div>
        <CardDescription>
          After 3 failed retries an endpoint is auto-paused. Enable it again to retry that user’s failed events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <EndpointsList endpoints={data.endpoints} />

        {data.daily.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="flex items-center gap-3 mb-3">
                <p className="text-sm font-medium">Delivery success / failure (7 days)</p>
                <div className="flex gap-3 ml-auto text-[11px]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> {data.totalOk} OK
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" /> {data.totalFail} Failed
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.daily} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid var(--color-border)' }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="ok" name="Success" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="fail" name="Failed" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── 3. Delivery Log ────────────────────────────────────────────────────── */

function DeliveryTable() {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<WebhookDeliveryInfo[]>({
    queryKey: ['admin-webhook-deliveries'],
    queryFn: async () => (await api.adminWebhookDeliveries(200)).data,
    refetchInterval: 10_000,
  });

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try {
      await api.adminRetryDelivery(id);
      await refetch();
      void qc.invalidateQueries({ queryKey: ['webhook-stats'] });
    } catch {
      // silent
    } finally {
      setRetrying(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          No webhook deliveries yet — deliveries appear here when invoices trigger events
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Delivery Log</CardTitle>
          <span className="text-[11px] text-muted-foreground ml-auto">
            Last 200 attempts · Auto-refresh 10s
          </span>
        </div>
        <CardDescription>
          Click a row for the payload. Retry only stays on events that never reached 200.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto max-h-[520px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-32">Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="w-14 text-center">Try</TableHead>
                <TableHead className="w-20">Result</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="w-20 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => {
                const open = openId === d.id;
                return (
                  <Fragment key={d.id}>
                    <TableRow
                      className={!d.success ? 'bg-red-500/[0.03] cursor-pointer' : 'cursor-pointer'}
                      onClick={() => setOpenId(open ? null : d.id)}
                    >
                      <TableCell>
                        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(d.created_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <p className="font-medium truncate max-w-28">{d.user_name || '—'}</p>
                        <p className="text-muted-foreground truncate max-w-28">{d.user_email}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          {d.event.replace('invoice.', '')}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-44">
                        <div className="flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${d.endpoint_active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                          <span className="font-mono text-[10px] truncate" title={d.endpoint_url}>
                            {d.endpoint_url ?? hostOf(d.endpoint_url)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {d.file_name ? (
                          <span className="flex items-center gap-1 text-muted-foreground" title={d.bill_id ?? ''}>
                            <FileText className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-24">{d.file_name}</span>
                          </span>
                        ) : d.bill_id ? (
                          <span className="font-mono text-[10px] text-muted-foreground">{d.bill_id.slice(0, 8)}…</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-center">{d.attempt}/3</TableCell>
                      <TableCell>
                        {d.success ? (
                          <Badge variant="success" className="text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-0.5" /> {d.status_code}
                          </Badge>
                        ) : (
                          <Badge variant="danger" className="text-[10px]">
                            <XCircle className="h-3 w-3 mr-0.5" /> {d.status_code ?? 'ERR'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-36 truncate" title={d.error ?? undefined}>
                        {d.error ?? '—'}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {d.retryable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={retrying === d.id}
                            onClick={() => void handleRetry(d.id)}
                          >
                            <RefreshCw className={`h-3 w-3 ${retrying === d.id ? 'animate-spin' : ''}`} />
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow>
                        <TableCell colSpan={10} className="bg-muted/30">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Webhook payload</p>
                          <PayloadBlock value={d.payload} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function MonitoringPanel() {
  return (
    <div className="space-y-6">
      <QueueSection />
      <WebhookOverview />
      <DeliveryTable />
    </div>
  );
}
