/**
 * Verify parsing accuracy for EVERY invoice already stored in the DB (the data produced by the
 * correct UI upload flow). For each, re-run the current footer/summary pipeline and the /api/parse
 * response shaping, then reconcile:  parts_net + labour_net  ==  grand_total  (within ₹1).
 *
 * Read-only — never writes to the DB, so the UI flow is untouched.
 *
 * Usage (DB is exposed on localhost:5433 by docker-compose):
 *   DATABASE_URL='postgresql://invoice:invoice@localhost:5433/invoice?schema=public' \
 *     npx tsx scripts/check-db.ts
 */
import { prisma } from '../src/config/db.js';
import { resolveBillSummary, columnNet } from '../src/billing/billSummary.js';
import { toApiParsed } from '../src/response/apiResponse.js';
import type { ParsedInvoiceData } from '../src/parsing/types.js';

type Verdict = 'PASS' | 'FAIL' | 'REVIEW';

function money(n: number | null): string {
  return n == null ? '—' : n.toFixed(2).padStart(11);
}

async function main(): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, fileName: true, vendorName: true, parsedData: true, rawText: true, totalAmount: true, status: true },
  });
  console.log(`\nVerifying ${invoices.length} invoice(s) from DB\n`);
  console.log('  verdict   parts_net    labour_net          sum         grand   vendor / file');
  console.log('  ' + '-'.repeat(96));

  let pass = 0, fail = 0, review = 0;
  for (const inv of invoices) {
    const label = `${inv.vendorName ?? '?'} — ${inv.fileName ?? inv.id.slice(0, 8)}`;
    const parsed = inv.parsedData as ParsedInvoiceData | null;
    let verdict: Verdict; let note = '';
    let partsNet: number | null = null, labourNet: number | null = null, sum: number | null = null, grand: number | null = null;

    if (!parsed) {
      verdict = 'REVIEW'; note = `no parsed_data (status ${inv.status})`;
    } else {
      const t = resolveBillSummary(parsed, inv.rawText ?? undefined);
      // Exercise the API shaping too, so a shaping bug would surface here as well.
      toApiParsed({ ...parsed, totals_and_tax_summary: t });
      partsNet = columnNet(t, 'parts');
      labourNet = columnNet(t, 'labour');
      grand = t.grand_total_invoice ?? inv.totalAmount ?? null;
      // Insurance bills add a customer-borne deductible / salvage on top of the parts+labour net.
      const extra = (t.deductibles ?? 0) + (t.salvage ?? 0);
      if (partsNet == null && labourNet == null && extra === 0) { verdict = 'REVIEW'; note = 'no column totals'; }
      else if (grand == null) { verdict = 'REVIEW'; note = 'no grand total'; sum = (partsNet ?? 0) + (labourNet ?? 0) + extra; }
      else {
        sum = (partsNet ?? 0) + (labourNet ?? 0) + extra;
        const ok = Math.abs(sum - grand) <= 1 || Math.round(sum) === Math.round(grand);
        verdict = ok ? 'PASS' : 'FAIL';
      }
    }

    if (verdict === 'PASS') pass++; else if (verdict === 'FAIL') fail++; else review++;
    const mark = verdict === 'PASS' ? 'PASS ' : verdict === 'FAIL' ? 'FAIL ' : 'REVIEW';
    console.log(`  ${mark}  ${money(partsNet)} ${money(labourNet)} ${money(sum)} ${money(grand)}   ${label}${note ? '  (' + note + ')' : ''}`);
  }

  console.log('\n  ' + '-'.repeat(96));
  console.log(`  ${pass} PASS   ${fail} FAIL   ${review} REVIEW   of ${invoices.length} total\n`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(2); });
