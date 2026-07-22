import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { Invoice, Batch } from '../types/index.js';
import { T } from '../theme.js';
import { money, dateFmt, costFmt } from '../lib/format.js';
import { StatusDot } from '../components/StatusDot.js';
import { DocumentPreview } from '../components/DocumentPreview.js';
import { Toast } from '../components/Toast.js';
import { usePolling } from '../hooks/usePolling.js';

/* Client-side invoice list cache (30s TTL) */
const INV_CACHE_TTL = 30_000;
let invCache: { invoices: Invoice[]; batches: Batch[]; total: number; page: number; pageSize: number; totalPages: number; at: number } | null = null;
export function invalidateInvoiceCache() { invCache = null; }

const DEFAULT_PAGE_SIZE = 10;

type SortKey = 'none' | 'status' | 'vendorName' | 'invoiceDate' | 'confidence' | 'totalAmount';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'ALL' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'NEEDS_REVIEW';

// Accept a file as a PDF if its MIME type says so OR its name ends in .pdf.
// Browsers frequently report an empty or non-standard MIME type for PDFs
// (depends on OS, file source, and file associations), so the extension is a
// necessary fallback — otherwise valid PDFs get silently dropped on selection.
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

function needsReview(inv: Invoice): boolean {
  if (inv.status !== 'COMPLETED' || inv.verified) return false;
  if ((inv.confidence ?? 1) < 0.75) return true;
  return (inv.reviewReasons?.length ?? 0) > 0;
}

function applyClientFilters(invoices: Invoice[], statusFilter: StatusFilter): Invoice[] {
  if (statusFilter === 'ALL') return invoices;
  if (statusFilter === 'NEEDS_REVIEW') return invoices.filter(needsReview);
  if (statusFilter === 'COMPLETED') return invoices.filter((inv) => inv.status === 'COMPLETED' && !needsReview(inv));
  return invoices.filter((inv) => inv.status === statusFilter);
}

function countsByStatus(invoices: Invoice[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    ALL: invoices.length,
    PENDING: 0,
    PROCESSING: 0,
    COMPLETED: 0,
    FAILED: 0,
    NEEDS_REVIEW: 0,
  };
  for (const inv of invoices) {
    if (inv.status === 'PENDING') counts.PENDING++;
    else if (inv.status === 'PROCESSING') counts.PROCESSING++;
    else if (inv.status === 'COMPLETED') {
      if (needsReview(inv)) counts.NEEDS_REVIEW++;
      else counts.COMPLETED++;
    }
    else if (inv.status === 'FAILED') counts.FAILED++;
  }
  return counts;
}

const STATUS_PILLS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'NEEDS_REVIEW', label: 'Needs review' },
];

function rowDisplayStatus(inv: Invoice): string {
  if (needsReview(inv)) return 'NEEDS_REVIEW';
  return inv.status;
}

function isDuplicate(inv: Invoice): boolean {
  return (inv.reviewReasons ?? []).some((r) => r.startsWith('Duplicate:'));
}

export function InvoicesPage() {
  const navigate = useNavigate();

  // Data state
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filter / sort state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
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

  // UI toggle state
  const [showFilters, setShowFilters] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Selection state (bulk checkboxes)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Row focused in the right-hand document preview panel
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Toast / banner state
  const [toast, setToast] = useState('');
  const [duplicateBanner, setDuplicateBanner] = useState<{ count: number } | null>(null);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(async (page: number, size: number) => {
    setLoading(true);
    try {
      const cacheKey = `${page}-${size}`;
      if (invCache && Date.now() - invCache.at < INV_CACHE_TTL && invCache.page === page && invCache.pageSize === size) {
        setAllInvoices(invCache.invoices);
        setBatches(invCache.batches);
        setTotalRecords(invCache.total);
        setTotalPages(invCache.totalPages);
        setCurrentPage(invCache.page);
        return;
      }
      const qs = `?page=${page}&pageSize=${size}`;
      const [inv, bat] = await Promise.all([api.list(qs), api.batches().catch(() => ({ batches: [] }))]);
      invCache = { invoices: inv.invoices, batches: bat.batches, total: inv.total, page: inv.page, pageSize: inv.pageSize, totalPages: inv.totalPages, at: Date.now() };
      setAllInvoices(inv.invoices);
      setBatches(bat.batches);
      setTotalRecords(inv.total);
      setTotalPages(inv.totalPages);
      setCurrentPage(inv.page);
    } catch (_e) {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(async () => {
    await fetchPage(currentPage, pageSize);
  }, [fetchPage, currentPage, pageSize]);

  // Fetch when page or pageSize changes
  useEffect(() => {
    void fetchPage(currentPage, pageSize);
  }, [fetchPage, currentPage, pageSize]);

  // Also call api.config on mount (as per spec / test mock)
  useEffect(() => {
    void api.config();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQ(searchInput);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // Polling: refetch when some rows are PENDING or PROCESSING
  usePolling(
    refetch,
    () => allInvoices.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING'),
    3000,
  );

  // Compute displayed rows: client-side filter + sort
  const counts = countsByStatus(allInvoices);

  const hasAdvancedFilters = !!(minTotal || dateFrom || dateTo);
  const hasSearch = !!q;

  const displayedRows: Invoice[] = (() => {
    let rows = applyClientFilters(allInvoices, statusFilter);
    if (batchFilter) rows = rows.filter((inv) => inv.batchId === batchFilter);

    // Apply text search client-side
    if (q) {
      const lower = q.toLowerCase();
      rows = rows.filter(
        (inv) =>
          (inv.vendorName ?? '').toLowerCase().includes(lower) ||
          (inv.invoiceNumber ?? '').toLowerCase().includes(lower) ||
          (inv.fileName ?? '').toLowerCase().includes(lower),
      );
    }

    // Apply advanced filters client-side
    if (minTotal) {
      const min = parseFloat(minTotal);
      if (!isNaN(min)) rows = rows.filter((inv) => ((inv.netAmount ?? inv.totalAmount) ?? 0) >= min);
    }
    if (dateFrom) {
      rows = rows.filter((inv) => !!inv.invoiceDate && inv.invoiceDate >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((inv) => !!inv.invoiceDate && inv.invoiceDate <= dateTo);
    }

    // Sort (none = server order = latest updated first)
    if (sort !== 'none') {
    rows = [...rows].sort((a, b) => {
      let av: string | number | null | undefined;
      let bv: string | number | null | undefined;
      switch (sort) {
        case 'status':
          av = a.status;
          bv = b.status;
          break;
        case 'vendorName':
          av = a.vendorName ?? '';
          bv = b.vendorName ?? '';
          break;
        case 'invoiceDate':
          av = a.invoiceDate ?? '';
          bv = b.invoiceDate ?? '';
          break;
        case 'confidence':
          av = a.confidence ?? -1;
          bv = b.confidence ?? -1;
          break;
        case 'totalAmount':
          av = (a.netAmount ?? a.totalAmount) ?? 0;
          bv = (b.netAmount ?? b.totalAmount) ?? 0;
          break;
      }
      if (av === null || av === undefined) av = '';
      if (bv === null || bv === undefined) bv = '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
    }

    return rows;
  })();

  // Sort toggle
  function toggleSort(key: SortKey) {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('desc');
    }
  }

  // Selection helpers
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === displayedRows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(displayedRows.map((r) => r.id)));
    }
  }

  // Bulk actions
  async function handleBulkReextract() {
    try {
      await api.bulk('reextract', [...selected]);
      setToast('Re-extraction queued');
      setSelected(new Set());
      invalidateInvoiceCache();
      await refetch();
    } catch (e) {
      setToast('Error: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  async function handleCancel(id: string) {
    try {
      await api.cancel(id);
      setToast('Cancelling extraction…');
      await refetch();
    } catch (e) {
      setToast('Error: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  async function handleBulkDelete() {
    try {
      await api.bulk('delete', [...selected]);
      setSelected(new Set());
      setToast('Deleted selected invoices');
      invalidateInvoiceCache();
      await refetch();
    } catch (e) {
      setToast('Error: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  // Export CSV — must use fetch with JWT (window.open cannot send Authorization)
  async function exportCsv(path: string) {
    const qs = buildQs({ q: q || undefined, minTotal: minTotal || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
    try {
      const token = localStorage.getItem('session_token');
      const res = await fetch(path + qs, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = path.includes('line-items') ? 'line-items.csv' : 'invoices.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setToast('Export failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  // Upload handler
  async function handleFiles(files: FileList | File[]) {
    const pdfs = filterPdfs(files);
    if (pdfs.length === 0) {
      setToast('No PDF files selected');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.upload(pdfs, batchName.trim() || undefined);
      const created = result?.created?.length ?? 0;
      const dupes = result?.duplicates?.length ?? 0;
      const rejectedList = (result?.rejected ?? []) as Array<string | { name: string; reason?: string }>;
      const rejected = rejectedList.length;
      const rejectDetail = rejectedList
        .map((r) => (typeof r === 'string' ? r : `${r.name}${r.reason ? `: ${r.reason}` : ''}`))
        .slice(0, 3)
        .join('; ');
      if (dupes > 0) setDuplicateBanner({ count: dupes });
      invalidateInvoiceCache();
      await refetch();
      setToast(
        `Uploaded ${created} file${created === 1 ? '' : 's'}` +
        `${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}` +
        `${rejected ? `, ${rejected} rejected${rejectDetail ? ` (${rejectDetail})` : ''}` : ''}`,
      );
      setShowUpload(false);
      setBatchName('');
    } catch (e) {
      setToast('Upload failed: ' + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  // Import handler — paste URLs / server file paths, one per line.
  async function handleImport() {
    const sources = importText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (sources.length === 0) {
      setToast('Paste at least one URL or file path');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.importSources(sources, batchName.trim() || undefined);
      const created = result?.created?.length ?? 0;
      const dupes = result?.duplicates?.length ?? 0;
      const rejected = result?.rejected?.length ?? 0;
      if (dupes > 0) setDuplicateBanner({ count: dupes });
      invalidateInvoiceCache();
      await refetch();
      setToast(
        `Imported ${created} file${created === 1 ? '' : 's'}${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}${rejected ? `, ${rejected} rejected` : ''}`,
      );
      setShowUpload(false);
      setImportText('');
      setBatchName('');
    } catch (e) {
      setToast('Import failed: ' + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  // Drag-and-drop
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave() {
    setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
  }

  const isAllSelected = displayedRows.length > 0 && selected.size === displayedRows.length;
  const isPartialSelected = selected.size > 0 && selected.size < displayedRows.length;

  // Keep preview on a visible row
  useEffect(() => {
    if (displayedRows.length === 0) {
      setPreviewId(null);
      return;
    }
    if (!previewId || !displayedRows.some((r) => r.id === previewId)) {
      setPreviewId(displayedRows[0].id);
    }
  }, [displayedRows, previewId]);

  const previewInvoice =
    displayedRows.find((r) => r.id === previewId) ?? displayedRows[0] ?? null;

  const skeletonRows = Array.from({ length: 5 });

  const btnSecondary: React.CSSProperties = {
    padding: '7px 14px',
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    background: T.surface,
    color: T.ink,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: T.font,
  };

  return (
    <div style={{ background: T.paper, minHeight: '100%', fontFamily: T.font }}>
      {duplicateBanner && (
        <div style={{
          background: T.warnSoft, borderBottom: `1px solid #E8D4B0`,
          padding: '10px 28px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', fontSize: 13, color: T.warn, fontWeight: 500,
        }}>
          <span>
            {duplicateBanner.count} duplicate{duplicateBanner.count !== 1 ? 's' : ''} skipped — these files were already uploaded.
          </span>
          <button onClick={() => setDuplicateBanner(null)} aria-label="Dismiss" style={{
            background: 'none', border: 'none', cursor: 'pointer', color: T.warn, fontWeight: 700, fontSize: 16,
          }}>×</button>
        </div>
      )}

      {/* Header */}
      <div style={{
        padding: '22px 28px 16px', display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontFamily: T.heading, fontSize: 26, fontWeight: 600, color: T.ink, lineHeight: 1.2 }}>
            Invoices
          </div>
          <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 4 }}>
            {loading && allInvoices.length === 0
              ? 'Loading…'
              : `${displayedRows.length} invoice${displayedRows.length !== 1 ? 's' : ''}`}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search vendor, invoice #, file"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              width: 260, padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8,
              fontSize: 13, fontFamily: T.font, color: T.ink, background: T.surface, outline: 'none',
            }}
          />
          <select
            aria-label="Filter by batch"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            style={{ ...btnSecondary, maxWidth: 180 }}
          >
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button onClick={() => setShowFilters((v) => !v)} style={{
            ...btnSecondary,
            background: showFilters ? T.accentSoft : T.surface,
            color: showFilters ? T.accent : T.ink,
          }}>
            Filters
            {hasAdvancedFilters && (
              <span style={{
                marginLeft: 6, background: T.accent, color: '#fff', borderRadius: 10,
                fontSize: 11, fontWeight: 700, padding: '1px 6px',
              }}>
                {[minTotal, dateFrom, dateTo].filter(Boolean).length}
              </span>
            )}
          </button>
          <button onClick={() => void exportCsv('/api/invoices/export/csv')} style={btnSecondary}>
            Export CSV
          </button>
          <button onClick={() => void exportCsv('/api/invoices/export/line-items.csv')} style={btnSecondary}>
            Items CSV
          </button>
          <button
            onClick={() => setShowUpload((v) => !v)}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: 8,
              background: showUpload ? T.accentHover : T.accent, color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
            }}
          >
            Upload bills
          </button>
        </div>
      </div>

      {/* Advanced filters */}
      {showFilters && (
        <div style={{
          margin: '0 28px 12px', padding: '16px 20px', background: T.surface,
          border: `1px solid ${T.border}`, borderRadius: 10,
          display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.inkSoft, marginBottom: 4 }}>MIN TOTAL</div>
            <input type="number" placeholder="0" value={minTotal} onChange={(e) => setMinTotal(e.target.value)}
              style={{ padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontFamily: T.font, width: 120 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.inkSoft, marginBottom: 4 }}>ISSUED FROM</div>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              style={{ padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontFamily: T.font }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.inkSoft, marginBottom: 4 }}>ISSUED TO</div>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              style={{ padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontFamily: T.font }} />
          </div>
          <button onClick={() => { setMinTotal(''); setDateFrom(''); setDateTo(''); }} style={btnSecondary}>
            Clear filters
          </button>
        </div>
      )}

      {/* Upload */}
      {showUpload && (
        <div
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          style={{
            margin: '0 28px 12px', padding: '28px 24px',
            border: `2px dashed ${dragging ? T.accent : T.border}`, borderRadius: 10,
            background: dragging ? T.accentSoft : T.surface, textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: T.ink, marginBottom: 6 }}>Drop PDF invoices here</div>
          <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 16 }}>or browse to select files</div>
          <input type="text" aria-label="Batch name" placeholder="Batch name (optional)" value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            style={{ display: 'block', margin: '0 auto 14px', maxWidth: 280, width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, fontFamily: T.font }} />
          <label style={{
            display: 'inline-block', padding: '8px 20px', background: T.accent, color: '#fff',
            borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Uploading…' : 'Browse files'}
            <input type="file" multiple accept="application/pdf,.pdf" disabled={busy} style={{ display: 'none' }}
              onChange={(e) => {
                const input = e.currentTarget;
                if (input.files?.length) void handleFiles(input.files);
                input.value = '';
              }}
            />
          </label>
          <div style={{ marginTop: 18, borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 8 }}>…or paste URLs / server file paths, one per line</div>
            <textarea aria-label="Import URLs or paths" value={importText} onChange={(e) => setImportText(e.target.value)} rows={3}
              placeholder={'https://bucket.s3.amazonaws.com/invoice.pdf\n/data/import/invoice.pdf'}
              style={{ width: '100%', maxWidth: 480, padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, fontFamily: T.mono, resize: 'vertical' }}
            />
            <div>
              <button onClick={() => void handleImport()} disabled={busy} style={{
                marginTop: 10, padding: '8px 20px', background: T.accent, color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: T.font,
              }}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status pills */}
      <div style={{ padding: '4px 28px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STATUS_PILLS.map(({ key, label }) => {
          const active = statusFilter === key;
          return (
            <button key={key} onClick={() => setStatusFilter(key)} style={{
              padding: '6px 14px', borderRadius: 999,
              border: `1px solid ${active ? T.accent : T.border}`,
              background: active ? T.accent : T.surface,
              color: active ? '#fff' : T.inkSoft,
              fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: T.font,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {label}
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: active ? '#fff' : T.inkFaint,
                background: active ? 'rgba(255,255,255,0.22)' : '#F0EEE6',
                borderRadius: 10, padding: '1px 7px', minWidth: 18, textAlign: 'center',
              }}>
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {batchFilter && (() => {
        const b = batches.find((x) => x.id === batchFilter);
        if (!b) return null;
        const pct = b.total ? Math.round((b.completed / b.total) * 100) : 0;
        return (
          <div style={{ margin: '12px 28px 0', padding: '12px 16px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              <span>{b.name}</span>
              <span style={{ color: T.inkSoft, fontWeight: 500 }}>
                {b.completed}/{b.total} done{b.failed ? ` · ${b.failed} failed` : ''}{b.processing ? ` · ${b.processing} in progress` : ''}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: T.accent, transition: 'width 0.3s' }} />
            </div>
          </div>
        );
      })()}

      {selected.size > 0 && (
        <div style={{
          margin: '12px 28px 0', padding: '10px 16px', background: T.ink, borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
          <button onClick={() => void handleBulkReextract()} style={bulkBtn}>Re-extract</button>
          <button onClick={() => void exportCsv('/api/invoices/export/csv')} style={bulkBtn}>Export CSV</button>
          <button onClick={() => void handleBulkDelete()} style={{ ...bulkBtn, color: '#ffb0a8' }}>Delete</button>
          <button onClick={() => setSelected(new Set())} style={{ ...bulkBtn, marginLeft: 'auto' }}>Clear</button>
        </div>
      )}

      {/* Two-column: table + preview */}
      <div className="inv-split" style={{
        padding: '16px 28px 40px', display: 'flex', gap: 16, alignItems: 'flex-start',
      }}>
        <div style={{
          flex: '1.35 1 0', minWidth: 0, background: T.surface,
          border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: T.font }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: '#FAF9F5' }}>
                <th style={thBase}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = isPartialSelected; }}
                    onChange={toggleAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ ...thBase, cursor: 'pointer' }} onClick={() => toggleSort('status')}>
                  Status {sort === 'status' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style={{ ...thBase, cursor: 'pointer' }} onClick={() => toggleSort('vendorName')}>
                  Vendor {sort === 'vendorName' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style={{ ...thBase, cursor: 'pointer' }} onClick={() => toggleSort('invoiceDate')}>
                  Date {sort === 'invoiceDate' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style={thBase}>Pipeline</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Items</th>
                <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('totalAmount')}>
                  Total {sort === 'totalAmount' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style={{ ...thBase, textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {loading && allInvoices.length === 0 && skeletonRows.map((_, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={tdBase} />
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} style={tdBase}>
                      <div style={{ height: 14, borderRadius: 4, background: '#EDEAE2', width: j === 1 ? '70%' : '55%' }} />
                    </td>
                  ))}
                </tr>
              ))}

              {!loading && displayedRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '56px 24px' }}>
                    {allInvoices.length === 0 && !hasSearch && !hasAdvancedFilters && statusFilter === 'ALL' ? (
                      <div>
                        <div style={{ fontFamily: T.heading, fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 8 }}>No invoices yet</div>
                        <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 20 }}>Upload your first invoice to get started.</div>
                        <button onClick={() => setShowUpload(true)} style={{
                          padding: '9px 20px', background: T.accent, color: '#fff', border: 'none',
                          borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
                        }}>
                          Upload bills
                        </button>
                      </div>
                    ) : (
                      <div style={{ color: T.inkSoft, fontSize: 13 }}>No invoices match this filter.</div>
                    )}
                  </td>
                </tr>
              )}

              {displayedRows.map((row) => {
                const isChecked = selected.has(row.id);
                const isPreview = previewInvoice?.id === row.id;
                return (
                  <tr
                    key={row.id}
                    tabIndex={0}
                    onClick={() => setPreviewId(row.id)}
                    onDoubleClick={() => navigate('/invoices/' + row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate('/invoices/' + row.id);
                      if (e.key === ' ') { e.preventDefault(); setPreviewId(row.id); }
                    }}
                    style={{
                      borderBottom: `1px solid ${T.border}`,
                      background: isPreview ? T.accentSoft : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ ...tdBase, width: 36 }} onClick={(e) => { e.stopPropagation(); toggleRow(row.id); }}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggleRow(row.id)}
                        onClick={(e) => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={tdBase}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <StatusDot status={rowDisplayStatus(row)} />
                        {isDuplicate(row) && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                            padding: '1px 5px', borderRadius: 3,
                            background: '#FEF3CD', color: '#8B6914', border: '1px solid #F0C040',
                          }}>DUP</span>
                        )}
                        {(row.status === 'PROCESSING' || row.status === 'PENDING') && (
                          <button onClick={(e) => { e.stopPropagation(); void handleCancel(row.id); }}
                            title="Stop this extraction" style={stopBtn}>Stop</button>
                        )}
                      </div>
                    </td>
                    <td style={tdBase}>
                      <div style={{ fontWeight: 600, color: T.accent }}>{row.vendorName ?? '—'}</div>
                      {row.fileName && (
                        <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 2, fontFamily: T.mono }}>
                          {row.fileName}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdBase, color: T.inkSoft }}>{dateFmt(row.invoiceDate)}</td>
                    <td style={tdBase}>
                      {row.extractionProvider || row.provider ? (
                        <div>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px',
                            background: row.pipelineMode === 'single' ? T.accentSoft : '#F3F2EC',
                            border: `1px solid ${row.pipelineMode === 'single' ? '#C5D4E4' : T.border}`,
                            borderRadius: 5, fontSize: 11, fontWeight: 600,
                            color: row.pipelineMode === 'single' ? T.accent : T.inkSoft,
                          }}>
                            {row.pipelineMode === 'single' ? 'Single' : 'Split'}
                          </span>
                          <div style={{ fontSize: 10, color: T.inkFaint, marginTop: 2, fontFamily: T.mono }}>
                            {row.extractionModel ?? row.extractionProvider ?? row.provider ?? '—'}
                          </div>
                        </div>
                      ) : <span style={{ color: T.inkFaint }}>—</span>}
                    </td>
                    <td style={{ ...tdBase, textAlign: 'right', color: T.inkSoft, fontFamily: T.mono }}>
                      {row.itemCount ?? '—'}
                    </td>
                    <td style={{ ...tdBase, textAlign: 'right', fontWeight: 600, fontFamily: T.mono, color: T.ink }}>
                      {money(row.netAmount ?? row.totalAmount, row.currency ?? 'INR')}
                    </td>
                    <td style={{ ...tdBase, textAlign: 'right', fontFamily: T.mono, color: T.inkSoft }}
                      title={
                        row.pipelineMode === 'single'
                          ? `Single call ${costFmt(row.costEstimate)}`
                          : `Extraction ${costFmt(row.extractionCost)} + Structuring ${costFmt(row.structuringCost)}`
                      }
                    >
                      {costFmt(row.costEstimate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* Pagination bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderTop: '1px solid #E4E1D3', fontSize: 13, color: '#67665D',
          }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              Showing page {currentPage} of {totalPages} ({totalRecords.toLocaleString()} records)
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Page size
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); invalidateInvoiceCache(); }}
                  style={{
                    padding: '4px 8px', border: '1px solid #E4E1D3', borderRadius: 4,
                    fontSize: 13, background: '#fff', cursor: 'pointer',
                  }}
                >
                  {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button
                disabled={currentPage <= 1 || loading}
                onClick={() => { setCurrentPage((p) => p - 1); invalidateInvoiceCache(); }}
                style={{
                  padding: '6px 16px', fontSize: 13, fontWeight: 500, borderRadius: 4,
                  border: '1px solid #E4E1D3', background: currentPage <= 1 ? '#f5f5f0' : '#fff',
                  color: currentPage <= 1 ? '#aaa' : '#1B1D19', cursor: currentPage <= 1 ? 'default' : 'pointer',
                }}
              >
                Previous
              </button>
              <button
                disabled={currentPage >= totalPages || loading}
                onClick={() => { setCurrentPage((p) => p + 1); invalidateInvoiceCache(); }}
                style={{
                  padding: '6px 16px', fontSize: 13, fontWeight: 500, borderRadius: 4,
                  border: '1px solid #E4E1D3', background: currentPage >= totalPages ? '#f5f5f0' : '#fff',
                  color: currentPage >= totalPages ? '#aaa' : '#1B1D19', cursor: currentPage >= totalPages ? 'default' : 'pointer',
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <DocumentPreview invoice={previewInvoice} />
      </div>

      {toast && (
        <Toast message={toast} actionLabel="Dismiss" onAction={() => setToast('')} />
      )}
    </div>
  );
}

const thBase: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#67665D',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const tdBase: React.CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'middle',
  color: '#1B1D19',
};

const stopBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #E8B4B0',
  color: '#B3261E',
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  cursor: 'pointer',
};

const bulkBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.2)',
  color: '#fff',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  padding: '5px 12px',
  cursor: 'pointer',
};
