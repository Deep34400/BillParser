import { useEffect, useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, Label,
  BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  ComposedChart, Area, AreaChart,
} from 'recharts';
import type { AnalyticsKpis, VehicleSpend, CostPerKm } from '../types/index.js';
import { api } from '../api/client.js';
import { moneyCompact, moneyFull, countFmt, usdToInrRate } from '../lib/format.js';
import { ErrorState } from '../components/ErrorState.js';
import { FeatureHint } from '../components/FeatureHint.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Card } from '@/components/ui/card.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.js';
import { Skeleton } from '@/components/ui/skeleton.js';
import { EmptyState } from '@/components/ui/empty-state.js';

const COLORS = ['#5b8fb9', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: COLORS[2],
  FAILED: COLORS[3],
  PROCESSING: COLORS[1],
  NEED_REVIEW: COLORS[5],
};

const CHART_TICK = { fontSize: 11, fill: 'var(--color-muted-foreground)' };
const CHART_GRID = 'var(--color-border)';

type SpendView = 'workshops' | 'vehicles' | 'months' | 'costkm';
const PAGE_SIZE = 20;
const TOP_N = 10;

function formatMonthLabel(label: string): string {
  const [y, m] = label.split('-');
  if (!y || !m) return label;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function truncateLabel(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function currencyTooltip(value: unknown): [string, string] {
  return [moneyFull(Number(value ?? 0)), 'Amount'];
}

function countTooltip(value: unknown, name?: string): [string, string] {
  return [countFmt(Number(value ?? 0)), name ?? 'Count'];
}

export function AnalyticsPage() {
  const { data: kpis, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics', 'kpis'],
    queryFn: () => api.analyticsKpis(),
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-7 w-16 mb-1" />
              <Skeleton className="h-3 w-28" />
            </Card>
          ))}
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <ErrorState
          title="Failed to load analytics"
          message={error instanceof Error ? error.message : 'Failed to load analytics'}
          onRetry={() => void refetch()}
        />
      </PageShell>
    );
  }

  if (!kpis || kpis.completedCount === 0) {
    return (
      <PageShell>
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" />}
          title="No analytics yet"
          description="Analytics will appear after you process your first invoice."
          action={<Button asChild><Link to="/invoices">Go to Invoices</Link></Button>}
        />
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
      <h1 className="font-heading text-xl font-bold text-foreground" data-tour="analytics-kpis">Analytics</h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-1 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

function KpiCard({
  label, value, full, color, hint, sparkline,
}: {
  label: string;
  value: string;
  full?: string;
  color?: string;
  hint: string;
  sparkline?: { label: string; value: number }[];
}) {
  return (
    <Card className="p-4" title={full ?? hint}>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider mb-1">{label}</p>
      <p className={cn('text-xl font-bold mb-0.5', color ?? 'text-primary')}>{value}</p>
      {full && full !== value && <p className="text-[10px] text-faint font-mono">{full}</p>}
      {sparkline && sparkline.length > 1 && (
        <div className="h-8 mt-1.5 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area type="monotone" dataKey="value" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[10px] text-faint leading-snug mt-1">{hint}</p>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">{label}</p>
      <p className="text-sm font-bold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-foreground mb-0.5">{title}</h3>
      {subtitle && <p className="text-[11px] text-muted-foreground mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </Card>
  );
}

function ChartNoData({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function OverviewTab({ kpis }: { kpis: AnalyticsKpis }) {
  const [spendView, setSpendView] = useState<SpendView>('workshops');

  const { data: monthsData = [] } = useQuery({
    queryKey: ['analytics', 'months', 'sparkline'],
    queryFn: () => api.analyticsMonths(24, 0),
    select: (r) => r.months,
  });

  const spendSparkline = useMemo(
    () => monthsData.slice(-12).map((m) => ({ label: m.label, value: m.amount })),
    [monthsData],
  );

  const invoiceSparkline = useMemo(
    () => monthsData.slice(-12).map((m) => ({ label: m.label, value: m.count ?? 0 })),
    [monthsData],
  );

  const totalProcessed = kpis.totalInvoiceCount ?? kpis.completedCount + kpis.needsReview;
  const avgInvoiceValue = kpis.completedCount > 0 ? kpis.totalSpend / kpis.completedCount : 0;

  const kpiCards = [
    { label: 'TOTAL SPEND', value: moneyCompact(kpis.totalSpend), full: moneyFull(kpis.totalSpend), hint: 'Sum of all invoice grand totals', sparkline: spendSparkline },
    { label: 'PARTS', value: moneyCompact(kpis.totalParts), full: moneyFull(kpis.totalParts), color: 'text-foreground', hint: 'Sum of parts_amount' },
    { label: 'LABOUR', value: moneyCompact(kpis.totalLabour), full: moneyFull(kpis.totalLabour), color: 'text-foreground', hint: 'Sum of labour_amount' },
    { label: 'TAX PAID', value: moneyCompact(kpis.totalTax), full: moneyFull(kpis.totalTax), color: 'text-warning', hint: 'CGST + SGST + IGST' },
    { label: 'INVOICES PROCESSED', value: countFmt(totalProcessed), color: 'text-foreground', hint: 'All invoices in the system', sparkline: invoiceSparkline.length > 1 ? invoiceSparkline : undefined },
    { label: 'AVG PROCESSING', value: formatDuration(kpis.avgProcessingTimeMs), color: 'text-foreground', hint: 'Mean OCR pipeline latency' },
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

      <FeatureHint
        id="analytics-tabs"
        message="Tip: Use the tabs below to see breakdowns by workshop, vehicle, or vendor."
      />

      <AnalyticsCharts kpis={kpis} />

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

      {spendView === 'workshops' && <WorkshopsView totalSpend={kpis.totalSpend} vendorCount={kpis.vendorCount} avgInvoiceValue={avgInvoiceValue} />}
      {spendView === 'vehicles' && <VehiclesView totalSpend={kpis.totalSpend} vehicleCount={kpis.vehicleCount} />}
      {spendView === 'months' && <MonthsView />}
      {spendView === 'costkm' && <CostKmView />}
    </>
  );
}

function AnalyticsCharts({ kpis }: { kpis: AnalyticsKpis }) {
  const { data: statusData = [] } = useQuery({
    queryKey: ['invoices', 'counts'],
    queryFn: () => api.counts(),
    select: (res) => {
      const c = res.counts;
      return [
        { name: 'COMPLETED', value: (c['OCR_COMPLETED'] ?? 0) + (c['VERIFIED'] ?? 0) },
        { name: 'FAILED', value: c['FAILED'] ?? 0 },
        { name: 'PROCESSING', value: c['PROCESSING'] ?? 0 },
        { name: 'NEED_REVIEW', value: c['NEED_REVIEW'] ?? 0 },
      ].filter((r) => r.value > 0);
    },
  });

  const spendBreakdown = useMemo(() => {
    const parts = kpis.totalParts;
    const labour = kpis.totalLabour;
    if (parts <= 0 && labour <= 0) return [];
    return [
      { name: 'Parts', value: parts },
      { name: 'Labour', value: labour },
    ];
  }, [kpis.totalParts, kpis.totalLabour]);

  const statusTotal = statusData.reduce((s, d) => s + d.value, 0);

  if (statusData.length === 0 && spendBreakdown.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
      {statusData.length > 0 && (
        <ChartCard title="Invoice status" subtitle="OCR pipeline distribution">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="45%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
              >
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? COLORS[0]} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !('cx' in viewBox) || viewBox.cx == null || viewBox.cy == null) return null;
                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan x={viewBox.cx} y={viewBox.cy - 4} className="fill-foreground text-xl font-bold">{countFmt(statusTotal)}</tspan>
                        <tspan x={viewBox.cx} y={viewBox.cy + 14} className="fill-muted-foreground text-[11px]">total</tspan>
                      </text>
                    );
                  }}
                />
              </Pie>
              <Tooltip formatter={(value, name) => countTooltip(value, String(name ?? '').replace('_', ' '))} />
              <Legend
                verticalAlign="bottom"
                formatter={(value: string) => value.replace('_', ' ')}
                wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {spendBreakdown.length > 0 && (
        <ChartCard title="Parts vs labour" subtitle="Spend breakdown from completed invoices">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={spendBreakdown} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="name" tick={CHART_TICK} />
              <YAxis tick={CHART_TICK} tickFormatter={(v) => moneyCompact(v)} width={56} />
              <Tooltip formatter={currencyTooltip} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
              <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]}>
                {spendBreakdown.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
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

function WorkshopsView({
  totalSpend, vendorCount, avgInvoiceValue,
}: {
  totalSpend: number;
  vendorCount: number;
  avgInvoiceValue: number;
}) {
  const [rows, setRows] = useState<{ name: string; amount: number; parts_amount?: number; labour_amount?: number }[]>([]);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['analytics', 'workshops', debouncedQ, page],
    queryFn: () => api.analyticsWorkshops(debouncedQ || undefined, PAGE_SIZE, page * PAGE_SIZE),
  });

  const { data: topWorkshops, isLoading: topLoading, error: topError, refetch: refetchTop } = useQuery({
    queryKey: ['analytics', 'workshops', 'top10'],
    queryFn: () => api.analyticsWorkshops(undefined, TOP_N, 0),
    select: (r) => r.workshops,
  });

  useEffect(() => {
    if (!data) return;
    setRows((prev) => (page === 0 ? data.workshops : [...prev, ...data.workshops]));
  }, [data, page]);

  const handleSearch = (v: string) => {
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedQ(v); setPage(0); setRows([]); }, 300);
  };
  const showMore = () => setPage((p) => p + 1);
  const total = data?.total ?? 0;
  const loading = isLoading && rows.length === 0;
  const loadingMore = isFetching && page > 0;

  const topBarData = useMemo(
    () => (topWorkshops ?? []).map((w) => ({
      name: truncateLabel(w.name),
      fullName: w.name,
      amount: w.amount,
    })),
    [topWorkshops],
  );

  const stackedData = useMemo(
    () => (topWorkshops ?? []).map((w) => ({
      name: truncateLabel(w.name, 16),
      fullName: w.name,
      parts_amount: w.parts_amount ?? 0,
      labour_amount: w.labour_amount ?? 0,
    })),
    [topWorkshops],
  );

  const hasStackedData = stackedData.some((w) => w.parts_amount > 0 || w.labour_amount > 0);

  if (error) {
    return (
      <ErrorState
        title="Failed to load workshop data"
        message={error instanceof Error ? error.message : 'Failed to load workshop data'}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-lg">
        <MiniStat label="Workshops" value={countFmt(vendorCount)} />
        <MiniStat label="Avg invoice value" value={moneyCompact(avgInvoiceValue)} />
        <MiniStat label="Total spend" value={moneyCompact(totalSpend)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top workshops by spend" subtitle="Top 10 ranked by total spend">
          {topLoading ? (
            <ChartNoData message="Loading…" />
          ) : topError ? (
            <ErrorState
              title="Chart unavailable"
              message={topError instanceof Error ? topError.message : 'Failed to load chart'}
              onRetry={() => void refetchTop()}
              className="py-8"
            />
          ) : topBarData.length === 0 ? (
            <ChartNoData message="No workshop data" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart layout="vertical" data={topBarData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                <XAxis type="number" tick={CHART_TICK} tickFormatter={(v) => moneyCompact(v)} />
                <YAxis type="category" dataKey="name" tick={CHART_TICK} width={100} />
                <Tooltip
                  formatter={currencyTooltip}
                  labelFormatter={(_, payload) => {
                    const item = payload?.[0]?.payload as { fullName?: string } | undefined;
                    return item?.fullName ?? '';
                  }}
                />
                <Bar dataKey="amount" name="Spend" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Parts vs labour by workshop" subtitle="Compare labour-heavy vs parts-heavy workshops">
          {topLoading ? (
            <ChartNoData message="Loading…" />
          ) : !hasStackedData ? (
            <ChartNoData message="No parts/labour split data" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={stackedData} margin={{ top: 4, right: 8, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="name" tick={CHART_TICK} angle={-35} textAnchor="end" height={60} interval={0} />
                <YAxis tick={CHART_TICK} tickFormatter={(v) => moneyCompact(v)} width={56} />
                <Tooltip
                  formatter={currencyTooltip}
                  labelFormatter={(_, payload) => {
                    const item = payload?.[0]?.payload as { fullName?: string } | undefined;
                    return item?.fullName ?? '';
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
                <Bar dataKey="parts_amount" name="Parts" stackId="a" fill={COLORS[0]} />
                <Bar dataKey="labour_amount" name="Labour" stackId="a" fill={COLORS[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1">Workshops & vendors</h3>
        <p className="text-[11px] text-muted-foreground mb-3">Full spend table with search</p>
        <Input value={q} onChange={(e) => handleSearch(e.target.value)} placeholder="Search workshops…" className="w-60 mb-3" />
        {loading && rows.length === 0 ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? <ChartNoData message="No workshop data" /> : (
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
    </div>
  );
}

function VehiclesView({ totalSpend, vehicleCount }: { totalSpend: number; vehicleCount: number }) {
  const [rows, setRows] = useState<VehicleSpend[]>([]);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['analytics', 'vehicles', debouncedQ, page],
    queryFn: () => api.analyticsVehicles(debouncedQ || undefined, PAGE_SIZE, page * PAGE_SIZE),
  });

  const { data: topVehicles, isLoading: topLoading, error: topError, refetch: refetchTop } = useQuery({
    queryKey: ['analytics', 'vehicles', 'top10'],
    queryFn: () => api.analyticsVehicles(undefined, TOP_N, 0),
    select: (r) => r.vehicles,
  });

  const topVehicle = topVehicles?.[0];
  const trendVehicleId = selectedVehicle ?? topVehicle?.vehicle_id ?? null;
  const trendVehicleLabel = useMemo(() => {
    const v = topVehicles?.find((x) => x.vehicle_id === trendVehicleId) ?? topVehicle;
    return v?.registration_number ?? v?.vehicle_id ?? '';
  }, [topVehicles, topVehicle, trendVehicleId]);

  const { data: vehicleInvoices, isLoading: trendLoading } = useQuery({
    queryKey: ['analytics', 'vehicle-trend', trendVehicleLabel],
    queryFn: () => api.list({ q: trendVehicleLabel, pageSize: 200, completed: 'true' }),
    enabled: !!trendVehicleLabel,
  });

  const vehicleTrend = useMemo(() => {
    if (!vehicleInvoices?.invoices) return [];
    const byMonth = new Map<string, number>();
    for (const inv of vehicleInvoices.invoices) {
      const date = inv.invoiceDate ?? inv.parsedData?.invoice_date;
      if (!date) continue;
      const mk = date.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(mk)) continue;
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + (inv.totalAmount ?? inv.parsedData?.totals_and_tax_summary?.grand_total_invoice ?? 0));
    }
    return Array.from(byMonth.entries())
      .map(([label, amount]) => ({ label, display: formatMonthLabel(label), amount }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [vehicleInvoices]);

  useEffect(() => {
    if (!data) return;
    setRows((prev) => (page === 0 ? data.vehicles : [...prev, ...data.vehicles]));
  }, [data, page]);

  const handleSearch = (v: string) => {
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedQ(v); setPage(0); setRows([]); }, 300);
  };
  const showMore = () => setPage((p) => p + 1);
  const total = data?.total ?? 0;
  const loading = isLoading && rows.length === 0;
  const loadingMore = isFetching && page > 0;

  const topBarData = useMemo(
    () => (topVehicles ?? []).map((v) => ({
      name: truncateLabel(v.registration_number ?? v.vehicle_id, 14),
      fullName: v.registration_number ?? v.vehicle_id,
      amount: v.total_amount,
      vehicle_id: v.vehicle_id,
    })),
    [topVehicles],
  );

  const avgCostPerVehicle = vehicleCount > 0 ? totalSpend / vehicleCount : 0;

  if (error) {
    return (
      <ErrorState
        title="Failed to load vehicle data"
        message={error instanceof Error ? error.message : 'Failed to load vehicle data'}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-lg">
        <MiniStat label="Vehicles" value={countFmt(vehicleCount)} />
        <MiniStat label="Avg cost / vehicle" value={moneyCompact(avgCostPerVehicle)} />
        <MiniStat label="Total spend" value={moneyCompact(totalSpend)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top vehicles by maintenance spend" subtitle="Top 10 by total invoice amount">
          {topLoading ? (
            <ChartNoData message="Loading…" />
          ) : topError ? (
            <ErrorState
              title="Chart unavailable"
              message={topError instanceof Error ? topError.message : 'Failed to load chart'}
              onRetry={() => void refetchTop()}
              className="py-8"
            />
          ) : topBarData.length === 0 ? (
            <ChartNoData message="No vehicle data" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={topBarData} margin={{ top: 4, right: 8, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="name" tick={CHART_TICK} angle={-35} textAnchor="end" height={60} interval={0} />
                <YAxis tick={CHART_TICK} tickFormatter={(v) => moneyCompact(v)} width={56} />
                <Tooltip
                  formatter={currencyTooltip}
                  labelFormatter={(_, payload) => {
                    const item = payload?.[0]?.payload as { fullName?: string } | undefined;
                    return item?.fullName ?? '';
                  }}
                />
                <Bar
                  dataKey="amount"
                  name="Spend"
                  radius={[4, 4, 0, 0]}
                  onClick={(data) => {
                    const item = data as { vehicle_id?: string };
                    if (item.vehicle_id) setSelectedVehicle(item.vehicle_id);
                  }}
                  cursor="pointer"
                >
                  {topBarData.map((entry, i) => (
                    <Cell
                      key={entry.fullName}
                      fill={entry.vehicle_id === trendVehicleId ? COLORS[3] : COLORS[i % COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Maintenance cost trend"
          subtitle={trendVehicleLabel ? `Monthly spend for ${trendVehicleLabel}` : 'Select a vehicle from the bar chart'}
        >
          {trendLoading ? (
            <ChartNoData message="Loading…" />
          ) : vehicleTrend.length === 0 ? (
            <ChartNoData message="No monthly trend data for this vehicle" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={vehicleTrend} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="display" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} tickFormatter={(v) => moneyCompact(v)} width={56} />
                <Tooltip formatter={currencyTooltip} labelFormatter={(label) => String(label)} />
                <Area type="monotone" dataKey="amount" name="Spend" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.2} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1">Vehicles</h3>
        <p className="text-[11px] text-muted-foreground mb-3">Per-vehicle parts / labour / tax / total</p>
        <Input value={q} onChange={(e) => handleSearch(e.target.value)} placeholder="Search by reg number…" className="w-60 mb-3" />
        {loading && rows.length === 0 ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? <ChartNoData message="No vehicle data" /> : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Vehicle</TableHead><TableHead className="text-right">Bills</TableHead><TableHead className="text-right">Parts</TableHead><TableHead className="text-right">Labour</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.vehicle_id} className={cn(r.vehicle_id === trendVehicleId && 'bg-muted/50')}>
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
            <ShowMore shown={rows.length} total={total} loading={loadingMore} onClick={showMore} />
          </>
        )}
      </Card>
    </div>
  );
}

function MonthsView() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics', 'months'],
    queryFn: () => api.analyticsMonths(50, 0),
    select: (r) => r.months,
  });

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map((m) => ({
      ...m,
      display: formatMonthLabel(m.label),
      count: m.count ?? 0,
    }));
  }, [data]);

  const years = useMemo(() => [...new Set((data ?? []).map((m) => m.label.slice(0, 4)))].sort(), [data]);
  const hasYoY = years.length >= 2;

  const yoyData = useMemo(() => {
    if (!hasYoY || !data) return [];
    const currentYear = years[years.length - 1];
    const prevYear = years[years.length - 2];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthNames.map((month, idx) => {
      const mm = String(idx + 1).padStart(2, '0');
      const curKey = `${currentYear}-${mm}`;
      const prevKey = `${prevYear}-${mm}`;
      const cur = data.find((m) => m.label === curKey);
      const prev = data.find((m) => m.label === prevKey);
      return {
        month,
        current: cur?.amount ?? 0,
        previous: prev?.amount ?? 0,
      };
    }).filter((d) => d.current > 0 || d.previous > 0);
  }, [data, hasYoY, years]);

  if (error) {
    return (
      <ErrorState
        title="Failed to load monthly data"
        message={error instanceof Error ? error.message : 'Failed to load monthly data'}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isLoading) return <Card className="p-4"><p className="text-muted-foreground">Loading…</p></Card>;
  if (!data || data.length === 0) return <ChartCard title="Spend by month"><ChartNoData message="No monthly data" /></ChartCard>;

  const total = data.reduce((s, m) => s + m.amount, 0);

  return (
    <div className="space-y-4">
      <ChartCard title="Monthly spend & invoice volume" subtitle="Spend (bars) vs invoice count (line)">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 48, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="display" tick={CHART_TICK} />
            <YAxis yAxisId="left" tick={CHART_TICK} tickFormatter={(v) => moneyCompact(v)} width={56} />
            <YAxis yAxisId="right" orientation="right" tick={CHART_TICK} width={40} />
            <Tooltip
              formatter={(value, name) => {
                if (name === 'Invoices') return countTooltip(value, 'Invoices');
                return currencyTooltip(value);
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
            <Bar yAxisId="left" dataKey="amount" name="Spend" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="count" name="Invoices" stroke={COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {hasYoY && yoyData.length > 0 && (
        <ChartCard title="Year-over-year comparison" subtitle={`${years[years.length - 2]} vs ${years[years.length - 1]} spend by month`}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={yoyData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="month" tick={CHART_TICK} />
              <YAxis tick={CHART_TICK} tickFormatter={(v) => moneyCompact(v)} width={56} />
              <Tooltip formatter={currencyTooltip} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
              <Bar dataKey="previous" name={years[years.length - 2]} fill={COLORS[4]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="current" name={years[years.length - 1]} fill={COLORS[0]} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1">Spend by month</h3>
        <p className="text-[11px] text-muted-foreground mb-3">Grouped by invoice date</p>
        <Table>
          <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((m) => (
              <TableRow key={m.label}>
                <TableCell className="font-semibold">{formatMonthLabel(m.label)}</TableCell>
                <TableCell className="text-right">{countFmt(m.count ?? 0)}</TableCell>
                <TableCell className="text-right font-bold text-primary" title={moneyFull(m.amount)}>{moneyCompact(m.amount)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{total > 0 ? `${((m.amount / total) * 100).toFixed(1)}%` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CostKmView() {
  const [rows, setRows] = useState<CostPerKm[]>([]);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['analytics', 'costkm', debouncedQ, page],
    queryFn: () => api.analyticsCostkm(debouncedQ || undefined, PAGE_SIZE, page * PAGE_SIZE),
  });

  useEffect(() => {
    if (!data) return;
    setRows((prev) => (page === 0 ? data.costPerKm : [...prev, ...data.costPerKm]));
  }, [data, page]);

  const handleSearch = (v: string) => {
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedQ(v); setPage(0); setRows([]); }, 300);
  };
  const showMore = () => setPage((p) => p + 1);
  const total = data?.total ?? 0;
  const loading = isLoading && rows.length === 0;
  const loadingMore = isFetching && page > 0;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-1">Cost per km</h3>
      <p className="text-[11px] text-muted-foreground mb-3">Needs 2+ odometer readings per vehicle</p>
      <Input value={q} onChange={(e) => handleSearch(e.target.value)} placeholder="Search vehicle / reg no…" className="w-60 mb-3" />
      <Card className="bg-info-soft border-info/20 p-3 mb-3 text-xs">
        <p className="font-semibold mb-1">How is this calculated?</p>
        <p className="font-mono text-primary text-sm">Cost/km = Total Spend / Km Range</p>
        <p className="text-muted-foreground mt-1"><b>Total Spend</b> = Sum of grand totals · <b>Km Range</b> = Max − Min odometer</p>
      </Card>
      {loading && rows.length === 0 ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? <ChartNoData message="Need 2+ invoices with odometer for the same vehicle" /> : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>Vehicle</TableHead><TableHead className="text-right">₹/km</TableHead><TableHead className="text-right">Total spend</TableHead><TableHead className="text-right">Km range</TableHead><TableHead className="text-right">Formula</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
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
          <ShowMore shown={rows.length} total={total} loading={loadingMore} onClick={showMore} />
        </>
      )}
    </Card>
  );
}

function CostsTab() {
  const { data: costs, isLoading } = useQuery({
    queryKey: ['analytics', 'costs'],
    queryFn: () => api.analyticsCosts(),
  });

  const rupees = (v: number | undefined, usdFallback: number) => `₹${(v ?? usdFallback * usdToInrRate()).toFixed(2)}`;
  const inr = (usd: number) => `₹${(usd * usdToInrRate()).toFixed(2)}`;
  const usd = (v: number) => `$${v.toFixed(4)}`;

  if (isLoading) return <p className="text-muted-foreground py-2">Loading costs…</p>;
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
          <h3 className="text-sm font-semibold mb-3">Cost by Provider</h3>
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
