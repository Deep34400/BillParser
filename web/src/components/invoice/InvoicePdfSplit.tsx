import type { Invoice } from '../../types/index.js';
import { api } from '../../api/client.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { FallbackComparePanel } from './FallbackComparePanel.js';
import { InvoiceFieldGrid } from './InvoiceFieldGrid.js';
import { PartsTable } from './PartsTable.js';
import { LabourTable } from './LabourTable.js';
import { CostBreakdown } from './CostBreakdown.js';
import { OcrCostPanel } from './OcrCostPanel.js';
import { resolveInvoiceData } from './invoiceData.js';
import { buildFinalOcrJson } from './rawOcr.js';

function RawOcrBlock({ rawText, maxHeight }: { rawText: string | null | undefined; maxHeight?: string }) {
  if (!rawText) {
    return <p className="text-sm italic text-muted-foreground">No OCR text</p>;
  }
  return (
    <pre
      className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#1c1a17] p-4 font-mono text-xs leading-relaxed text-[#e8e4dc]"
      style={{ maxHeight }}
    >
      {rawText}
    </pre>
  );
}

export function InvoicePdfSplit({
  inv,
  comparePane,
  setComparePane,
  narrow,
}: {
  inv: Invoice;
  comparePane: 'fields' | 'models' | 'raw';
  setComparePane: (v: 'fields' | 'models' | 'raw') => void;
  narrow: boolean;
}) {
  const pdfUrl = api.fileUrl(inv.id);
  const hasFallbackCompare = (inv.fallbackHistory?.length ?? 0) > 1;
  const tabs = hasFallbackCompare ? (['fields', 'models', 'raw'] as const) : (['fields', 'raw'] as const);
  const data = resolveInvoiceData(inv);

  return (
    <div className={cn('grid items-start gap-4', narrow ? 'grid-cols-1' : 'grid-cols-2')}>
      <div className={cn('overflow-hidden rounded-lg border border-border bg-card', !narrow && 'sticky top-4')}>
        <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Source PDF</span>
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary no-underline hover:underline">
            Open in new tab ↗
          </a>
        </div>
        <iframe
          title="Invoice PDF"
          src={pdfUrl}
          className="block w-full border-0 bg-[#525659]"
          style={{ height: narrow ? '70vh' : 'calc(100vh - 220px)', minHeight: 520 }}
        />
      </div>

      <div>
        <div className="mb-3.5 inline-flex flex-wrap overflow-hidden rounded-lg border border-border">
          {tabs.map((key) => (
            <Button
              key={key}
              variant={comparePane === key ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setComparePane(key)}
            >
              {key === 'fields' ? 'Fields' : key === 'models' ? 'Model compare' : 'Raw OCR'}
              {key === 'models' && (
                <span className={cn(
                  'ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                  comparePane === key ? 'bg-white/25' : 'bg-warning-soft text-warning',
                )}>
                  {inv.fallbackHistory!.length}
                </span>
              )}
            </Button>
          ))}
        </div>

        {comparePane === 'fields' ? (
          <>
            {hasFallbackCompare && (
              <button
                type="button"
                onClick={() => setComparePane('models')}
                className="mb-3 w-full cursor-pointer rounded-lg border border-warning bg-warning-soft px-3.5 py-2.5 text-left"
              >
                <span className="font-bold text-warning">Fallback used</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  See why Primary failed and what Secondary fixed →
                </span>
              </button>
            )}
            <InvoiceFieldGrid inv={inv} />
            <OcrCostPanel inv={inv} />
            {data && (
              <>
                <PartsTable items={data.parts_line_items ?? []} />
                <LabourTable items={data.labour_service_line_items ?? []} />
                <CostBreakdown data={data} inv={inv} />
              </>
            )}
          </>
        ) : comparePane === 'models' && hasFallbackCompare ? (
          <FallbackComparePanel history={inv.fallbackHistory!} compact />
        ) : (
          <RawOcrBlock rawText={buildFinalOcrJson(inv)} maxHeight="calc(100vh - 260px)" />
        )}
      </div>
    </div>
  );
}
