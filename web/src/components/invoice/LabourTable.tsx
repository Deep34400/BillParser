import type { LabourServiceLineItem } from '../../types/index.js';
import { amount } from '../../lib/format.js';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table.js';

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : amount(n);
}

export function LabourTable({ items }: { items: LabourServiceLineItem[] }) {
  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Labour / service</span>
        <span className="text-xs font-semibold text-faint">{items.length} item{items.length !== 1 ? 's' : ''}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>HSN</TableHead>
            <TableHead className="text-right">Charges</TableHead>
            <TableHead className="text-right">Tax %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">No labour items</TableCell>
            </TableRow>
          ) : items.map((it, i) => (
            <TableRow key={i}>
              <TableCell>{it.labour_description ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{it.labour_code ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{it.hsn_sac_code ?? '—'}</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.labour_charges)}</TableCell>
              <TableCell className="text-right font-mono">
                {it.tax_percentage != null ? `${it.tax_percentage}%` : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
