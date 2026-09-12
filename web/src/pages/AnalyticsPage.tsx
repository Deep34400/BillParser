import { useEffect, useState, useCallback, useRef } from 'react';
import type { AnalyticsKpis, VehicleSpend, CostPerKm, OcrCostSummary } from '../types/index.js';
import { api } from '../api/client.js';
import { moneyCompact, moneyFull, countFmt, usdToInrRate } from '../lib/format.js';
import { DocNote, type DocItem } from '../components/DocNote.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Card, CardContent } from '@/components/ui/card.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.js';

const KPI_DOCS: DocItem[] = [
  { term: 'Total Spend', desc: 'SUM(grand_total_amount) WHERE status = OCR_COMPLETED or VERIFIED' },
  { term: 'Parts / Labour / Tax', desc: 'Parts = SUM(parts_amount) · Labour = SUM(labour_amount) · Tax = SUM(total_tax_amount)' },
  { term: 'Needs Review', desc: 'COUNT WHERE ocr_status = NEED_REVIEW (no GSTIN and no PAN at OCR save)' },
];

type SpendView = 'workshops' | 'vehicles' | 'months' | 'costkm';
const PAGE_SIZE = 20;

export function AnalyticsPage() {
  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.analyticsKpis().then(setKpis).finally(() => setLoading(false)); }, []);

  if (loading) return <PageShell><p className="text-muted-foreground py-2">Loading analytics…</p></PageShell>;

  if (!kpis || kpis.completedCount === 0) {
    return (
      <PageShell>
        <DocNote title="How analytics values are calculated" subtitle="Upload invoices first — metrics populate automatically" items={KPI_DOCS} />
        <p className="text-sm text-muted-foreground mt-4">No completed invoices yet — upload and extract some bills.</p>
      </PageShell>
    );
  }

  return (
    <PageShell subtitle={`${countFmt(kpis.completedCount)} invoices · ${countFmt(kpis.vendorCount)} workshops · ${countFmt(kpis.vehicleCount)} vehicles`}>
      <Tabs defaultValue="overview">
        <TabsList className="mb-5">
          <TabsTrigger value="overview">Spend Overview</TabsTrigger>
          <TabsTrigger value="costs">API Costs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab kpis={kpis} /></TabsContent>
        <TabsContent value="costs"><CostsTab /></TabsContent>
      </Tabs>
    </PageShell>
  );
}

function PageShell({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[1200px] px-7 py-6 font-sans">
      <h1 className="font-heading text-xl font-bold">Analytics</h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-1 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

function KpiCard({ label, value, full, color, hint }: { label: string; value: string; full?: string; color?: string; hint: string }) {
  return (
    <Card className="p-4" title={full ?? hint}>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">{label}</p>
      <p className={cn('text-xl font-bold mb-0.5', color ?? 'text-primary')}>{value}</p>
      {full && full !== value && <p className="text-[10px] text-faint font-mono">{full}</p>}
      <p className="text-[10px] text-faint leading-snug">{hint}</p>
    </Card>
  );
}

function OverviewTab({ kpis }: { kpis: AnalyticsKpis }) {
  const [spendView, setSpendView] = useState<SpendView>('workshops');

  const kpiCards = [
    { label: 'TOTAL SPEND', value: moneyCompact(kpis.totalSpend), full: moneyFull(kpis.totalSpend), hint: 'Sum of all invoice grand totals' },
    { label: 'PARTS', value: moneyCompact(kpis.totalParts), full: moneyFull(kpis.totalParts), color: 'text-foreground', hint: 'Sum of parts_amount' },
    { label: 'LABOUR', value: moneyCompact(kpis.totalLabour), full: moneyFull(kpis.totalLabour), color: 'text-foreground', hint: 'Sum of labour_amount' },
    { label: 'TAX PAID', value: moneyCompact(kpis.totalTax), full: moneyFull(kpis.totalTax), color: 'text-warning', hint: 'CGST + SGST + IGST' },
    { label: 'WORKSHOPS', value: countFmt(kpis.vendorCount), color: 'text-foreground', hint: 'Unique vendors' },
    { label: 'VEHICLES', value: countFmt(kpis.vehicleCount), color: 'text-foreground', hint: 'Unique reg numbers' },
    { label: 'COMPLETED', value: countFmt(kpis.completedCount), color: 'text-success', hint: 'OCR done' },
    { label: 'NEEDS REVIEW', value: countFmt(kpis.needsReview), color: kpis.needsReview > 0 ? 'text-danger' : 'text-success', hint: 'ocr_status = NEED_REVIEW' },
  ];

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5 mb-5">
        {kpiCards.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {([
          { key: 'workshops' as SpendView, label: `Workshops (${countFmt(kpis.vendorCount)})` },
          { key: 'vehicles' as SpendView, label: `Vehicles (${countFmt(kpis.vehicleCount)})` },
          { key: 'months' as SpendView, label: 'By month' },
          { key: 'costkm' as SpendView, label: 'Cost / km' },
        ]).map((c) => (
          <Button key={c.key} variant={spendView === c.key ? 'default' : 'outline'} size="sm" onClick={() => setSpendView(c.key)}>
            {c.label}
          </Button>
        ))}
      </div>

      {spendView === 'workshops' && <WorkshopsView totalSpend={kpis.totalSpend} />}
      {spendView === 'vehicles' && <VehiclesView />}
      {spendView === 'months' && <MonthsView />}
      {spendView === 'costkm' && <CostKmView />}
    </>
  );
}

function ShowMore({ shown, total, loading, onClick }: { shown: number; total: number; loading: boolean; onClick: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="mt-3 text-center">
      <Button variant="outline" onClick={onClick} disabled={loading}>{loading ? 'Loading…' : `Show more (${shown} of ${total})`}</Button>
    </div>
  );
}

function WorkshopsView({ totalSpend }: { totalSpend: number }) {
  const [rows, setRows] = useState<{ name: string; amount: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = useCallback(async (query: string, offset: number, append: boolean) => {
    const r = await api.analyticsWorkshops(query || undefined, PAGE_SIZE, offset);
    setTotal(r.total); setRows((prev) => (append ? [...prev, ...r.workshops] : r.workshops));
  }, []);

  useEffect(() => { setLoading(true); fetchPage('', 0, false).finally(() => setLoading(false)); }, [fetchPage]);
  const doSearch = useCallback((query: string) => { setLoading(true); fetchPage(query, 0, false).finally(() => setLoading(false)); }, [fetchPage]);
  const handleSearch = (v: string) => { setQ(v); clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => doSearch(v), 300); };
  const showMore = () => { setLoadingMore(true); fetchPage(q, rows.length, true).finally(() => setLoadingMore(false)); };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold mb-1">Workshops & vendors</h2>
      <p className="text-[11px] text-faint mb-3">Spend ranked by workshop</p>
      <Input value={q} onChange={(e) => handleSearch(e.target.value)} placeholder="Search workshops…" className="w-60 mb-3" />
      {loading && rows.length === 0 ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No workshop data</p> : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead className="w-9">#</TableHead><TableHead>Workshop / Vendor</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((v, i) => (
                <TableRow key={v.name}>
                  <TableCell className="text-faint">{i + 1}</TableCell>
                  <TableCell className="font-semibold"><span className="inline-block h-2 w-2 rounded-full bg-primary mr-2" />{v.name}</TableCell>
                  <TableCell className="text-right font-bold text-primary" title={moneyFull(v.amount)}>{moneyCompact(v.amount)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{totalSpend > 0 ? `${((v.amount / totalSpend) * 100).toFixed(1)}%` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ShowMore shown={rows.length} total={total} loading={loadingMore} onClick={showMore} />
        </>
      )}
    </Card>
  );
}

function VehiclesView() {
  const [data, setData] = useState<VehicleSpend[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = useCallback(async (query: string, offset: number, append: boolean) => {
    const r = await api.analyticsVehicles(query || undefined, PAGE_SIZE, offset);
    setTotal(r.total); setData((prev) => (append ? [...prev, ...r.vehicles] : r.vehicles));
  }, []);

  useEffect(() => { setLoading(true); fetchPage('', 0, false).finally(() => setLoading(false)); }, [fetchPage]);
  const doSearch = useCallback((query: string) => { setLoading(true); fetchPage(query, 0, false).finally(() => setLoading(false)); }, [fetchPage]);
  const handleSearch = (v: string) => { setQ(v); clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => doSearch(v), 300); };
  const showMore = () => { setLoadingMore(true); fetchPage(q, data.length, true).finally(() => setLoadingMore(false)); };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold mb-1">Vehicles</h2>
      <p className="text-[11px] text-faint mb-3">Per-vehicle parts / labour / tax / total</p>
      <Input value={q} onChange={(e) => handleSearch(e.target.value)} placeholder="Search by reg number…" className="w-60 mb-3" />
      {loading && data.length === 0 ? <p className="text-muted-foreground">Loading…</p> : data.length === 0 ? <p className="text-sm text-muted-foreground">No vehicle data</p> : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>Vehicle</TableHead><TableHead className="text-right">Bills</TableHead><TableHead className="text-right">Parts</TableHead><TableHead className="text-right">Labour</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.vehicle_id}>
                  <TableCell className="font-semibold font-mono text-xs">{r.registration_number ?? r.vehicle_id}</TableCell>
                  <TableCell className="text-right">{r.total_bills}</TableCell>
                  <TableCell className="text-right" title={moneyFull(r.parts_amount)}>{moneyCompact(r.parts_amount)}</TableCell>
                  <TableCell className="text-right" title={moneyFull(r.labour_amount)}>{moneyCompact(r.labour_amount)}</TableCell>
                  <TableCell className="text-right" title={moneyFull(r.total_tax)}>{moneyCompact(r.total_tax)}</TableCell>
                  <TableCell className="text-right font-bold text-primary" title={moneyFull(r.total_amount)}>{moneyCompact(r.total_amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ShowMore shown={data.length} total={total} loading={loadingMore} onClick={showMore} />
        </>
      )}
    </Card>
  );
}

function MonthsView() {
  const [data, setData] = useState<{ label: string; amount: number }[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.analyticsMonths().then((r) => r.months).then(setData).finally(() => setLoading(false)); }, []);

  if (loading) return <Card className="p-4"><p className="text-muted-foreground">Loading…</p></Card>;
  if (!data || data.length === 0) return <Card className="p-4"><p className="text-sm text-muted-foreground">No monthly data</p></Card>;
  const total = data.reduce((s, m) => s + m.amount, 0);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold mb-1">Spend by month</h2>
      <p className="text-[11px] text-faint mb-3">Grouped by invoice date</p>
      <Table>
        <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.map((m) => (
            <TableRow key={m.label}>
              <TableCell className="font-semibold">{m.label}</TableCell>
              <TableCell className="text-right font-bold text-primary" title={moneyFull(m.amount)}>{moneyCompact(m.amount)}</TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">{total > 0 ? `${((m.amount / total) * 100).toFixed(1)}%` : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function CostKmView() {
  const [data, setData] = useState<CostPerKm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = useCallback(async (query: string, offset: number, append: boolean) => {
    const r = await api.analyticsCostkm(query || undefined, PAGE_SIZE, offset);
    setTotal(r.total); setData((prev) => (append ? [...prev, ...r.costPerKm] : r.costPerKm));
  }, []);

  useEffect(() => { setLoading(true); fetchPage('', 0, false).finally(() => setLoading(false)); }, [fetchPage]);
  const doSearch = useCallback((query: string) => { setLoading(true); fetchPage(query, 0, false).finally(() => setLoading(false)); }, [fetchPage]);
  const handleSearch = (v: string) => { setQ(v); clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => doSearch(v), 300); };
  const showMore = () => { setLoadingMore(true); fetchPage(q, data.length, true).finally(() => setLoadingMore(false)); };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold mb-1">Cost per km</h2>
      <p className="text-[11px] text-faint mb-3">Needs 2+ odometer readings per vehicle</p>
      <Input value={q} onChange={(e) => handleSearch(e.target.value)} placeholder="Search vehicle / reg no…" className="w-60 mb-3" />
      <Card className="bg-info-soft border-info/20 p-3 mb-3 text-xs">
        <p className="font-semibold mb-1">How is this calculated?</p>
        <p className="font-mono text-primary text-sm">Cost/km = Total Spend / Km Range</p>
        <p className="text-muted-foreground mt-1"><b>Total Spend</b> = Sum of grand totals · <b>Km Range</b> = Max − Min odometer</p>
      </Card>
      {loading && data.length === 0 ? <p className="text-muted-foreground">Loading…</p> : data.length === 0 ? <p className="text-sm text-muted-foreground">Need 2+ invoices with odometer for the same vehicle</p> : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>Vehicle</TableHead><TableHead className="text-right">₹/km</TableHead><TableHead className="text-right">Total spend</TableHead><TableHead className="text-right">Km range</TableHead><TableHead className="text-right">Formula</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.vehicle_id}>
                  <TableCell className="font-semibold font-mono text-xs">{r.registration_number ?? r.vehicle_id}</TableCell>
                  <TableCell className={cn('text-right font-bold', r.cost_per_km != null ? 'text-primary' : 'text-muted-foreground')}>{r.cost_per_km != null ? `₹${r.cost_per_km}` : '—'}</TableCell>
                  <TableCell className="text-right" title={moneyFull(r.total_spend)}>{moneyCompact(r.total_spend)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.km_range != null ? `${countFmt(r.km_range)} km` : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] text-muted-foreground">{r.cost_per_km != null && r.km_range != null ? `${moneyCompact(r.total_spend)} ÷ ${countFmt(r.km_range)}` : 'insufficient data'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ShowMore shown={data.length} total={total} loading={loadingMore} onClick={showMore} />
        </>
      )}
    </Card>
  );
}

function CostsTab() {
  const [costs, setCosts] = useState<OcrCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.analyticsCosts().then(setCosts).finally(() => setLoading(false)); }, []);

  const rupees = (v: number | undefined, usdFallback: number) => `₹${(v ?? usdFallback * usdToInrRate()).toFixed(2)}`;
  const inr = (usd: number) => `₹${(usd * usdToInrRate()).toFixed(2)}`;
  const usd = (v: number) => `$${v.toFixed(4)}`;

  if (loading) return <p className="text-muted-foreground py-2">Loading costs…</p>;
  if (!costs || costs.total_ocr_count === 0) return <p className="text-sm text-muted-foreground">No OCR cost data yet — extract some invoices first.</p>;

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
        {[
          { label: 'TOTAL OCR RUNS', value: countFmt(costs.total_ocr_count), sub: '' },
          { label: 'TOTAL COST', value: rupees(costs.total_cost_inr, costs.total_cost_usd), sub: usd(costs.total_cost_usd) },
          { label: 'EXTRACTION', value: inr(costs.total_extraction_cost_usd), sub: `${costs.total_extraction_tokens.toLocaleString()} tokens` },
          { label: 'STRUCTURING', value: inr(costs.total_structuring_cost_usd), sub: `${costs.total_structuring_tokens.toLocaleString()} tokens` },
          { label: 'AVG / OCR', value: rupees(costs.avg_cost_per_ocr_inr, costs.avg_cost_per_ocr_usd), sub: `${costs.avg_tokens_per_ocr.toLocaleString()} tokens` },
          { label: 'TOTAL TOKENS', value: costs.total_tokens.toLocaleString(), sub: 'Input + Output' },
        ].map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">{c.label}</p>
            <p className="text-xl font-bold text-primary mb-0.5">{c.value}</p>
            {c.sub && <p className="text-[11px] text-faint">{c.sub}</p>}
          </Card>
        ))}
      </div>

      {costs.by_provider.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Cost by Provider</h2>
          <Table>
            <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead className="text-right">Cost (INR)</TableHead><TableHead className="text-right">Cost (USD)</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Avg/Call</TableHead></TableRow></TableHeader>
            <TableBody>
              {costs.by_provider.map((p) => (
                <TableRow key={p.provider}>
                  <TableCell className="font-semibold"><span className={cn('inline-block h-2 w-2 rounded-full mr-2', p.provider === 'gemini' ? 'bg-blue-500' : p.provider === 'mistral' ? 'bg-orange-500' : p.provider === 'claude' ? 'bg-purple-500' : 'bg-green-500')} />{p.provider}</TableCell>
                  <TableCell className="text-right font-semibold">{rupees(costs.by_provider_inr?.[p.provider], p.cost_usd)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{usd(p.cost_usd)}</TableCell>
                  <TableCell className="text-right">{p.tokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{p.count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{usd(p.count > 0 ? p.cost_usd / p.count : 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
