import { useState } from 'react';
import type { Invoice, ParsedInvoiceData } from '../../types/index.js';
import { cn } from '@/lib/utils.js';
import { columnNet } from '../../lib/summaryFromMarkdown.js';
import { amount } from '../../lib/format.js';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardHeader } from '@/components/ui/card.js';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table.js';

function sum(nums: (number | null | undefined)[]): number {
  return nums.reduce<number>((a, n) => a + (n ?? 0), 0);
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : amount(n);
}

function gstRowLabel(kind: 'CGST' | 'SGST' | 'IGST', partsRate?: number | null, labourRate?: number | null): string {
  if (partsRate != null && labourRate != null && partsRate !== labourRate) {
    return `${kind} (Parts ${partsRate}% / Labour ${labourRate}%)`;
  }
  const rate = partsRate ?? labourRate;
  return rate != null ? `${kind} @ ${rate}%` : kind;
}

interface CostBreakdownProps {
  data: ParsedInvoiceData;
  inv: Invoice;
}

export function CostBreakdown({ data, inv }: CostBreakdownProps) {
  const [showExtras, setShowExtras] = useState(false);
  const t = data.totals_and_tax_summary;
  if (!t) return null;

  const parts = data.parts_line_items ?? [];
  const labour = data.labour_service_line_items ?? [];
  const partsTotal = t.parts_total ?? (parts.length ? sum(parts.map((p) => p.taxable_amount)) : null);
  const labourTotal = t.labour_total ?? (labour.length ? sum(labour.map((l) => l.labour_charges)) : 0);
  const hasPartsCol = partsTotal != null || t.parts_discount != null || t.parts_cgst_amount != null;
  const hasLabourCol = hasPartsCol || labourTotal != null || t.labour_discount != null || t.labour_cgst_amount != null;
  if (!hasPartsCol && !hasLabourCol) return null;

  const hasIgst = (t.parts_igst_amount ?? 0) !== 0 || (t.labour_igst_amount ?? 0) !== 0
    || (t.parts_igst_rate ?? 0) > 0 || (t.labour_igst_rate ?? 0) > 0;
  const showGst = hasIgst || t.parts_cgst_rate != null || t.labour_cgst_rate != null
    || t.parts_cgst_amount != null || t.labour_cgst_amount != null || !!inv.vendorTaxId;

  type Row = { label: string; parts?: number | null; labour?: number | null };
  const labourZero = t.labour_total === 0;
  const rows: Row[] = [{ label: 'Sub Total', parts: partsTotal, labour: labourTotal }];

  rows.push({
    label: 'Less Discount',
    parts: t.parts_discount,
    labour: t.labour_discount ?? (labourZero ? 0 : null),
  });

  if ((t.parts_special_discount ?? 0) > 0 || (t.labour_special_discount ?? 0) > 0) {
    rows.push({
      label: 'Less Special Discount',
      parts: t.parts_special_discount,
      labour: t.labour_special_discount ?? (labourZero ? 0 : null),
    });
  }

  if (showGst) {
    if (t.gst_breakdown?.length) {
      for (const g of t.gst_breakdown) {
        rows.push({
          label: g.rate != null ? `${g.kind} @ ${g.rate}%` : g.kind,
          parts: g.parts,
          labour: g.labour ?? (labourZero ? 0 : null),
        });
      }
    } else if (hasIgst) {
      rows.push({
        label: gstRowLabel('IGST', t.parts_igst_rate, t.labour_igst_rate),
        parts: t.parts_igst_amount,
        labour: t.labour_igst_amount,
      });
    } else {
      rows.push(
        { label: gstRowLabel('CGST', t.parts_cgst_rate, t.labour_cgst_rate), parts: t.parts_cgst_amount, labour: t.labour_cgst_amount ?? (labourZero ? 0 : null) },
        { label: gstRowLabel('SGST', t.parts_sgst_rate, t.labour_sgst_rate), parts: t.parts_sgst_amount, labour: t.labour_sgst_amount ?? (labourZero ? 0 : null) },
      );
    }
  }

  rows.push({ label: 'Sub Total (after discount & tax)', parts: columnNet(t, 'parts'), labour: columnNet(t, 'labour') });

  const hasDeductibles = t.deductibles != null && t.deductibles !== 0;
  const hasSalvage = t.salvage != null && t.salvage !== 0;
  const hasExtras = hasDeductibles || hasSalvage;
  const colSpan = (hasPartsCol ? 1 : 0) + (hasLabourCol ? 1 : 0);

  return (
    <Card className="mb-5">
      <CardHeader className="border-b border-border bg-muted px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Bill summary (GST)</span>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                {hasPartsCol && <TableHead className="text-right text-[10px] uppercase">Parts</TableHead>}
                {hasLabourCol && <TableHead className="text-right text-[10px] uppercase">Labour</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const isLastSub = i === rows.length - 1;
                return (
                  <TableRow key={`${r.label}-${i}`}>
                    <TableCell className={isLastSub ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                      {r.label}
                    </TableCell>
                    {hasPartsCol && (
                      <TableCell className={cellClass(isLastSub)}>{fmt(r.parts)}</TableCell>
                    )}
                    {hasLabourCol && (
                      <TableCell className={cellClass(isLastSub)}>{fmt(r.labour)}</TableCell>
                    )}
                  </TableRow>
                );
              })}
              {hasExtras && showExtras && (
                <>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Adjustments</TableCell>
                    {hasPartsCol && <TableCell className="text-right font-mono">—</TableCell>}
                    {hasLabourCol && <TableCell className="text-right font-mono">—</TableCell>}
                  </TableRow>
                  {hasDeductibles && (
                    <TableRow>
                      <TableCell>Deductibles</TableCell>
                      <TableCell colSpan={colSpan} className="text-right font-mono">{fmt(t.deductibles)}</TableCell>
                    </TableRow>
                  )}
                  {hasSalvage && (
                    <TableRow>
                      <TableCell>Salvage</TableCell>
                      <TableCell colSpan={colSpan} className="text-right font-mono">{fmt(t.salvage)}</TableCell>
                    </TableRow>
                  )}
                </>
              )}
              {t.grand_total_invoice != null && (
                <TableRow className="border-t-2">
                  <TableCell className="pt-3 font-bold">Net Bill Amount (Rounded)</TableCell>
                  <TableCell colSpan={colSpan} className="pt-3 text-right font-mono text-base font-bold text-primary">
                    {fmt(t.grand_total_invoice)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {hasExtras && (
          <div className="px-4 pb-3 text-right">
            <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => setShowExtras((v) => !v)}>
              {showExtras ? 'Hide deductibles / salvage' : 'Show deductibles / salvage'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function cellClass(bold: boolean) {
  return cn('text-right font-mono', bold && 'font-semibold');
}
