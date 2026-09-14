import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type CompareMismatch, type CompareResult, type CompareFieldDiff, type CompareLineDiff } from '../api/client.js';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Textarea } from '@/components/ui/textarea.js';
import { Badge } from '@/components/ui/badge.js';
import { Label } from '@/components/ui/label.js';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select.js';
import { cn } from '@/lib/utils.js';

type Tab = 'ids' | 'json' | 'files';

const COMPARE_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-flash-latest', 'gemini-2.5-flash-lite'] },
  { id: 'openai', label: 'OpenAI GPT', models: ['gpt-4o-mini', 'gpt-4o'] },
  { id: 'mistral', label: 'Mistral', models: ['mistral-small-latest', 'mistral-medium-latest'] },
] as const;

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

function statusClass(status: string) {
  if (status === 'match') return 'text-emerald-700 dark:text-emerald-300';
  if (status === 'same_item') return 'text-amber-700 dark:text-amber-300';
  return 'text-red-700 dark:text-red-300';
}

function mismatchKind(kind: CompareMismatch['kind']) {
  if (kind === 'total' || kind === 'changed') return 'warning';
  if (kind === 'rejected_ai') return 'muted';
  return 'destructive';
}

function FieldRow({ row }: { row: CompareFieldDiff }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 text-sm border-b border-border/60">
      <div className="truncate">{String(row.a ?? '—')}</div>
      <div className={cn('text-center text-xs font-medium', statusClass(row.status))}>
        {row.status === 'match' ? 'match' : row.delta != null ? `Δ ${money(row.delta)}` : row.status.replace(/_/g, ' ')}
      </div>
      <div className="truncate text-right">{String(row.b ?? '—')}</div>
    </div>
  );
}

function LineRow({ row }: { row: CompareLineDiff }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 text-sm border-b border-border/60">
      <div className="truncate">{row.a ?? '—'}</div>
      <div className={cn('text-center text-xs font-medium', statusClass(row.status))}>
        {row.status.replace(/_/g, ' ')}
        {row.how === 'ai' ? ' · AI' : row.how === 'fuzzy' ? ' · fuzzy' : ''}
      </div>
      <div className="truncate text-right">{row.b ?? '—'}</div>
    </div>
  );
}

export default function ComparePage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('id1') ? 'ids' : 'json');
  const [id1, setId1] = useState(params.get('id1') ?? '');
  const [id2, setId2] = useState(params.get('id2') ?? '');
  const [leftJson, setLeftJson] = useState('');
  const [rightJson, setRightJson] = useState('');
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [ai, setAi] = useState(true);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingIds, setPendingIds] = useState<{ a: string; b: string } | null>(null);
  const [overrideProvider, setOverrideProvider] = useState('');
  const [overrideModel, setOverrideModel] = useState('');

  const { data: listData } = useQuery({
    queryKey: ['invoices', 'compare-pick'],
    queryFn: () => api.list({ pageSize: 50, completed: '1' }),
  });
  const { data: cfg } = useQuery({
    queryKey: ['config', 'compare-model'],
    queryFn: () => api.config(),
  });
  const invoices = listData?.invoices ?? [];
  const settingsProvider = cfg?.compareProvider || 'gemini';
  const settingsModel = cfg?.compareModel || 'gemini-2.5-flash';
  const activeProvider = overrideProvider || settingsProvider;
  const activeModels = COMPARE_PROVIDERS.find((p) => p.id === activeProvider)?.models ?? [settingsModel];
  const activeModel = overrideModel || (activeModels.includes(settingsModel) ? settingsModel : activeModels[0]);

  function modelBody() {
    if (!ai) return {};
    if (!overrideProvider && !overrideModel) return {};
    return { compareProvider: activeProvider, compareModel: activeModel };
  }

  useEffect(() => {
    if (params.get('id1')) setId1(params.get('id1') ?? '');
    if (params.get('id2')) setId2(params.get('id2') ?? '');
  }, [params]);

  async function runIds(a = id1, b = id2) {
    setBusy(true);
    setError('');
    try {
      const res = await api.compareInvoices({ id1: a, id2: b, ai, ...modelBody() });
      setResult(res.data);
      setPendingIds(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compare failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!pendingIds) return;
    const t = setInterval(async () => {
      try {
        const [a, b] = await Promise.all([api.get(pendingIds.a), api.get(pendingIds.b)]);
        const ready = ![a.status, b.status].some((s) => s === 'PROCESSING' || s === 'PENDING');
        if (ready) {
          clearInterval(t);
          void runIds(pendingIds.a, pendingIds.b);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [pendingIds]);

  async function onCompare() {
    setResult(null);
    setError('');
    setBusy(true);
    try {
      if (tab === 'ids') {
        await runIds();
        return;
      }
      if (tab === 'json') {
        const left = JSON.parse(leftJson);
        const right = JSON.parse(rightJson);
        const res = await api.compareInvoices({ mode: 'json', left, right, ai, ...modelBody() });
        setResult(res.data);
        return;
      }
      if (!fileA || !fileB) throw new Error('Choose two PDF or image files');
      const res = await api.compareFiles(fileA, fileB, ai);
      const data = res.data as CompareResult & { status?: string; invoiceA?: { id: string | null }; invoiceB?: { id: string | null } };
      if (data.status === 'processing' && data.invoiceA?.id && data.invoiceB?.id) {
        setPendingIds({ a: data.invoiceA.id, b: data.invoiceB.id });
        setError('OCR is running on both files. Compare starts when they finish.');
      } else if ('header' in data) {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compare failed');
    } finally {
      setBusy(false);
    }
  }

  const options = useMemo(
    () => invoices.map((inv) => ({
      id: inv.id,
      label: `${inv.invoiceNumber || inv.fileName} · ${inv.vendorName ?? '—'}`,
    })),
    [invoices],
  );

  const mismatches = result?.mismatches ?? [];
  const usedModel = result?.model;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Compare invoices</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Rules compare totals and names first. AI only pairs leftovers like “brake pad” vs “pads”, then a second prompt writes the note. Validation drops weak pairs — review the mismatch list.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide">Compare model</Label>
            <Select
              value={overrideProvider || 'settings'}
              onValueChange={(v) => {
                if (v === 'settings') {
                  setOverrideProvider('');
                  setOverrideModel('');
                  return;
                }
                setOverrideProvider(v);
                const first = COMPARE_PROVIDERS.find((p) => p.id === v)?.models[0] ?? '';
                setOverrideModel(first);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="settings">Settings default ({settingsProvider})</SelectItem>
                {COMPARE_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide">Model</Label>
            <Select
              value={activeModel}
              onValueChange={(v) => {
                setOverrideProvider(activeProvider);
                setOverrideModel(v);
              }}
              disabled={!ai}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {activeModels.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-end gap-2 text-sm text-muted-foreground pb-1">
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
            AI leftover match + summary
          </label>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {([
          ['ids', 'Select invoices'],
          ['json', 'Paste JSON'],
          ['files', 'Upload files'],
        ] as const).map(([key, label]) => (
          <Button key={key} type="button" variant={tab === key ? 'default' : 'outline'} size="sm" onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'ids' && (
        <Card>
          <CardContent className="pt-4 grid gap-3 sm:grid-cols-2">
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={id1} onChange={(e) => setId1(e.target.value)}>
              <option value="">Invoice A</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={id2} onChange={(e) => setId2(e.target.value)}>
              <option value="">Invoice B</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </CardContent>
        </Card>
      )}

      {tab === 'json' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Textarea className="min-h-48 font-mono text-xs" placeholder='{"company_name":"Apex","parts_line_items":[]}' value={leftJson} onChange={(e) => setLeftJson(e.target.value)} />
          <Textarea className="min-h-48 font-mono text-xs" placeholder="Second invoice JSON" value={rightJson} onChange={(e) => setRightJson(e.target.value)} />
        </div>
      )}

      {tab === 'files' && (
        <Card>
          <CardContent className="pt-4 grid gap-3 sm:grid-cols-2 text-sm">
            <label className="rounded-md border p-4">
              File A
              <input type="file" accept="application/pdf,image/*" className="mt-2 block" onChange={(e) => setFileA(e.target.files?.[0] ?? null)} />
            </label>
            <label className="rounded-md border p-4">
              File B
              <input type="file" accept="application/pdf,image/*" className="mt-2 block" onChange={(e) => setFileB(e.target.files?.[0] ?? null)} />
            </label>
          </CardContent>
        </Card>
      )}

      <Button type="button" onClick={() => void onCompare()} disabled={busy}>
        {busy ? 'Comparing…' : pendingIds ? 'Waiting for OCR…' : 'Compare'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {usedModel?.used ? `${usedModel.provider} / ${usedModel.model}` : `Rules only · default ${activeProvider}/${activeModel}`}
                </Badge>
                {usedModel?.error && <Badge variant="destructive">{usedModel.error}</Badge>}
                {result.validation && (
                  <Badge variant={result.validation.summaryOk ? 'outline' : 'destructive'}>
                    {result.validation.summaryOk
                      ? `${result.validation.acceptedAi} AI pairs kept`
                      : 'Summary needs review'}
                  </Badge>
                )}
              </div>
              <p>{result.summary.rules}</p>
              {result.summary.ai && <p className="text-muted-foreground">{result.summary.ai}</p>}
              {result.validation?.summaryIssues?.length ? (
                <ul className="list-disc pl-5 text-amber-800 dark:text-amber-200">
                  {result.validation.summaryIssues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="outline">{result.counts.matched} match</Badge>
                <Badge variant="outline">{result.counts.changed} changed</Badge>
                <Badge variant="outline">{result.counts.missing} missing</Badge>
                <Badge variant="outline">{result.counts.extra} extra</Badge>
                {result.counts.aiPairs > 0 && <Badge>{result.counts.aiPairs} AI pairs</Badge>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Check these mismatches
                {mismatches.length > 0 ? ` (${mismatches.length})` : ''}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {mismatches.length === 0 && (
                <p className="text-sm text-muted-foreground">No header, total, or line mismatches to review.</p>
              )}
              {mismatches.map((row, i) => (
                <div key={`${row.kind}-${i}`} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
                  <Badge variant={mismatchKind(row.kind)} className="mt-0.5 shrink-0">{row.kind.replace(/_/g, ' ')}</Badge>
                  <div>
                    <p className="font-medium">{row.label}</p>
                    <p className="text-muted-foreground">{row.detail}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base grid grid-cols-3">
                <span>{result.invoiceA.vendorName ?? 'Invoice A'}</span>
                <span className="text-center text-muted-foreground font-normal">Diff</span>
                <span className="text-right">{result.invoiceB.vendorName ?? 'Invoice B'}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] uppercase text-muted-foreground mb-1">Header</p>
              {result.header.map((row) => <FieldRow key={row.field} row={row} />)}
              <p className="text-[11px] uppercase text-muted-foreground mt-4 mb-1">Totals</p>
              {result.totals.map((row) => <FieldRow key={row.field} row={row} />)}
              <p className="text-[11px] uppercase text-muted-foreground mt-4 mb-1">Parts</p>
              {result.parts.length === 0 && <p className="text-sm text-muted-foreground">No parts</p>}
              {result.parts.map((row, i) => <LineRow key={`p-${i}`} row={row} />)}
              <p className="text-[11px] uppercase text-muted-foreground mt-4 mb-1">Labour</p>
              {result.labour.length === 0 && <p className="text-sm text-muted-foreground">No labour</p>}
              {result.labour.map((row, i) => <LineRow key={`l-${i}`} row={row} />)}
            </CardContent>
          </Card>

          {result.invoiceA.id && result.invoiceB.id && (
            <p className="text-xs text-muted-foreground">
              Open <Link className="underline" to={`/invoices/${result.invoiceA.id}`}>invoice A</Link>
              {' · '}
              <Link className="underline" to={`/invoices/${result.invoiceB.id}`}>invoice B</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
