import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Plus, Trash2, Webhook } from 'lucide-react';
import { api, type WebhookEndpointInfo } from '../api/client.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';
import { EmptyState } from '@/components/ui/empty-state.js';

const DEFAULT_EVENTS = [
  'invoice.uploaded',
  'invoice.completed',
  'invoice.failed',
  'invoice.approved',
  'invoice.rejected',
  'invoice.deleted',
];

export function WebhooksPanel({ onFlash }: { onFlash?: (text: string, type?: 'ok' | 'err') => void }) {
  const [hooks, setHooks] = useState<WebhookEndpointInfo[]>([]);
  const [events, setEvents] = useState<string[]>([...DEFAULT_EVENTS]);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const flash = onFlash ?? (() => undefined);

  const load = useCallback(async () => {
    try {
      const r = await api.listWebhooks();
      setHooks(r.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleEvent = (event: string) => {
    setEvents((prev) => prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]);
  };

  const handleCreate = async () => {
    try {
      const r = await api.createWebhook(url.trim(), events, description.trim() || undefined);
      setNewSecret(r.data.secret);
      setUrl('');
      setDescription('');
      flash('Webhook created — copy the signing secret now.');
      void load();
    } catch (e) {
      flash((e as Error).message, 'err');
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    try {
      await api.toggleWebhook(id, active);
      flash(active ? 'Webhook enabled' : 'Webhook paused');
      void load();
    } catch (e) {
      flash((e as Error).message, 'err');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this webhook endpoint?')) return;
    try {
      await api.deleteWebhook(id);
      flash('Webhook removed');
      void load();
    } catch (e) {
      flash((e as Error).message, 'err');
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Webhook className="h-4 w-4" /> Webhooks</CardTitle>
        <CardDescription>
          Receive a signed POST when invoices are uploaded, processed, approved, rejected, or deleted.
          Production URLs must be HTTPS. Locally you can use <code>http://localhost</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 mb-4 sm:grid-cols-[1fr_200px_auto]">
          <Input ref={urlInputRef} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/invoices" />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Label (optional)" />
          <Button onClick={() => void handleCreate()} disabled={!url.trim() || events.length === 0}>
            <Plus className="h-4 w-4" /> Add endpoint
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {DEFAULT_EVENTS.map((event) => (
            <button
              key={event}
              type="button"
              onClick={() => toggleEvent(event)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium',
                events.includes(event)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground',
              )}
            >
              {event}
            </button>
          ))}
        </div>

        {newSecret && (
          <div className="mb-4 rounded-lg border border-success/20 bg-success-soft p-4">
            <p className="text-sm font-bold mb-2">Signing secret (shown once)</p>
            <div className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs break-all mb-3">{newSecret}</div>
            <div className="flex gap-2">
              <Button variant="success" size="sm" onClick={() => { void navigator.clipboard.writeText(newSecret); flash('Secret copied'); }}>
                <Copy className="h-3.5 w-3.5" /> Copy secret
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setNewSecret(null)}>Dismiss</Button>
            </div>
          </div>
        )}

        {hooks.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks.map((h) => (
                <TableRow key={h.endpoint_id}>
                  <TableCell>
                    <div className="font-mono text-xs break-all">{h.url}</div>
                    {h.description && <p className="text-[11px] text-muted-foreground mt-1">{h.description}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {h.events.map((event) => <Badge key={event} variant="secondary" className="text-[10px]">{event}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={h.active ? 'success' : 'danger'}>{h.active ? 'Active' : 'Paused'}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void handleToggle(h.endpoint_id, !h.active)}>
                        {h.active ? 'Pause' : 'Enable'}
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => void handleDelete(h.endpoint_id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={<Webhook className="h-10 w-10" />}
            title="No webhooks yet"
            description="Set up webhooks to get notified when invoices are processed."
            action={
              <Button onClick={() => urlInputRef.current?.focus()}>
                <Plus className="h-4 w-4" /> Add Webhook
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
