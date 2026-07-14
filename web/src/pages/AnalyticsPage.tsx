import { useEffect, useState } from 'react';
import type { Analytics, VehicleSpend, CostPerKm, OcrCostSummary } from '../types/index.js';
import { api } from '../api/client.js';
import { T } from '../theme.js';
import { money, moneyCompact, moneyFull, confLabel, countFmt, costFmt, USD_TO_INR } from '../lib/format.js';
import { DocNote, type DocItem } from '../components/DocNote.js';
import { SearchableTable, type TableColumn } from '../components/SearchableTable.js';

const KPI_DOCS: DocItem[] = [
  { label: 'Total Spend', formula: 'SUM(grand_total_amount) WHERE status = OCR_COMPLETED or VERIFIED', description: 'Sum of net bill amounts across all successfully extracted invoices.', sourceFile: 'platform/src/routes/analytics.ts' },
  { label: 'Parts / Labour / Tax', formula: 'Parts = SUM(parts_amount) · Labour = SUM(labour_amount) · Tax = SUM(total_tax_amount)', description: 'Breakdown of spend by category from OCR-parsed footer totals.', sourceFile: 'platform/src/services/analytics/analyticsService.ts' },
  { label: 'Avg Confidence', formula: 'AVG(confidence_score) across completed bills', description: 'Average OCR extraction confidence (0–100%).', sourceFile: 'platform/src/routes/analytics.ts' },
  { label: 'Needs Review', formula: 'COUNT WHERE confidence < 0.75 AND status ≠ VERIFIED', description: 'Low-confidence invoices not yet human-verified.', sourceFile: 'platform/src/routes/analytics.ts' },
];

const PANEL_DOCS: DocItem[] = [
  { label: 'Workshops / vendors', formula: 'GROUP BY vendor_name → SUM(grand_total_amount)', description: 'All workshops ranked by total spend. Searchable table scales to 50+ vendors.', sourceFile: 'platform/src/routes/analytics.ts' },
  { label: 'Vehicles', formula: 'GROUP BY registration_number → SUM(parts, labour, tax, total)', description: 'Per-vehicle maintenance cost. Searchable table scales to thousands of vehicles.', sourceFile: 'platform/src/services/analytics/analyticsService.ts → getVehicleSpend()' },
  { label: 'Cost per km', formula: 'total_spend ÷ (max_odometer − min_odometer)', description: 'Requires 2+ bills with odometer for same vehicle.', sourceFile: 'platform/src/services/analytics/analyticsService.ts → getCostPerKm()' },
];

const vendorColumns: TableColumn<{ name: string; amount: number }>[] = [
  {
    key: 'name',
    header: 'Workshop / Vendor',
    render: (r) => <span style={{ fontWeight: 500 }}>{r.name}</span>,
    searchValue: (r) => r.name,
  },
  {
    key: 'amount',
    header: 'Total spend',
    align: 'right',
    width: '120px',
    render: (r) => <AmountCell value={r.amount} />,
    searchValue: (r) => String(r.amount),
  },
];

const vehicleColumns: TableColumn<VehicleSpend>[] = [
  {
    key: 'reg',
    header: 'Vehicle',
    render: (r) => (
      <span style={{ fontWeight: 600, fontFamily: T.mono, fontSize: 12 }}>
        {r.registration_number ?? r.vehicle_id}
      </span>
    ),
    searchValue: (r) => r.registration_number ?? r.vehicle_id,
  },
  {
    key: 'bills',
    header: 'Bills',
    align: 'right',
    width: '56px',
    render: (r) => r.total_bills,
  },
  {
    key: 'parts',
    header: 'Parts',
    align: 'right',
    width: '88px',
    render: (r) => <AmountCell value={r.parts_amount} />,
  },
  {
    key: 'labour',
    header: 'Labour',
    align: 'right',
    width: '88px',
    render: (r) => <AmountCell value={r.labour_amount} />,
  },
  {
    key: 'tax',
    header: 'Tax',
    align: 'right',
    width: '80px',
    render: (r) => <AmountCell value={r.total_tax} />,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    width: '96px',
    render: (r) => <AmountCell value={r.total_amount} bold />,
  },
];

const costKmColumns: TableColumn<CostPerKm>[] = [
  {
    key: 'reg',
    header: 'Vehicle',
    render: (r) => (
      <span style={{ fontWeight: 600, fontFamily: T.mono, fontSize: 12 }}>
        {r.registration_number ?? r.vehicle_id}
      </span>
    ),
    searchValue: (r) => r.registration_number ?? r.vehicle_id,
  },
  {
    key: 'cpk',
    header: '₹/km',
    align: 'right',
    width: '88px',
    render: (r) => (
      <span style={{ fontWeight: 700, color: r.cost_per_km != null ? T.accent : T.muted }}>
        {r.cost_per_km != null ? `₹${r.cost_per_km}` : '—'}
      </span>
    ),
  },
  {
    key: 'spend',
    header: 'Total spend',
    align: 'right',
    width: '96px',
    render: (r) => <AmountCell value={r.total_spend} />,
  },
  {
    key: 'km',
    header: 'Km range',
    align: 'right',
    width: '96px',
    render: (r) => (r.km_range != null ? `${countFmt(r.km_range)} km` : '—'),
  },
];

export function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.analytics().then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <PageShell><div style={{ color: T.muted, padding: 8 }}>Loading analytics…</div></PageShell>;
  }

  if (!data || data.completedCount === 0) {
    return (
      <PageShell>
        <DocNote title="How analytics values are calculated" subtitle="Upload invoices first — metrics populate automatically" items={[...KPI_DOCS, ...PANEL_DOCS]} />
        <p style={{ color: T.muted, fontSize: 14 }}>No completed invoices yet — upload and extract some bills.</p>
      </PageShell>
    );
  }

  const kpis = [
    { label: 'TOTAL SPEND', value: moneyCompact(data.totalSpend), full: moneyFull(data.totalSpend), color: T.accent, hint: 'Sum of all invoice grand totals' },
    { label: 'PARTS', value: moneyCompact(data.totalParts), full: moneyFull(data.totalParts), color: T.text, hint: 'Sum of parts_amount' },
    { label: 'LABOUR', value: moneyCompact(data.totalLabour), full: moneyFull(data.totalLabour), color: T.text, hint: 'Sum of labour_amount' },
    { label: 'TAX PAID', value: moneyCompact(data.totalTax), full: moneyFull(data.totalTax), color: T.amber, hint: 'CGST + SGST + IGST' },
    { label: 'WORKSHOPS', value: countFmt(data.vendorCount ?? data.byVendor.length), full: undefined, color: T.text, hint: 'Unique vendor/workshop names' },
    { label: 'VEHICLES', value: countFmt(data.vehicleCount ?? data.vehicleSpend.length), full: undefined, color: T.text, hint: 'Unique registration numbers' },
    { label: 'COMPLETED', value: countFmt(data.completedCount), full: undefined, color: T.green, hint: 'Invoices with OCR done' },
    { label: 'NEEDS REVIEW', value: countFmt(data.needsReview), full: undefined, color: data.needsReview > 0 ? T.red : T.green, hint: 'Low confidence, not verified' },
  ];

  return (
    <PageShell subtitle={`${countFmt(data.completedCount)} invoices · ${countFmt(data.vendorCount ?? data.byVendor.length)} workshops · ${countFmt(data.vehicleCount ?? data.vehicleSpend.length)} vehicles`}>
      <DocNote title="How analytics values are calculated" subtitle="Edit backend files to change formulas" items={[...KPI_DOCS, ...PANEL_DOCS]} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 24 }}>
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Panel title={`Workshops & vendors (${countFmt(data.byVendor.length)})`} note="Search by workshop name · amounts in compact format (hover for exact)">
          <SearchableTable
            rows={data.byVendor}
            columns={vendorColumns}
            rowKey={(r) => r.name}
            searchPlaceholder="Search workshop…"
            emptyMessage="No vendor data"
            maxHeight={420}
          />
        </Panel>

        <Panel title={`Vehicles (${countFmt(data.vehicleSpend.length)})`} note="Search by registration number · scales to 5,000+ vehicles">
          <SearchableTable
            rows={data.vehicleSpend}
            columns={vehicleColumns}
            rowKey={(r) => r.vehicle_id}
            searchPlaceholder="Search vehicle reg no…"
            emptyMessage="No vehicle data"
            maxHeight={420}
          />
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Panel title="Spend by month" note="Grouped by invoice_date month">
          {(data.byMonth.length === 0) ? <Empty>No monthly data</Empty> : (
            <SearchableTable
              rows={data.byMonth}
              columns={[
                { key: 'label', header: 'Month', render: (r) => r.label, searchValue: (r) => r.label },
                { key: 'amount', header: 'Spend', align: 'right', render: (r) => <AmountCell value={r.amount} bold /> },
              ]}
              rowKey={(r) => r.label}
              searchPlaceholder="Filter month…"
              maxHeight={280}
              pageSize={12}
            />
          )}
        </Panel>

        <Panel title={`Cost per km (${countFmt(data.costPerKm.length)} vehicles)`} note="Needs 2+ odometer readings per vehicle">
          {(data.costPerKm.length === 0) ? (
            <Empty>Need 2+ invoices with odometer for same vehicle</Empty>
          ) : (
            <SearchableTable
              rows={data.costPerKm}
              columns={costKmColumns}
              rowKey={(r) => r.vehicle_id}
              searchPlaceholder="Search vehicle…"
              maxHeight={280}
            />
          )}
        </Panel>
      </div>

      {/* OCR Cost Analytics */}
      {data.ocrCosts && data.ocrCosts.total_ocr_count > 0 && (
        <OcrCostPanel costs={data.ocrCosts} />
      )}
    </PageShell>
  );
}

function PageShell({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 4px' }}>Analytics</h1>
      {subtitle && <p style={{ color: T.muted, margin: '0 0 16px', fontSize: 14 }}>{subtitle}</p>}
      {!subtitle && <div style={{ marginBottom: 16 }} />}
      {children}
    </div>
  );
}

function AmountCell({ value, bold }: { value: number; bold?: boolean }) {
  return (
    <span title={moneyFull(value)} style={{ fontWeight: bold ? 700 : 500, color: bold ? T.accent : T.text, cursor: 'default' }}>
      {moneyCompact(value)}
    </span>
  );
}

function KpiCard({ label, value, full, color, hint }: { label: string; value: string; full?: string; color: string; hint: string }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }} title={full ?? hint}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginBottom: 2 }}>{value}</div>
      {full && full !== value && (
        <div style={{ fontSize: 10, color: T.faint, fontFamily: T.mono, marginBottom: 2 }}>{full}</div>
      )}
      <div style={{ fontSize: 10, color: T.faint, lineHeight: 1.3 }}>{hint}</div>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 18px' }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
      {note && <p style={{ fontSize: 11, color: T.faint, margin: '0 0 12px', lineHeight: 1.4 }}>{note}</p>}
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>{children}</p>;
}

function OcrCostPanel({ costs }: { costs: OcrCostSummary }) {
  const inr = (usd: number) => `₹${(usd * USD_TO_INR).toFixed(2)}`;
  const usd = (v: number) => `$${v.toFixed(4)}`;

  return (
    <Panel title="OCR API Cost Analytics" note="Actual token usage and estimated costs from Mistral/Gemini APIs">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="TOTAL OCR" value={countFmt(costs.total_ocr_count)} hint="Completed extractions with cost data" color={T.accent} />
        <KpiCard label="TOTAL COST" value={inr(costs.total_cost_usd)} full={usd(costs.total_cost_usd)} hint="Extraction + Structuring" color={T.accent} />
        <KpiCard label="EXTRACTION" value={inr(costs.total_extraction_cost_usd)} full={`${costs.total_extraction_tokens.toLocaleString()} tokens`} hint="Mistral OCR (PDF → markdown)" color={T.text} />
        <KpiCard label="STRUCTURING" value={inr(costs.total_structuring_cost_usd)} full={`${costs.total_structuring_tokens.toLocaleString()} tokens`} hint="JSON structuring (markdown → data)" color={T.text} />
        <KpiCard label="AVG/OCR" value={inr(costs.avg_cost_per_ocr_usd)} full={`${costs.avg_tokens_per_ocr.toLocaleString()} tokens/OCR`} hint="Average cost per extraction" color={T.amber} />
        <KpiCard label="TOTAL TOKENS" value={costs.total_tokens.toLocaleString()} hint="All API tokens consumed" color={T.muted} />
      </div>

      {costs.by_provider.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: T.muted }}>Cost by Provider</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${T.border}`, textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Provider</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Cost (INR)</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Cost (USD)</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Tokens</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Calls</th>
              </tr>
            </thead>
            <tbody>
              {costs.by_provider.map((p) => (
                <tr key={p.provider} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{p.provider}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{inr(p.cost_usd)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: T.mono }}>{usd(p.cost_usd)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{p.tokens.toLocaleString()}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
