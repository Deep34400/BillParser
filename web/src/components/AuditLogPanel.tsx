import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { api } from '../api/client.js';
import { ErrorState } from './ErrorState.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Badge } from '@/components/ui/badge.js';
import { Input } from '@/components/ui/input.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';
import { Skeleton } from '@/components/ui/skeleton.js';
import { EmptyState } from '@/components/ui/empty-state.js';

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
  const [action, setAction] = useState('');
  const [debouncedAction, setDebouncedAction] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAction(action), 300);
    return () => clearTimeout(timer);
  }, [action]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit-logs', debouncedAction.trim() || undefined],
    queryFn: () => api.auditLogs({ action: debouncedAction.trim() || undefined, limit: 50 }),
  });

  const logs = data?.data ?? [];
  const total = data?.metadata.total ?? 0;

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
        {error ? (
          <ErrorState
            title="Failed to load activity"
            message={error instanceof Error ? error.message : 'Failed to load activity'}
            onRetry={() => void refetch()}
          />
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : logs.length > 0 ? (
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
          <EmptyState
            icon={<History className="h-10 w-10" />}
            title="No activity yet"
            description="Your activity history will show here as you use BillParser."
          />
        )}
      </CardContent>
    </Card>
  );
}
