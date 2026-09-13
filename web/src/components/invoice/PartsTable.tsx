import type { PartsLineItem } from '../../types/index.js';
import { amount } from '../../lib/format.js';
import { cn } from '@/lib/utils.js';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table.js';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function taxableMismatch(li: PartsLineItem): boolean {
  const qty = li.quantity;
  const rate = li.rate;
  const taxable = li.taxable_amount;
  if (qty == null || rate == null || taxable == null) return false;
  const expected = roundMoney(qty * rate);
  return Math.abs(taxable - expected) > Math.max(0.05, Math.abs(expected) * 0.02);
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : amount(n);
}

export function PartsTable({ items }: { items: PartsLineItem[] }) {
  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Parts</span>
        <span className="text-xs font-semibold text-faint">{items.length} item{items.length !== 1 ? 's' : ''}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Part number</TableHead>
            <TableHead>HSN</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Taxable</TableHead>
            <TableHead className="text-right">Tax %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">No parts items</TableCell>
            </TableRow>
          ) : items.map((it, i) => {
            const mismatch = taxableMismatch(it);
            return (
              <TableRow key={i}>
                <TableCell>{it.item_name_description ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{it.part_number_item_code ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{it.hsn_sac_code ?? '—'}</TableCell>
                <TableCell className="text-right font-mono">{it.quantity ?? '—'}</TableCell>
                <TableCell className="text-right font-mono">{fmt(it.rate)}</TableCell>
                <TableCell
                  className={cn('text-right font-mono', mismatch && 'text-warning')}
                  title={mismatch ? 'Qty × rate ≠ taxable' : undefined}
                >
                  {fmt(it.taxable_amount)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {it.tax_percentage != null ? `${it.tax_percentage}%` : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
