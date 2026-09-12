import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Search, SlidersHorizontal, Download, X, Mail, Copy, Square, CheckSquare, RotateCcw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import type { Invoice, Batch } from '../types/index.js';
import { money, dateFmt, costFmt } from '../lib/format.js';
import { StatusDot } from '../components/StatusDot.js';
import { DocumentPreview } from '../components/DocumentPreview.js';
import { Toast } from '../components/Toast.js';
import { usePolling } from '../hooks/usePolling.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Badge } from '@/components/ui/badge.js';
import { Card } from '@/components/ui/card.js';
import { Textarea } from '@/components/ui/textarea.js';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table.js';
import { EmptyState } from '@/components/ui/empty-state.js';

const DEFAULT_PAGE_SIZE = 10;

type SortKey = 'none' | 'status' | 'vendorName' | 'invoiceDate' | 'confidence' | 'totalAmount';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'ALL' | 'DRAFT' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'NEEDS_REVIEW';

export function filterPdfs(files: FileList | File[]): File[] {
  return Array.from(files).filter(
    (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
  );
}

function buildQs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

const STATUS_PILLS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFT', label: 'Email Draft' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'NEEDS_REVIEW', label: 'Needs review' },
];

type ReviewCodeFilter = '' | 'MISSING_TAX_ID' | 'TOTAL_MISMATCH' | 'PARTS_BASE_MISMATCH' | 'LABOUR_BASE_MISMATCH';

const REVIEW_CODE_CHIPS: { key: ReviewCodeFilter; label: string; countKey: string }[] = [
  { key: '', label: 'All reasons', countKey: 'NEED_REVIEW' },
  { key: 'MISSING_TAX_ID', label: 'No GSTIN / PAN', countKey: 'review_MISSING_TAX_ID' },
  { key: 'TOTAL_MISMATCH', label: 'Total mismatch', countKey: 'review_TOTAL_MISMATCH' },
  { key: 'PARTS_BASE_MISMATCH', label: 'Parts base ≠ total', countKey: 'review_PARTS_BASE_MISMATCH' },
  { key: 'LABOUR_BASE_MISMATCH', label: 'Labour base ≠ total', countKey: 'review_LABOUR_BASE_MISMATCH' },
];

function isDuplicate(inv: Invoice): boolean {
  return (inv.reviewReasons ?? []).some((r) => r.startsWith('Duplicate:'));
}

export function InvoicesPage() {
  const navigate = useNavigate();

  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [globalCounts, setGlobalCounts] = useState<Record<StatusFilter, number>>({
    ALL: 0, DRAFT: 0, PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, NEEDS_REVIEW: 0,
  });
  const [reviewCodeCounts, setReviewCodeCounts] = useState<Record<string, number>>({});

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [reviewCodeFilter, setReviewCodeFilter] = useState<ReviewCodeFilter>('');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState<SortKey>('none');
  const [dir, setDir] = useState<SortDir>('desc');
  const [minTotal, setMinTotal] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchFilter, setBatchFilter] = useState('');
  const [batchName, setBatchName] = useState('');
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);

  const [showFilters, setShowFilters] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [duplicateBanner, setDuplicateBanner] = useState<{ count: number } | null>(null);
  const [intakeEmail, setIntakeEmail] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statusToApiParams = (sf: StatusFilter): Record<string, string | undefined> => {
    switch (sf) {
      case 'DRAFT': return { status: 'DRAFT' };
      case 'PENDING': return { status: 'UPLOADED' };
      case 'PROCESSING': return { status: 'PROCESSING' };
      case 'COMPLETED': return { completed: '1' };
      case 'FAILED': return { status: 'FAILED' };
      case 'NEEDS_REVIEW': return { status: 'NEED_REVIEW' };
      default: return {};
    }
  };

  const fetchPage = useCallback(async (
    page: number, size: number, search?: string, status?: StatusFilter, reviewCode?: ReviewCodeFilter,
  ) => {
    setLoading(true);
    setAllInvoices([]);
    try {
      const statusParams = statusToApiParams(status ?? 'ALL');
      const code = reviewCode ?? '';
      const params: Record<string, string | undefined> = { page: String(page), pageSize: String(size), ...statusParams };
      if (search) params.q = search;
      if (code && (status ?? 'ALL') === 'NEEDS_REVIEW') params.review_code = code;
      const qs = buildQs(params);
      const [inv, bat] = await Promise.all([api.list(qs), api.batches().catch(() => ({ batches: [] }))]);
      setAllInvoices(inv.invoices);
      setBatches(bat.batches);
      setTotalRecords(inv.total);
      setTotalPages(inv.totalPages);
      setCurrentPage(inv.page);
    } catch (e) {
      setAllInvoices([]);
      setTotalRecords(0);
      setTotalPages(1);
      setToast(e instanceof Error ? e.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGlobalCounts = useCallback(async () => {
    try {
      const res = await api.counts();
      applyCountsToState(res.counts);
    } catch { /* ignore */ }
  }, []);

  const applyCountsToState = useCallback((c: Record<string, number>) => {
    setGlobalCounts({
      ALL: c['all'] ?? c['ALL'] ?? 0,
      DRAFT: c['DRAFT'] ?? 0,
      PENDING: c['UPLOADED'] ?? 0,
      PROCESSING: c['PROCESSING'] ?? 0,
      COMPLETED: (c['OCR_COMPLETED'] ?? 0) + (c['VERIFIED'] ?? 0),
      FAILED: c['FAILED'] ?? 0,
      NEEDS_REVIEW: c['NEED_REVIEW'] ?? 0,
    });
    setReviewCodeCounts({
      NEED_REVIEW: c['NEED_REVIEW'] ?? 0,
      review_MISSING_TAX_ID: c['review_MISSING_TAX_ID'] ?? 0,
      review_TOTAL_MISMATCH: c['review_TOTAL_MISMATCH'] ?? 0,
      review_PARTS_BASE_MISMATCH: c['review_PARTS_BASE_MISMATCH'] ?? 0,
      review_LABOUR_BASE_MISMATCH: c['review_LABOUR_BASE_MISMATCH'] ?? 0,
    });
  }, []);

  const refetch = useCallback(async () => {
    await fetchPage(currentPage, pageSize, q || undefined, statusFilter, reviewCodeFilter);
  }, [fetchPage, currentPage, pageSize, q, statusFilter, reviewCodeFilter]);

  useEffect(() => { void fetchPage(currentPage, pageSize, q || undefined, statusFilter, reviewCodeFilter); }, [fetchPage, currentPage, pageSize, q, statusFilter, reviewCodeFilter]);
  useEffect(() => { void fetchGlobalCounts(); }, [fetchGlobalCounts]);
  useEffect(() => { api.config().then((cfg) => { if (cfg.emailIntake?.enabled && cfg.emailIntake.address) setIntakeEmail(cfg.emailIntake.address); }).catch(() => {}); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setQ(searchInput); setCurrentPage(1); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const refetchWithCounts = useCallback(async () => { await Promise.all([refetch(), fetchGlobalCounts()]); }, [refetch, fetchGlobalCounts]);
  usePolling(refetchWithCounts, () => allInvoices.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING'), 3000);

  const counts = globalCounts;
  const hasAdvancedFilters = !!(minTotal || dateFrom || dateTo);
  const hasSearch = !!q;

  const displayedRows: Invoice[] = (() => {
    let rows = [...allInvoices];
    if (batchFilter) rows = rows.filter((inv) => inv.batchId === batchFilter);
    if (minTotal) { const min = parseFloat(minTotal); if (!isNaN(min)) rows = rows.filter((inv) => ((inv.netAmount ?? inv.totalAmount) ?? 0) >= min); }
    if (dateFrom) rows = rows.filter((inv) => !!inv.invoiceDate && inv.invoiceDate >= dateFrom);
    if (dateTo) rows = rows.filter((inv) => !!inv.invoiceDate && inv.invoiceDate <= dateTo);
    if (sort !== 'none') {
      rows = [...rows].sort((a, b) => {
        let av: string | number | null | undefined;
        let bv: string | number | null | undefined;
        switch (sort) {
          case 'status': av = a.status; bv = b.status; break;
          case 'vendorName': av = a.vendorName ?? ''; bv = b.vendorName ?? ''; break;
          case 'invoiceDate': av = a.invoiceDate ?? ''; bv = b.invoiceDate ?? ''; break;
          case 'confidence': av = a.confidence ?? -1; bv = b.confidence ?? -1; break;
          case 'totalAmount': av = (a.netAmount ?? a.totalAmount) ?? 0; bv = (b.netAmount ?? b.totalAmount) ?? 0; break;
        }
        if (av === null || av === undefined) av = '';
        if (bv === null || bv === undefined) bv = '';
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  })();

  function toggleSort(key: SortKey) { if (sort === key) setDir((d) => d === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('desc'); } }
  function toggleRow(id: string) { setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAll() { if (selected.size === displayedRows.length) setSelected(new Set()); else setSelected(new Set(displayedRows.map((r) => r.id))); }

  async function handleBulkReextract() { try { await api.bulk('reextract', [...selected]); setToast('Re-extraction queued'); setSelected(new Set()); await refetch(); } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'unknown')); } }
  async function handleCancel(id: string) { try { await api.cancel(id); setToast('Cancelling extraction…'); await refetch(); } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'unknown')); } }
  async function handleProcessOcr(id: string) { try { await api.processOcr(id); setToast('OCR processing started…'); await refetch(); } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'unknown')); } }
  async function handleBulkDelete() { try { await api.bulk('delete', [...selected]); setSelected(new Set()); setToast('Deleted selected invoices'); await refetch(); } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'unknown')); } }

  async function exportCsv(path: string) {
    const qs = buildQs({ q: q || undefined, minTotal: minTotal || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
    try {
      const token = localStorage.getItem('session_token');
      const res = await fetch(path + qs, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error((body as { message?: string }).message ?? `Export failed (${res.status})`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = path.includes('line-items') ? 'line-items.csv' : 'invoices.csv';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setToast('Export failed: ' + (e instanceof Error ? e.message : 'unknown')); }
  }

  async function handleFiles(files: FileList | File[]) {
    const pdfs = filterPdfs(files);
    if (pdfs.length === 0) { setToast('No PDF files selected'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.upload(pdfs, batchName.trim() || undefined);
      const created = result?.created?.length ?? 0;
      const dupes = result?.duplicates?.length ?? 0;
      const rejectedList = (result?.rejected ?? []) as Array<string | { name: string; reason?: string }>;
      const rejected = rejectedList.length;
      const rejectDetail = rejectedList.map((r) => (typeof r === 'string' ? r : `${r.name}${r.reason ? `: ${r.reason}` : ''}`)).slice(0, 3).join('; ');
      if (dupes > 0) setDuplicateBanner({ count: dupes });
      await refetch();
      setToast(`Uploaded ${created} file${created === 1 ? '' : 's'}${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}${rejected ? `, ${rejected} rejected${rejectDetail ? ` (${rejectDetail})` : ''}` : ''}`);
      setShowUpload(false); setBatchName('');
    } catch (e) { setToast('Upload failed: ' + (e instanceof Error ? e.message : 'unknown')); } finally { setBusy(false); }
  }

  async function handleImport() {
    const sources = importText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (sources.length === 0) { setToast('Paste at least one URL or file path'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.importSources(sources, batchName.trim() || undefined);
      const created = result?.created?.length ?? 0;
      const dupes = result?.duplicates?.length ?? 0;
      const rejected = result?.rejected?.length ?? 0;
      if (dupes > 0) setDuplicateBanner({ count: dupes });
      await refetch();
      setToast(`Imported ${created} file${created === 1 ? '' : 's'}${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}${rejected ? `, ${rejected} rejected` : ''}`);
      setShowUpload(false); setImportText(''); setBatchName('');
    } catch (e) { setToast('Import failed: ' + (e instanceof Error ? e.message : 'unknown')); } finally { setBusy(false); }
  }

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragging(true); }
  function onDragLeave() { setDragging(false); }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files); }

  const isAllSelected = displayedRows.length > 0 && selected.size === displayedRows.length;
  const isPartialSelected = selected.size > 0 && selected.size < displayedRows.length;

  useEffect(() => {
    if (displayedRows.length === 0) { setPreviewId(null); return; }
    if (!previewId || !displayedRows.some((r) => r.id === previewId)) setPreviewId(displayedRows[0].id);
  }, [displayedRows, previewId]);

  const previewInvoice = displayedRows.find((r) => r.id === previewId) ?? displayedRows[0] ?? null;

  const sortIcon = (key: SortKey) => sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="min-h-full bg-background font-sans">
      {/* Duplicate banner */}
      {duplicateBanner && (
        <div className="flex items-center justify-between border-b border-warning/20 bg-warning-soft px-7 py-2.5 text-sm font-medium text-warning">
          <span>{duplicateBanner.count} duplicate{duplicateBanner.count !== 1 ? 's' : ''} skipped — these files were already uploaded.</span>
          <button onClick={() => setDuplicateBanner(null)} className="text-warning font-bold text-base hover:opacity-70 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-start justify-between gap-4 px-7 pt-6 pb-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading && allInvoices.length === 0
              ? 'Loading…'
              : statusFilter === 'ALL'
                ? `${(globalCounts.ALL || totalRecords).toLocaleString()} invoice${(globalCounts.ALL || totalRecords) !== 1 ? 's' : ''}`
                : `${(globalCounts[statusFilter] ?? totalRecords).toLocaleString()} ${STATUS_PILLS.find((p) => p.key === statusFilter)?.label ?? statusFilter} · ${(globalCounts.ALL || totalRecords).toLocaleString()} total`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              type="text" placeholder="Search vendor, invoice #, file"
              value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              className="w-64 pl-9"
            />
          </div>

          <select aria-label="Filter by batch" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-3 text-sm cursor-pointer">
            <option value="">All batches</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          <Button variant={showFilters ? 'secondary' : 'outline'} size="default" onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {hasAdvancedFilters && (
              <Badge variant="default" className="ml-1 h-5 px-1.5 text-[10px]">
                {[minTotal, dateFrom, dateTo].filter(Boolean).length}
              </Badge>
            )}
          </Button>

          <Button variant="outline" onClick={() => void exportCsv('/api/invoices/export/csv')}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={() => void exportCsv('/api/invoices/export/line-items.csv')}>
            <Download className="h-4 w-4" /> Items
          </Button>

          <Button onClick={() => setShowUpload((v) => !v)}>
            <Upload className="h-4 w-4" /> Upload bills
          </Button>
        </div>
      </div>

      {/* ─── Advanced filters ─── */}
      {showFilters && (
        <Card className="mx-7 mb-3 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Min total</label>
              <Input type="number" placeholder="0" value={minTotal} onChange={(e) => setMinTotal(e.target.value)} className="w-28" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Issued from</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Issued to</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setMinTotal(''); setDateFrom(''); setDateTo(''); }}>
              Clear filters
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Email intake banner ─── */}
      {showUpload && intakeEmail && (
        <Card className="mx-7 mb-2 border-info/20 bg-info-soft">
          <div className="flex items-center gap-3 p-4">
            <Mail className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-primary">Email invoices directly</p>
              <p className="mt-0.5 text-xs text-primary/70">
                Send PDF/image attachments to <strong>{intakeEmail}</strong> — they'll be picked up automatically and processed via OCR.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(intakeEmail); setToast('Email copied!'); }}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Upload panel ─── */}
      {showUpload && (
        <div
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          className={cn(
            'mx-7 mb-3 rounded-xl border-2 border-dashed p-7 text-center transition-colors',
            dragging ? 'border-primary bg-secondary' : 'border-border bg-card',
          )}
        >
          <p className="text-base font-semibold text-foreground mb-1">Drop PDF invoices here</p>
          <p className="text-sm text-muted-foreground mb-4">or browse to select files</p>

          <Input type="text" aria-label="Batch name" placeholder="Batch name (optional)" value={batchName}
            onChange={(e) => setBatchName(e.target.value)} className="mx-auto mb-3 max-w-[280px]" />

          <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors', busy && 'opacity-60 cursor-default')}>
            <Upload className="h-4 w-4" />
            {busy ? 'Uploading…' : 'Browse files'}
            <input type="file" multiple accept="application/pdf,.pdf" disabled={busy} className="hidden"
              onChange={(e) => { const input = e.currentTarget; if (input.files?.length) void handleFiles(input.files); input.value = ''; }} />
          </label>

          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-xs text-muted-foreground">…or paste URLs / server file paths, one per line</p>
            <Textarea aria-label="Import URLs or paths" value={importText} onChange={(e) => setImportText(e.target.value)}
              rows={3} placeholder={'https://bucket.s3.amazonaws.com/invoice.pdf\n/data/import/invoice.pdf'}
              className="mx-auto max-w-lg font-mono text-xs" />
            <Button onClick={() => void handleImport()} disabled={busy} className="mt-3">
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      )}

      {/* ─── Status pills ─── */}
      <div className="flex flex-wrap gap-1.5 px-7 pt-1">
        {STATUS_PILLS.map(({ key, label }) => {
          const active = statusFilter === key;
          return (
            <button key={key}
              onClick={() => { setStatusFilter(key); setReviewCodeFilter(''); setCurrentPage(1); }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
              <span className={cn(
                'rounded-full px-1.5 py-px text-[11px] font-semibold min-w-[18px] text-center',
                active ? 'bg-white/20 text-primary-foreground' : 'bg-muted text-faint',
              )}>
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* ─── Review code chips ─── */}
      {statusFilter === 'NEEDS_REVIEW' && (
        <div className="flex flex-wrap items-center gap-1.5 px-7 pt-2">
          <span className="mr-1 text-xs text-faint">Why:</span>
          {REVIEW_CODE_CHIPS.map(({ key, label, countKey }) => {
            const active = reviewCodeFilter === key;
            const n = reviewCodeCounts[countKey] ?? 0;
            return (
              <button key={key || 'all'}
                onClick={() => { setReviewCodeFilter(key); setCurrentPage(1); }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
                  active
                    ? 'border-primary bg-secondary text-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
                <span className={cn('rounded-md px-1.5 text-[10px] font-semibold', active ? 'text-primary' : 'text-faint')}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Batch progress ─── */}
      {batchFilter && (() => {
        const b = batches.find((x) => x.id === batchFilter);
        if (!b) return null;
        const pct = b.total ? Math.round((b.completed / b.total) * 100) : 0;
        return (
          <Card className="mx-7 mt-3 p-4">
            <div className="mb-2 flex justify-between text-sm font-semibold">
              <span>{b.name}</span>
              <span className="font-medium text-muted-foreground">
                {b.completed}/{b.total} done{b.failed ? ` · ${b.failed} failed` : ''}{b.processing ? ` · ${b.processing} in progress` : ''}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </Card>
        );
      })()}

      {/* ─── Bulk action bar ─── */}
      {selected.size > 0 && (
        <div className="mx-7 mt-3 flex items-center gap-3 rounded-lg bg-foreground px-4 py-2.5">
          <span className="text-sm font-semibold text-card">{selected.size} selected</span>
          <Button variant="ghost" size="sm" className="text-card/80 hover:text-card hover:bg-white/10" onClick={() => void handleBulkReextract()}>
            <RotateCcw className="h-3.5 w-3.5" /> Re-extract
          </Button>
          <Button variant="ghost" size="sm" className="text-card/80 hover:text-card hover:bg-white/10" onClick={() => void exportCsv('/api/invoices/export/csv')}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-soft hover:text-danger hover:bg-white/10" onClick={() => void handleBulkDelete()}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-card/60 hover:text-card hover:bg-white/10" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* ─── Two-column: table + preview ─── */}
      <div className="inv-split flex items-start gap-4 px-7 pt-4 pb-10">
        <Card className="flex min-w-0 flex-[1.35] flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-9">
                    <input type="checkbox" checked={isAllSelected}
                      ref={(el) => { if (el) el.indeterminate = isPartialSelected; }}
                      onChange={toggleAll} className="cursor-pointer" />
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('status')}>Status{sortIcon('status')}</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('vendorName')}>Vendor{sortIcon('vendorName')}</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('invoiceDate')}>Date{sortIcon('invoiceDate')}</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('totalAmount')}>Total{sortIcon('totalAmount')}</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Loading skeleton */}
                {loading && allInvoices.length === 0 && Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell />
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><div className={cn('h-3.5 rounded bg-muted animate-pulse', j === 1 ? 'w-3/4' : 'w-1/2')} /></TableCell>
                    ))}
                  </TableRow>
                ))}

                {/* Empty state */}
                {!loading && displayedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      {allInvoices.length === 0 && !hasSearch && !hasAdvancedFilters && statusFilter === 'ALL' ? (
                        <EmptyState
                          icon={<Upload className="h-10 w-10" />}
                          title="No invoices yet"
                          description="Upload your first invoice to get started."
                          action={<Button onClick={() => setShowUpload(true)}>Upload bills</Button>}
                        />
                      ) : (
                        <EmptyState title="No invoices match this filter" />
                      )}
                    </TableCell>
                  </TableRow>
                )}

                {/* Data rows */}
                {displayedRows.map((row) => {
                  const isChecked = selected.has(row.id);
                  const isPreview = previewInvoice?.id === row.id;
                  return (
                    <TableRow key={row.id} tabIndex={0}
                      onClick={() => setPreviewId(row.id)}
                      onDoubleClick={() => navigate('/invoices/' + row.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate('/invoices/' + row.id); if (e.key === ' ') { e.preventDefault(); setPreviewId(row.id); } }}
                      className={cn('cursor-pointer', isPreview && 'bg-secondary')}
                    >
                      <TableCell className="w-9" onClick={(e) => { e.stopPropagation(); toggleRow(row.id); }}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggleRow(row.id)}
                          onClick={(e) => e.stopPropagation()} className="cursor-pointer" />
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusDot status={row.status} />
                          {isDuplicate(row) && (
                            <Badge variant="warning" className="text-[9px] px-1.5 py-0">DUP</Badge>
                          )}
                          {(row.status === 'PROCESSING' || row.status === 'PENDING') && (
                            <Button variant="outline" size="sm" className="h-5 px-2 text-[11px] text-danger border-danger/30"
                              onClick={(e) => { e.stopPropagation(); void handleCancel(row.id); }}>Stop</Button>
                          )}
                          {row.status === 'DRAFT' && (
                            <Button size="sm" className="h-5 px-2 text-[11px]"
                              onClick={(e) => { e.stopPropagation(); void handleProcessOcr(row.id); }}>Process OCR</Button>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="font-semibold text-primary">{row.vendorName ?? '—'}</div>
                        {row.fileName && <div className="mt-0.5 font-mono text-[11px] text-faint truncate max-w-[200px]">{row.fileName}</div>}
                      </TableCell>

                      <TableCell className="text-muted-foreground">{dateFmt(row.invoiceDate)}</TableCell>

                      <TableCell>
                        {row.extractionProvider || row.provider ? (
                          <div>
                            <Badge variant={row.pipelineMode === 'single' ? 'info' : 'muted'} className="text-[11px]">
                              {row.pipelineMode === 'single' ? 'Single' : 'Split'}
                            </Badge>
                            {(row.fallbackAttempts ?? 0) > 1 && (
                              <Badge variant="warning" className="ml-1 text-[10px]">via fallback</Badge>
                            )}
                            <div className="mt-0.5 font-mono text-[10px] text-faint">
                              {(() => {
                                const prov = row.extractionProvider ?? row.provider;
                                const model = row.extractionModel ?? row.structuringModel;
                                if (prov === 'azapi') return 'AzAPI OCR';
                                if (prov && model && !model.startsWith(prov)) return `${prov} · ${model}`;
                                return model ?? prov ?? '—';
                              })()}
                            </div>
                          </div>
                        ) : <span className="text-faint">—</span>}
                      </TableCell>

                      <TableCell className="text-right font-mono text-muted-foreground">{row.itemCount ?? '—'}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{money(row.netAmount ?? row.totalAmount, row.currency ?? 'INR')}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground"
                        title={row.totalInputTokens != null
                          ? `Input: ${row.totalInputTokens.toLocaleString()} tkn = ${costFmt(row.totalInputCostUsd ?? 0)}  +  Output: ${row.totalOutputTokens?.toLocaleString() ?? 0} tkn = ${costFmt(row.totalOutputCostUsd ?? 0)}  =  Total: ${costFmt(row.costEstimate)}`
                          : `${(row.totalTokens ?? 0).toLocaleString()} tokens · ${costFmt(row.costEstimate)}`
                        }
                      >
                        {costFmt(row.costEstimate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* ─── Pagination ─── */}
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <span className="font-mono text-xs">
              Page {currentPage} of {totalPages} ({totalRecords.toLocaleString()} records)
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                Per page
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  className="h-7 rounded border border-input bg-card px-2 text-xs cursor-pointer">
                  {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <Button variant="outline" size="sm" disabled={currentPage <= 1 || loading} onClick={() => setCurrentPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages || loading} onClick={() => setCurrentPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>

        <DocumentPreview invoice={previewInvoice} />
      </div>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}
