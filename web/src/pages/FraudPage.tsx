import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import type { FraudAlert } from '../types/index.js';
import { T } from '../theme.js';
import { countFmt } from '../lib/format.js';
import { DocNote, type DocItem } from '../components/DocNote.js';

type CheckType = 'all' | 'duplicates' | 'gst' | 'prices' | 'odometer';

const FRAUD_FORMULAS: DocItem[] = [
  { label: 'Duplicate Invoices', severity: 'HIGH', formula: 'GROUP BY (invoice_number + vendor_gstin) → alert if count > 1', description: 'Same invoice number from same vendor GSTIN submitted more than once.', sourceFile: 'platform/src/fraud/service.ts → detectDuplicateInvoices()' },
  { label: 'GST Anomalies', severity: 'MEDIUM', formula: 'accept if GST ≈ amount×rate% OR (amount−discount)×rate% · tolerance max(₹1, 1%)', description: 'Handles both invoice styles: (A) amount already post-discount, (B) amount is pre-discount line sum. True mismatch only when neither matches.', sourceFile: 'platform/src/fraud/service.ts → checkGstSide()' },
  { label: 'Price Anomalies', severity: 'MEDIUM', formula: 'median × 1.5 threshold · needs 3+ bills per part', description: 'Parts priced >50% above median rate.', sourceFile: 'platform/src/fraud/service.ts → detectPriceAnomalies()' },
  { label: 'Odometer Issues', severity: 'HIGH', formula: 'current_odometer < previous_odometer → alert', description: 'Odometer rollback for same vehicle.', sourceFile: 'platform/src/fraud/service.ts → detectOdometerInconsistency()' },
];

const CHECKS: { key: CheckType; label: string; icon: string; desc: string; types: string[] }[] = [
  { key: 'all', label: 'Full Scan', icon: '🔍', desc: 'All checks in parallel', types: ['DUPLICATE_INVOICE', 'GST_MISMATCH', 'PRICE_ANOMALY', 'ODOMETER_INCONSISTENCY'] },
  { key: 'duplicates', label: 'Duplicates', icon: '📋', desc: 'Same invoice + vendor', types: ['DUPLICATE_INVOICE'] },
  { key: 'gst', label: 'GST', icon: '📊', desc: 'CGST+SGST+IGST match', types: ['GST_MISMATCH'] },
  { key: 'prices', label: 'Prices', icon: '💰', desc: '>50% above median', types: ['PRICE_ANOMALY'] },
  { key: 'odometer', label: 'Odometer', icon: '🚗', desc: 'Mileage rollback', types: ['ODOMETER_INCONSISTENCY'] },
];

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: { bg: '#fce4ec', text: '#b71c1c', border: '#ef9a9a' },
  HIGH: { bg: '#fff3e0', text: '#e65100', border: '#ffcc02' },
  MEDIUM: { bg: '#fff8e1', text: '#f57f17', border: '#ffe082' },
  LOW: { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' },
};

function countForCheck(alerts: FraudAlert[], check: CheckType): number {
  if (check === 'all') return alerts.length;
  const def = CHECKS.find((c) => c.key === check);
  if (!def) return 0;
  return alerts.filter((a) => def.types.includes(a.type)).length;
}

export function FraudPage() {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCheck, setActiveCheck] = useState<CheckType>('all');
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [scanCounts, setScanCounts] = useState<Record<CheckType, number>>({
    all: 0, duplicates: 0, gst: 0, prices: 0, odometer: 0,
  });

  const runCheck = useCallback(async (type: CheckType) => {
    setLoading(true);
    setError(null);
    setActiveCheck(type);
    try {
      let result;
      switch (type) {
        case 'all': result = await api.fraudScan(); break;
        case 'duplicates': result = await api.fraudDuplicates(); break;
        case 'gst': result = await api.fraudGst(); break;
        case 'prices': result = await api.fraudPrices(); break;
        case 'odometer': result = await api.fraudOdometer(); break;
      }
      const data = result.data ?? [];
      setAlerts(data);
      setLastScan(new Date());

      if (type === 'all') {
        setScanCounts({
          all: data.length,
          duplicates: countForCheck(data, 'duplicates'),
          gst: countForCheck(data, 'gst'),
          prices: countForCheck(data, 'prices'),
          odometer: countForCheck(data, 'odometer'),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run full scan on page load
  useEffect(() => {
    runCheck('all');
  }, [runCheck]);

  const displayed = activeCheck === 'all'
    ? alerts
    : alerts.filter((a) => CHECKS.find((c) => c.key === activeCheck)?.types.includes(a.type));

  const bySeverity = displayed.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 4px' }}>Fraud Detection</h1>
          <p style={{ color: T.muted, margin: 0, fontSize: 14 }}>
            Auto-scans on load · click a check to filter results
          </p>
        </div>
        <button
          type="button"
          onClick={() => runCheck('all')}
          disabled={loading}
          style={{
            padding: '10px 18px', borderRadius: 8, border: 'none',
            background: T.accent, color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer', fontFamily: T.font, flexShrink: 0,
          }}
        >
          {loading ? 'Scanning…' : '↻ Rescan all'}
        </button>
      </div>

      {/* Status bar */}
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: '12px 16px', marginBottom: 16,
      }}>
        <StatusChip label="Total alerts" value={scanCounts.all} color={scanCounts.all > 0 ? T.red : T.green} />
        <StatusChip label="Duplicates" value={scanCounts.duplicates} color={scanCounts.duplicates > 0 ? T.amber : T.muted} />
        <StatusChip label="GST" value={scanCounts.gst} color={scanCounts.gst > 0 ? T.amber : T.muted} />
        <StatusChip label="Prices" value={scanCounts.prices} color={scanCounts.prices > 0 ? T.amber : T.muted} />
        <StatusChip label="Odometer" value={scanCounts.odometer} color={scanCounts.odometer > 0 ? T.amber : T.muted} />
        {lastScan && (
          <span style={{ fontSize: 11, color: T.faint, marginLeft: 'auto' }}>
            Last scan: {lastScan.toLocaleTimeString('en-IN')}
          </span>
        )}
      </div>

      <DocNote title="Formulas & backend logic" subtitle="Edit platform/src/services/fraud/fraudDetectionService.ts to change rules" items={FRAUD_FORMULAS} />

      {/* Check filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {CHECKS.map((c) => {
          const count = scanCounts[c.key];
          const active = activeCheck === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setActiveCheck(c.key)}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 8,
                background: active ? T.accentSoft : T.panel,
                border: `1px solid ${active ? T.accent : T.border}`,
                cursor: 'pointer', fontFamily: T.font,
              }}
            >
              <span>{c.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: active ? T.accent : T.text }}>{c.label}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, minWidth: 20, textAlign: 'center',
                padding: '2px 6px', borderRadius: 10,
                background: count > 0 ? '#fce4ec' : T.rail,
                color: count > 0 ? T.red : T.muted,
              }}>
                {countFmt(count)}
              </span>
            </button>
          );
        })}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 32, color: T.muted, fontSize: 14 }}>
          Scanning all invoices…
        </div>
      )}

      {error && (
        <div style={{ background: '#fce4ec', border: '1px solid #ef9a9a', borderRadius: 10, padding: '14px 18px', color: '#b71c1c', fontSize: 14, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {activeCheck !== 'all' && (
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>
              Showing {countFmt(displayed.length)} alert{displayed.length !== 1 ? 's' : ''} for <strong>{CHECKS.find((c) => c.key === activeCheck)?.label}</strong>
              {' · '}
              <button type="button" onClick={() => setActiveCheck('all')} style={{ background: 'none', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}>
                Show all
              </button>
            </div>
          )}

          {displayed.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {Object.entries(bySeverity).map(([sev, n]) => (
                <span key={sev} style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                  background: SEVERITY_COLORS[sev]?.bg, color: SEVERITY_COLORS[sev]?.text,
                  border: `1px solid ${SEVERITY_COLORS[sev]?.border}`,
                }}>
                  {sev}: {n}
                </span>
              ))}
            </div>
          )}

          {displayed.length === 0 ? (
            <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 10, padding: '24px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#2e7d32' }}>No issues found</div>
              <div style={{ fontSize: 13, color: '#4caf50', marginTop: 4 }}>
                {activeCheck === 'all' ? 'All fraud checks passed' : `No ${CHECKS.find((c) => c.key === activeCheck)?.label} alerts`}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayed.map((alert, i) => (
                <AlertCard key={`${alert.type}-${i}`} alert={alert} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{countFmt(value)}</span>
      <span style={{ fontSize: 11, color: T.muted }}>{label}</span>
    </div>
  );
}

function AlertCard({ alert }: { alert: FraudAlert }) {
  const sev = SEVERITY_COLORS[alert.severity] ?? SEVERITY_COLORS.LOW;
  const [open, setOpen] = useState(false);

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <span style={{ background: sev.bg, color: sev.text, border: `1px solid ${sev.border}`, fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5 }}>
          {alert.severity}
        </span>
        <span style={{ background: T.accentSoft, color: T.accent, fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 5 }}>
          {alert.type.replace(/_/g, ' ')}
        </span>
        <span style={{ flex: 1, fontSize: 14 }}>{alert.message}</span>
        <span style={{ fontSize: 12, color: T.muted }}>{alert.bill_ids.length} bill{alert.bill_ids.length !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 11, color: T.muted }}>{open ? '▼' : '▶'}</span>
      </div>

      {open && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.border}`, background: T.rail }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
            <strong>Bills:</strong>{' '}
            {alert.bill_ids.map((id, i) => (
              <span key={id}>
                {i > 0 && ', '}
                <Link to={`/invoices/${id}`} style={{ color: T.accent, textDecoration: 'none' }}>{id.slice(0, 8)}…</Link>
              </span>
            ))}
          </div>
          <pre style={{
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '10px 12px', margin: 0, fontSize: 11, overflow: 'auto',
            fontFamily: T.mono, whiteSpace: 'pre-wrap', color: T.text,
          }}>
            {JSON.stringify(alert.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
