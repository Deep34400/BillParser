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

interface GstSide {
  label: string;
  grossAmount: number | null;
  discount: number | null;
  special_discount: number | null;
  cgstRate: number | null;
  sgstRate: number | null;
  igstRate: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
}

// ─── Helpers (used by detection functions below) ─────────────────────────────

function sumNums(...vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Validate GST on one side (parts or labour).
 * taxable base = gross − discount. GST = taxable × rate%.
 * Tolerance: max(₹1, 1% of expected).
 */
function checkGstSide(side: GstSide): string[] {
  const issues: string[] = [];
  const totalGstAmount = sumNums(side.cgstAmount, side.sgstAmount, side.igstAmount);
  const hasRate = side.cgstRate != null || side.sgstRate != null || side.igstRate != null;
  if (side.grossAmount == null || totalGstAmount == null || !hasRate) return issues;

  const isInterState = (side.igstRate ?? 0) > 0 || (side.igstAmount ?? 0) > 0;

  if (!isInterState && side.cgstRate != null && side.sgstRate != null) {
    if (Math.abs(side.cgstRate - side.sgstRate) > 0.01) {
      issues.push(`${side.label}: CGST rate (${side.cgstRate}%) ≠ SGST rate (${side.sgstRate}%)`);
    }
    if (side.cgstAmount != null && side.sgstAmount != null &&
        Math.abs(side.cgstAmount - side.sgstAmount) > 1) {
      issues.push(`${side.label}: CGST amount (₹${side.cgstAmount}) ≠ SGST amount (₹${side.sgstAmount})`);
    }
  }

  const totalRate = isInterState
    ? (side.igstRate ?? 0)
    : (side.cgstRate ?? 0) + (side.sgstRate ?? 0);

  if (totalRate > 0) {
    const taxableBase = side.grossAmount - (side.discount ?? 0) - (side.special_discount ?? 0);
    const expected = Math.round(taxableBase * (totalRate / 100) * 100) / 100;
    const tolerance = Math.max(1, expected * 0.01);
    if (Math.abs(expected - totalGstAmount) > tolerance) {
      issues.push(
        `${side.label}: total GST expected ₹${expected} ` +
        `(₹${taxableBase} × ${totalRate}%), got ₹${round2(totalGstAmount)}`,
      );
    }
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
    const totals = bill.parsed_data?.totals_and_tax_summary;

    const partsIssues = checkGstSide({
      label: 'Parts',
      grossAmount: bill.parts_amount ?? null,
      discount: totals?.parts_discount ?? null,
      special_discount: totals?.parts_special_discount ?? null,
      cgstRate: bill.parts_cgst_rate ?? null,
      sgstRate: bill.parts_sgst_rate ?? null,
      igstRate: bill.parts_igst_rate ?? null,
      cgstAmount: bill.parts_cgst_amount ?? null,
      sgstAmount: bill.parts_sgst_amount ?? null,
      igstAmount: bill.parts_igst_amount ?? null,
    });

    const labourIssues = checkGstSide({
      label: 'Labour',
      grossAmount: bill.labour_amount ?? null,
      discount: totals?.labour_discount ?? null,
      special_discount: totals?.labour_special_discount ?? null,
      cgstRate: bill.labour_cgst_rate ?? null,
      sgstRate: bill.labour_sgst_rate ?? null,
      igstRate: bill.labour_igst_rate ?? null,
      cgstAmount: bill.labour_cgst_amount ?? null,
      sgstAmount: bill.labour_sgst_amount ?? null,
      igstAmount: bill.labour_igst_amount ?? null,
    });

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
