import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import type { FraudAlert } from '../types/index.js';
import { countFmt } from '../lib/format.js';
import { DocNote, type DocItem } from '../components/DocNote.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent } from '@/components/ui/card.js';
import { EmptyState } from '@/components/ui/empty-state.js';

type CheckType = 'all' | 'duplicates' | 'gst' | 'prices' | 'odometer';
const PAGE_SIZE = 20;

const FRAUD_FORMULAS: DocItem[] = [
  { term: 'Duplicate Invoices', desc: 'GROUP BY (invoice_number + vendor_gstin) → alert if count > 1' },
  { term: 'GST Anomalies', desc: 'accept if GST ≈ amount×rate% · tolerance max(₹1, 1%)' },
  { term: 'Price Anomalies', desc: 'median × 1.5 threshold · needs 3+ bills per part' },
  { term: 'Odometer Issues', desc: 'current_odometer < previous_odometer → alert' },
];

const CHECKS: { key: CheckType; label: string; icon: string; types: string[] }[] = [
  { key: 'all', label: 'Full Scan', icon: '🔍', types: ['DUPLICATE_INVOICE', 'GST_MISMATCH', 'PRICE_ANOMALY', 'ODOMETER_INCONSISTENCY'] },
  { key: 'duplicates', label: 'Duplicates', icon: '📋', types: ['DUPLICATE_INVOICE'] },
  { key: 'gst', label: 'GST', icon: '📊', types: ['GST_MISMATCH'] },
  { key: 'prices', label: 'Prices', icon: '💰', types: ['PRICE_ANOMALY'] },
  { key: 'odometer', label: 'Odometer', icon: '🚗', types: ['ODOMETER_INCONSISTENCY'] },
];

const SEVERITY_MAP: Record<string, 'danger' | 'warning' | 'success' | 'muted'> = {
  CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'warning', LOW: 'success',
};

export function FraudPage() {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeCheck, setActiveCheck] = useState<CheckType>('all');
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [scanCounts, setScanCounts] = useState<Record<CheckType, number>>({ all: 0, duplicates: 0, gst: 0, prices: 0, odometer: 0 });

  const fetchSummary = useCallback(async () => {
    try {
      const s = await api.fraudSummary();
      setScanCounts({ all: s.total, duplicates: s.by_type['DUPLICATE_INVOICE'] ?? 0, gst: s.by_type['GST_MISMATCH'] ?? 0, prices: s.by_type['PRICE_ANOMALY'] ?? 0, odometer: s.by_type['ODOMETER_INCONSISTENCY'] ?? 0 });
      setLastScan(new Date());
    } catch { /* ignore */ }
  }, []);

  const fetchAlerts = useCallback(async (type: CheckType, offset: number, append: boolean) => {
    let result;
    switch (type) {
      case 'all': result = await api.fraudScan(PAGE_SIZE, offset); break;
      case 'duplicates': result = await api.fraudDuplicates(PAGE_SIZE, offset); break;
      case 'gst': result = await api.fraudGst(PAGE_SIZE, offset); break;
      case 'prices': result = await api.fraudPrices(PAGE_SIZE, offset); break;
      case 'odometer': result = await api.fraudOdometer(PAGE_SIZE, offset); break;
    }
    const data = result.data ?? [];
    const t = result.metadata?.total as number ?? data.length;
    setTotal(t);
    setAlerts((prev) => append ? [...prev, ...data] : data);
  }, []);

  const runCheck = useCallback(async (type: CheckType) => {
    setLoading(true); setError(null); setActiveCheck(type); setAlerts([]);
    try { await fetchAlerts(type, 0, false); await fetchSummary(); } catch (e) { setError(e instanceof Error ? e.message : 'Scan failed'); } finally { setLoading(false); }
  }, [fetchAlerts, fetchSummary]);

  const showMore = () => { setLoadingMore(true); fetchAlerts(activeCheck, alerts.length, true).finally(() => setLoadingMore(false)); };
  useEffect(() => { runCheck('all'); }, [runCheck]);

  const bySeverity = alerts.reduce((acc, a) => { acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="max-w-[1200px] px-7 py-6 font-sans">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="font-heading text-xl font-bold">Fraud Detection</h1>
          <p className="text-sm text-muted-foreground">Auto-scans on load · click a check to filter · paginated (top {PAGE_SIZE})</p>
        </div>
        <Button onClick={() => runCheck('all')} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          {loading ? 'Scanning…' : 'Rescan all'}
        </Button>
      </div>

      {/* Status bar */}
      <Card className="mb-4">
        <CardContent className="pt-4 flex flex-wrap items-center gap-6">
          {[
            { label: 'Total alerts', value: scanCounts.all, danger: scanCounts.all > 0 },
            { label: 'Duplicates', value: scanCounts.duplicates, danger: scanCounts.duplicates > 0 },
            { label: 'GST', value: scanCounts.gst, danger: scanCounts.gst > 0 },
            { label: 'Prices', value: scanCounts.prices, danger: scanCounts.prices > 0 },
            { label: 'Odometer', value: scanCounts.odometer, danger: scanCounts.odometer > 0 },
          ].map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <span className={cn('text-xl font-bold', s.danger ? 'text-danger' : 'text-success')}>{countFmt(s.value)}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
          {lastScan && <span className="ml-auto text-[11px] text-faint">Last scan: {lastScan.toLocaleTimeString('en-IN')}</span>}
        </CardContent>
      </Card>

      <DocNote title="Formulas & backend logic" subtitle="Edit platform/src/fraud/service.ts to change rules" items={FRAUD_FORMULAS} />

      {/* Check tabs */}
      <div className="flex flex-wrap gap-2 my-5">
        {CHECKS.map((c) => {
          const count = scanCounts[c.key];
          const active = activeCheck === c.key;
          return (
            <button key={c.key} onClick={() => runCheck(c.key)} disabled={loading}
              className={cn('flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
                active ? 'border-primary bg-secondary text-primary' : 'border-border bg-card text-foreground hover:bg-muted')}>
              <span>{c.icon}</span>
              <span>{c.label}</span>
              <Badge variant={count > 0 ? 'danger' : 'muted'} className="text-[11px]">{countFmt(count)}</Badge>
            </button>
          );
        })}
      </div>

      {loading && <p className="text-center py-8 text-muted-foreground">Scanning invoices…</p>}
      {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger mb-4">{error}</div>}

      {!loading && !error && (
        <>
          {alerts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {Object.entries(bySeverity).map(([sev, n]) => (
                <Badge key={sev} variant={SEVERITY_MAP[sev] ?? 'muted'} className="text-[11px]">{sev}: {n}</Badge>
              ))}
              <span className="text-xs text-muted-foreground ml-2">Showing {alerts.length} of {total}</span>
            </div>
          )}

          {alerts.length === 0 ? (
            <Card className="border-success/20 bg-success-soft">
              <EmptyState icon={<ShieldCheck className="h-8 w-8 text-success" />}
                title="No issues found"
                description={activeCheck === 'all' ? 'All fraud checks passed' : `No ${CHECKS.find((c) => c.key === activeCheck)?.label} alerts`}
              />
            </Card>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert, i) => <AlertCard key={`${alert.type}-${i}`} alert={alert} />)}
              {alerts.length < total && (
                <div className="text-center pt-4">
                  <Button variant="outline" onClick={showMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : `Show more (${alerts.length} of ${total})`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: FraudAlert }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left cursor-pointer">
        <Badge variant={SEVERITY_MAP[alert.severity] ?? 'muted'} className="text-[10px]">{alert.severity}</Badge>
        <Badge variant="info" className="text-[10px]">{alert.type.replace(/_/g, ' ')}</Badge>
        <span className="flex-1 text-sm">{alert.message}</span>
        <span className="text-xs text-muted-foreground">{alert.bill_ids.length} bill{alert.bill_ids.length !== 1 ? 's' : ''}</span>
        {open ? <ChevronDown className="h-4 w-4 text-faint" /> : <ChevronRight className="h-4 w-4 text-faint" />}
      </button>
      {open && (
        <div className="border-t border-border bg-muted/50 px-4 py-3">
          <p className="text-xs text-muted-foreground mb-2">
            <strong>Bills:</strong>{' '}
            {alert.bill_ids.map((id, i) => (
              <span key={id}>{i > 0 && ', '}<Link to={`/invoices/${id}`} className="text-primary hover:underline">{id.slice(0, 8)}…</Link></span>
            ))}
          </p>
          <pre className="rounded-md border border-border bg-card p-3 font-mono text-[11px] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(alert.details, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  );
}
