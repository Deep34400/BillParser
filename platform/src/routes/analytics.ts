import type { FastifyInstance } from 'fastify';
import { listBills } from '../models/bills.js';
import {
  getDashboard,
  getVehicleSpend,
  getVendorAnalytics,
  getCostPerKm,
  getOcrCostSummary,
} from '../services/analytics/analyticsService.js';
import type { BillDoc } from '../models/types.js';

export async function analyticsRoutes(app: FastifyInstance) {
  /**
   * GET /api/analytics — main analytics (frontend AnalyticsPage).
   * Returns KPIs + vendor breakdown + monthly breakdown +
   * vehicle spend + tax summary + dashboard.
   */
  app.get('/api/analytics', async () => {
    const bills = await listBills({ limit: 5000 });

    let totalSpend = 0;
    let completedCount = 0;
    let confidenceSum = 0;
    let needsReview = 0;
    let totalParts = 0;
    let totalLabour = 0;
    let totalTax = 0;
    const vendorTotals = new Map<string, number>();
    const monthTotals = new Map<string, number>();

    for (const bill of bills) {
      if (bill.ocr_status === 'OCR_COMPLETED' || bill.ocr_status === 'VERIFIED') {
        completedCount++;
        const amount = bill.grand_total_amount ?? 0;
        totalSpend += amount;
        totalParts += bill.parts_amount ?? 0;
        totalLabour += bill.labour_amount ?? 0;
        totalTax += bill.total_tax_amount ?? 0;

        if (bill.confidence_score != null) confidenceSum += bill.confidence_score;
        if ((bill.confidence_score ?? 1) < 0.75 && bill.ocr_status !== 'VERIFIED') needsReview++;

        const vendor = bill.vendor_name ?? bill.company_name ?? 'Unknown';
        vendorTotals.set(vendor, (vendorTotals.get(vendor) ?? 0) + amount);

        if (bill.invoice_date) {
          const monthKey = bill.invoice_date.slice(0, 7);
          monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + amount);
        }
      }
    }

    const byVendor = Array.from(vendorTotals.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const byMonth = Array.from(monthTotals.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const vehicleSpend = await getVehicleSpend();
    const costPerKm = await getCostPerKm();
    const ocrCosts = await getOcrCostSummary();

    return {
      totalSpend,
      completedCount,
      avgConfidence: completedCount > 0 ? Math.round((confidenceSum / completedCount) * 100) / 100 : 0,
      needsReview,
      totalParts,
      totalLabour,
      totalTax,
      byVendor,
      byMonth,
      vendorCount: byVendor.length,
      vehicleCount: vehicleSpend.length,
      vehicleSpend,
      costPerKm,
      ocrCosts,
    };
  });

  app.get('/api/batches', async () => ({ batches: [] }));
}
