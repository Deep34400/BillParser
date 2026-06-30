import type { Invoice, ParsedInvoiceData, PartsLineItem, LabourServiceLineItem, TotalsAndTaxSummary } from '../types/index.js';
import { enrichInvoiceSummary, columnNet } from '../lib/summaryFromMarkdown.js';
import { T } from '../theme.js';
import { amount } from '../lib/format.js';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sum(nums: (number | null | undefined)[]): number {
  return nums.reduce<number>((a, n) => a + (n ?? 0), 0);
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : amount(n);
}

function enrichFromInvoice(data: ParsedInvoiceData, inv: Invoice): ParsedInvoiceData {
  const enriched = enrichInvoiceSummary(data, inv.rawText);
  const t = enriched.totals_and_tax_summary ?? {};
  if (t.grand_total_invoice == null) t.grand_total_invoice = inv.netAmount ?? inv.totalAmount ?? null;
  return { ...enriched, totals_and_tax_summary: t };
}

function taxableMismatch(li: PartsLineItem): boolean {
  const qty = li.quantity;
  const rate = li.rate;
  const taxable = li.taxable_amount;
  if (qty == null || rate == null || taxable == null) return false;
  const expected = roundMoney(qty * rate);
  return Math.abs(taxable - expected) > Math.max(0.05, Math.abs(expected) * 0.02);
}

function buildFromLineItems(inv: Invoice): ParsedInvoiceData | null {
  const items = inv.lineItems ?? [];
  const parts = items.filter((it) => it.amount != null && it.labourAmount == null);
  const labour = items.filter((it) => it.labourAmount != null);
  if (parts.length === 0 && labour.length === 0) return null;
  const cols = inv.summaryColumns ?? [];
  const partsCol = cols.find((c) => /part/i.test(c.label ?? ''));
  const labourCol = cols.find((c) => /labou?r/i.test(c.label ?? ''));
  return {
    company_name: inv.vendorName,
    gstin: inv.vendorTaxId,
    invoice_number: inv.invoiceNumber,
    parts_line_items: parts.map((it) => ({
      item_name_description: it.description,
      part_number_item_code: it.sku,
      hsn_sac_code: it.hsnSac,
      quantity: it.quantity,
      rate: it.unitPrice,
      taxable_amount: it.amount,
      tax_percentage: it.taxRate,
    })),
    labour_service_line_items: labour.map((it) => ({
      labour_description: it.description,
      labour_code: it.sku,
      hsn_sac_code: it.hsnSac,
      labour_charges: it.labourAmount,
      tax_percentage: it.taxRate,
    })),
    totals_and_tax_summary: {
      parts_total: partsCol?.subtotal ?? (parts.length ? sum(parts.map((p) => p.amount)) : null),
      labour_total: labourCol?.subtotal ?? (labour.length ? sum(labour.map((l) => l.labourAmount)) : null),
      parts_discount: partsCol?.discount ?? null,
      labour_discount: labourCol?.discount ?? null,
      parts_cgst_amount: partsCol?.cgst ?? null,
      parts_sgst_amount: partsCol?.sgst ?? null,
      parts_igst_amount: partsCol?.igst ?? null,
      labour_cgst_amount: labourCol?.cgst ?? null,
      labour_sgst_amount: labourCol?.sgst ?? null,
      labour_igst_amount: labourCol?.igst ?? null,
      sub_total_calculated: inv.subtotal,
      grand_total_invoice: inv.totalAmount ?? inv.netAmount,
    },
  };
}

const thS: React.CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: T.muted,
  letterSpacing: '0.04em', textTransform: 'uppercase', background: T.rail, borderBottom: `1px solid ${T.border}`,
};
const tdS: React.CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: T.text, borderBottom: `1px solid ${T.border}`, verticalAlign: 'middle',
};
const numS: React.CSSProperties = { ...tdS, textAlign: 'right', fontFamily: T.mono };

function SectionHeader({ title, count, hideCount }: { title: string; count?: number; hideCount?: boolean }) {
  return (
    <div style={{
      padding: '10px 16px', borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700,
      color: T.muted, letterSpacing: '0.06em', textTransform: 'uppercase', background: T.rail,
      display: 'flex', justifyContent: 'space-between',
    }}>
      <span>{title}</span>
      {!hideCount && count != null && (
        <span style={{ fontWeight: 600, color: T.faint }}>{count} item{count !== 1 ? 's' : ''}</span>
      )}
    </div>
  );
}

function PartsTable({ items }: { items: PartsLineItem[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
      <thead>
        <tr>
          <th style={thS}>Description</th>
          <th style={thS}>Part no.</th>
          <th style={thS}>HSN/SAC</th>
          <th style={{ ...thS, textAlign: 'right' }}>Qty</th>
          <th style={{ ...thS, textAlign: 'right' }}>Rate</th>
          <th style={{ ...thS, textAlign: 'right' }}>Taxable</th>
          <th style={{ ...thS, textAlign: 'right' }}>Tax %</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr><td colSpan={7} style={{ ...tdS, textAlign: 'center', color: T.muted }}>No parts items</td></tr>
        ) : items.map((it, i) => {
          const mismatch = taxableMismatch(it);
          return (
            <tr key={i}>
              <td style={tdS}>{it.item_name_description ?? '—'}</td>
              <td style={{ ...tdS, fontFamily: T.mono, color: T.muted }}>{it.part_number_item_code ?? '—'}</td>
              <td style={{ ...tdS, fontFamily: T.mono, color: T.muted }}>{it.hsn_sac_code ?? '—'}</td>
              <td style={numS}>{it.quantity ?? '—'}</td>
              <td style={numS}>{fmt(it.rate)}</td>
              <td style={{ ...numS, color: mismatch ? T.amber : T.text }} title={mismatch ? 'Qty × rate ≠ taxable' : undefined}>
                {fmt(it.taxable_amount)}
              </td>
              <td style={numS}>{it.tax_percentage != null ? `${it.tax_percentage}%` : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LabourTable({ items }: { items: LabourServiceLineItem[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
      <thead>
        <tr>
          <th style={thS}>Description</th>
          <th style={thS}>Labour code</th>
          <th style={thS}>HSN/SAC</th>
          <th style={{ ...thS, textAlign: 'right' }}>Labour charges</th>
          <th style={{ ...thS, textAlign: 'right' }}>Tax %</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr><td colSpan={5} style={{ ...tdS, textAlign: 'center', color: T.muted }}>No labour items</td></tr>
        ) : items.map((it, i) => (
          <tr key={i}>
            <td style={tdS}>{it.labour_description ?? '—'}</td>
            <td style={{ ...tdS, fontFamily: T.mono, color: T.muted }}>{it.labour_code ?? '—'}</td>
            <td style={{ ...tdS, fontFamily: T.mono, color: T.muted }}>{it.hsn_sac_code ?? '—'}</td>
            <td style={numS}>{fmt(it.labour_charges)}</td>
            <td style={numS}>{it.tax_percentage != null ? `${it.tax_percentage}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function colNet(t: TotalsAndTaxSummary, side: 'parts' | 'labour'): number | null {
  return columnNet(t, side);
}

function gstRowLabel(kind: 'CGST' | 'SGST' | 'IGST', partsRate?: number | null, labourRate?: number | null): string {
  if (partsRate != null && labourRate != null && partsRate !== labourRate) {
    return `${kind} (Parts ${partsRate}% / Labour ${labourRate}%)`;
  }
  const rate = partsRate ?? labourRate;
  return rate != null ? `${kind} @ ${rate}%` : kind;
}

function BillSummaryTable({ data, inv }: { data: ParsedInvoiceData; inv: Invoice }) {
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

  type Row = { label: string; parts?: number | null; labour?: number | null; isPct?: boolean };
  const labourZero = t.labour_total === 0;
  const rows: Row[] = [{ label: 'Sub Total', parts: partsTotal, labour: labourTotal }];

  // Always show discount row when Parts + Labour columns exist.
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
        parts: t.parts_igst_amount, labour: t.labour_igst_amount,
      });
    } else {
      rows.push(
        { label: gstRowLabel('CGST', t.parts_cgst_rate, t.labour_cgst_rate), parts: t.parts_cgst_amount, labour: t.labour_cgst_amount ?? (labourZero ? 0 : null) },
        { label: gstRowLabel('SGST', t.parts_sgst_rate, t.labour_sgst_rate), parts: t.parts_sgst_amount, labour: t.labour_sgst_amount ?? (labourZero ? 0 : null) },
      );
    }
  }

  rows.push({ label: 'Sub Total (after discount & tax)', parts: colNet(t, 'parts'), labour: colNet(t, 'labour') });

  const labelCell: React.CSSProperties = { padding: '8px 16px', fontSize: 13, textAlign: 'left', color: T.muted, borderBottom: `1px solid ${T.border}` };
  const cell: React.CSSProperties = { padding: '8px 16px', fontSize: 13, textAlign: 'right', fontFamily: T.mono, color: T.text, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' };

  return (
    <div style={{ overflowX: 'auto', padding: '4px 0 12px' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 420, marginLeft: 'auto' }}>
        <thead>
          <tr>
            <th style={{ ...labelCell, fontWeight: 600, background: T.rail }} />
            {hasPartsCol && <th style={{ ...cell, fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: '0.04em', textTransform: 'uppercase', background: T.rail }}>Parts</th>}
            {hasLabourCol && <th style={{ ...cell, fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: '0.04em', textTransform: 'uppercase', background: T.rail }}>Labour</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isLastSub = i === rows.length - 1;
            return (
              <tr key={`${r.label}-${i}`}>
                <td style={{ ...labelCell, fontWeight: isLastSub ? 600 : 400, color: isLastSub ? T.text : T.muted }}>{r.label}</td>
                {hasPartsCol && (
                  <td style={{ ...cell, fontWeight: isLastSub ? 600 : 400 }}>{fmt(r.parts)}</td>
                )}
                {hasLabourCol && (
                  <td style={{ ...cell, fontWeight: isLastSub ? 600 : 400 }}>{fmt(r.labour)}</td>
                )}
              </tr>
            );
          })}
          {(t.deductibles != null || t.salvage != null) && (
            <tr>
              <td style={{ ...labelCell, color: T.muted }}>Adjustments</td>
              {hasPartsCol && <td style={cell}>—</td>}
              {hasLabourCol && <td style={cell}>—</td>}
            </tr>
          )}
          {t.deductibles != null && t.deductibles !== 0 && (
            <tr>
              <td style={labelCell}>Deductibles</td>
              <td colSpan={(hasPartsCol ? 1 : 0) + (hasLabourCol ? 1 : 0)} style={{ ...cell, textAlign: 'right' }}>{fmt(t.deductibles)}</td>
            </tr>
          )}
          {t.salvage != null && t.salvage !== 0 && (
            <tr>
              <td style={labelCell}>Salvage</td>
              <td colSpan={(hasPartsCol ? 1 : 0) + (hasLabourCol ? 1 : 0)} style={{ ...cell, textAlign: 'right' }}>{fmt(t.salvage)}</td>
            </tr>
          )}
          {t.grand_total_invoice != null && (
            <tr>
              <td style={{ ...labelCell, fontWeight: 700, color: T.text, borderTop: `2px solid ${T.border}`, borderBottom: 'none', paddingTop: 12 }}>
                Net Bill Amount (Rounded)
              </td>
              <td
                colSpan={(hasPartsCol ? 1 : 0) + (hasLabourCol ? 1 : 0)}
                style={{ ...cell, fontSize: 15, fontWeight: 700, color: T.accent, borderTop: `2px solid ${T.border}`, borderBottom: 'none', paddingTop: 12 }}
              >
                {fmt(t.grand_total_invoice)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function InvoiceBreakdown({ inv }: { inv: Invoice; currency?: string }) {
  const raw = inv.parsedData ?? buildFromLineItems(inv);
  if (!raw) return null;
  const data = enrichFromInvoice(raw, inv);
  const parts = data.parts_line_items ?? [];
  const labour = data.labour_service_line_items ?? [];
  const vehicle = data.vehicle_details;
  const service = data.service_details;

  return (
    <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(vehicle?.registration_number || service?.service_type) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {vehicle?.registration_number && (
            <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: T.rail, border: `1px solid ${T.border}` }}>
              Reg: {vehicle.registration_number}
            </span>
          )}
          {vehicle?.chassis_number && (
            <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: T.rail, border: `1px solid ${T.border}` }}>
              Chassis: {vehicle.chassis_number}
            </span>
          )}
          {vehicle?.mileage_odometer_reading != null && (
            <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: T.rail, border: `1px solid ${T.border}` }}>
              Odometer: {vehicle.mileage_odometer_reading}
            </span>
          )}
          {service?.service_type && (
            <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: T.rail, border: `1px solid ${T.border}` }}>
              Service: {service.service_type}
            </span>
          )}
        </div>
      )}

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <SectionHeader title="Parts" count={parts.length} />
        <PartsTable items={parts} />
      </div>

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <SectionHeader title="Labour / service" count={labour.length} />
        <LabourTable items={labour} />
      </div>

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <SectionHeader title="Bill summary" hideCount />
        <BillSummaryTable data={data} inv={inv} />
      </div>
    </div>
  );
}
