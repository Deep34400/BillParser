import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api, type AuditLogEntry } from '../api/client.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Badge } from '@/components/ui/badge.js';
import { Input } from '@/components/ui/input.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';

function detailsText(details: Record<string, unknown> | null): string {
  if (!details || Object.keys(details).length === 0) return '—';
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
}

export function AuditLogPanel({
  title = 'Activity history',
  description = 'Who did what to invoices, users, tokens, and webhooks.',
}: {
  title?: string;
  description?: string;
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.auditLogs({ action: action.trim() || undefined, limit: 50 });
      setLogs(r.data);
      setTotal(r.metadata.total);
    } catch { /* ignore */ }
  }, [action]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> {title}</CardTitle>
            <CardDescription>{description} {total ? `(${total} total)` : ''}</CardDescription>
          </div>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Filter action (e.g. invoice:approve)"
            className="w-64"
          />
        </div>
      </CardHeader>
      <CardContent>
        {logs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.log_id}>
                  <TableCell className="font-mono text-[11px] whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{log.action}</Badge></TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {log.resource_type ?? '—'}{log.resource_id ? ` · ${log.resource_id.slice(0, 8)}` : ''}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate" title={detailsText(log.details)}>
                    {detailsText(log.details)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-faint py-2">
            No activity yet. Upload an invoice, approve one, or add a webhook — those actions appear here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
