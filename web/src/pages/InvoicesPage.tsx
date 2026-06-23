import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import type { Invoice, Batch } from '../types.js';
import { T } from '../theme.js';
import { money, dateFmt, costFmt } from '../format.js';
import { StatusDot } from '../components/StatusDot.js';
import { ConfidenceBar } from '../components/ConfidenceBar.js';
import { Toast } from '../components/Toast.js';
import { usePolling } from '../hooks/usePolling.js';

type SortKey = 'status' | 'vendorName' | 'invoiceDate' | 'confidence' | 'totalAmount';
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

function applyClientFilters(invoices: Invoice[], statusFilter: StatusFilter): Invoice[] {
  if (statusFilter === 'ALL') return invoices;
  if (statusFilter === 'NEEDS_REVIEW') {
    return invoices.filter(
      (inv) => inv.status === 'COMPLETED' && (inv.confidence ?? 1) < 0.75 && !inv.verified,
    );
  }
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
    else if (inv.status === 'COMPLETED') counts.COMPLETED++;
    else if (inv.status === 'FAILED') counts.FAILED++;
    if (inv.status === 'COMPLETED' && (inv.confidence ?? 1) < 0.75 && !inv.verified) {
      counts.NEEDS_REVIEW++;
    }
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

const SORT_COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'status', label: 'Status' },
  { key: 'vendorName', label: 'Vendor' },
  { key: 'invoiceDate', label: 'Date' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'totalAmount', label: 'Total', align: 'right' },
];

export function InvoicesPage() {
  const navigate = useNavigate();

  // Data state
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter / sort state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState<SortKey>('invoiceDate');
  const [dir, setDir] = useState<SortDir>('desc');
  const [minTotal, setMinTotal] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchFilter, setBatchFilter] = useState('');
  const [batchName, setBatchName] = useState('');

  // UI toggle state
  const [showFilters, setShowFilters] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Toast / banner state
  const [toast, setToast] = useState('');
  const [duplicateBanner, setDuplicateBanner] = useState<{ count: number } | null>(null);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch all invoices (for count display and display)
  const fetchAll = useCallback(async () => {
    try {
      const [inv, bat] = await Promise.all([api.list(''), api.batches().catch(() => ({ batches: [] }))]);
      setAllInvoices(inv.invoices);
      setBatches(bat.batches);
    } catch (_e) {
      // silently ignore for counts
    }
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      await fetchAll();
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  // Initial load
  useEffect(() => {
    void refetch();
  }, [refetch]);

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
      if (!isNaN(min)) rows = rows.filter((inv) => (inv.totalAmount ?? 0) >= min);
    }
    if (dateFrom) {
      rows = rows.filter((inv) => !!inv.invoiceDate && inv.invoiceDate >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((inv) => !!inv.invoiceDate && inv.invoiceDate <= dateTo);
    }

    // Sort
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
          av = a.totalAmount ?? 0;
          bv = b.totalAmount ?? 0;
          break;
      }
      if (av === null || av === undefined) av = '';
      if (bv === null || bv === undefined) bv = '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });

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
      await refetch();
    } catch (e) {
      setToast('Error: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  // Export CSV helper
  function exportCsv(path: string) {
    const qs = buildQs({ q: q || undefined, minTotal: minTotal || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
    window.open(path + qs, '_blank');
  }

  // Upload handler
  async function handleFiles(files: FileList | File[]) {
    const pdfs = filterPdfs(files);
    if (pdfs.length === 0) {
      setToast('No PDF files selected');
      return;
    }
    try {
      const result = await api.upload(pdfs, batchName.trim() || undefined);
      const created = result?.created?.length ?? 0;
      const dupes = result?.duplicates?.length ?? 0;
      const rejected = result?.rejected?.length ?? 0;
      if (dupes > 0) setDuplicateBanner({ count: dupes });
      await refetch();
      setToast(
        `Uploaded ${created} file${created === 1 ? '' : 's'}${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}${rejected ? `, ${rejected} rejected` : ''}`,
      );
      setShowUpload(false);
      setBatchName('');
    } catch (e) {
      setToast('Upload failed: ' + (e instanceof Error ? e.message : 'unknown'));
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

  // Skeleton rows for loading state
  const skeletonRows = Array.from({ length: 5 });

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: T.font }}>
      {/* Duplicate banner */}
      {duplicateBanner && (
        <div
          style={{
            background: '#fbf4e6',
            borderBottom: `1px solid #e8d99a`,
            padding: '10px 30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            color: T.amber,
            fontWeight: 500,
          }}
        >
          <span>
            {duplicateBanner.count} duplicate{duplicateBanner.count !== 1 ? 's' : ''} skipped — these files were already uploaded.
          </span>
          <button
            onClick={() => setDuplicateBanner(null)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: T.amber,
              fontWeight: 700,
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Header bar */}
      <div
        style={{
          padding: '24px 30px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: T.panel,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        {/* Left: title + count */}
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>
            Invoices
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>
            {loading && allInvoices.length === 0
              ? 'Loading…'
              : `${displayedRows.length} invoice${displayedRows.length !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* Right: controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Search */}
          <input
            type="text"
            placeholder="Search vendor, invoice #, file…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              width: 288,
              padding: '7px 12px',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              fontSize: 13,
              fontFamily: T.font,
              color: T.text,
              background: T.rail,
              outline: 'none',
            }}
          />

          {/* Batch filter */}
          <select
            aria-label="Filter by batch"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${T.border}`, borderRadius: 7, fontSize: 13, fontFamily: T.font, color: T.text, background: T.rail, outline: 'none', maxWidth: 200 }}
          >
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          {/* Filters toggle */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            style={{
              padding: '7px 14px',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              background: showFilters ? T.accentSoft : T.panel,
              color: showFilters ? T.accent : T.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: T.font,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            Filters
            {hasAdvancedFilters && (
              <span
                style={{
                  background: T.accent,
                  color: '#fff',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '1px 6px',
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {[minTotal, dateFrom, dateTo].filter(Boolean).length}
              </span>
            )}
          </button>

          {/* Export CSV */}
          <button
            onClick={() => exportCsv('/api/invoices/export/csv')}
            style={{
              padding: '7px 14px',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              background: T.panel,
              color: T.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: T.font,
            }}
          >
            Export CSV
          </button>

          {/* Items CSV */}
          <button
            onClick={() => exportCsv('/api/invoices/export/line-items.csv')}
            style={{
              padding: '7px 14px',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              background: T.panel,
              color: T.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: T.font,
            }}
          >
            Items CSV
          </button>

          {/* Upload bills */}
          <button
            onClick={() => setShowUpload((v) => !v)}
            style={{
              padding: '7px 14px',
              border: 'none',
              borderRadius: 7,
              background: showUpload ? T.accentHover : T.accent,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: T.font,
            }}
          >
            Upload bills
          </button>
        </div>
      </div>

      {/* Advanced filters panel */}
      {showFilters && (
        <div
          style={{
            margin: '12px 30px 0',
            padding: '16px 20px',
            background: T.rail,
            border: `1px solid ${T.border}`,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4 }}>
              MIN TOTAL ($)
            </div>
            <input
              type="number"
              placeholder="0"
              value={minTotal}
              onChange={(e) => setMinTotal(e.target.value)}
              style={{
                padding: '6px 10px',
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                fontSize: 13,
                fontFamily: T.font,
                color: T.text,
                background: T.panel,
                width: 120,
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4 }}>
              ISSUED FROM
            </div>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                padding: '6px 10px',
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                fontSize: 13,
                fontFamily: T.font,
                color: T.text,
                background: T.panel,
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4 }}>
              ISSUED TO
            </div>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                padding: '6px 10px',
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                fontSize: 13,
                fontFamily: T.font,
                color: T.text,
                background: T.panel,
              }}
            />
          </div>
          <button
            onClick={() => {
              setMinTotal('');
              setDateFrom('');
              setDateTo('');
            }}
            style={{
              padding: '7px 14px',
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              background: T.panel,
              color: T.muted,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: T.font,
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Upload drop zone */}
      {showUpload && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          style={{
            margin: '12px 30px 0',
            padding: '32px 24px',
            border: `2px dashed ${dragging ? T.accent : T.border}`,
            borderRadius: 10,
            background: dragging ? T.accentSoft : T.panel,
            textAlign: 'center',
            transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 6 }}>
            Drop PDF invoices here
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 16 }}>
            or browse to select files
          </div>
          <input
            type="text"
            aria-label="Batch name"
            placeholder="Batch name (optional)"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            style={{ display: 'block', margin: '0 auto 14px', maxWidth: 280, width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 7, fontSize: 13, fontFamily: T.font, color: T.text, background: T.rail, outline: 'none' }}
          />
          <label
            style={{
              display: 'inline-block',
              padding: '8px 20px',
              background: T.accent,
              color: '#fff',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Browse files
            <input
              type="file"
              multiple
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const input = e.currentTarget;
                if (input.files && input.files.length > 0) {
                  void handleFiles(input.files);
                }
                // reset so selecting the same file again still fires onChange
                input.value = '';
              }}
            />
          </label>
        </div>
      )}

      {/* Status filter pill row */}
      <div
        style={{
          padding: '12px 30px 0',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {STATUS_PILLS.map(({ key, label }) => {
          const active = statusFilter === key;
          const count = counts[key];
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              style={{
                padding: '5px 14px',
                borderRadius: 20,
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? T.accentSoft : T.panel,
                color: active ? T.accent : T.muted,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                fontFamily: T.font,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.12s',
              }}
            >
              {label}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: active ? T.accent : T.faint,
                  background: active ? '#d8d4ff' : '#f0ede8',
                  borderRadius: 10,
                  padding: '1px 7px',
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Batch progress banner */}
      {batchFilter && (() => {
        const b = batches.find((x) => x.id === batchFilter);
        if (!b) return null;
        const pct = b.total ? Math.round((b.completed / b.total) * 100) : 0;
        return (
          <div style={{ margin: '12px 30px 0', padding: '12px 16px', background: T.rail, border: `1px solid ${T.border}`, borderRadius: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 8 }}>
              <span>{b.name}</span>
              <span style={{ color: T.muted, fontWeight: 500 }}>
                {b.completed}/{b.total} done{b.failed ? ` · ${b.failed} failed` : ''}{b.processing ? ` · ${b.processing} in progress` : ''}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#e8e3da', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: T.accent, transition: 'width 0.3s' }} />
            </div>
          </div>
        );
      })()}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          style={{
            margin: '12px 30px 0',
            padding: '10px 16px',
            background: '#1f1b30',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <button
            onClick={() => void handleBulkReextract()}
            style={bulkBtn}
          >
            Re-extract
          </button>
          <button
            onClick={() => exportCsv('/api/invoices/export/csv')}
            style={bulkBtn}
          >
            Export CSV
          </button>
          <button
            onClick={() => void handleBulkDelete()}
            style={{ ...bulkBtn, color: '#ff8080' }}
          >
            Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ ...bulkBtn, marginLeft: 'auto' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Main content area */}
      <div style={{ padding: '16px 30px 40px' }}>
        {/* Table */}
        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              fontFamily: T.font,
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.rail }}>
                <th style={thBase}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isPartialSelected;
                    }}
                    onChange={toggleAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                {/* Status */}
                <th
                  style={{ ...thBase, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('status')}
                >
                  Status {sort === 'status' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                {/* Vendor */}
                <th
                  style={{ ...thBase, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('vendorName')}
                >
                  Vendor {sort === 'vendorName' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                {/* Invoice # */}
                <th style={thBase}>Invoice #</th>
                {/* Date */}
                <th
                  style={{ ...thBase, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('invoiceDate')}
                >
                  Date {sort === 'invoiceDate' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                {/* Provider */}
                <th style={thBase}>Provider</th>
                {/* Confidence */}
                <th
                  style={{ ...thBase, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('confidence')}
                >
                  Confidence {sort === 'confidence' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                {/* Items */}
                <th style={{ ...thBase, textAlign: 'right' }}>Items</th>
                {/* Total */}
                <th
                  style={{ ...thBase, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('totalAmount')}
                >
                  Total {sort === 'totalAmount' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </th>
                {/* Cost */}
                <th style={{ ...thBase, textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {/* Loading skeleton */}
              {loading && allInvoices.length === 0 &&
                skeletonRows.map((_, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={tdBase} />
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} style={tdBase}>
                        <div
                          style={{
                            height: 14,
                            borderRadius: 4,
                            background: '#ede9e2',
                            width: j === 1 ? '70%' : j === 7 ? '50%' : '60%',
                            animation: 'shimmer 1.4s ease-in-out infinite',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

              {/* Empty states */}
              {!loading && displayedRows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '60px 24px' }}>
                    {allInvoices.length === 0 && !hasSearch && !hasAdvancedFilters && statusFilter === 'ALL' ? (
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 8 }}>
                          No invoices yet
                        </div>
                        <div style={{ fontSize: 13, color: T.muted, marginBottom: 20 }}>
                          Upload your first invoice to get started.
                        </div>
                        <button
                          onClick={() => setShowUpload(true)}
                          style={{
                            padding: '9px 20px',
                            background: T.accent,
                            color: '#fff',
                            border: 'none',
                            borderRadius: 7,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: T.font,
                          }}
                        >
                          Upload bills
                        </button>
                      </div>
                    ) : (
                      <div style={{ color: T.muted, fontSize: 13 }}>
                        No invoices match your search or filter.
                      </div>
                    )}
                  </td>
                </tr>
              )}

              {/* Data rows */}
              {displayedRows.map((row) => {
                const isSelected = selected.has(row.id);
                return (
                  <tr
                    key={row.id}
                    onClick={() => navigate('/invoices/' + row.id)}
                    style={{
                      borderBottom: `1px solid ${T.border}`,
                      background: isSelected ? T.accentSoft : undefined,
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = '#fbf8f3';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = '';
                    }}
                  >
                    {/* Checkbox */}
                    <td
                      style={{ ...tdBase, width: 40 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRow(row.id);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(row.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>

                    {/* Status */}
                    <td style={tdBase}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <StatusDot status={row.status} />
                        {(row.status === 'PROCESSING' || row.status === 'PENDING') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCancel(row.id);
                            }}
                            title="Stop this extraction"
                            style={stopBtn}
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Vendor */}
                    <td style={tdBase}>
                      <div style={{ fontWeight: 600, color: T.text }}>
                        {row.vendorName ?? '—'}
                      </div>
                      {(row.fileName || row.vendorAddress) && (
                        <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>
                          {row.fileName || row.vendorAddress}
                        </div>
                      )}
                      {row.batch && (
                        <span style={{ display: 'inline-block', marginTop: 4, padding: '1px 7px', background: T.accentSoft, color: T.accent, borderRadius: 5, fontSize: 10, fontWeight: 600 }}>
                          {row.batch.name}
                        </span>
                      )}
                    </td>

                    {/* Invoice # */}
                    <td style={{ ...tdBase, fontFamily: T.mono, color: T.muted }}>
                      {row.invoiceNumber ?? '—'}
                    </td>

                    {/* Date */}
                    <td style={tdBase}>{dateFmt(row.invoiceDate)}</td>

                    {/* Provider */}
                    <td style={tdBase}>
                      {row.provider ? (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            background: T.rail,
                            border: `1px solid ${T.border}`,
                            borderRadius: 5,
                            fontSize: 11,
                            fontWeight: 500,
                            color: T.muted,
                          }}
                        >
                          {row.provider}
                        </span>
                      ) : (
                        <span style={{ color: T.faint }}>—</span>
                      )}
                    </td>

                    {/* Confidence */}
                    <td style={tdBase}>
                      <ConfidenceBar value={row.confidence} verified={row.verified} />
                    </td>

                    {/* Items */}
                    <td style={{ ...tdBase, textAlign: 'right', color: T.muted }}>
                      {row.itemCount ?? '—'}
                    </td>

                    {/* Total */}
                    <td style={{ ...tdBase, textAlign: 'right', fontWeight: 600, color: T.text }}>
                      {money(row.totalAmount, row.currency ?? 'USD')}
                    </td>

                    {/* Cost (total; hover for the extraction/structuring split) */}
                    <td
                      style={{ ...tdBase, textAlign: 'right', color: row.costEstimate ? T.text : T.green, fontWeight: 500 }}
                      title={`Extraction ${costFmt(row.extractionCost)} + Structuring ${costFmt(row.structuringCost)}`}
                    >
                      {costFmt(row.costEstimate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast}
          actionLabel="Dismiss"
          onAction={() => setToast('')}
        />
      )}

      {/* Shimmer keyframes (injected inline via style tag trick) */}
      <style>{`@keyframes shimmer{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

// Style constants
const thBase: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#8d877c',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const tdBase: React.CSSProperties = {
  padding: '11px 14px',
  verticalAlign: 'middle',
  color: '#1c1a17',
};

const stopBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #e0b4b4',
  color: '#c0392b',
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  cursor: 'pointer',
  lineHeight: 1.4,
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
