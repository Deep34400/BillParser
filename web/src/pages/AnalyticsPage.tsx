import { useEffect, useState, useCallback, useRef } from 'react';
import type { AnalyticsKpis, VehicleSpend, CostPerKm, OcrCostSummary } from '../types/index.js';
import { api } from '../api/client.js';
import { T } from '../theme.js';
import { moneyCompact, moneyFull, countFmt, USD_TO_INR } from '../lib/format.js';
import { DocNote, type DocItem } from '../components/DocNote.js';

const KPI_DOCS: DocItem[] = [
  { label: 'Total Spend', formula: 'SUM(grand_total_amount) WHERE status = OCR_COMPLETED or VERIFIED', description: 'Sum of net bill amounts across all successfully extracted invoices.', sourceFile: 'platform/src/routes/analytics.ts' },
  { label: 'Parts / Labour / Tax', formula: 'Parts = SUM(parts_amount) · Labour = SUM(labour_amount) · Tax = SUM(total_tax_amount)', description: 'Breakdown of spend by category from OCR-parsed footer totals.', sourceFile: 'platform/src/services/analytics/analyticsService.ts' },
  { label: 'Needs Review', formula: 'COUNT WHERE confidence < 0.75 AND status ≠ VERIFIED', description: 'Low-confidence invoices not yet human-verified.', sourceFile: 'platform/src/routes/analytics.ts' },
];

type MainTab = 'overview' | 'costs';
type SpendView = 'workshops' | 'vehicles' | 'months' | 'costkm';

/* ─── Client-side cache ──────────────────────────────────────────────── */
const CLIENT_CACHE_TTL = 30_000;
const clientCache = new Map<string, { data: unknown; at: number }>();

function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = clientCache.get(key);
  if (hit && Date.now() - hit.at < CLIENT_CACHE_TTL) return Promise.resolve(hit.data as T);
  return fetcher().then((d) => { clientCache.set(key, { data: d, at: Date.now() }); return d; });
}

export function AnalyticsPage() {
  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MainTab>('overview');
  const [spendView, setSpendView] = useState<SpendView>('workshops');

  useEffect(() => {
    cachedFetch('kpis', api.analyticsKpis).then(setKpis).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <PageShell><div style={{ color: T.muted, padding: 8 }}>Loading analytics…</div></PageShell>;
  }

  if (!kpis || kpis.completedCount === 0) {
    return (
      <PageShell>
        <DocNote title="How analytics values are calculated" subtitle="Upload invoices first — metrics populate automatically" items={KPI_DOCS} />
        <p style={{ color: T.muted, fontSize: 14 }}>No completed invoices yet — upload and extract some bills.</p>
      </PageShell>
    );
  }

  return (
    <PageShell subtitle={`${countFmt(kpis.completedCount)} invoices · ${countFmt(kpis.vendorCount)} workshops · ${countFmt(kpis.vehicleCount)} vehicles`}>
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: `2px solid ${T.border}` }}>
        <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')}>Spend Overview</TabBtn>
        <TabBtn active={tab === 'costs'} onClick={() => setTab('costs')}>API Costs</TabBtn>
      </div>

      {tab === 'overview' && (
        <OverviewTab kpis={kpis} spendView={spendView} setSpendView={setSpendView} />
      )}
      {tab === 'costs' && <CostsTab />}
    </PageShell>
  );
}

/* ─── Search input ────────────────────────────────────────────────────── */
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: '7px 12px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 6,
        fontFamily: T.font, outline: 'none', width: 240, background: T.panel, color: T.text,
        marginBottom: 12,
      }}
    />
  );
}

/* ─── Overview Tab (lazy-loads each sub-view) ─────────────────────────── */
function OverviewTab({
  kpis,
  spendView,
  setSpendView,
}: {
  kpis: AnalyticsKpis;
  spendView: SpendView;
  setSpendView: (v: SpendView) => void;
}) {
  const kpiCards = [
    { label: 'TOTAL SPEND', value: moneyCompact(kpis.totalSpend), full: moneyFull(kpis.totalSpend), color: T.accent, hint: 'Sum of all invoice grand totals' },
    { label: 'PARTS', value: moneyCompact(kpis.totalParts), full: moneyFull(kpis.totalParts), color: T.text, hint: 'Sum of parts_amount' },
    { label: 'LABOUR', value: moneyCompact(kpis.totalLabour), full: moneyFull(kpis.totalLabour), color: T.text, hint: 'Sum of labour_amount' },
    { label: 'TAX PAID', value: moneyCompact(kpis.totalTax), full: moneyFull(kpis.totalTax), color: T.amber, hint: 'CGST + SGST + IGST' },
    { label: 'WORKSHOPS', value: countFmt(kpis.vendorCount), color: T.text, hint: 'Unique vendors' },
    { label: 'VEHICLES', value: countFmt(kpis.vehicleCount), color: T.text, hint: 'Unique reg numbers' },
    { label: 'COMPLETED', value: countFmt(kpis.completedCount), color: T.green, hint: 'OCR done' },
    { label: 'NEEDS REVIEW', value: countFmt(kpis.needsReview), color: kpis.needsReview > 0 ? T.red : T.green, hint: 'Low confidence' },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
        {kpiCards.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Chip active={spendView === 'workshops'} onClick={() => setSpendView('workshops')}>
          Workshops ({countFmt(kpis.vendorCount)})
        </Chip>
        <Chip active={spendView === 'vehicles'} onClick={() => setSpendView('vehicles')}>
          Vehicles ({countFmt(kpis.vehicleCount)})
        </Chip>
        <Chip active={spendView === 'months'} onClick={() => setSpendView('months')}>
          By month
        </Chip>
        <Chip active={spendView === 'costkm'} onClick={() => setSpendView('costkm')}>
          Cost / km
        </Chip>
      </div>

      {spendView === 'workshops' && <WorkshopsView totalSpend={kpis.totalSpend} />}
      {spendView === 'vehicles' && <VehiclesView />}
      {spendView === 'months' && <MonthsView />}
      {spendView === 'costkm' && <CostKmView />}
    </>
  );
}

const PAGE_SIZE = 20;

function ShowMore({ shown, total, loading, onClick }: { shown: number; total: number; loading: boolean; onClick: () => void }) {
  if (shown >= total) return null;
  return (
    <div style={{ marginTop: 12, textAlign: 'center' }}>
      <button
        onClick={onClick}
        disabled={loading}
        style={{
          padding: '8px 20px', fontSize: 13, fontWeight: 600, color: T.accent,
          background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
          cursor: loading ? 'wait' : 'pointer', fontFamily: T.font,
        }}
      >
        {loading ? 'Loading…' : `Show more (${shown} of ${total})`}
      </button>
    </div>
  );
}

/* ─── Workshops (paginated, with search) ────────────────────────────── */
function WorkshopsView({ totalSpend }: { totalSpend: number }) {
  const [rows, setRows] = useState<{ name: string; amount: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = useCallback(async (query: string, offset: number, append: boolean) => {
    const r = await api.analyticsWorkshops(query || undefined, PAGE_SIZE, offset);
    setTotal(r.total);
    setRows((prev) => (append ? [...prev, ...r.workshops] : r.workshops));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPage('', 0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  const doSearch = useCallback((query: string) => {
    setLoading(true);
    fetchPage(query, 0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  const handleSearch = (v: string) => {
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 300);
  };

  const showMore = () => {
    setLoadingMore(true);
    fetchPage(q, rows.length, true).finally(() => setLoadingMore(false));
  };

  if (loading && rows.length === 0) {
    return <Panel title="Workshops & vendors"><div style={{ color: T.muted }}>Loading…</div></Panel>;
  }

  return (
    <Panel title="Workshops & vendors" note="Spend ranked by workshop">
      <SearchInput value={q} onChange={handleSearch} placeholder="Search workshops…" />
      {rows.length === 0 ? <Empty>No workshop data</Empty> : (
        <>
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Workshop / Vendor</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Spend</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={v.name} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ ...tdStyle, color: T.faint, width: 36 }}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.accent, display: 'inline-block', flexShrink: 0 }} />
                      {v.name}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: T.accent }} title={moneyFull(v.amount)}>
                    {moneyCompact(v.amount)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: T.muted, fontFamily: T.mono, fontSize: 12 }}>
                    {totalSpend > 0 ? `${((v.amount / totalSpend) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ShowMore shown={rows.length} total={total} loading={loadingMore} onClick={showMore} />
        </>
      )}
    </Panel>
  );
}

/* ─── Vehicles (lazy-loaded, paginated, with search) ──────────────────── */
function VehiclesView() {
  const [data, setData] = useState<VehicleSpend[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = useCallback(async (query: string, offset: number, append: boolean) => {
    const r = await api.analyticsVehicles(query || undefined, PAGE_SIZE, offset);
    setTotal(r.total);
    setData((prev) => (append ? [...prev, ...r.vehicles] : r.vehicles));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPage('', 0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  const doSearch = useCallback((query: string) => {
    setLoading(true);
    fetchPage(query, 0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  const handleSearch = (v: string) => {
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 300);
  };

  const showMore = () => {
    setLoadingMore(true);
    fetchPage(q, data.length, true).finally(() => setLoadingMore(false));
  };

  if (loading && data.length === 0) return <Panel title="Vehicles"><div style={{ color: T.muted }}>Loading…</div></Panel>;
  if (!loading && data.length === 0) return <Panel title="Vehicles"><Empty>No vehicle data</Empty></Panel>;

  return (
    <Panel title="Vehicles" note="Per-vehicle parts / labour / tax / total">
      <SearchInput value={q} onChange={handleSearch} placeholder="Search by reg number…" />
      <table style={tableStyle}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${T.border}` }}>
            <th style={thStyle}>Vehicle</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Bills</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Parts</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Labour</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Tax</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.vehicle_id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ ...tdStyle, fontWeight: 600, fontFamily: T.mono, fontSize: 12 }}>
                {r.registration_number ?? r.vehicle_id}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{r.total_bills}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }} title={moneyFull(r.parts_amount)}>{moneyCompact(r.parts_amount)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }} title={moneyFull(r.labour_amount)}>{moneyCompact(r.labour_amount)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }} title={moneyFull(r.total_tax)}>{moneyCompact(r.total_tax)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: T.accent }} title={moneyFull(r.total_amount)}>
                {moneyCompact(r.total_amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ShowMore shown={data.length} total={total} loading={loadingMore} onClick={showMore} />
    </Panel>
  );
}

/* ─── Months (lazy-loaded) ────────────────────────────────────────────── */
function MonthsView() {
  const [data, setData] = useState<{ label: string; amount: number }[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cachedFetch('months', () => api.analyticsMonths().then((r) => r.months))
      .then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <Panel title="Spend by month"><div style={{ color: T.muted }}>Loading…</div></Panel>;
  if (!data || data.length === 0) return <Panel title="Spend by month"><Empty>No monthly data</Empty></Panel>;

  const total = data.reduce((s, m) => s + m.amount, 0);

  return (
    <Panel title="Spend by month" note="Grouped by invoice date">
      <table style={tableStyle}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${T.border}` }}>
            <th style={thStyle}>Month</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Spend</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.label} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{m.label}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: T.accent }} title={moneyFull(m.amount)}>
                {moneyCompact(m.amount)}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', color: T.muted, fontFamily: T.mono, fontSize: 12 }}>
                {total > 0 ? `${((m.amount / total) * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/* ─── Cost per km (lazy-loaded, paginated, with vehicle search) ─────── */
function CostKmView() {
  const [data, setData] = useState<CostPerKm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = useCallback(async (query: string, offset: number, append: boolean) => {
    const r = await api.analyticsCostkm(query || undefined, PAGE_SIZE, offset);
    setTotal(r.total);
    setData((prev) => (append ? [...prev, ...r.costPerKm] : r.costPerKm));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPage('', 0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  const doSearch = useCallback((query: string) => {
    setLoading(true);
    fetchPage(query, 0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  const handleSearch = (v: string) => {
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 300);
  };

  const showMore = () => {
    setLoadingMore(true);
    fetchPage(q, data.length, true).finally(() => setLoadingMore(false));
  };

  if (loading && data.length === 0) return <Panel title="Cost per km"><div style={{ color: T.muted }}>Loading…</div></Panel>;
  if (!loading && data.length === 0) return <Panel title="Cost per km"><Empty>Need 2+ invoices with odometer for the same vehicle</Empty></Panel>;

  return (
    <Panel title="Cost per km" note="Needs 2+ odometer readings per vehicle">
      <SearchInput value={q} onChange={handleSearch} placeholder="Search vehicle / reg no…" />
      <div style={{
        background: '#F0F4F8', border: '1px solid #D4DEE8', borderRadius: 8,
        padding: '12px 16px', marginBottom: 14, fontSize: 12, lineHeight: 1.8,
      }}>
        <div style={{ fontWeight: 600, color: T.ink, marginBottom: 4 }}>How is this calculated?</div>
        <div style={{ fontFamily: T.mono, color: T.accent, fontSize: 13 }}>
          Cost/km = Total Spend / Km Range
        </div>
        <div style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>
          <b>Total Spend</b> = Sum of grand totals from all invoices for this vehicle<br />
          <b>Km Range</b> = Max odometer reading − Min odometer reading (across all invoices)<br />
          <b>Requires</b> at least 2 invoices with odometer readings for the same vehicle
        </div>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${T.border}` }}>
            <th style={thStyle}>Vehicle</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>₹/km</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total spend</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Km range</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Formula</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.vehicle_id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ ...tdStyle, fontWeight: 600, fontFamily: T.mono, fontSize: 12 }}>
                {r.registration_number ?? r.vehicle_id}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: r.cost_per_km != null ? T.accent : T.muted }}>
                {r.cost_per_km != null ? `₹${r.cost_per_km}` : '—'}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }} title={moneyFull(r.total_spend)}>{moneyCompact(r.total_spend)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: T.muted }}>
                {r.km_range != null ? `${countFmt(r.km_range)} km` : '—'}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: T.mono, fontSize: 11, color: T.muted }}>
                {r.cost_per_km != null && r.km_range != null
                  ? `${moneyCompact(r.total_spend)} ÷ ${countFmt(r.km_range)}`
                  : 'insufficient data'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ShowMore shown={data.length} total={total} loading={loadingMore} onClick={showMore} />
    </Panel>
  );
}

/* ─── API Costs Tab (lazy-loaded) ─────────────────────────────────────── */
function CostsTab() {
  const [costs, setCosts] = useState<OcrCostSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cachedFetch('costs', api.analyticsCosts).then(setCosts).finally(() => setLoading(false));
  }, []);

  const inr = (usd: number) => `₹${(usd * USD_TO_INR).toFixed(2)}`;
  const usd = (v: number) => `$${v.toFixed(4)}`;

  if (loading) return <div style={{ color: T.muted, padding: 8 }}>Loading costs…</div>;
  if (!costs || costs.total_ocr_count === 0) {
    return <Empty>No OCR cost data yet — extract some invoices first.</Empty>;
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <CostKpiCard label="TOTAL OCR RUNS" value={countFmt(costs.total_ocr_count)} sub="" accent={T.accent} />
        <CostKpiCard label="TOTAL COST" value={inr(costs.total_cost_usd)} sub={usd(costs.total_cost_usd)} accent={T.accent} />
        <CostKpiCard label="EXTRACTION" value={inr(costs.total_extraction_cost_usd)} sub={`${costs.total_extraction_tokens.toLocaleString()} tokens`} accent="#3b82f6" />
        <CostKpiCard label="STRUCTURING" value={inr(costs.total_structuring_cost_usd)} sub={`${costs.total_structuring_tokens.toLocaleString()} tokens`} accent="#8b5cf6" />
        <CostKpiCard label="AVG / OCR" value={inr(costs.avg_cost_per_ocr_usd)} sub={`${costs.avg_tokens_per_ocr.toLocaleString()} tokens`} accent={T.amber} />
        <CostKpiCard label="TOTAL TOKENS" value={costs.total_tokens.toLocaleString()} sub="Input + Output" accent={T.muted} />
      </div>

      {costs.by_provider.length > 0 && (
        <Panel title="Cost by Provider" note="Aggregated across all OCR runs">
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                <th style={thStyle}>Provider</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Cost (INR)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Cost (USD)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Tokens</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Calls</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Avg/Call</th>
              </tr>
            </thead>
            <tbody>
              {costs.by_provider.map((p) => (
                <tr key={p.provider} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                        background: p.provider === 'gemini' ? '#4285f4' : p.provider === 'mistral' ? '#ff6f00' : p.provider === 'claude' ? '#6b4c9a' : '#10a37f',
                      }} />
                      {p.provider}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{inr(p.cost_usd)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: T.mono, fontSize: 12 }}>{usd(p.cost_usd)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{p.tokens.toLocaleString()}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{p.count}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: T.mono, fontSize: 12 }}>
                    {usd(p.count > 0 ? p.cost_usd / p.count : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

/* ─── Shared UI components ────────────────────────────────────────────── */
function PageShell({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 4px' }}>Analytics</h1>
      {subtitle && <p style={{ color: T.muted, margin: '0 0 16px', fontSize: 14 }}>{subtitle}</p>}
      {!subtitle && <div style={{ marginBottom: 16 }} />}
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 20px', fontSize: 14, fontWeight: active ? 700 : 500,
        color: active ? T.accent : T.muted, background: 'none', border: 'none',
        borderBottom: active ? `2px solid ${T.accent}` : '2px solid transparent',
        cursor: 'pointer', fontFamily: T.font, marginBottom: -2,
      }}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 14px', fontSize: 13, fontWeight: active ? 700 : 500,
        color: active ? '#fff' : T.text, background: active ? T.accent : T.panel,
        border: `1px solid ${active ? T.accent : T.border}`, borderRadius: 8,
        cursor: 'pointer', fontFamily: T.font,
      }}
    >
      {children}
    </button>
  );
}

function KpiCard({ label, value, full, color, hint }: { label: string; value: string; full?: string; color: string; hint: string }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }} title={full ?? hint}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginBottom: 2 }}>{value}</div>
      {full && full !== value && <div style={{ fontSize: 10, color: T.faint, fontFamily: T.mono, marginBottom: 2 }}>{full}</div>}
      <div style={{ fontSize: 10, color: T.faint, lineHeight: 1.3 }}>{hint}</div>
    </div>
  );
}

function CostKpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginBottom: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.faint }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
      {note && <p style={{ fontSize: 11, color: T.faint, margin: '0 0 12px', lineHeight: 1.4 }}>{note}</p>}
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>{children}</p>;
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: '0.04em', textTransform: 'uppercase' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };
