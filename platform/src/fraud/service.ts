/**
 * Fraud Detection Service — business logic only.
 * All data comes through repository.ts. No direct Firestore access.
 */
import { fetchCompletedBills, fetchAllParts, type BillDoc, type BillPartDoc } from './repository.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FraudAlert {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  bill_ids: string[];
  details: Record<string, unknown>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sum(...vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Check if expected GST matches actual within tolerance (max ₹1 or 1%).
 */
function gstCloseEnough(taxable: number, rate: number, actual: number): boolean {
  const expected = round2(taxable * rate / 100);
  return Math.abs(expected - actual) <= Math.max(1, expected * 0.01);
}

/**
 * Validate GST for one side (parts or labour) of a bill.
 *
 * Indian invoices use two conventions for parts_total / labour_total:
 *   Style A — already post-discount (Toyota) → GST = amount × rate
 *   Style B — pre-discount line sum (Maruti)  → GST = (amount − discount) × rate
 *
 * We accept either. Alert only when neither matches.
 */
function checkGstSide(
  label: string,
  amount: number | null,
  discount: number,
  rate: number,
  gstActual: number | null,
  cgstRate: number | null,
  sgstRate: number | null,
  cgstAmount: number | null,
  sgstAmount: number | null,
): string[] {
  if (amount == null || gstActual == null || rate <= 0) return [];

  const issues: string[] = [];

  // Check 1: CGST must equal SGST (intra-state only)
  if (cgstRate != null && sgstRate != null && Math.abs(cgstRate - sgstRate) > 0.01) {
    issues.push(`${label}: CGST rate (${cgstRate}%) ≠ SGST rate (${sgstRate}%)`);
  }
  if (cgstAmount != null && sgstAmount != null && Math.abs(cgstAmount - sgstAmount) > 1) {
    issues.push(`${label}: CGST amount (₹${cgstAmount}) ≠ SGST amount (₹${sgstAmount})`);
  }

  // Check 2: GST amount matches taxable × rate (accept either convention)
  const styleA = gstCloseEnough(amount, rate, gstActual);
  const styleB = discount > 0 && gstCloseEnough(amount - discount, rate, gstActual);

  if (!styleA && !styleB) {
    const taxable = discount > 0 ? round2(amount - discount) : amount;
    const expected = round2(taxable * rate / 100);
    issues.push(`${label}: GST expected ₹${expected} (₹${round2(taxable)} × ${rate}%), got ₹${round2(gstActual)}`);
  }

  return issues;
}

// ─── Detection Functions ────────────────────────────────────────────────────

export async function detectDuplicateInvoices(): Promise<FraudAlert[]> {
  const bills = await fetchCompletedBills();
  const alerts: FraudAlert[] = [];
  const seen = new Map<string, BillDoc[]>();

  for (const bill of bills) {
    if (!bill.invoice_number) continue;
    const key = `${bill.invoice_number}__${bill.vendor_gstin ?? ''}`;
    const group = seen.get(key) ?? [];
    group.push(bill);
    seen.set(key, group);
  }

  for (const [, group] of seen) {
    if (group.length > 1) {
      alerts.push({
        type: 'DUPLICATE_INVOICE',
        severity: 'HIGH',
        message: `Duplicate invoice: ${group[0].invoice_number} from ${group[0].vendor_name ?? 'Unknown'}`,
        bill_ids: group.map((b) => b.bill_id),
        details: {
          invoice_number: group[0].invoice_number,
          vendor: group[0].vendor_name,
          count: group.length,
          amounts: group.map((b) => b.grand_total_amount),
        },
      });
    }
  }

  return alerts;
}

export async function detectGstAnomalies(): Promise<FraudAlert[]> {
  const bills = await fetchCompletedBills();
  const alerts: FraudAlert[] = [];

  for (const bill of bills) {
    const t = bill.parsed_data?.totals_and_tax_summary;

    const pDisc = (t?.parts_discount ?? 0) + (t?.parts_special_discount ?? 0);
    const lDisc = (t?.labour_discount ?? 0) + (t?.labour_special_discount ?? 0);

    const isInterParts = (bill.parts_igst_rate ?? 0) > 0;
    const isInterLabour = (bill.labour_igst_rate ?? 0) > 0;

    const partsIssues = checkGstSide(
      'Parts',
      bill.parts_amount ?? null,
      pDisc,
      isInterParts ? (bill.parts_igst_rate ?? 0) : (bill.parts_cgst_rate ?? 0) + (bill.parts_sgst_rate ?? 0),
      sum(bill.parts_cgst_amount, bill.parts_sgst_amount, bill.parts_igst_amount),
      isInterParts ? null : (bill.parts_cgst_rate ?? null),
      isInterParts ? null : (bill.parts_sgst_rate ?? null),
      isInterParts ? null : (bill.parts_cgst_amount ?? null),
      isInterParts ? null : (bill.parts_sgst_amount ?? null),
    );

    const labourIssues = checkGstSide(
      'Labour',
      bill.labour_amount ?? null,
      lDisc,
      isInterLabour ? (bill.labour_igst_rate ?? 0) : (bill.labour_cgst_rate ?? 0) + (bill.labour_sgst_rate ?? 0),
      sum(bill.labour_cgst_amount, bill.labour_sgst_amount, bill.labour_igst_amount),
      isInterLabour ? null : (bill.labour_cgst_rate ?? null),
      isInterLabour ? null : (bill.labour_sgst_rate ?? null),
      isInterLabour ? null : (bill.labour_cgst_amount ?? null),
      isInterLabour ? null : (bill.labour_sgst_amount ?? null),
    );

    const issues = [...partsIssues, ...labourIssues];

    if (issues.length) {
      alerts.push({
        type: 'GST_MISMATCH',
        severity: 'MEDIUM',
        message: `GST mismatch on invoice ${bill.invoice_number ?? bill.bill_id}`,
        bill_ids: [bill.bill_id],
        details: {
          invoice_number: bill.invoice_number,
          vendor: bill.vendor_name,
          grand_total: bill.grand_total_amount,
          issues,
        },
      });
    }
  }

  return alerts;
}

export async function detectPriceAnomalies(thresholdPct = 50): Promise<FraudAlert[]> {
  const parts = await fetchAllParts();
  const alerts: FraudAlert[] = [];
  const byPart = new Map<string, BillPartDoc[]>();

  for (const part of parts) {
    if (part.line_type !== 'PART') continue;
    const key = (part.normalized_name ?? part.name ?? '').toLowerCase().trim();
    if (!key || !part.rate) continue;
    const group = byPart.get(key) ?? [];
    group.push(part);
    byPart.set(key, group);
  }

  for (const [name, group] of byPart) {
    if (group.length < 3) continue;
    const rates = group.map((p) => p.rate!).sort((a, b) => a - b);
    const median = rates[Math.floor(rates.length / 2)];
    const threshold = median * (1 + thresholdPct / 100);

    for (const part of group) {
      if (part.rate! > threshold) {
        alerts.push({
          type: 'PRICE_ANOMALY',
          severity: 'MEDIUM',
          message: `${part.name} priced at ₹${part.rate} (median: ₹${median})`,
          bill_ids: [part.bill_id],
          details: { part_name: name, price: part.rate, median, threshold },
        });
      }
    }
  }

  return alerts;
}

export async function detectOdometerInconsistency(): Promise<FraudAlert[]> {
  const bills = await fetchCompletedBills();
  const alerts: FraudAlert[] = [];
  const byVehicle = new Map<string, BillDoc[]>();

  for (const bill of bills) {
    if (!bill.odometer_reading || bill.odometer_reading <= 0) continue;
    const vid = bill.vehicle_id ?? bill.registration_number ?? '';
    if (!vid) continue;
    const group = byVehicle.get(vid) ?? [];
    group.push(bill);
    byVehicle.set(vid, group);
  }

  for (const [vid, group] of byVehicle) {
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1].odometer_reading ?? 0;
      const curr = group[i].odometer_reading ?? 0;
      if (curr < prev) {
        alerts.push({
          type: 'ODOMETER_INCONSISTENCY',
          severity: 'HIGH',
          message: `Odometer went backward for ${vid}: ${prev} → ${curr} km`,
          bill_ids: [group[i - 1].bill_id, group[i].bill_id],
          details: {
            vehicle: vid,
            previous_reading: prev,
            current_reading: curr,
            previous_date: group[i - 1].invoice_date,
            current_date: group[i].invoice_date,
          },
        });
      }
    }
  }

  return alerts;
}

// ─── Combined Scan ──────────────────────────────────────────────────────────

export async function runAllChecks(): Promise<FraudAlert[]> {
  const [dupes, gst, prices, odometer] = await Promise.all([
    detectDuplicateInvoices(),
    detectGstAnomalies(),
    detectPriceAnomalies(),
    detectOdometerInconsistency(),
  ]);
  return [...dupes, ...gst, ...prices, ...odometer];
}
